<#
  Publishes the NEXUS distribution to https://github.com/share2abhishek/nexus
   - Pushes user docs (README, USER-GUIDE, RELEASING) to the repo (keeps LICENSE)
   - Creates a GitHub Release with the installer .exe files attached

  Prerequisite (one time):
     winget install --id GitHub.cli -e
     gh auth login           # GitHub.com -> HTTPS -> browser

  Then run:
     powershell -ExecutionPolicy Bypass -File .\publish-to-github.ps1
#>
param(
  [string]$Repo    = "share2abhishek/nexus",
  [string]$Version = "2.0.0"
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$distDir = Split-Path $here -Parent     # ...\dist-app

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Error "$cmd not found. $hint"; exit 1 }
}
Need git "Install Git."
Need gh  "Install with: winget install --id GitHub.cli -e   then: gh auth login"

# Verify gh auth
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "GitHub CLI is not logged in. Run: gh auth login"; exit 1 }

$setup    = Join-Path $distDir "NEXUS-Setup-$Version.exe"
$portable = Join-Path $distDir "NEXUS-Portable-$Version.exe"
foreach ($f in @($setup, $portable)) {
  if (-not (Test-Path $f)) { Write-Error "Missing installer: $f  (build first: npx electron-builder --win --x64)"; exit 1 }
}

# ── 1. Push docs to the repo ────────────────────────────────────────────────
$tmp = Join-Path $env:TEMP ("nexus-pub-" + [guid]::NewGuid().ToString("N").Substring(0,8))
Write-Host "Cloning $Repo ..." -ForegroundColor Cyan
gh repo clone $Repo $tmp -- -q
Copy-Item (Join-Path $here "README.md")     (Join-Path $tmp "README.md")     -Force
Copy-Item (Join-Path $here "USER-GUIDE.md") (Join-Path $tmp "USER-GUIDE.md") -Force
Copy-Item (Join-Path $here "RELEASING.md")  (Join-Path $tmp "RELEASING.md")  -Force

Push-Location $tmp
git add -A
$pending = git status --porcelain
if ($pending) {
  git commit -m "docs: publish NEXUS v$Version distribution docs" | Out-Null
  git push
  Write-Host "Docs pushed." -ForegroundColor Green
} else {
  Write-Host "Docs already up to date." -ForegroundColor Yellow
}
Pop-Location

# ── 1b. Repo description + topics (SEO / discoverability) ────────────────────
$desc = "Free AI digital marketing desktop app for Windows. Private, local AI (Ollama / Llama 3.2) for content generation, social media scheduling, SEO and email marketing. Optional Gemini/Claude fallback. By Radixile."
$topics = @("ai","artificial-intelligence","digital-marketing","marketing-automation","social-media","social-media-scheduler","content-generation","seo","email-marketing","ollama","llama","local-ai","llm","privacy","windows","desktop-app","electron","gemini","claude","nexus")
$topicArgs = @(); foreach ($t in $topics) { $topicArgs += "--add-topic"; $topicArgs += $t }
gh repo edit $Repo --description $desc --homepage "https://radixile.com" @topicArgs 2>$null
Write-Host "Repo description + topics set (SEO)." -ForegroundColor Green

# ── 2. Create / update the Release with installers ──────────────────────────
$tag = "v$Version"
$exists = (gh release view $tag --repo $Repo 2>$null)
if ($LASTEXITCODE -eq 0) {
  Write-Host "Release $tag exists - uploading/overwriting assets..." -ForegroundColor Yellow
  gh release upload $tag $setup $portable --repo $Repo --clobber
} else {
  Write-Host "Creating release $tag ..." -ForegroundColor Cyan
  $notes = @"
NEXUS $tag

- Fixes the installer/startup error ('server process failed to start' / node.exe ENOENT).
- Local AI via Ollama is now the primary engine, with a guided first-run setup.
- No separate Node.js install required.

See the README for download & setup instructions.
"@
  gh release create $tag $setup $portable --repo $Repo --title "NEXUS $tag" --notes $notes
}

# cleanup
try { Remove-Item $tmp -Recurse -Force } catch {}
Write-Host "`nDone. View it at: https://github.com/$Repo/releases/tag/$tag" -ForegroundColor Green
