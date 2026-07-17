"use strict"

/**
 * Prepare the bundled runtime used by the desktop app's strict offline
 * first-launch bootstrap.
 *
 * The generated payload lives under apps/desktop/resources:
 *   - python/                 full Windows Python runtime with venv + pip
 *   - git/                    Git for Windows runtime with Git Bash
 *   - wheels/*.whl            maliang-agent[all] wheelhouse
 *   - wheels/offline-runtime.json
 *   - install.ps1             bundled fallback installer script
 *
 * The target install machine never needs network access. Any downloads happen
 * here, on the packaging machine, before electron-builder creates the .exe.
 */

const crypto = require("node:crypto")
const fs = require("node:fs")
const https = require("node:https")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const APP_ROOT = path.resolve(__dirname, "..")
const REPO_ROOT = path.resolve(APP_ROOT, "..", "..")
const RESOURCES_ROOT = path.join(APP_ROOT, "resources")
const PYTHON_ROOT = path.join(RESOURCES_ROOT, "python")
const GIT_ROOT = path.join(RESOURCES_ROOT, "git")
const WHEELS_ROOT = path.join(RESOURCES_ROOT, "wheels")
const OFFLINE_MANIFEST = path.join(WHEELS_ROOT, "offline-runtime.json")
const DEFAULT_PYTHON_VERSION = "3.11.13"
const DEFAULT_GIT_VERSION = "2.54.0"
const DEFAULT_GIT_RELEASE = "v2.54.0.windows.1"

function usage() {
  console.log(`Usage: node scripts/prepare-offline-runtime.cjs [options]

Options:
  --refresh-wheels           Rebuild the wheelhouse even if wheels already exist.
  --python-source <dir>      Copy a prepared Python runtime directory.
  --python-archive <file>    Extract a local .zip/.nupkg Python runtime.
  --download-python          Download Python from NuGet if resources/python is missing.
  --python-version <ver>     Python NuGet version for --download-python (default ${DEFAULT_PYTHON_VERSION}).
  --git-source <dir>         Copy a prepared Git for Windows directory.
  --git-archive <file>       Extract a local PortableGit .7z.exe or .zip archive.
  --download-git             Download PortableGit if resources/git is missing.
  --git-version <ver>        Git for Windows version for --download-git (default ${DEFAULT_GIT_VERSION}).
  --allow-online-fallback    Manifest allows runtime fallback to install.ps1 downloads.
  --no-install-check         Skip temp-venv offline install verification.
  --pip-index-url <url>      PyPI mirror for downloading missing wheels (e.g. https://pypi.tuna.tsinghua.edu.cn/simple/).
  --china-mirror             Use Tsinghua PyPI mirror (shortcut for --pip-index-url).
  --help                     Show this help.

Examples:
  npm run prepare:offline
  npm run prepare:offline -- --refresh-wheels
  npm run prepare:offline -- --python-archive C:\\cache\\python.3.11.13.nupkg
  npm run prepare:offline -- --git-archive C:\\cache\\PortableGit-2.54.0-64-bit.7z.exe
  npm run prepare:offline -- --refresh-wheels --china-mirror
`)
}

