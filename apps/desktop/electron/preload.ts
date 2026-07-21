import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('maliangDesktop', {
  getConnection: profile => ipcRenderer.invoke('maliang:connection', profile),
  revalidateConnection: () => ipcRenderer.invoke('maliang:connection:revalidate'),
  touchBackend: profile => ipcRenderer.invoke('maliang:backend:touch', profile),
  getGatewayWsUrl: profile => ipcRenderer.invoke('maliang:gateway:ws-url', profile),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('maliang:window:openSession', sessionId, opts),
  openNewSessionWindow: () => ipcRenderer.invoke('maliang:window:openNewSession'),
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: request => ipcRenderer.invoke('maliang:pet-overlay:open', request),
    close: () => ipcRenderer.invoke('maliang:pet-overlay:close'),
    setBounds: bounds => ipcRenderer.send('maliang:pet-overlay:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('maliang:pet-overlay:ignore-mouse', ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: focusable => ipcRenderer.send('maliang:pet-overlay:set-focusable', focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: payload => ipcRenderer.send('maliang:pet-overlay:state', payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: payload => ipcRenderer.send('maliang:pet-overlay:control', payload),
    // Overlay subscribes to state pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('maliang:pet-overlay:state', listener)

      return () => ipcRenderer.removeListener('maliang:pet-overlay:state', listener)
    },
    // Main renderer subscribes to overlay control messages.
    onControl: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('maliang:pet-overlay:control', listener)

      return () => ipcRenderer.removeListener('maliang:pet-overlay:control', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('maliang:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('maliang:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('maliang:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('maliang:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('maliang:connection-config:test', payload),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('maliang:connection-config:probe', remoteUrl),
  oauthLoginConnectionConfig: remoteUrl => ipcRenderer.invoke('maliang:connection-config:oauth-login', remoteUrl),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('maliang:connection-config:oauth-logout', remoteUrl),
  // Maliang Cloud: one portal login powers discovery + silent per-agent sign-in
  // (cloud-auto-discovery Phase 3).
  cloud: {
    status: () => ipcRenderer.invoke('maliang:cloud:status'),
    login: () => ipcRenderer.invoke('maliang:cloud:login'),
    logout: () => ipcRenderer.invoke('maliang:cloud:logout'),
    discover: org => ipcRenderer.invoke('maliang:cloud:discover', org),
    agentSignIn: dashboardUrl => ipcRenderer.invoke('maliang:cloud:agent-sign-in', dashboardUrl)
  },
  profile: {
    get: () => ipcRenderer.invoke('maliang:profile:get'),
    set: name => ipcRenderer.invoke('maliang:profile:set', name)
  },
  api: request => ipcRenderer.invoke('maliang:api', request),
  notify: payload => ipcRenderer.invoke('maliang:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('maliang:requestMicrophoneAccess'),
  readFileDataUrl: filePath => ipcRenderer.invoke('maliang:readFileDataUrl', filePath),
  readFileText: filePath => ipcRenderer.invoke('maliang:readFileText', filePath),
  selectPaths: options => ipcRenderer.invoke('maliang:selectPaths', options),
  writeClipboard: text => ipcRenderer.invoke('maliang:writeClipboard', text),
  saveImageFromUrl: url => ipcRenderer.invoke('maliang:saveImageFromUrl', url),
  saveImageBuffer: (data, ext) => ipcRenderer.invoke('maliang:saveImageBuffer', { data, ext }),
  saveClipboardImage: () => ipcRenderer.invoke('maliang:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('maliang:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('maliang:watchPreviewFile', url),
  stopPreviewFileWatch: id => ipcRenderer.invoke('maliang:stopPreviewFileWatch', id),
  setTitleBarTheme: payload => ipcRenderer.send('maliang:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('maliang:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('maliang:translucency', payload),
  setPreviewShortcutActive: active => ipcRenderer.send('maliang:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('maliang:openExternal', url),
  openPreviewInBrowser: url => ipcRenderer.invoke('maliang:openPreviewInBrowser', url),
  fetchLinkTitle: url => ipcRenderer.invoke('maliang:fetchLinkTitle', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('maliang:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('maliang:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('maliang:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('maliang:setting:defaultProjectDir:pick')
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('maliang:zoom:get'),
    setPercent: percent => ipcRenderer.send('maliang:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('maliang:zoom:changed', listener)

      return () => ipcRenderer.removeListener('maliang:zoom:changed', listener)
    }
  },
  revealLogs: () => ipcRenderer.invoke('maliang:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('maliang:logs:recent'),
  readDir: dirPath => ipcRenderer.invoke('maliang:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('maliang:fs:gitRoot', startPath),
  revealPath: targetPath => ipcRenderer.invoke('maliang:fs:reveal', targetPath),
  openDir: dirPath => ipcRenderer.invoke('maliang:fs:openDir', dirPath),
  renamePath: (targetPath, newName) => ipcRenderer.invoke('maliang:fs:rename', targetPath, newName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('maliang:fs:writeText', filePath, content),
  trashPath: targetPath => ipcRenderer.invoke('maliang:fs:trash', targetPath),
  git: {
    worktreeList: repoPath => ipcRenderer.invoke('maliang:git:worktreeList', repoPath),
    worktreeAdd: (repoPath, options) => ipcRenderer.invoke('maliang:git:worktreeAdd', repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) =>
      ipcRenderer.invoke('maliang:git:worktreeRemove', repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => ipcRenderer.invoke('maliang:git:branchSwitch', repoPath, branch),
    branchList: repoPath => ipcRenderer.invoke('maliang:git:branchList', repoPath),
    baseBranchList: repoPath => ipcRenderer.invoke('maliang:git:baseBranchList', repoPath),
    repoStatus: repoPath => ipcRenderer.invoke('maliang:git:repoStatus', repoPath),
    fileDiff: (repoPath, filePath) => ipcRenderer.invoke('maliang:git:fileDiff', repoPath, filePath),
    scanRepos: (roots, options) => ipcRenderer.invoke('maliang:git:scanRepos', roots, options),
    review: {
      list: (repoPath, scope, baseRef) => ipcRenderer.invoke('maliang:git:review:list', repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) =>
        ipcRenderer.invoke('maliang:git:review:diff', repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => ipcRenderer.invoke('maliang:git:review:stage', repoPath, filePath),
      unstage: (repoPath, filePath) => ipcRenderer.invoke('maliang:git:review:unstage', repoPath, filePath),
      revert: (repoPath, filePath) => ipcRenderer.invoke('maliang:git:review:revert', repoPath, filePath),
      revParse: (repoPath, ref) => ipcRenderer.invoke('maliang:git:review:revParse', repoPath, ref),
      commit: (repoPath, message, push) => ipcRenderer.invoke('maliang:git:review:commit', repoPath, message, push),
      commitContext: repoPath => ipcRenderer.invoke('maliang:git:review:commitContext', repoPath),
      push: repoPath => ipcRenderer.invoke('maliang:git:review:push', repoPath),
      shipInfo: repoPath => ipcRenderer.invoke('maliang:git:review:shipInfo', repoPath),
      createPr: repoPath => ipcRenderer.invoke('maliang:git:review:createPr', repoPath)
    }
  },
  terminal: {
    cwd: id => ipcRenderer.invoke('maliang:terminal:cwd', id),
    dispose: id => ipcRenderer.invoke('maliang:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('maliang:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('maliang:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('maliang:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `maliang:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `maliang:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('maliang:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('maliang:close-preview-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('maliang:open-updates', listener)

    return () => ipcRenderer.removeListener('maliang:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('maliang:deep-link', listener)

    return () => ipcRenderer.removeListener('maliang:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('maliang:deep-link-ready'),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('maliang:window-state-changed', listener)

    return () => ipcRenderer.removeListener('maliang:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('maliang:focus-session', listener)

    return () => ipcRenderer.removeListener('maliang:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('maliang:notification-action', listener)

    return () => ipcRenderer.removeListener('maliang:notification-action', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('maliang:preview-file-changed', listener)

    return () => ipcRenderer.removeListener('maliang:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('maliang:backend-exit', listener)

    return () => ipcRenderer.removeListener('maliang:backend-exit', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('maliang:connection:applied', listener)

    return () => ipcRenderer.removeListener('maliang:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('maliang:power-resume', listener)

    return () => ipcRenderer.removeListener('maliang:power-resume', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('maliang:boot-progress', listener)

    return () => ipcRenderer.removeListener('maliang:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('maliang:bootstrap:get'),
  resetBootstrap: () => ipcRenderer.invoke('maliang:bootstrap:reset'),
  repairBootstrap: () => ipcRenderer.invoke('maliang:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('maliang:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('maliang:bootstrap:event', listener)

    return () => ipcRenderer.removeListener('maliang:bootstrap:event', listener)
  },
  getVersion: () => ipcRenderer.invoke('maliang:version'),
  getRemoteDisplayReason: () => ipcRenderer.invoke('maliang:get-remote-display-reason'),
  uninstall: {
    summary: () => ipcRenderer.invoke('maliang:uninstall:summary'),
    run: mode => ipcRenderer.invoke('maliang:uninstall:run', { mode })
  },
  updates: {
    check: () => ipcRenderer.invoke('maliang:updates:check'),
    apply: opts => ipcRenderer.invoke('maliang:updates:apply', opts),
    getBranch: () => ipcRenderer.invoke('maliang:updates:branch:get'),
    setBranch: name => ipcRenderer.invoke('maliang:updates:branch:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('maliang:updates:progress', listener)

      return () => ipcRenderer.removeListener('maliang:updates:progress', listener)
    }
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('maliang:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('maliang:vscode-theme:search', query)
  }
})
