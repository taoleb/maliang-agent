'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  getOfflineBootstrapPolicy,
  offlineManifestPath,
  readOfflineManifest,
  runOfflineBootstrap
} = require('./offline-bootstrap.cjs')

function withTempResources(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maliang-offline-bootstrap-'))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('offline manifest path lives inside wheels resource directory', () => {
  withTempResources(resourcesPath => {
    assert.equal(offlineManifestPath(resourcesPath), path.join(resourcesPath, 'wheels', 'offline-runtime.json'))
  })
})

test('missing offline manifest keeps bootstrap in non-strict auto mode', () => {
  withTempResources(resourcesPath => {
    const policy = getOfflineBootstrapPolicy({}, resourcesPath)
    assert.equal(policy.mode, 'auto')
    assert.equal(policy.strictOffline, false)
    assert.equal(policy.source, 'default')
  })
})

test('offline manifest makes packaged bootstrap strict offline by default', () => {
  withTempResources(resourcesPath => {
    const wheels = path.join(resourcesPath, 'wheels')
    fs.mkdirSync(wheels, { recursive: true })
    fs.writeFileSync(path.join(wheels, 'offline-runtime.json'), JSON.stringify({ strictOffline: true }), 'utf8')

    assert.deepEqual(readOfflineManifest(resourcesPath), { strictOffline: true })
    const policy = getOfflineBootstrapPolicy({}, resourcesPath)
    assert.equal(policy.mode, 'auto')
    assert.equal(policy.strictOffline, true)
    assert.equal(policy.source, 'manifest')
  })
})

test('MALIANG_DESKTOP_BOOTSTRAP_MODE=auto overrides strict offline manifest', () => {
  withTempResources(resourcesPath => {
    const wheels = path.join(resourcesPath, 'wheels')
    fs.mkdirSync(wheels, { recursive: true })
    fs.writeFileSync(path.join(wheels, 'offline-runtime.json'), JSON.stringify({ strictOffline: true }), 'utf8')

    const policy = getOfflineBootstrapPolicy({ MALIANG_DESKTOP_BOOTSTRAP_MODE: 'auto' }, resourcesPath)
    assert.equal(policy.mode, 'auto')
    assert.equal(policy.strictOffline, false)
    assert.equal(policy.source, 'env')
  })
})

test('MALIANG_DESKTOP_BOOTSTRAP_MODE=offline forces strict offline without manifest', () => {
  withTempResources(resourcesPath => {
    const policy = getOfflineBootstrapPolicy({ MALIANG_DESKTOP_BOOTSTRAP_MODE: 'offline' }, resourcesPath)
    assert.equal(policy.mode, 'offline')
    assert.equal(policy.strictOffline, true)
    assert.equal(policy.source, 'env')
  })
})

test('runOfflineBootstrap returns a clean skip when bundled resources are absent', async () => {
  await withTempResources(async resourcesPath => {
    const oldResourcesPath = process.resourcesPath
    process.resourcesPath = resourcesPath
    const events = []
    try {
      const result = await runOfflineBootstrap({
        activeRoot: path.join(resourcesPath, 'active'),
        installStamp: { commit: '0123456789abcdef' },
        onEvent: ev => events.push(ev),
        writeMarker: () => {
          throw new Error('writeMarker should not run')
        }
      })
      assert.equal(result.ok, false)
      assert.match(result.reason, /no bundled offline resources/)
      assert.equal(events.some(ev => ev.type === 'log' && /skipped offline bootstrap/.test(ev.line)), true)
    } finally {
      process.resourcesPath = oldResourcesPath
    }
  })
})
