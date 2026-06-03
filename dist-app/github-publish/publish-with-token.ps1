<#
  Publishes the NEXUS distribution to https://github.com/share2abhishek/nexus
  using a GitHub Personal Access Token (no GitHub CLI required).

   - Pushes user docs (README, USER-GUIDE, RELEASING) to the repo (keeps LICENSE)
   - Creates/updates a GitHub Release with the installer .exe files attached

  GET A TOKEN (one time):
    https://github.com/settings/tokens
      • Classic token: tick the  "repo"  scope, OR
      • Fine-grained token for the 'nexus' repo: Contents = Read and write
    Copy the token (starts with ghp_ or github_pat_).

  RUN:
    powershell -ExecutionPolicy Bypass -File .\publish-with-token.ps1
    (you'll be prompted to paste the token; it is not shown or saved)

    Or non-interactively:
    $env:GITHUB_TOKEN = "ghp_xxx"; .\publish-with-token.ps1
#>
param(
  [string]$Repo    = "share2abhishek/nexus",
  [string]$Version = "2.0.0",
  [string]$Token   = $env:GITHUB_TOKEN
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$here    = $PSScriptRoot
$distDir = Split-Path $here -Parent

# ── Token ─────────────────────────────────────────────────────────────────────
# Visible prompt: pasting into a *masked* prompt is unreliable and often captures
# only 1 character. You can clear the screen afterwards (cls).
if (-not $Token) {
  Write-Host "Paste your GitHub token, then press Enter (it WILL be visible on screen):" -ForegroundColor Cyan
  $Token = Read-Host
}
$Token = ("$Token").Trim()    # strip stray spaces/newlines from pasting
if (-not $Token) { Write-Error "No token provided."; exit 1 }
Write-Host ("Token received: length {0}, prefix '{1}...'" -f $Token.Length, $Token.Substring(0, [Math]::Min(7,$Token.Length))) -ForegroundColor DarkGray

$apiHdr = @{ Authorization = "Bearer $Token"; "User-Agent" = "nexus-publish"; Accept = "application/vnd.github+json" }

# Validate token + repo access — surface GitHub's real response on failure
try {
  $me = Invoke-RestMethod "https://api.github.com/user" -Headers $apiHdr -TimeoutSec 15
  Write-Host "Authenticated as $($me.login)" -ForegroundColor Green
} catch {
  $resp = $_.Exception.Response
  $code = if ($resp) { try { [int]$resp.StatusCode } catch { 0 } } else { 0 }
  $detail = $_.ErrorDetails.Message
  if (-not $detail -and $resp) { try { $detail = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {} }
  Write-Host ""
  Write-Host "GitHub rejected the token (HTTP $code)." -ForegroundColor Red
  Write-Host "GitHub said: $detail" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Most common causes:" -ForegroundColor Cyan
  Write-Host "  401 Bad credentials  -> token is mistyped/expired, or it's not a real PAT."
  Write-Host "                          Create a NEW classic token at https://github.com/settings/tokens"
  Write-Host "                          with the 'repo' scope checked, and copy ALL of it (ghp_...)."
  Write-Host "  403 / SSO            -> if your account uses SSO, click 'Configure SSO' on the token and authorize it."
  Write-Host "  fine-grained token   -> must grant this repo + Contents: Read and write, and be 'Active'."
  exit 1
}

# Installers must exist
$setup    = Join-Path $distDir "NEXUS-Setup-$Version.exe"
$portable = Join-Path $distDir "NEXUS-Portable-$Version.exe"
foreach ($f in @($setup, $portable)) {
  if (-not (Test-Path $f)) { Write-Error "Missing installer: $f  (build first: npx electron-builder --win --x64)"; exit 1 }
}

# ── 1. Push docs via git (token embedded in the push URL; temp clone deleted) ─
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Error "git not found. Install Git for Windows: https://git-scm.com/download/win"; exit 1 }
$tmp     = Join-Path $env:TEMP ("nexus-pub-" + [guid]::NewGuid().ToString("N").Substring(0,8))
$authUrl = "https://x-access-token:$Token@github.com/$Repo.git"
Write-Host "Cloning $Repo ..." -ForegroundColor Cyan
git clone --quiet $authUrl $tmp 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmp)) {
  Write-Error "git clone failed. The token likely lacks repo access (need 'repo' scope, or Contents: Read and write for a fine-grained token)."
  exit 1
}
foreach ($d in "README.md","USER-GUIDE.md","RELEASING.md") {
  Copy-Item (Join-Path $here $d) (Join-Path $tmp $d) -Force
}
Push-Location $tmp
git add -A
if (git status --porcelain) {
  git -c user.name="NEXUS Publisher" -c user.email="support@radixile.com" commit -m "docs: publish NEXUS v$Version distribution docs" | Out-Null
  git push --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Error "git push failed (token write permission?)."; exit 1 }
  Write-Host "Docs pushed." -ForegroundColor Green
} else { Write-Host "Docs already up to date." -ForegroundColor Yellow }
Pop-Location
try { Remove-Item $tmp -Recurse -Force } catch {}

