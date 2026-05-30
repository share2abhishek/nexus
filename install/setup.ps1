# ╔══════════════════════════════════════════════════════════════╗
# ║   NEXUS v2.0 — One-Click Installer for Windows              ║
# ║   Run as Administrator for best results                      ║
# ╚══════════════════════════════════════════════════════════════╝

param(
  [string]$InstallPath = "C:\NEXUS",
  [switch]$InstallOllama,
  [switch]$Silent
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

function Write-Step { param($msg, $color = "Cyan") Write-Host "`n  ► $msg" -ForegroundColor $color }
function Write-OK   { param($msg) Write-Host "    ✓ $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "    ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "    ✗ $msg" -ForegroundColor Red }

Clear-Host
Write-Host @"

  ╔════════════════════════════════════════════════════╗
  ║                                                    ║
  ║     NEXUS v2.0 — AI Digital Marketing Platform     ║
  ║              Windows Installer                     ║
  ║                                                    ║
  ╚════════════════════════════════════════════════════╝

"@ -ForegroundColor Magenta

# ── 1. Check Node.js ─────────────────────────────────────────────────────────

Write-Step "Checking Node.js..."
$nodeInstalled = $null
try { $nodeInstalled = (node --version 2>$null) } catch {}

if (-not $nodeInstalled) {
  Write-Warn "Node.js not found. Downloading installer..."
  $nodeUrl = "https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi"
  $nodeMsi = "$env:TEMP\node-installer.msi"
  Invoke-WebRequest $nodeUrl -OutFile $nodeMsi -UseBasicParsing
  Write-Step "Installing Node.js v20 LTS..."
  Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /quiet /norestart" -Wait
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Write-OK "Node.js installed"
} else {
  Write-OK "Node.js $nodeInstalled found"
}

# ── 2. Create install directory ───────────────────────────────────────────────

Write-Step "Setting up installation directory: $InstallPath"
New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
New-Item -ItemType Directory -Force -Path "$InstallPath\data" | Out-Null
Write-OK "Directory ready"

# ── 3. Copy application files ─────────────────────────────────────────────────

Write-Step "Copying NEXUS application files..."
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceDir  = Split-Path -Parent $scriptDir

$exclude = @("node_modules", ".git", "install", "data")
Get-ChildItem $sourceDir | Where-Object { $_.Name -notin $exclude } | ForEach-Object {
  if ($_.PSIsContainer) {
    Copy-Item $_.FullName "$InstallPath\$($_.Name)" -Recurse -Force
  } else {
    Copy-Item $_.FullName "$InstallPath\" -Force
  }
}
Write-OK "Files copied"

# ── 4. Install npm dependencies ───────────────────────────────────────────────

Write-Step "Installing Node.js dependencies (this may take 1-2 minutes)..."
Set-Location $InstallPath
npm install --omit=dev --quiet 2>&1 | Out-Null
Write-OK "Dependencies installed"

# ── 5. Generate .env if not exists ────────────────────────────────────────────

Write-Step "Configuring environment..."
$envFile = "$InstallPath\.env"
if (-not (Test-Path $envFile)) {
  $secret  = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  $envContent = @"
PORT=3000
SESSION_SECRET=$secret

# ─── Google Gemini AI (Primary - Free) ────────────────────────
GOOGLE_AI_KEY=

# ─── Anthropic Claude (Optional) ─────────────────────────────
ANTHROPIC_API_KEY=

# ─── Ollama Local AI ─────────────────────────────────────────
OLLAMA_ENABLED=false
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# ─── Social Platforms ────────────────────────────────────────
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_CALLBACK_URL=http://localhost:3000/auth/linkedin/callback
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_CALLBACK_URL=http://localhost:3000/auth/facebook/callback
PINTEREST_APP_ID=
PINTEREST_APP_SECRET=
PINTEREST_CALLBACK_URL=http://localhost:3000/auth/pinterest/callback
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_CALLBACK_URL=http://localhost:3000/auth/twitter/callback
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_CALLBACK_URL=http://localhost:3000/auth/tiktok/callback

# ─── Image/Video AI ─────────────────────────────────────────
STABILITY_API_KEY=
OPENAI_API_KEY=
LUMA_API_KEY=
RUNWAY_API_KEY=

# ─── Email ──────────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_FROM_NAME=NEXUS

CONTENT_FOLDER=D:/nexus-content
"@
  Set-Content $envFile $envContent -Encoding utf8
  Write-OK ".env file created with secure random session secret"
} else {
  Write-OK ".env already exists — keeping existing configuration"
}

# ── 6. Optional Ollama install ────────────────────────────────────────────────

if ($InstallOllama) {
  Write-Step "Installing Ollama for local AI..."
  $ollamaInstalled = $null
  try { $ollamaInstalled = (ollama --version 2>$null) } catch {}

  if (-not $ollamaInstalled) {
    $ollamaUrl = "https://ollama.com/download/OllamaSetup.exe"
    $ollamaExe = "$env:TEMP\OllamaSetup.exe"
    Write-Warn "Downloading Ollama (~500MB)..."
    Invoke-WebRequest $ollamaUrl -OutFile $ollamaExe -UseBasicParsing
    Start-Process $ollamaExe -ArgumentList "/S" -Wait
    Write-OK "Ollama installed"

    # Set models to D: if available, otherwise use default
    $modelPath = if (Test-Path "D:\") { "D:\OllamaModels" } else { "$env:USERPROFILE\.ollama\models" }
    [System.Environment]::SetEnvironmentVariable("OLLAMA_MODELS", $modelPath, "User")
    Write-OK "Ollama models will be stored at: $modelPath"

    Write-Step "Pulling Llama 3.2 model (2GB — takes 3-10 minutes)..."
    Start-Process "ollama" -ArgumentList "pull llama3.2" -Wait -NoNewWindow
    Write-OK "llama3.2 model ready"

    # Enable Ollama in .env
    (Get-Content $envFile) -replace 'OLLAMA_ENABLED=false', 'OLLAMA_ENABLED=true' | Set-Content $envFile
    Write-OK "Ollama enabled in .env"
  } else {
    Write-OK "Ollama already installed: $ollamaInstalled"
  }
}

# ── 7. Create Windows Start Menu shortcut ─────────────────────────────────────

Write-Step "Creating shortcuts..."
$startMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\NEXUS"
New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null

$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$startMenuDir\NEXUS Marketing Suite.lnk")
$shortcut.TargetPath       = "cmd.exe"
$shortcut.Arguments        = "/c cd /d `"$InstallPath`" && node server/index.js"
$shortcut.WorkingDirectory = $InstallPath
$shortcut.IconLocation     = "$InstallPath\public\icon.svg,0"
$shortcut.Description      = "NEXUS AI Digital Marketing Platform"
$shortcut.Save()

# Desktop shortcut
$desktop  = $shell.CreateShortcut("$env:USERPROFILE\Desktop\NEXUS.lnk")
$desktop.TargetPath       = "cmd.exe"
$desktop.Arguments        = "/c cd /d `"$InstallPath`" && node server/index.js && timeout 2 && start http://localhost:3000"
$desktop.WorkingDirectory = $InstallPath
$desktop.Description      = "Start NEXUS"
$desktop.Save()

Write-OK "Desktop shortcut created"

# ── 8. Create startup batch file ──────────────────────────────────────────────

$startBat = @"
@echo off
title NEXUS — AI Marketing Platform
cd /d "$InstallPath"
echo Starting NEXUS...
node server/index.js
pause
"@
Set-Content "$InstallPath\start-nexus.bat" $startBat -Encoding utf8
Write-OK "start-nexus.bat created"

# ── 9. Summary ────────────────────────────────────────────────────────────────

Write-Host @"

  ╔════════════════════════════════════════════════════╗
  ║                                                    ║
  ║   ✅  NEXUS installed successfully!                 ║
  ║                                                    ║
  ║   📁  Location:  $InstallPath
  ║   🌐  URL:       http://localhost:3000             ║
  ║                                                    ║
  ║   To start NEXUS:                                  ║
  ║   • Double-click NEXUS.lnk on your Desktop        ║
  ║   • OR run: $InstallPath\start-nexus.bat           ║
  ║                                                    ║
  ║   First run: Register an account at               ║
  ║   http://localhost:3000/login.html                 ║
  ║                                                    ║
  ╚════════════════════════════════════════════════════╝

"@ -ForegroundColor Green

if (-not $Silent) {
  $launch = Read-Host "  Launch NEXUS now? (Y/n)"
  if ($launch -ne 'n') {
    Start-Process "cmd.exe" -ArgumentList "/c cd /d `"$InstallPath`" && node server/index.js" -WindowStyle Normal
    Start-Sleep 4
    Start-Process "http://localhost:3000"
  }
}
