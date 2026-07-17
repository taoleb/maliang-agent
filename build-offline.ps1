# ============================================================================
# Maliang Agent — Offline Windows Desktop Build Script
# ============================================================================
# Usage:
#   .\build-offline.ps1                    # full offline build
#   .\build-offline.ps1 -ChinaMirror       # use Tsinghua PyPI mirror
#   .\build-offline.ps1 -SkipInstaller     # just build win-unpacked (no NSIS)
#   .\build-offline.ps1 -SkipPrepare       # skip prepare-offline (already done)
# ============================================================================

param(
    [switch]$ChinaMirror = $false,
    [switch]$SkipInstaller = $false,
    [switch]$SkipPrepare = $false,
    [string]$PythonArchive = "",
    [string]$GitArchive = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
$DesktopDir = Join-Path $RepoRoot "apps\desktop"

Write-Host "`n=== Maliang Agent Offline Build ===`n" -ForegroundColor Cyan

# ----------------------------------------------------------------------------
# Step 1: Prepare offline runtime (Python, Git, wheels)
# ----------------------------------------------------------------------------
if (-not $SkipPrepare) {
    Write-Host "[1/3] Preparing offline runtime..." -ForegroundColor Yellow
    
    $prepareArgs = @("node", "scripts\prepare-offline-runtime.cjs")
    if ($ChinaMirror) {
        $prepareArgs += "--china-mirror"
    }
    if ($PythonArchive) {
        $prepareArgs += "--python-archive", $PythonArchive
    }
    if ($GitArchive) {
        $prepareArgs += "--git-archive", $GitArchive
    }
    $prepareArgs += "--refresh-wheels"
    
    Push-Location $DesktopDir
    try {
        & node scripts\prepare-offline-runtime.cjs --refresh-wheels $(if ($ChinaMirror) { '--china-mirror' })
        if ($LASTEXITCODE -ne 0) { throw "prepare-offline-runtime failed" }
    } finally {
        Pop-Location
    }
    Write-Host "[1/3] Offline runtime ready.`n" -ForegroundColor Green
} else {
    Write-Host "[1/3] Skipping offline runtime preparation (already done).`n" -ForegroundColor DarkGray
}

# ----------------------------------------------------------------------------
# Step 2: Build the desktop app (TypeScript + Vite)
# ----------------------------------------------------------------------------
Write-Host "[2/3] Building desktop app..." -ForegroundColor Yellow

$env:MALIANG_DESKTOP_BUILD_COMMIT = if ($env:MALIANG_DESKTOP_BUILD_COMMIT) { $env:MALIANG_DESKTOP_BUILD_COMMIT } else { "offline-build" }
$env:MALIANG_DESKTOP_BUILD_BRANCH = if ($env:MALIANG_DESKTOP_BUILD_BRANCH) { $env:MALIANG_DESKTOP_BUILD_BRANCH } else { "main" }

# Use Chinese Electron mirror if requested
if ($ChinaMirror) {
    $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
    Write-Host "  Using Chinese mirrors for Electron" -ForegroundColor DarkGray
}

Push-Location $DesktopDir
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} finally {
    Pop-Location
}
Write-Host "[2/3] Desktop app built.`n" -ForegroundColor Green

# ----------------------------------------------------------------------------
# Step 3: Package the installer
# ----------------------------------------------------------------------------
if ($SkipInstaller) {
    Write-Host "[3/3] Skipping installer creation (--SkipInstaller)." -ForegroundColor DarkGray
    Write-Host "`n  win-unpacked directory: apps\desktop\release\win-unpacked\" -ForegroundColor Cyan
    Write-Host "  Run Maliang.exe directly from there.`n" -ForegroundColor Cyan
} else {
    Write-Host "[3/3] Creating NSIS installer (this may take 10-20 minutes)..." -ForegroundColor Yellow
    
    Push-Location $DesktopDir
    try {
        & npm run builder -- --win
        if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
        
        $installers = Get-ChildItem (Join-Path $DesktopDir "release\Maliang-*.exe") -ErrorAction SilentlyContinue
        if ($installers) {
            Write-Host "[3/3] Installer created:`n" -ForegroundColor Green
            foreach ($f in $installers) {
                $sizeMB = [math]::Round($f.Length / 1MB, 1)
                Write-Host "  $($f.FullName) ($sizeMB MB)" -ForegroundColor Cyan
            }
        }
    } finally {
        Pop-Location
    }
}

Write-Host "`n=== Build Complete ===`n" -ForegroundColor Cyan
Write-Host "Offline resources bundled:" -ForegroundColor White
Write-Host "  - Python 3.11.13 runtime" -ForegroundColor DarkGray
Write-Host "  - Git for Windows" -ForegroundColor DarkGray
Write-Host "  - 99 pip wheels (maliang-agent[all])" -ForegroundColor DarkGray
Write-Host "  - install.ps1 fallback script" -ForegroundColor DarkGray
Write-Host ""
Write-Host "The target machine does NOT need internet access." -ForegroundColor Green
Write-Host "First launch creates a venv from bundled Python + installs from bundled wheels." -ForegroundColor DarkGray
