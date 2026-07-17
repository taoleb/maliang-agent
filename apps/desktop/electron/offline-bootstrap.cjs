'use strict'

/**
 * First-launch backend install using a bundled Python runtime plus a local
 * wheelhouse in resources/python and resources/wheels. This path never talks
 * to PyPI: pip runs with --no-index and installs the manifest's Maliang
 * package only from
 * the bundled wheels.
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const IS_WINDOWS = process.platform === 'win32'
const OFFLINE_MANIFEST_NAME = 'offline-runtime.json'

const OFFLINE_STAGES = [
  { name: 'offline-venv', title: 'Creating bundled Python environment', category: 'offline', needs_user_input: false },
  { name: 'offline-pip', title: 'Installing bundled Maliang wheels', category: 'offline', needs_user_input: false },
  { name: 'offline-verify', title: 'Verifying Maliang runtime', category: 'offline', needs_user_input: false },
  { name: 'bootstrap-marker', title: 'Marking install complete', category: 'finalize', needs_user_input: false }
]

function spawnAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const { abortSignal, ...spawnOpts } = opts
    const child = spawn(cmd, args, { windowsHide: true, shell: false, ...spawnOpts })
    let stdout = ''
    let stderr = ''
    let killed = false

    const onAbort = () => {
      killed = true
      try {
        child.kill('SIGTERM')
      } catch {
        void 0
      }
    }

    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort()
      } else {
        abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    }

    child.stdout.on('data', d => {
      stdout += d.toString()
    })
    child.stderr.on('data', d => {
      stderr += d.toString()
    })
    child.on('error', err => {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', code => {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort)
      if (killed) {
        reject(new Error('offline bootstrap cancelled by user'))
        return
      }
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${cmd} exited ${code}: ${(stderr || stdout).slice(0, 500)}`))
    })
  })
}

function emitSafely(onEvent, ev) {
  if (typeof onEvent !== 'function') return
  try {
    onEvent(ev)
  } catch {
    void 0
  }
}

function offlineManifestPath(resourcesPath = process.resourcesPath) {
  if (!resourcesPath) return null
  return path.join(resourcesPath, 'wheels', OFFLINE_MANIFEST_NAME)
}

function readOfflineManifest(resourcesPath = process.resourcesPath) {
  const manifestPath = offlineManifestPath(resourcesPath)
  if (!manifestPath) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    void 0
  }
  return null
}

function getOfflineBootstrapPolicy(env = process.env, resourcesPath = process.resourcesPath) {
  const requested = String(env.MALIANG_DESKTOP_BOOTSTRAP_MODE || '').trim().toLowerCase()
  if (requested === 'offline') return { mode: 'offline', strictOffline: true, source: 'env' }
  if (requested === 'online') return { mode: 'online', strictOffline: false, source: 'env' }
  if (requested === 'auto') return { mode: 'auto', strictOffline: false, source: 'env' }

  const manifest = readOfflineManifest(resourcesPath)
  const strictOffline = Boolean(
    manifest && (manifest.strictOffline === true || String(manifest.mode || '').toLowerCase() === 'offline')
  )
  return {
    mode: 'auto',
    strictOffline,
    source: manifest ? 'manifest' : 'default',
    manifest
  }
}

function bundledOfflineResources(resourcesPath = process.resourcesPath) {
  const resourcesPython = path.join(resourcesPath || '', 'python', IS_WINDOWS ? 'python.exe' : 'bin/python3')
  const resourcesWheels = path.join(resourcesPath || '', 'wheels')
  return {
    resourcesPath,
    python: resourcesPython,
    wheels: resourcesWheels,
    pythonExists: Boolean(resourcesPath && fs.existsSync(resourcesPython)),
    wheelsExists: Boolean(resourcesPath && fs.existsSync(resourcesWheels))
  }
}

async function runOfflineBootstrap({ activeRoot, installStamp, onEvent, writeMarker, abortSignal }) {
  const emit = ev => emitSafely(onEvent, ev)
  const venvRoot = path.join(activeRoot, 'venv')
  const resources = bundledOfflineResources(process.resourcesPath)
  const manifest = readOfflineManifest(process.resourcesPath)
  const packageRequirement = typeof manifest?.package?.requirement === 'string' ? manifest.package.requirement : 'maliang-agent[all]'

  if (!process.resourcesPath || !resources.pythonExists || !resources.wheelsExists) {
    emit({
      type: 'log',
      line:
        `[offline] skipped offline bootstrap: resourcesPath=${process.resourcesPath || 'undefined'} ` +
        `pythonExists=${resources.pythonExists} wheelsExists=${resources.wheelsExists} ` +
        `(looked for ${resources.python} and ${resources.wheels})`
    })
    return { ok: false, reason: 'no bundled offline resources' }
  }

  const venvPython = path.join(venvRoot, IS_WINDOWS ? 'Scripts\\python.exe' : 'bin/python')

  try {
    emit({ type: 'manifest', stages: OFFLINE_STAGES, protocolVersion: 'offline-v1' })
    emit({
      type: 'log',
      line: `[offline] using bundled runtime from ${process.resourcesPath}; python=${resources.python}; wheels=${resources.wheels}`
    })

    emit({ type: 'stage', name: 'offline-venv', state: 'running' })
    fs.mkdirSync(activeRoot, { recursive: true })
    await spawnAsync(resources.python, ['-m', 'venv', '--copies', venvRoot], { abortSignal })
    emit({ type: 'stage', name: 'offline-venv', state: 'succeeded' })

    emit({ type: 'stage', name: 'offline-pip', state: 'running' })
    await spawnAsync(
      venvPython,
      [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-index',
        '--only-binary',
        ':all:',
        '--find-links',
        resources.wheels,
        packageRequirement
      ],
      {
        abortSignal,
        env: {
          ...process.env,
          PIP_DISABLE_PIP_VERSION_CHECK: '1',
          PIP_NO_INDEX: '1',
          PIP_FIND_LINKS: resources.wheels
        }
      }
    )
    emit({ type: 'stage', name: 'offline-pip', state: 'succeeded' })

    emit({ type: 'stage', name: 'offline-verify', state: 'running' })
    await spawnAsync(venvPython, ['-c', 'import maliang_cli.main'], { abortSignal })
    emit({ type: 'stage', name: 'offline-verify', state: 'succeeded' })

    emit({ type: 'stage', name: 'bootstrap-marker', state: 'running' })
    let marker = null
    if (typeof writeMarker === 'function') {
      marker = await writeMarker({ pinnedCommit: installStamp?.commit, pinnedBranch: installStamp?.branch || null })
    }
    emit({ type: 'stage', name: 'bootstrap-marker', state: 'succeeded' })
    emit({ type: 'complete', marker })
    return { ok: true, venvRoot, marker }
  } catch (err) {
    emit({ type: 'stage', name: 'offline', state: 'failed', error: String(err?.message || err) })
    return { ok: false, reason: String(err?.message || err) }
  }
}

module.exports = {
  bundledOfflineResources,
  getOfflineBootstrapPolicy,
  offlineManifestPath,
  readOfflineManifest,
  runOfflineBootstrap
}
