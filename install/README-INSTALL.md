# NEXUS v2.0 — Installation Guide

## Quick Install (Windows)

### Option 1: PowerShell (Recommended)
```powershell
# Run as Administrator
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\install\setup.ps1
```

### Option 2: With Ollama (local AI bundled)
```powershell
.\install\setup.ps1 -InstallOllama
```

### Option 3: Custom install path
```powershell
.\install\setup.ps1 -InstallPath "D:\NEXUS" -InstallOllama
```

---

## What the installer does

1. ✅ Checks Node.js (downloads v20 LTS if missing)
2. ✅ Copies NEXUS to your chosen directory
3. ✅ Runs `npm install` automatically
4. ✅ Creates `.env` with a secure random session secret
5. ✅ Optionally downloads and configures Ollama + llama3.2
6. ✅ Creates a Desktop shortcut
7. ✅ Creates a Start Menu entry

---

## System Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| OS | Windows 10 | Windows 11 |
| RAM | 4 GB | 8+ GB (for local AI) |
| Disk | 500 MB | 10+ GB (for AI models) |
| Node.js | v18+ | v20 LTS |
| Internet | Required for setup | Optional after setup |

---

## First Run

1. Start NEXUS via Desktop shortcut or `start-nexus.bat`
2. Open http://localhost:3000
3. You'll be redirected to the login page
4. Click **"Create Account"** — register your admin account
5. Configure your API keys in **Settings → My API Keys**
6. Connect your social media accounts in **Settings → Social Platforms**

---

## Sharing with others (multi-user)

NEXUS supports multiple user accounts. Share your server URL with teammates — each person registers their own account with their own API keys and social connections.

To make NEXUS accessible on your local network:
1. Edit `.env` and change `PORT=3000` if needed
2. Share your local IP: `http://192.168.x.x:3000`
3. Each user registers and logs in independently

---

## Updating NEXUS

```powershell
# Re-run the installer — it preserves your .env and database
.\install\setup.ps1
```

---

## Uninstall

1. Delete the install folder (default: `C:\NEXUS`)
2. Delete Desktop shortcut
3. Delete Start Menu folder: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\NEXUS`