# ── 1b. Repo description + topics (SEO / discoverability) ─────────────────────
$desc   = "Free AI digital marketing desktop app for Windows. Private, local AI (Ollama / Llama 3.2) for content generation, social media scheduling, SEO and email marketing. Optional Gemini/Claude fallback. By Radixile."
$topics = @("ai","artificial-intelligence","digital-marketing","marketing-automation","social-media","social-media-scheduler","content-generation","seo","email-marketing","ollama","llama","local-ai","llm","privacy","windows","desktop-app","electron","gemini","claude","nexus")
try {
  Invoke-RestMethod "https://api.github.com/repos/$Repo" -Method Patch -Headers $apiHdr -Body (@{ description = $desc; homepage = "https://radixile.com" } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 20 | Out-Null
  Invoke-RestMethod "https://api.github.com/repos/$Repo/topics" -Method Put -Headers $apiHdr -Body (@{ names = $topics } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 20 | Out-Null
  Write-Host "Repo description + topics set (SEO)." -ForegroundColor Green
} catch { Write-Host "Warning: could not set description/topics: $($_.Exception.Message)" -ForegroundColor Yellow }

# ── 2. Create or reuse the Release ────────────────────────────────────────────
$tag = "v$Version"
$rel = $null
try { $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/tags/$tag" -Headers $apiHdr -TimeoutSec 15 } catch {}
if (-not $rel) {
  $notes = "NEXUS $tag`n`n- Fixes the installer/startup error (server process failed to start / node.exe ENOENT).`n- Local AI via Ollama is now primary, with a guided first-run setup.`n- No separate Node.js install required.`n`nSee the README for download & setup."
  $body = @{ tag_name = $tag; name = "NEXUS $tag"; body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json
  $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases" -Method Post -Headers $apiHdr -Body $body -ContentType "application/json" -TimeoutSec 30
  Write-Host "Created release $tag" -ForegroundColor Green
} else {
  Write-Host "Release $tag already exists - updating assets." -ForegroundColor Yellow
}

# ── 3. Upload installers (replace if same name already attached) ──────────────
$existing = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/$($rel.id)/assets" -Headers $apiHdr -TimeoutSec 15
foreach ($file in @($setup, $portable)) {
  $name = Split-Path $file -Leaf
  $dupe = $existing | Where-Object { $_.name -eq $name }
  if ($dupe) {
    Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/assets/$($dupe.id)" -Method Delete -Headers $apiHdr | Out-Null
  }
  Write-Host "Uploading $name ..." -ForegroundColor Cyan
  $upUrl = "https://uploads.github.com/repos/$Repo/releases/$($rel.id)/assets?name=$name"
  Invoke-RestMethod $upUrl -Method Post -Headers $apiHdr -InFile $file -ContentType "application/octet-stream" -TimeoutSec 600 | Out-Null
  Write-Host "  done." -ForegroundColor Green
}

Write-Host "`nPublished. View it at: https://github.com/$Repo/releases/tag/$tag" -ForegroundColor Green
