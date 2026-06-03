<div align="center">

# ◆ NEXUS

### AI Digital Marketing Platform

*by Radixile Technology Solutions LLP*

**Version 2.0.0 · Windows 10/11 (64-bit)**

[**⬇ Download the latest version**](https://github.com/share2abhishek/nexus/releases/latest)

</div>

---

## What is NEXUS?

NEXUS is a desktop application that runs an AI-powered digital marketing suite on
your own computer — content generation, scheduling, SEO, email, and social
publishing — all behind a private local dashboard. Your data stays on your machine.

It uses a **local, free, private AI (Ollama)** as the primary engine, so you can
work without paying for cloud API keys. Cloud providers (Google Gemini, Anthropic
Claude) can be added as optional fallbacks.

---

## ⬇ Download & Install

1. Go to the [**Releases page**](https://github.com/share2abhishek/nexus/releases/latest).
2. Download one of:
   - **`NEXUS-Setup-2.0.0.exe`** — installer (creates Start Menu + Desktop shortcuts). *Recommended.*
   - **`NEXUS-Portable-2.0.0.exe`** — portable, no install; just run it.
3. Run it. Windows SmartScreen may warn on first launch (the app isn't
   code-signed yet) — click **More info → Run anyway**.
4. NEXUS opens its own window. On first launch it walks you through setting up
   the AI (see below).

> No separate Node.js install is required — everything the app needs is bundled.

---

## 🤖 First run — set up the AI (one time)

On the first launch, NEXUS shows a **guided "Set up your AI"** screen. Three steps:

1. **Install Ollama** — click *Open download page* → install from
   <https://ollama.com/download>. It starts automatically in the background.
2. **Confirm it's running** — the screen shows a green "Running" indicator once
   detected. (If not, open a terminal and run `ollama serve`.)
3. **Download the model** — click **Download model**. NEXUS recommends the right
   model for your computer automatically:
   - `llama3.2:1b` (~1.3 GB) on machines with under 8 GB RAM
   - `llama3.2:3b` (~2 GB) on machines with 8 GB+ RAM

   *(Or run it yourself: `ollama pull llama3.2:3b`)*

When the model finishes downloading, click **Start using NEXUS**. That's it — the
AI is now local, free, and private.

> Prefer cloud AI? Click *Skip for now* and add a Google Gemini or Anthropic
> Claude key in **Settings → My API Keys**.

---

## 🖥 System requirements

| | Minimum | Recommended |
|---|---|---|
| OS | Windows 10 (1903+) | Windows 11 |
| RAM | 4 GB | 8 GB+ (for local AI) |
| Disk | 500 MB | 10 GB+ (for AI models) |
| Internet | Once, to install Ollama + model | Optional afterwards |

---

## 📖 Documentation

- **[User Guide](USER-GUIDE.md)** — registering, connecting platforms, generating
  content, scheduling, and using the AI.
- In-app help is available any time from the dashboard.

---

## 🛠 Troubleshooting

**"The server process failed to start" / `node.exe ENOENT`**
This was fixed in v2.0.0. Make sure you're running the latest installer from the
[Releases page](https://github.com/share2abhishek/nexus/releases/latest).

**AI replies fail or are empty**
Open the dashboard's AI setup, confirm Ollama shows *Running* and a model is
downloaded. Re-open NEXUS after installing Ollama so it can detect it.

**Port 3000 in use**
Another app (or a previous NEXUS) is using port 3000. Close it, or change `PORT`
in your `.env` (stored in your user data folder).

---

## 🔒 Privacy

NEXUS runs entirely on your computer. With Ollama, AI runs locally and nothing is
sent to external servers. Your databases, sessions, and content stay in your
Windows user-data folder.

---

## 📦 Releases

Every version is published on the
**[Releases page](https://github.com/share2abhishek/nexus/releases)**. Watch or
star this repository to be notified of new versions.

---

<div align="center">

© 2026 **Radixile Technology Solutions LLP** (India) · All rights reserved.
· [radixile.com](https://radixile.com) · support@radixile.com

</div>
