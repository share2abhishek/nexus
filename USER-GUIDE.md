# NEXUS — User Guide

A quick walkthrough of getting productive with NEXUS after installation.

> New here? Install first using the [README](README.md), then set up the local
> AI on the first-run wizard.

---

## 1. Create your account

1. Launch NEXUS (Desktop shortcut, Start Menu, or the portable `.exe`).
2. The app opens its own window at your local dashboard.
3. Click **Create Account** and register. The first account you create is your
   admin account.

Multiple people can use one NEXUS server — each registers their own account with
their own keys and connected platforms.

---

## 2. Set up the AI

NEXUS uses **Ollama** (local, free, private) as the primary AI.

- On first run, follow the **Set up your AI** wizard: install Ollama, confirm it's
  running, and download the recommended model.
- You can revisit AI settings any time from **Settings**.
- **Optional cloud fallback:** add a **Google Gemini** or **Anthropic Claude** key
  in **Settings → My API Keys**. These are used only if the local AI is
  unavailable.

---

## 3. Connect your platforms

Go to **Settings → Social Platforms** and connect the accounts you want to publish
to (LinkedIn, Facebook/Instagram, Pinterest, X/Twitter, YouTube/Google, TikTok).
Each connection uses your own developer app credentials, entered in settings.

For email marketing, add your SMTP details (e.g. a Gmail App Password) under the
email settings.

---

## 4. Generate content

1. Open the content/generation area of the dashboard.
2. Describe what you want; NEXUS uses your local AI to draft posts, captions, SEO
   copy, or emails.
3. Edit, then save or schedule.

---

## 5. Schedule & publish

- Schedule posts to go out at chosen times; the built-in scheduler runs while
  NEXUS is open (it stays in the system tray when you close the window).
- Right-click the tray icon to open the dashboard, open in a browser, or quit.

---

## 6. Where your data lives

Everything is stored locally in your Windows user-data folder
(`%APPDATA%\NEXUS`): your `.env` settings, the database, and content. Backing up
that folder backs up your NEXUS data. Reinstalling/updating preserves it.

---

## Getting help

- In-app **Help** is available from the dashboard.
- Issues or questions: **support@radixile.com**
- Latest version: [Releases](https://github.com/share2abhishek/nexus/releases/latest)

---

© 2026 Radixile Technology Solutions LLP (India).
