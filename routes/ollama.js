/**
 * Social-Nexus — Ollama Guided Setup routes (public, no auth)
 *
 * Powers the first-run setup wizard: live status detection, hardware-based
 * model recommendation, and a streamed model download that flips Ollama on as
 * the primary AI once a model is ready.
 */
const express = require('express');
const axios   = require('axios');
const os      = require('os');
const fs      = require('fs');
const path    = require('path');

const router = express.Router();

const BASE       = () => process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const ENV_PATH   = process.env.DOTENV_CONFIG_PATH || path.join(__dirname, '..', '.env');
const DOWNLOAD_URL = 'https://ollama.com/download';

// ── .env writer (writable copy; mirrors routes/config.js behaviour) ───────────

// Model names look like "llama3.2", "llama3.1:8b", "hf.co/org/model:Q4" — nothing else
const MODEL_RE = /^[\w.:\/-]{1,100}$/;

function setEnvValues(updates) {
  for (const [k, v] of Object.entries(updates)) {
    if (/[\r\n]/.test(String(v)) || !/^[A-Z0-9_]+$/.test(k)) throw new Error('Invalid setting value');
  }
  let lines = [];
  try { lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/); } catch { lines = []; }
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value; // take effect immediately (aiHelper re-reads env)
    const idx = lines.findIndex(l => l.startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else          lines.push(`${key}=${value}`);
  }
  try { fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8'); } catch (e) {
    console.warn('[Ollama] Could not write .env:', e.message);
  }
}

// ── Hardware-based model recommendation ───────────────────────────────────────

function recommendModel() {
  const totalRamGB = os.totalmem() / (1024 ** 3);
  if (totalRamGB < 8) {
    return { model: 'llama3.2:1b', totalRamGB: +totalRamGB.toFixed(1),
             reason: 'Under 8 GB RAM — a lightweight 1B model runs smoothly.' };
  }
  return { model: 'llama3.2:3b', totalRamGB: +totalRamGB.toFixed(1),
           reason: '8 GB+ RAM — the 3B model gives better quality.' };
}

function baseName(model) { return String(model).split(':')[0]; }

async function listModels() {
  const res = await axios.get(`${BASE()}/api/tags`, { timeout: 3000 });
  return (res.data.models || []).map(m => m.name);
}

// ── GET /ollama/recommend ─────────────────────────────────────────────────────

router.get('/recommend', (req, res) => res.json(recommendModel()));

// ── GET /ollama/status ────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  const recommended    = recommendModel();
  const configuredModel = process.env.OLLAMA_MODEL || recommended.model;

  let running = false, models = [];
  try { models = await listModels(); running = true; } catch { running = false; }

  // A model is "ready" if any installed model matches the one we'd use.
  const want = baseName(configuredModel);
  const modelReady = running && models.some(
    n => n === configuredModel || baseName(n) === want
  );

  res.json({
    running,
    models,
    modelReady,
    recommendedModel:  recommended.model,
    configuredModel,
    enabled:           process.env.OLLAMA_ENABLED === 'true',
    downloadUrl:       DOWNLOAD_URL,
    platform:          process.platform,
  });
});

// ── POST /ollama/select  (user already has a model / manual command path) ─────

router.post('/select', async (req, res) => {
  const model = (req.body && req.body.model) || process.env.OLLAMA_MODEL;
  if (!model) return res.status(400).json({ error: 'No model specified' });
  if (!MODEL_RE.test(model)) return res.status(400).json({ error: 'That does not look like an Ollama model name.' });
  setEnvValues({ OLLAMA_ENABLED: 'true', OLLAMA_MODEL: model });
  res.json({ ok: true, model, enabled: true });
});

// ── POST /ollama/pull  (SSE stream of download progress) ──────────────────────

router.post('/pull', async (req, res) => {
  const model = (req.body && req.body.model) || recommendModel().model;
  if (!MODEL_RE.test(model)) return res.status(400).json({ error: 'That does not look like an Ollama model name.' });

  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });
  res.flushHeaders?.();

  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const upstream = await axios.post(
      `${BASE()}/api/pull`,
      { name: model, stream: true },
      { responseType: 'stream', timeout: 0 }
    );

    let buffer = '';
    upstream.data.on('data', chunk => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          const pct = (evt.total && evt.completed)
            ? Math.round((evt.completed / evt.total) * 100) : null;
          send({ status: evt.status || '', percent: pct,
                 completed: evt.completed, total: evt.total, error: evt.error });
        } catch { /* ignore partial JSON */ }
      }
    });

    upstream.data.on('end', () => {
      // Mark Ollama primary now that the model is present
      setEnvValues({ OLLAMA_ENABLED: 'true', OLLAMA_MODEL: model });
      send({ status: 'success', percent: 100, done: true, model });
      res.end();
    });

    upstream.data.on('error', err => {
      send({ status: 'error', error: err.message, done: true });
      res.end();
    });

    // If the client disconnects, stop reading upstream
    req.on('close', () => { try { upstream.data.destroy(); } catch {} });
  } catch (err) {
    const hint = (err.code === 'ECONNREFUSED')
      ? 'Ollama is not running. Install it and make sure it is started.'
      : err.message;
    send({ status: 'error', error: hint, done: true });
    res.end();
  }
});

module.exports = router;
