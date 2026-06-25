# NEXUS — Ollama as Primary AI with Guided Setup

**Date:** 2026-06-03
**Status:** Approved (implementing)

## Goal

Make local **Ollama** the primary AI for NEXUS, without bundling its 1.4 GB
runtime in the installer. After installation, a clear guided popup walks the
user through: (1) installing Ollama, (2) confirming it runs, (3) downloading a
model — so they can start working. The app detects each step's completion live.

## Why not bundle

`ollama-windows-amd64.zip` is ~1.4 GB. Bundling it (plus a ~1–2 GB model) makes
the installer 3 GB+. A guided installer keeps NEXUS ~91 MB and lets Ollama
update independently.

## Design

### AI priority
- `OLLAMA_ENABLED=true` by default; Ollama is priority 1 in
  [services/aiHelper.js](../../../services/aiHelper.js) (already implemented).
- Cloud providers (Gemini, Claude) remain automatic fallback if keys exist.

### Guided setup wizard — `public/setup.html`
A standalone, themed page with three live, numbered steps:
1. **Install Ollama** — "Open download page" button → https://ollama.com/download.
   Note: the Windows installer auto-starts Ollama as a background service.
2. **Confirm it's running** — live status dot; reachable = `GET /api/tags` OK.
   Shows the `ollama serve` command (copy button) for the rare manual case.
3. **Download the model** — shows the exact command `ollama pull <model>`
   (copy button) AND a one-click **Download model** button that streams pull
   progress via the app once Ollama is reachable. Model recommended by hardware.
- A status poller advances steps automatically (checkmarks). When the model is
  ready it enables **Start using NEXUS** → redirects to `/`.
- "Skip for now" link → `/` (cloud fallback used if configured).

### Backend — `routes/ollama.js` (mounted public, no auth)
- `GET /ollama/status` → `{ running, models, modelReady, recommendedModel,
  configuredModel, downloadUrl, platform }`.
- `GET /ollama/recommend` → `{ model, totalRamGB, reason }`.
  - RAM < 8 GB → `llama3.2:1b` (~1.3 GB); else `llama3.2:3b` (~2 GB).
- `POST /ollama/pull` (body `{ model }`) → SSE proxy of Ollama's
  `POST /api/pull` NDJSON progress; on completion writes `OLLAMA_ENABLED=true`
  and `OLLAMA_MODEL=<model>` to the writable `.env` and to `process.env`.
- `POST /ollama/select` (body `{ model }`) → set model + enable, for the
  "I already have it" path.

### Electron flow — `electron/main.js`
- After the Express server is healthy, check Ollama status over HTTP.
- If not ready (not running, or no model), load `/setup.html` in the main
  window; otherwise load the app normally. "Skip for now" navigates to `/`.

### Config
- `.env.example`: `OLLAMA_ENABLED=true`, `OLLAMA_BASE_URL=http://localhost:11434`,
  `OLLAMA_MODEL=llama3.2`.

## Error handling
- Ollama not installed/running → wizard stays on the relevant step with a
  "Re-check" affordance; AI calls fall back to cloud if keys are present.
- Pull interrupted → Ollama's pull is resumable; user can re-click Download.
- Offline → wizard explains internet is needed once to fetch the model.

## Out of scope
- Bundling the Ollama runtime or any model.
- macOS/Linux guidance text (Windows-first; links still work cross-platform).

## Verification
- `GET /ollama/status` reports the real local Ollama (installed + running here).
- Wizard renders, polls, advances, and the pull SSE proxies progress.
- `aiGenerate` routes to Ollama when enabled + model present.
- Full packaged app loads `/setup.html` when not ready, app when ready.
