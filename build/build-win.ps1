# ====================================================================
# =   Social-Nexus - Windows installer builder                       =
# =   Radixile Technology Solutions LLP                              =
# =   Output: dist-app\Social-Nexus-Setup-<version>.exe              =
# =           dist-app\Social-Nexus-Portable-<version>.exe           =
# ====================================================================
#
#   .\build\build-win.ps1             full build (tests + protect + installer)
#   .\build\build-win.ps1 -DirOnly    unpacked folder only (fast, for testing)
#   .\build\build-win.ps1 -SkipTests
#
# Code signing: set CSC_LINK/CSC_KEY_PASSWORD (certificate file) or configure the
# cloud-signing tool in package.json "win.signtoolOptions" once the certificate
# arrives. Without them the build is unsigned (fine for internal testing only).

param(
  [switch]$DirOnly,
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
Set-Location $root

function Step { param($msg) Write-Host "`n  > $msg" -ForegroundColor Cyan }
function OK   { param($msg) Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn { param($msg) Write-Host "    !   $msg" -ForegroundColor Yellow }
function Fail { param($msg) Write-Host "    X   $msg" -ForegroundColor Red; exit 1 }

$version = node -p "require('./package.json').version"
Write-Host "`n  Social-Nexus $version - Windows build`n" -ForegroundColor Magenta

# -- 1. Prerequisites ----------------------------------------------------------
Step "Checking prerequisites"
try { $nodeVer = node --version; OK "Node.js $nodeVer (build machine)" } catch { Fail "Node.js not found - install from https://nodejs.org" }

$bundled = Join-Path $root "resources\node\node.exe"
if (-not (Test-Path $bundled)) { Fail "Bundled runtime missing: resources\node\node.exe (copy a Node 20 x64 node.exe there)" }
$bundledVer = & $bundled --version
OK "Bundled runtime node.exe $bundledVer"
# Native modules are compiled by the build machine's Node, so its major version
# must match the bundled runtime's (same module ABI)
if (($nodeVer -split '\.')[0] -ne ($bundledVer -split '\.')[0]) {
  Fail "Build machine Node $nodeVer and bundled $bundledVer have different major versions. Use Node $(($bundledVer -split '\.')[0]) to build."
}

if (-not (Test-Path "node_modules")) { Step "Installing dependencies"; npm ci; if ($LASTEXITCODE) { Fail "npm ci failed" } }

# -- 2. Native modules must load in the BUNDLED node.exe -----------------------
# The server runs under resources\node\node.exe, not inside Electron, so the
# database modules must be compiled for that Node version (never @electron/rebuild).
Step "Checking native modules against the bundled runtime"
& $bundled -e "require('better-sqlite3'); require('sqlite3'); console.log('native modules OK')"
if ($LASTEXITCODE) {
  Warn "Native modules don't load in node.exe $bundledVer - rebuilding for it"
  npm rebuild better-sqlite3 sqlite3 --runtime=node --target=$($bundledVer.TrimStart('v')) --dist-url=https://nodejs.org/dist
  & $bundled -e "require('better-sqlite3'); require('sqlite3')"
  if ($LASTEXITCODE) { Fail "Native modules still fail in the bundled runtime. Use a node.exe with the same major version as the build machine." }
}
OK "better-sqlite3 + sqlite3 load in the bundled runtime"

# -- 3. Tests ------------------------------------------------------------------
if (-not $SkipTests) {
  Step "Running tests"
  npx jest --forceExit --silent
  if ($LASTEXITCODE) { Fail "Tests failed - fix before releasing (or pass -SkipTests for an internal build)" }
  OK "All tests passed"
}

# -- 4. Protect + 5. Build -----------------------------------------------------
# protect.js compiles licence/core modules to V8 bytecode, which only runs on the
# exact V8 it was made with - so it MUST run under the bundled node.exe.
# The readable sources are always restored afterwards, even if a step fails.
$protect = Test-Path "scripts\release\protect.js"
$buildExit = 1
try {
  if ($protect) {
    Step "Protecting licence and core modules"
    & $bundled scripts\release\protect.js
    if ($LASTEXITCODE) { throw "Protect step failed" }
    OK "Protected"
    $env:SN_PROTECTED = "1"   # tells scripts/release/after-sign.js to write the integrity manifest
  }
  Step "Building installer"
  if ($DirOnly) { npx electron-builder --win --x64 --dir } else { npx electron-builder --win --x64 }
  $buildExit = $LASTEXITCODE
} finally {
  if ($protect) { & $bundled scripts\release\protect.js --restore }
  Remove-Item Env:SN_PROTECTED -ErrorAction SilentlyContinue
}
if ($buildExit) { Fail "electron-builder failed" }
if ($protect) {
  $manifest = Join-Path $root "dist-app/win-unpacked/resources/app/config/integrity.json"
  if (-not (Test-Path $manifest)) { Fail "No integrity manifest in the packaged app - every user would see 'modified'. Check build.afterSign in package.json." }
  $m = Get-Content $manifest -Raw | ConvertFrom-Json
  if (-not $m.sig) { Fail "Integrity manifest is not signed - set BUILD_SIGNING_KEY (see scripts/release/gen-build-key.js)" }
  OK "Signed integrity manifest present"
}

# -- 5b. Smoke test: the packaged server starts under the bundled runtime ------
$unpacked = Join-Path $root "dist-app\win-unpacked"
if (Test-Path $unpacked) {
  Step "Smoke test (packaged server, throwaway data folder)"
  $tmp = Join-Path $env:TEMP "social-nexus-smoke-$(Get-Random)"
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $env:NEXUS_DATA_DIR = $tmp; $env:PORT = "3987"; $env:NEXUS_NO_BROWSER = "true"; $env:NODE_ENV = "production"; $env:SESSION_SECRET = "smoke"
  $proc = Start-Process -FilePath (Join-Path $unpacked "resources/node/node.exe") -ArgumentList "server/index.js" -WorkingDirectory (Join-Path $unpacked "resources/app") -PassThru -WindowStyle Hidden
  $okSmoke = $false; $licState = $null
  for ($i = 0; $i -lt 90 -and -not $okSmoke; $i++) {
    Start-Sleep -Seconds 1
    try { $r = Invoke-RestMethod "http://127.0.0.1:3987/__health" -TimeoutSec 2; if ($r.app -eq 'social-nexus' -and $r.licence -ne 'checking') { $okSmoke = $true; $licState = $r.licence } } catch {}
  }
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Remove-Item Env:NEXUS_DATA_DIR, Env:PORT, Env:SESSION_SECRET, Env:NODE_ENV, Env:NEXUS_NO_BROWSER -ErrorAction SilentlyContinue
  if (-not $okSmoke) { Fail "Packaged server did not start - check native modules / bundled runtime" }
  if ($licState -eq 'invalid') { Fail "The packaged app reports itself as MODIFIED (licence state invalid) - integrity manifest does not match the files" }
  OK "Packaged server starts and answers /__health"
}

# -- 6. Output -----------------------------------------------------------------
Step "Build output"
Get-ChildItem "$root\dist-app" -Filter "Social-Nexus*.exe" -ErrorAction SilentlyContinue | ForEach-Object {
  $sizeMB = [math]::Round($_.Length / 1MB, 1)
  $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
  OK "$($_.Name)  ($sizeMB MB)  SHA256 $hash"
}
if ($DirOnly) { OK "Unpacked app: dist-app\win-unpacked\Social-Nexus.exe" }

if (-not $env:CSC_LINK -and -not $env:WIN_CSC_LINK) {
  Warn "UNSIGNED build - Windows will show 'Unknown publisher'. Sign before public release."
}
Write-Host "`n  Done.`n" -ForegroundColor Green
