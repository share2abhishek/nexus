# ╔══════════════════════════════════════════════════════════════════════╗
# ║   NEXUS v2.0 — All Build Commands                                    ║
# ║   Radixile Technology Solutions LLP (India)                          ║
# ║                                                                      ║
# ║   Run from the nexus/ directory:                                     ║
# ║     Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass       ║
# ║     .\build\BUILD-COMMANDS.ps1                                       ║
# ╚══════════════════════════════════════════════════════════════════════╝

Set-Location $PSScriptRoot\..

# ── Environment (disable code signing — add cert later if needed) ──────────────
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
$env:WIN_CSC_LINK                = ""

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — Run the app normally (development)
# ══════════════════════════════════════════════════════════════════════════════

function Run-Server {
  Write-Host "Starting NEXUS server (browser mode)..." -ForegroundColor Cyan
  node server/index.js
}

function Run-Electron {
  Write-Host "Starting NEXUS in Electron window..." -ForegroundColor Cyan
  npx electron .
}

function Run-Dev {
  Write-Host "Starting NEXUS in dev mode (auto-restart)..." -ForegroundColor Cyan
  npx nodemon server/index.js
}

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — Generate app icons
# ══════════════════════════════════════════════════════════════════════════════

function Build-Icons {
  Write-Host "Generating app icons (PNG + ICO)..." -ForegroundColor Cyan
  node build/create-icons.js
  Write-Host "Icons saved to build/icon.png and build/icon.ico" -ForegroundColor Green
}

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — Build Windows EXE Installer (FULL BUILD)
# ══════════════════════════════════════════════════════════════════════════════

function Build-Windows {
  Write-Host "`n========================================" -ForegroundColor Magenta
  Write-Host "  NEXUS Windows Installer Build"         -ForegroundColor Magenta
  Write-Host "========================================`n" -ForegroundColor Magenta

  # Step 1: Clean
  Write-Host "[1/4] Cleaning previous build..." -ForegroundColor Cyan
  Remove-Item "dist-app" -Recurse -Force -ErrorAction SilentlyContinue

  # Step 2: Icons
  Write-Host "[2/4] Generating icons..." -ForegroundColor Cyan
  Build-Icons

  # Step 3: Package
  Write-Host "[3/4] Packaging Electron app (3-5 min)..." -ForegroundColor Cyan
  npx electron-builder --win --x64 --dir
  if (-not (Test-Path "dist-app\win-unpacked\NEXUS.exe")) { Write-Host "Packaging failed!" -ForegroundColor Red; return }
  $nodeOk = Test-Path "dist-app\win-unpacked\resources\node\node.exe"
  Write-Host "  ✓ NEXUS.exe built" -ForegroundColor Green
  Write-Host "  $(if($nodeOk){'✓'}else{'✗'}) Bundled node.exe: $nodeOk" -ForegroundColor $(if($nodeOk){'Green'}else{'Red'})

  # Step 4: NSIS Installer
  Write-Host "[4/4] Creating NSIS installer EXE..." -ForegroundColor Cyan
  npx electron-builder --win nsis --x64 --prepackaged dist-app/win-unpacked

  # Summary
  $exe = Get-Item "dist-app\NEXUS-Setup-2.0.0.exe" -ErrorAction SilentlyContinue
  if ($exe) {
    $mb = [math]::Round($exe.Length/1MB,1)
    Write-Host "`n  ✅  Build complete!" -ForegroundColor Green
    Write-Host "  📦  NEXUS-Setup-2.0.0.exe  ($mb MB)" -ForegroundColor Green
    Write-Host "  📁  $($exe.FullName)" -ForegroundColor Gray
    $open = Read-Host "`n  Open dist-app folder? (Y/n)"
    if ($open -ne 'n') { Start-Process explorer.exe "dist-app" }
  } else {
    Write-Host "  ✗ Installer not created — check errors above" -ForegroundColor Red
  }
}

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — Build only the portable EXE (no installer, faster)
# ══════════════════════════════════════════════════════════════════════════════