function parseArgs(argv) {
  const opts = {
    allowOnlineFallback: false,
    downloadPython: false,
    downloadGit: false,
    gitArchive: null,
    gitSource: process.env.MALIANG_DESKTOP_GIT_SOURCE || null,
    gitVersion: process.env.MALIANG_DESKTOP_OFFLINE_GIT_VERSION || DEFAULT_GIT_VERSION,
    installCheck: true,
    pipIndexUrl: process.env.PIP_INDEX_URL || null,
    pythonArchive: null,
    pythonSource: process.env.MALIANG_DESKTOP_PYTHON_SOURCE || null,
    pythonVersion: process.env.MALIANG_DESKTOP_OFFLINE_PYTHON_VERSION || DEFAULT_PYTHON_VERSION,
    refreshWheels: false
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      opts.help = true
    } else if (arg === "--refresh-wheels") {
      opts.refreshWheels = true
    } else if (arg === "--download-python") {
      opts.downloadPython = true
    } else if (arg === "--download-git") {
      opts.downloadGit = true
    } else if (arg === "--allow-online-fallback") {
      opts.allowOnlineFallback = true
    } else if (arg === "--no-install-check") {
      opts.installCheck = false
    } else if (arg === "--python-source") {
      opts.pythonSource = argv[++i]
    } else if (arg === "--python-archive") {
      opts.pythonArchive = argv[++i]
    } else if (arg === "--python-version") {
      opts.pythonVersion = argv[++i]
    } else if (arg === "--git-source") {
      opts.gitSource = argv[++i]
    } else if (arg === "--git-archive") {
      opts.gitArchive = argv[++i]
    } else if (arg === "--git-version") {
      opts.gitVersion = argv[++i]
    } else if (arg === "--pip-index-url") {
      opts.pipIndexUrl = argv[++i]
    } else if (arg === "--china-mirror") {
      opts.pipIndexUrl = "https://pypi.tuna.tsinghua.edu.cn/simple/"
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  return opts
}

function die(message) {
  console.error(`[prepare-offline-runtime] ERROR: ${message}`)
  process.exit(1)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

function copyDir(src, dest) {
  rmrf(dest)
  ensureDir(path.dirname(dest))
  fs.cpSync(src, dest, { recursive: true })
}

function copyGitDir(src, dest) {
  rmrf(dest)
  ensureDir(path.dirname(dest))
  fs.cpSync(src, dest, {
    recursive: true,
    filter: source => {
      const name = path.basename(source).toLowerCase()
      return !(
        name === "tmp" ||
        name === "unins000.exe" ||
        name === "unins000.dat" ||
        name === "unins000.msg"
      )
    }
  })
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || REPO_ROOT,
    env: opts.env || process.env,
    encoding: "utf8",
    stdio: opts.stdio || "inherit",
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}`)
  }
  return result
}

function runCapture(cmd, args, opts = {}) {
  return run(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] }).stdout.trim()
}

function powershell() {
  const systemRoot = process.env.SystemRoot || process.env.windir
  if (systemRoot) {
    const candidate = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    if (fs.existsSync(candidate)) return candidate
  }
  return "powershell.exe"
}

function download(url, dest) {
  ensureDir(path.dirname(dest))
  return new Promise((resolve, reject) => {
    const request = currentUrl => {
      const out = fs.createWriteStream(dest + ".tmp")
      https
        .get(currentUrl, res => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            out.close()
            rmrf(dest + ".tmp")
            request(res.headers.location)
            return
          }
          if (res.statusCode !== 200) {
            out.close()
            rmrf(dest + ".tmp")
            reject(new Error(`HTTP ${res.statusCode} from ${currentUrl}`))
            return
          }
          res.pipe(out)
          out.on("finish", () => {
            out.close()
            fs.renameSync(dest + ".tmp", dest)
            resolve(dest)
          })
        })
        .on("error", err => {
          rmrf(dest + ".tmp")
          reject(err)
        })
    }
    request(url)
  })
}

function expandArchive(archive, dest) {
  rmrf(dest)
  ensureDir(dest)
  run(powershell(), [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
    archive,
    dest
  ])
}

function findPythonRuntimeRoot(expandedDir) {
  const direct = path.join(expandedDir, "python.exe")
  if (fs.existsSync(direct)) return expandedDir
  const tools = path.join(expandedDir, "tools")
  if (fs.existsSync(path.join(tools, "python.exe"))) return tools
  const stack = [expandedDir]
  while (stack.length) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(current, entry.name)
      if (fs.existsSync(path.join(candidate, "python.exe"))) return candidate
      stack.push(candidate)
    }
  }
  return null
}

function findGitRuntimeRoot(expandedDir) {
  const hasGit = dir => fs.existsSync(path.join(dir, "bin", "bash.exe")) && fs.existsSync(path.join(dir, "cmd", "git.exe"))
  if (hasGit(expandedDir)) return expandedDir
  const stack = [expandedDir]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(current, entry.name)
      if (hasGit(candidate)) return candidate
      stack.push(candidate)
    }
  }
  return null
}

function findInstalledGitRoot() {
  const candidates = [
    process.env.MALIANG_DESKTOP_GIT_SOURCE,
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Git") : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "maliang", "git") : null
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (findGitRuntimeRoot(candidate) === candidate) return candidate
  }
  return null
}

async function ensureBundledPython(opts) {
  if (fs.existsSync(path.join(PYTHON_ROOT, "python.exe")) && !opts.pythonSource && !opts.pythonArchive) {
    console.log(`[prepare-offline-runtime] using existing Python runtime at ${PYTHON_ROOT}`)
    return
  }

  if (opts.pythonSource) {
    const source = path.resolve(opts.pythonSource)
    if (!fs.existsSync(path.join(source, "python.exe"))) {
      die(`--python-source must point to a Windows Python runtime containing python.exe: ${source}`)
    }
    console.log(`[prepare-offline-runtime] copying Python runtime from ${source}`)
    copyDir(source, PYTHON_ROOT)
    return
  }

  let archive = opts.pythonArchive && path.resolve(opts.pythonArchive)
  if (!archive && opts.downloadPython) {
    const cacheDir = path.join(APP_ROOT, "build", "offline-cache")
    archive = path.join(cacheDir, `python.${opts.pythonVersion}.nupkg`)
    if (!fs.existsSync(archive)) {
      const url = `https://www.nuget.org/api/v2/package/python/${opts.pythonVersion}`
      console.log(`[prepare-offline-runtime] downloading ${url}`)
      await download(url, archive)
    }
  }

  if (!archive) {
    die(
      "resources/python is missing. Provide --python-source, --python-archive, " +
        "or --download-python on a machine allowed to fetch packaging assets."
    )
  }

  const expanded = path.join(APP_ROOT, "build", "offline-python-expanded")
  console.log(`[prepare-offline-runtime] extracting Python archive ${archive}`)
  expandArchive(archive, expanded)
  const runtimeRoot = findPythonRuntimeRoot(expanded)
  if (!runtimeRoot) die(`could not find python.exe inside ${archive}`)
  copyDir(runtimeRoot, PYTHON_ROOT)
}

