# Build a distributable ZIP of NEXUS (without node_modules)
param([string]$Version = "2.0.0")

$root    = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$outDir  = "$root\dist"
$zipName = "NEXUS-v$Version-Windows.zip"
$zipPath = "$outDir\$zipName"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "Building NEXUS v$Version release..." -ForegroundColor Cyan

# Files/folders to include
$include = @("server","routes","services","middleware","public","install","package.json","package-lock.json",".env.example","NEXUS-DEV-GUIDE.md")

# Create temp staging folder
$staging = "$env:TEMP\nexus-release"
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $staging | Out-Null

foreach ($item in $include) {
  $src = "$root\$item"
  if (Test-Path $src) {
    Copy-Item $src "$staging\$item" -Recurse -Force
    Write-Host "  + $item" -ForegroundColor Gray
  }
}

# Compress
Compress-Archive -Path "$staging\*" -DestinationPath $zipPath -Force
Remove-Item $staging -Recurse -Force

$size = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "`n✅ Release built: $zipPath ($size MB)" -ForegroundColor Green
Write-Host "   Share this ZIP — users run: .\install\setup.ps1" -ForegroundColor Gray
