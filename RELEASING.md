# Releasing NEXUS (maintainer guide)

This repository publishes **only the distribution** (installers) and user docs —
not the application source. Installers live on the **GitHub Releases** page:

> **https://github.com/share2abhishek/nexus/releases**

Each version is one Release, tagged `vX.Y.Z`, with the installer files attached.
That is where you (and your users) release and download every future version.

---

## One-time setup

Install the GitHub CLI and sign in once (opens a browser):

```powershell
winget install --id GitHub.cli -e
gh auth login          # choose GitHub.com → HTTPS → login with browser
```

---

## Cut a new release

From the **source** project folder (where you build):

```powershell
# 1. Bump the version in package.json (e.g. 2.0.0 -> 2.0.1)

# 2. Build the installers
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npx electron-builder --win --x64
#    -> produces dist-app\NEXUS-Setup-<version>.exe and NEXUS-Portable-<version>.exe

# 3. Publish the Release (replace the version + notes)
$ver = "2.0.1"
gh release create "v$ver" `
  "dist-app\NEXUS-Setup-$ver.exe" `
  "dist-app\NEXUS-Portable-$ver.exe" `
  --repo share2abhishek/nexus `
  --title "NEXUS v$ver" `
  --notes "What's new in v$ver..."
```

Users who downloaded before will see the new version at
`/releases/latest` automatically.

---

## Updating the docs (README / USER-GUIDE)

The docs in this repo are plain Markdown. Edit them, then:

```powershell
git clone https://github.com/share2abhishek/nexus.git
# edit README.md / USER-GUIDE.md
git add -A && git commit -m "docs: update for vX.Y.Z" && git push
```

---

## Notes

- **Do not commit installers into git.** They are large binaries — always attach
  them to a Release instead (the commands above do this).
- **Never commit `.env`, databases, or `node_modules`** — they're git-ignored in
  the source project and must stay out of the public repo.
- Code signing is not configured (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Users see
  a SmartScreen prompt; add an EV/OV certificate later to remove it.
