'use strict'

// Regression guards for Windows `maliang` resolution in main.cjs.
//
// main.cjs has no module.exports, so these follow the repo's source-assertion
// test pattern (see windows-child-process.test.cjs). They pin the two Windows
// resolution bugs that caused desktop reinstall loops:
//   1. findOnPath() tried the empty extension FIRST, so an extensionless
//      Git-Bash `maliang` shim shadowed the real maliang.cmd/maliang.exe; the
//      shim then failed the --version probe and the desktop fell through to a
//      spurious bootstrap/repair.
//   2. handOffWindowsBootstrapRecovery() chose --update vs the destructive
//      --repair by checking ONLY venv\Scripts\maliang.exe (the console-script
//      shim, written at the END of venv setup and absent in interrupted
//      states), so it escalated to a full venv recreate even on healthy
//      installs.
//   3. unwrapWindowsVenvMaliangCommand() returned the venv python with NO
//      runtime probe (bypassing the caller's --version check too), so a venv
//      broken mid-update (e.g. missing python-dotenv) was re-selected forever:
//      Retry / "Repair install" resolved the same dead interpreter instead of
//      falling through to the bootstrap installer.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function readMain() {
  return fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8').replace(/\r\n/g, '\n')
}

test('findOnPath tries PATHEXT extensions before the bare (empty) name on Windows', () => {
  const source = readMain()
  // Fixed order: PATHEXT first, empty string LAST.
  assert.match(
    source,
    /\(process\.env\.PATHEXT \|\| '\.COM;\.EXE;\.BAT;\.CMD'\)\.split\(';'\)\.filter\(Boolean\), ''\]/,
    'extensions array must end with the empty string, not start with it'
  )
  // The buggy empty-first order must not return.
  assert.doesNotMatch(
    source,
    /\['', \.\.\.\(process\.env\.PATHEXT/,
    'empty-extension-first order regressed: an extensionless shim can shadow maliang.cmd/.exe'
  )
})

test('Windows bootstrap recovery chooses --update when any real-install signal is present', () => {
  const source = readMain()
  assert.match(source, /const haveRealInstall =/, 'recovery must compute haveRealInstall')
  assert.match(source, /fileExists\(venvPython\)/, 'recovery must accept the venv interpreter as a real-install signal')
  assert.match(
    source,
    /\.maliang-bootstrap-complete/,
    'recovery must accept the bootstrap-complete marker as a real-install signal'
  )
  assert.match(source, /updaterArgs = haveRealInstall \? \['--update'/, 'updaterArgs must gate on haveRealInstall')
  // The old too-narrow check (only venv\Scripts\maliang.exe) must not return.
  assert.doesNotMatch(
    source,
    /updaterArgs = fileExists\(venvMaliang\) \?/,
    'recovery regressed to gating only on the maliang.exe shim, which forces destructive --repair'
  )
})

test('unwrapWindowsVenvMaliangCommand smoke-tests the venv python before trusting it', () => {
  const source = readMain()
  const fnStart = source.indexOf('function unwrapWindowsVenvMaliangCommand(')
  assert.notEqual(fnStart, -1, 'unwrapWindowsVenvMaliangCommand must exist in main.cjs')
  // Slice out just the function body (up to the next top-level function decl)
  const fnEnd = source.indexOf('\nfunction ', fnStart + 1)
  const body = source.slice(fnStart, fnEnd === -1 ? undefined : fnEnd)
  assert.match(
    body,
    /canImportMaliangCli\(python/,
    'unwrap must probe the venv interpreter; returning it unprobed re-selects a broken venv ' +
      'forever (Retry/Repair loop on a mid-update venv missing e.g. python-dotenv)'
  )
  assert.match(
    body,
    /return null\s*\n\s*\}\s*\n\s*return \{/,
    'a failed probe must fall through (return null) so the resolver reaches the bootstrap rung'
  )
})

test('missing Git Bash does not block desktop startup', () => {
  const source = readMain()
  const checkStart = source.indexOf('if (IS_WINDOWS && !findGitBash())')
  assert.notEqual(checkStart, -1, 'main.cjs should still detect missing Git Bash for logging')
  const checkEnd = source.indexOf('\n\n  const venvPython = getVenvPython', checkStart)
  const body = source.slice(checkStart, checkEnd === -1 ? undefined : checkEnd)
  assert.doesNotMatch(
    body,
    /throw new Error/,
    'Git Bash is only needed for the local terminal tool; missing Git must not prevent offline desktop startup'
  )
  assert.match(
    body,
    /continuing without local terminal tool support/,
    'missing Git Bash should be logged as a terminal-tool limitation'
  )
})

test('packaged Windows build prefers bundled Git runtime for backend and terminal', () => {
  const source = readMain()

  assert.match(source, /function bundledGitRoot\(\)/, 'main.cjs must resolve a bundled Git root')
  assert.match(source, /path\.join\(root, 'git'\)/, 'bundled Git must live under resources/git')
  assert.match(source, /'bin', 'bash\.exe'/, 'bundled Git Bash path must be checked')
  assert.match(source, /'cmd', 'git\.exe'/, 'bundled git.exe path must be checked')

  const bashStart = source.indexOf('function findGitBash()')
  const bashEnd = source.indexOf('\nfunction getVenvPython', bashStart)
  const bashBody = source.slice(bashStart, bashEnd)
  assert.ok(
    bashBody.indexOf('const bundled = bundledGitBashPath()') < bashBody.indexOf('const localAppData'),
    'findGitBash should check packaged resources before user/system Git installs'
  )

  const gitStart = source.indexOf('function resolveGitBinary()')
  const gitEnd = source.indexOf('\nfunction resolveGhBinary', gitStart)
  const gitBody = source.slice(gitStart, gitEnd)
  assert.ok(
    gitBody.indexOf('const bundled = bundledGitBinaryPath()') < gitBody.indexOf('const localAppData'),
    'resolveGitBinary should check packaged resources before user/system Git installs'
  )

  assert.match(source, /extraEnv: bundledGitBackendEnv\(\)/, 'Python backend env must receive MALIANG_GIT_BASH_PATH')
  assert.match(source, /extraPathEntries: bundledGitPathEntries\(\)/, 'Python backend PATH must include bundled Git')

  const terminalStart = source.indexOf('function terminalShellEnv()')
  const terminalEnd = source.indexOf('\nfunction terminalChannel', terminalStart)
  const terminalBody = source.slice(terminalStart, terminalEnd)
  assert.match(terminalBody, /Object\.assign\(env, bundledGitBackendEnv\(\)\)/, 'terminal env must receive Git Bash path')
  assert.match(terminalBody, /bundledGitPathEntries\(\)/, 'terminal PATH must include bundled Git')
})