function bundledPython() {
  return path.join(PYTHON_ROOT, "python.exe")
}

function verifyBundledPython() {
  const python = bundledPython()
  if (!fs.existsSync(python)) die(`missing bundled Python at ${python}`)
  const version = runCapture(python, ["--version"])
  runCapture(python, ["-m", "venv", "--help"])
  runCapture(python, ["-m", "pip", "--version"])
  console.log(`[prepare-offline-runtime] ${version}`)
  return version
}

function gitArchiveAssetName(opts) {
  if (process.arch === "arm64") return `PortableGit-${opts.gitVersion}-arm64.7z.exe`
  if (process.arch === "x64") return `PortableGit-${opts.gitVersion}-64-bit.7z.exe`
  die("offline Git bundling supports Windows x64/arm64 PortableGit only")
}

async function ensureBundledGit(opts) {
  if (fs.existsSync(path.join(GIT_ROOT, "bin", "bash.exe")) && fs.existsSync(path.join(GIT_ROOT, "cmd", "git.exe")) && !opts.gitSource && !opts.gitArchive) {
    console.log(`[prepare-offline-runtime] using existing Git runtime at ${GIT_ROOT}`)
    return
  }

  let source = opts.gitSource && path.resolve(opts.gitSource)
  if (!source) {
    source = findInstalledGitRoot()
  }
  if (source) {
    const runtimeRoot = findGitRuntimeRoot(source)
    if (!runtimeRoot) {
      die(`Git source must contain bin\\bash.exe and cmd\\git.exe: ${source}`)
    }
    console.log(`[prepare-offline-runtime] copying Git runtime from ${runtimeRoot}`)
    copyGitDir(runtimeRoot, GIT_ROOT)
    return
  }

  let archive = opts.gitArchive && path.resolve(opts.gitArchive)
  if (!archive && opts.downloadGit) {
    const cacheDir = path.join(APP_ROOT, "build", "offline-cache")
    const assetName = gitArchiveAssetName(opts)
    archive = path.join(cacheDir, assetName)
    if (!fs.existsSync(archive)) {
      const release = opts.gitVersion === DEFAULT_GIT_VERSION ? DEFAULT_GIT_RELEASE : `v${opts.gitVersion}.windows.1`
      const url = `https://github.com/git-for-windows/git/releases/download/${release}/${assetName}`
      console.log(`[prepare-offline-runtime] downloading ${url}`)
      await download(url, archive)
    }
  }

  if (!archive) {
    die(
      "resources/git is missing. Install Git for Windows on the packaging machine, " +
        "or provide --git-source, --git-archive, or --download-git."
    )
  }

  const expanded = path.join(APP_ROOT, "build", "offline-git-expanded")
  console.log(`[prepare-offline-runtime] extracting Git archive ${archive}`)
  rmrf(expanded)
  ensureDir(expanded)
  if (/\.zip$/i.test(archive)) {
    expandArchive(archive, expanded)
  } else {
    run(archive, [`-o${expanded}`, "-y"])
  }
  const runtimeRoot = findGitRuntimeRoot(expanded)
  if (!runtimeRoot) die(`could not find bin\\bash.exe and cmd\\git.exe inside ${archive}`)
  copyGitDir(runtimeRoot, GIT_ROOT)
}

