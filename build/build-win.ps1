# ╔══════════════════════════════════════════════════════════════════╗
# ║   NEXUS v2.0 — Windows Installer Builder                        ║
# ║   Outputs: dist-app/NEXUS-Setup-2.0.0.exe                       ║
# ║            dist-app/NEXUS-Portable-2.0.0.exe                     ║
# ╚══════════════════════════════════════════════════════════════════╝

param(
  [switch]$SkipRebuild,
  [switch]$DirOnly     # fast build for testing (no installer)
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
Set-Location $root

function Step { param($msg) Write-Host "`n  ► $msg" -ForegroundColor Cyan }
function OK   { param($msg) Write-Host "    ✓ $msg" -ForegroundColor Green }
function Warn { param($msg) Write-Host "    ⚠ $msg" -ForegroundColor Yellow }
function Fail { param($msg) Write-Host "    ✗ $msg" -ForegroundColor Red; exit 1 }

Clear-Host
Write-Host @"

  ╔══════════════════════════════════════════════════╗
  ║     NEXUS v2.0 — Windows Installer Builder       ║
  ╚══════════════════════════════════════════════════╝

"@ -ForegroundColor Magenta

# ── 1. Check prerequisites ────────────────────────────────────────────────────

Step "Checking prerequisites..."

# Node.js
try { $nodeVer = node --version 2>$null; OK "Node.js $nodeVer" }
catch { Fail "Node.js not found. Install from https://nodejs.org" }

# Electron
$electronVer = node -e "try{console.log(require('./node_modules/electron/package.json').version)}catch(e){}" 2>$null
if ($electronVer) { OK "Electron v$electronVer" }
else { Warn "Electron not found — running npm install..."; npm install }

# ── 2. Generate icons ─────────────────────────────────────────────────────────

Step "Generating application icons..."
try {
  node build/create-icons.js
  if (Test-Path "build/icon.png") { OK "Icons generated" }
  else { Warn "Icon generation skipped — using placeholder" }
} catch { Warn "Icon generation failed: $_" }

# ── 3. Rebuild native modules for Electron ────────────────────────────────────

if (-not $SkipRebuild) {
  Step "Rebuilding native modules for Electron..."
  try {
    npx @electron/rebuild --force 2>&1 | Select-Object -Last 5
    OK "Native modules rebuilt (better-sqlite3, etc.)"
  } catch {
    Warn "Rebuild had issues: $_ — continuing anyway"
  }
} else {
  Warn "Skipping native module rebuild (-SkipRebuild flag)"
}

# ── 4. Build the Electron app ─────────────────────────────────────────────────

Step "Building Electron installer..."

$buildCmd = if ($DirOnly) { "npx electron-builder --win --x64 --dir" } else { "npx electron-builder --win --x64" }

try {
  Invoke-Expression $buildCmd
  OK "Build completed"
} catch {
  Fail "Build failed: $_"
}

# ── 5. Show output ────────────────────────────────────────────────────────────

Step "Build output:"
$distDir = "$root\dist-app"
if (Test-Path $distDir) {
  Get-ChildItem $distDir -Filter "*.exe" | ForEach-Object {
    $sizeMB = [math]::Round($_.Length / 1MB, 1)
    OK "$($_.Name)  ($sizeMB MB)"
  }
  if ($DirOnly) {
    Get-ChildItem $distDir -Directory | ForEach-Object { OK "$($_.Name)/ (unpacked)" }
  }
}

Write-Host @"

  ╔══════════════════════════════════════════════════╗
  ║   ✅  Installer built successfully!               ║
  ║                                                  ║
  ║   📁  dist-app\NEXUS-Setup-2.0.0.exe             ║
  ║   📁  dist-app\NEXUS-Portable-2.0.0.exe          ║
  ║                                                  ║
  ║   Share the Setup EXE with users.                ║
  ║   Portable EXE runs without installation.        ║
  ╚══════════════════════════════════════════════════╝

"@ -ForegroundColor Green

# Open dist folder
$open = Read-Host "  Open dist-app folder? (Y/n)"
if ($open -ne 'n') { Start-Process explorer.exe $distDir }
