# ============================================================================
# Maliang Agent Windows Installer (offline-capable)
# ============================================================================
# Creates a Python venv and installs maliang-agent[all] from bundled wheels.
# When wheels are present alongside this script, NO network access is needed.
#
# Usage (offline, from bundled resources):
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# Usage (online, from repo):
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Online
# ============================================================================

param(
    [string]$InstallDir = "",
    [string]$MaliangHome = "",
    [string]$PythonExe = "",
    [string]$WheelsDir = "",
    [switch]$Online = $false,
    [switch]$SkipSetup = $false,
    [switch]$Help = $false
)

$ErrorActionPreference = "Stop"

if ($Help) {
    Write-Host "Maliang Agent Windows Installer"
    Write-Host ""
    Write-Host "Usage: install.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -InstallDir <path>   Installation directory (default: `$MALIANG_HOME/maliang-agent)"
    Write-Host "  -MaliangHome <path>  MALIANG_HOME directory (default: `$env:LOCALAPPDATA\maliang)"
    Write-Host "  -PythonExe <path>     Python executable to use (default: bundled or system)"
    Write-Host "  -WheelsDir <path>     Directory containing .whl files (default: alongside this script)"
    Write-Host "  -Online              Force online installation (downloads from PyPI)"
    Write-Host "  -SkipSetup           Skip the interactive setup wizard"
    exit 0
}

# ----------------------------------------------------------------------------
# Resolve paths
# ----------------------------------------------------------------------------

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $MaliangHome) {
    $MaliangHome = Join-Path $env:LOCALAPPDATA "maliang"
}
if (-not $InstallDir) {
    $InstallDir = Join-Path $MaliangHome "maliang-agent"
}
if (-not $WheelsDir) {
    $WheelsDir = Join-Path $ScriptDir "wheels"
}
if (-not $PythonExe) {
    $BundledPython = Join-Path $ScriptDir "python\python.exe"
    if (Test-Path $BundledPython) {
        $PythonExe = $BundledPython
    } else {
        $SystemPython = Get-Command python -ErrorAction SilentlyContinue
        if ($SystemPython) {
            $PythonExe = $SystemPython.Source
        } else {
            Write-Error "No Python found. Provide -PythonExe or ensure python is on PATH."
        }
    }
}

$VenvDir = Join-Path $InstallDir "venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$HasWheels = (Test-Path $WheelsDir) -and ((Get-ChildItem $WheelsDir -Filter *.whl -ErrorAction SilentlyContinue).Count -gt 0)
$OfflineMode = $HasWheels -and -not $Online

# ----------------------------------------------------------------------------
# Create MALIANG_HOME
# ----------------------------------------------------------------------------

if (-not (Test-Path $MaliangHome)) {
    New-Item -ItemType Directory -Path $MaliangHome -Force | Out-Null
}

# ----------------------------------------------------------------------------
# Create venv
# ----------------------------------------------------------------------------

if -not (Test-Path $VenvPython) {
    Write-Host "[install] Creating Python venv at $VenvDir" -ForegroundColor Cyan
    & $PythonExe -m venv --copies $VenvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create venv. Exit code: $LASTEXITCODE"
    }
} else {
    Write-Host "[install] Using existing venv at $VenvDir" -ForegroundColor Green
}

# ----------------------------------------------------------------------------
# Install maliang-agent
# ----------------------------------------------------------------------------

if ($OfflineMode) {
    Write-Host "[install] Installing maliang-agent[all] from bundled wheels (offline)" -ForegroundColor Cyan
    & $VenvPython -m pip install --disable-pip-version-check --no-index --only-binary ":all:" --find-links $WheelsDir "maliang-agent[all]"
} else {
    Write-Host "[install] Installing maliang-agent[all] from PyPI (online)" -ForegroundColor Cyan
    & $VenvPython -m pip install --disable-pip-version-check "maliang-agent[all]"
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "pip install failed. Exit code: $LASTEXITCODE"
}

# ----------------------------------------------------------------------------
# Verify
# ----------------------------------------------------------------------------

Write-Host "[install] Verifying installation..." -ForegroundColor Cyan
& $VenvPython -c "import maliang_cli.main; print('OK: maliang_cli.main imports')"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Verification failed: maliang_cli.main could not be imported"
}

# ----------------------------------------------------------------------------
# Create launcher
# ----------------------------------------------------------------------------

$BinDir = Join-Path $MaliangHome "bin"
if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
}

$LauncherPath = Join-Path $BinDir "maliang.cmd"
$LauncherContent = @"
@echo off
set MALIANG_HOME=$MaliangHome
"$VenvPython" -m maliang_cli.main %*
"@
Set-Content -Path $LauncherPath -Value $LauncherContent -Encoding ASCII

Write-Host "[install] Created launcher at $LauncherPath" -ForegroundColor Green

# Add to user PATH if not already there
$UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($UserPath -notlike "*$BinDir*") {
    Write-Host "[install] Adding $BinDir to user PATH" -ForegroundColor Cyan
    [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$UserPath", "User")
}

# ----------------------------------------------------------------------------
# Done
# ----------------------------------------------------------------------------

Write-Host ""
Write-Host "[install] Maliang Agent installed successfully!" -ForegroundColor Green
Write-Host "  MALIANG_HOME: $MaliangHome" -ForegroundColor DarkGray
Write-Host "  Install dir:  $InstallDir" -ForegroundColor DarkGray
Write-Host "  Venv:         $VenvDir" -ForegroundColor DarkGray
Write-Host "  Launcher:     $LauncherPath" -ForegroundColor DarkGray
Write-Host ""

if (-not $SkipSetup) {
    Write-Host "[install] Running setup wizard..." -ForegroundColor Cyan
    & $VenvPython -m maliang_cli.main setup
}

Write-Host "Run 'maliang' to start." -ForegroundColor Green