function bundledGitBash() {
  return path.join(GIT_ROOT, "bin", "bash.exe")
}

function bundledGitExe() {
  return path.join(GIT_ROOT, "cmd", "git.exe")
}

function verifyBundledGit() {
  const bash = bundledGitBash()
  const git = bundledGitExe()
  if (!fs.existsSync(bash)) die(`missing bundled Git Bash at ${bash}`)
  if (!fs.existsSync(git)) die(`missing bundled git.exe at ${git}`)
  const gitVersion = runCapture(git, ["--version"])
  const bashVersion = runCapture(bash, ["--version"]).split(/\r?\n/)[0]
  console.log(`[prepare-offline-runtime] ${gitVersion}`)
  console.log(`[prepare-offline-runtime] ${bashVersion}`)
  return { bashVersion, gitVersion }
}

function wheelFiles() {
  if (!fs.existsSync(WHEELS_ROOT)) return []
  return fs
    .readdirSync(WHEELS_ROOT)
    .filter(name => name.endsWith(".whl"))
    .sort((a, b) => a.localeCompare(b))
}

function stageInstallerScript() {
  const source = path.join(REPO_ROOT, "scripts", "install.ps1")
  const dest = path.join(RESOURCES_ROOT, "install.ps1")
  if (fs.existsSync(source)) {
    ensureDir(RESOURCES_ROOT)
    fs.copyFileSync(source, dest)
    console.log(`[prepare-offline-runtime] staged ${path.relative(APP_ROOT, dest)}`)
  }
}

function prepareWheelhouse(opts) {
  const existing = wheelFiles()
  const hasMaliangWheel = existing.some(name => /^maliang_agent-.*\.whl$/i.test(name))
  if (hasMaliangWheel && !opts.refreshWheels) {
    console.log(`[prepare-offline-runtime] using existing wheelhouse (${existing.length} wheels)`)
    return
  }

  console.log("[prepare-offline-runtime] building maliang-agent[all] wheelhouse")
  const seedRoot = path.join(APP_ROOT, "build", "offline-wheel-seed")
  rmrf(seedRoot)
  if (existing.length > 0) {
    fs.cpSync(WHEELS_ROOT, seedRoot, { recursive: true })
  }
  rmrf(WHEELS_ROOT)
  ensureDir(WHEELS_ROOT)

  const pipArgs = [
    "-m",
    "pip",
    "wheel",
    "--wheel-dir",
    WHEELS_ROOT,
    "--prefer-binary",
    "--find-links",
    seedRoot
  ]

  if (opts.pipIndexUrl) {
    pipArgs.push("--index-url", opts.pipIndexUrl)
    console.log(`[prepare-offline-runtime] using PyPI mirror: ${opts.pipIndexUrl}`)
  }

  pipArgs.push(".[all]")

  try {
    run(bundledPython(), pipArgs, {
      env: {
        ...process.env,
        ...(opts.pipIndexUrl ? { PIP_INDEX_URL: opts.pipIndexUrl } : {})
      }
    })
  } finally {
    rmrf(seedRoot)
  }
}

function verifyWheelhouse() {
  const wheels = wheelFiles()
  if (wheels.length === 0) die(`no .whl files found in ${WHEELS_ROOT}`)
  const maliangWheels = wheels.filter(name => /^maliang_agent-.*\.whl$/i.test(name))
  if (maliangWheels.length === 0) die("wheelhouse does not contain maliang_agent-*.whl")
  console.log(`[prepare-offline-runtime] wheelhouse contains ${wheels.length} wheels`)
  return wheels
}