function Build-Portable {
  Write-Host "Building portable EXE..." -ForegroundColor Cyan
  Remove-Item "dist-app" -Recurse -Force -ErrorAction SilentlyContinue
  Build-Icons
  npx electron-builder --win portable --x64
  $exe = Get-Item "dist-app\NEXUS-Portable-2.0.0.exe" -ErrorAction SilentlyContinue
  if ($exe) {
    Write-Host "✅ NEXUS-Portable-2.0.0.exe ($([math]::Round($exe.Length/1MB,1)) MB)" -ForegroundColor Green
  }
}

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — Rebuild native modules for Electron (run after npm install)
# ══════════════════════════════════════════════════════════════════════════════

function Rebuild-Native {
  Write-Host "Rebuilding native modules for Electron..." -ForegroundColor Cyan
  Write-Host "(Requires Visual Studio Build Tools or windows-build-tools)"
  npx @electron/rebuild --force
}

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 6 — Fix winCodeSign symlink error (run if build fails with symlink error)
# ══════════════════════════════════════════════════════════════════════════════

function Fix-WinCodeSign {
  Write-Host "Fixing winCodeSign cache symlink issue..." -ForegroundColor Cyan
  $cacheDir = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
  Remove-Item $cacheDir -Recurse -Force -ErrorAction SilentlyContinue

  $url      = "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z"
  $archive  = "$env:TEMP\winCodeSign.7z"
  $outDir   = "$cacheDir\winCodeSign-2.6.0"
  $sevenZip = ".\node_modules\7zip-bin\win\x64\7za.exe"

  Invoke-WebRequest $url -OutFile $archive -UseBasicParsing
  New-Item -ItemType Directory -Force $outDir | Out-Null
  & $sevenZip x $archive "-o$outDir" -snl -y 2>&1 | Select-Object -Last 3
  Write-Host "winCodeSign cache fixed ✓" -ForegroundColor Green
  Write-Host "Now run Build-Windows" -ForegroundColor Yellow
}

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 7 — Create distributable ZIP (for sharing source without node_modules)
# ══════════════════════════════════════════════════════════════════════════════

function Build-Zip {
  Write-Host "Creating distributable ZIP..." -ForegroundColor Cyan
  node install/build-release.ps1
}

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 8 — Git: commit and push all changes
# ══════════════════════════════════════════════════════════════════════════════

function Git-Push {
  param([string]$Message = "Update NEXUS")
  git add -A
  git commit -m $Message
  git push
  Write-Host "Pushed to Bitbucket ✓" -ForegroundColor Green
}

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 9 — macOS build (run on a Mac, not Windows)
# ══════════════════════════════════════════════════════════════════════════════
# On macOS terminal:
#   git clone https://share2abhishek@bitbucket.org/radixile/nexus.git && cd nexus
#   npm install
#   curl -o resources/node/node https://nodejs.org/dist/v20.19.2/bin/node && chmod +x resources/node/node
#   npx electron-builder --mac --x64
#   # Output: dist-app/NEXUS-2.0.0.dmg

# ══════════════════════════════════════════════════════════════════════════════
# QUICK REFERENCE
# ══════════════════════════════════════════════════════════════════════════════
Write-Host @"

  NEXUS Build Commands (call any function above):
  ────────────────────────────────────────────────
  Run-Server       — Start in browser mode (npm start)
  Run-Electron     — Start in Electron window
  Run-Dev          — Start with auto-restart (nodemon)

  Build-Icons      — Regenerate PNG + ICO icons
  Build-Windows    — Full Windows EXE installer (RECOMMENDED)
  Build-Portable   — Portable EXE (no installer needed)
  Rebuild-Native   — Rebuild native modules for Electron

  Fix-WinCodeSign  — Fix symlink error on Windows
  Git-Push         — Commit and push to Bitbucket

  Example:
    Build-Windows      ← builds NEXUS-Setup-2.0.0.exe

"@ -ForegroundColor Yellow