function sha256(file) {
  const hash = crypto.createHash("sha256")
  hash.update(fs.readFileSync(file))
  return hash.digest("hex")
}

function writeManifest({ opts, pythonVersion, gitInfo, wheels }) {
  const manifest = {
    schemaVersion: 1,
    mode: opts.allowOnlineFallback ? "auto" : "offline",
    strictOffline: !opts.allowOnlineFallback,
    target: `${process.platform}-${process.arch}`,
    generatedAt: new Date().toISOString(),
    python: {
      version: pythonVersion,
      path: "python/python.exe"
    },
    git: {
      version: gitInfo.gitVersion,
      bashVersion: gitInfo.bashVersion,
      path: "git/bin/bash.exe",
      git: "git/cmd/git.exe"
    },
    package: {
      requirement: "maliang-agent[all]",
      wheels: wheels.filter(name => /^maliang_agent-.*\.whl$/i.test(name))
    },
    wheels: wheels.map(name => {
      const file = path.join(WHEELS_ROOT, name)
      return {
        file: name,
        bytes: fs.statSync(file).size,
        sha256: sha256(file)
      }
    })
  }
  fs.writeFileSync(OFFLINE_MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf8")
  console.log(`[prepare-offline-runtime] wrote ${path.relative(APP_ROOT, OFFLINE_MANIFEST)}`)
}

function verifyOfflineInstall() {
  const tempRoot = path.join(APP_ROOT, "build", "offline-install-check")
  const venv = path.join(tempRoot, "venv")
  const venvPython = path.join(venv, "Scripts", "python.exe")
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === "PATH") || "Path"
  const gitPathEntries = [
    path.join(GIT_ROOT, "cmd"),
    path.join(GIT_ROOT, "bin"),
    path.join(GIT_ROOT, "usr", "bin")
  ]
  const offlineEnv = {
    ...process.env,
    MALIANG_GIT_BASH_PATH: bundledGitBash(),
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_NO_INDEX: "1",
    PIP_FIND_LINKS: WHEELS_ROOT,
    [pathKey]: [...gitPathEntries, process.env[pathKey] || process.env.PATH || ""].filter(Boolean).join(path.delimiter)
  }
  rmrf(tempRoot)
  ensureDir(tempRoot)
  console.log("[prepare-offline-runtime] verifying bundled Git runtime")
  run(bundledGitExe(), ["--version"])
  run(bundledGitBash(), ["-lc", "echo maliang-git-bash-ok"])
  console.log("[prepare-offline-runtime] verifying install from wheelhouse with network disabled")
  run(bundledPython(), ["-m", "venv", "--copies", venv])
  run(venvPython, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--no-index",
    "--only-binary",
    ":all:",
    "--find-links",
    WHEELS_ROOT,
    "maliang-agent[all]"
  ], { env: offlineEnv })
  run(venvPython, ["-c", "import maliang_cli.main, tui_gateway.server"])
  run(venvPython, [
    "-c",
    [
      "import os, shutil",
      "from tools.environments.local import _find_bash",
      "bash = _find_bash()",
      "expected = os.environ['MALIANG_GIT_BASH_PATH']",
      "assert os.path.isfile(bash), bash",
      "assert os.path.normcase(bash) == os.path.normcase(expected), (bash, expected)",
      "assert shutil.which('git'), 'git not found on PATH'",
      "print(bash)"
    ].join("; ")
  ], { env: offlineEnv })
  rmrf(tempRoot)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    usage()
    return
  }
  if (process.platform !== "win32") {
    die("offline desktop runtime packaging currently prepares the Windows payload; run this on Windows")
  }

  ensureDir(RESOURCES_ROOT)
  await ensureBundledPython(opts)
  const pythonVersion = verifyBundledPython()
  await ensureBundledGit(opts)
  const gitInfo = verifyBundledGit()
  stageInstallerScript()
  prepareWheelhouse(opts)
  const wheels = verifyWheelhouse()
  writeManifest({ opts, pythonVersion, gitInfo, wheels })
  if (opts.installCheck) verifyOfflineInstall()
  console.log("[prepare-offline-runtime] offline runtime ready")
}

main().catch(err => die(err.message || String(err)))
