// The AI voice assistant, for the active workspace (docs/platform/VOICE-AGENTS.md 9). PoC: Radixile staff only
// (the voice.* permissions have no role grants yet, so only the staff bypass passes them).
const express = require('express');
const fs = require('fs');
const calls = require('../services/voice/calls');

const DEFAULTS = {
  name: 'Sneha',
  greeting: 'Namaste! Main Sneha bol rahi hoon, aapki AI assistant. Ye call quality ke liye record ho raha hai. Bataiye, main aapki kaise madad kar sakti hoon?',
  instructions: '',
  voice_controls: { speed: 1.0, pauseMs: 250, endOfTurnMs: 700, bargeIn: true, noiseSuppression: true, maxCallSec: 600, silenceSec: 12 },
  models: { stt: { provider: 'openai', model: 'gpt-4o-transcribe' }, llm: { provider: 'anthropic', model: 'claude-sonnet-5-5', temperature: 0.4 }, tts: { provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'coral' } },
  handover: { phone: '', hoursFrom: '08:00', hoursTo: '22:00', days: [0, 1, 2, 3, 4, 5, 6] },
  kb_enabled: true, recording_on: true, retention_days: 30, active: false,
};
const PROVIDERS = { stt: ['openai', 'gemini'], llm: ['anthropic', 'openai', 'gemini'], tts: ['openai', 'gemini'] };
const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const now = () => Math.floor(Date.now() / 1000);

function shape(row) {
  if (!row) return { ...DEFAULTS, exists: false };
  return { exists: true, name: row.name, greeting: row.greeting, instructions: row.instructions || '',
    voice_controls: { ...DEFAULTS.voice_controls, ...json(row.voice_controls, {}) }, models: { ...DEFAULTS.models, ...json(row.models, {}) },
    handover: { ...DEFAULTS.handover, ...json(row.handover, {}) }, kb_enabled: !!row.kb_enabled, recording_on: !!row.recording_on,
    retention_days: Number(row.retention_days), active: !!row.active, updated_at: row.updated_at };
}

function clean(b = {}) {
  const err = (m, field) => Object.assign(new Error(m), { status: 400, field });
  const s = (v, max, field, req) => { const x = String(v ?? '').trim(); if (req && !x) throw err(`${field} is required.`, field); return x.slice(0, max); };
  const vc = b.voice_controls || {};
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const models = {};
  for (const part of ['stt', 'llm', 'tts']) {
    const m = (b.models || {})[part] || DEFAULTS.models[part];
    if (!PROVIDERS[part].includes(m.provider)) throw err(`${part}: provider must be one of ${PROVIDERS[part].join(', ')}.`, 'models');
    models[part] = { provider: m.provider, model: s(m.model, 80, `${part} model`, true), ...(m.voice !== undefined && { voice: s(m.voice, 40, 'voice') }),
      ...(part === 'llm' && { temperature: num(m.temperature, 0, 1, 0.4) }) };
  }
  const h = b.handover || {};
  const time = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : d);
  const phone = String(h.phone || '').replace(/[^\d+]/g, '').slice(0, 16);
  if (phone && !/^\+?\d{10,15}$/.test(phone)) throw err('Hand-over phone: 10 to 15 digits, with the country code.', 'handover');
  const retention = Math.round(num(b.retention_days, 1, 365, 30));
  return {
    name: s(b.name, 60, 'name', true), greeting: s(b.greeting, 1000, 'greeting', true), instructions: s(b.instructions, 20000, 'instructions'),
    voice_controls: JSON.stringify({ speed: num(vc.speed, 0.7, 1.3, 1), pauseMs: Math.round(num(vc.pauseMs, 0, 1500, 250)), endOfTurnMs: Math.round(num(vc.endOfTurnMs, 300, 2000, 700)),
      bargeIn: vc.bargeIn !== false, noiseSuppression: vc.noiseSuppression !== false, maxCallSec: Math.round(num(vc.maxCallSec, 60, 1800, 600)), silenceSec: Math.round(num(vc.silenceSec, 5, 60, 12)) }),
    models: JSON.stringify(models),
    handover: JSON.stringify({ phone, hoursFrom: time(h.hoursFrom, '08:00'), hoursTo: time(h.hoursTo, '22:00'),
      days: Array.isArray(h.days) ? [...new Set(h.days.map(Number).filter((d) => d >= 0 && d <= 6))] : DEFAULTS.handover.days }),
    kb_enabled: b.kb_enabled !== false, recording_on: b.recording_on !== false, retention_days: retention, active: b.active === true,
  };
}

module.exports = (knex, permit) => {
  const router = express.Router();
  router.use(express.json({ limit: '128kb' }));
  const serverOnly = (req, res, next) => (require('../services/edition').isServer() ? next() : res.status(404).json({ error: 'Not found' }));
  router.use(serverOnly);

  router.get('/status', permit('voice.calls.view'), (req, res) => {
    res.json({ enabled: calls.enabled(), gateway_configured: require('../services/voice/gateway').configured() });
  });

  router.get('/assistant', permit('voice.assistants.manage'), async (req, res) => {
    res.json(shape(await knex('voice_assistant').where({ workspace_id: req.workspaceId }).first()));
  });

  router.put('/assistant', permit('voice.assistants.manage'), async (req, res) => {
    let row;
    try { row = clean(req.body); } catch (e) { return res.status(e.status || 400).json({ error: e.message, field: e.field }); }
    const ws = await knex('workspaces').where({ id: req.workspaceId }).first('org_id');
    if (!ws) return res.status(404).json({ error: 'Not found' });
    const existing = await knex('voice_assistant').where({ workspace_id: req.workspaceId }).first('id');
    const patch = { ...row, updated_at: now(), updated_by: req.session.userId };
    if (existing) await knex('voice_assistant').where({ id: existing.id }).update(patch);
    else await knex('voice_assistant').insert({ ...patch, org_id: ws.org_id, workspace_id: req.workspaceId, created_at: now() });
    res.json(shape(await knex('voice_assistant').where({ workspace_id: req.workspaceId }).first()));
  });

  router.get('/calls', permit('voice.calls.view'), async (req, res) => {
    const rows = await knex('voice_call').where({ workspace_id: req.workspaceId }).orderBy('id', 'desc').limit(Math.min(200, Number(req.query.limit) || 50))
      .select('id', 'direction', 'contact', 'status', 'started_at', 'answered_at', 'ended_at', 'duration_sec', 'end_reason', 'outcome', 'next_step', 'summary', 'lead_id', 'recording_key', 'recording_deleted_at');
    res.json(rows.map(({ recording_key: k, contact, ...r }) => ({ ...r, contact_masked: contact ? `…${String(contact).slice(-4)}` : null, has_recording: !!k })));
  });

  // Another workspace's call id answers 404 (isolation)
  const own = async (req) => knex('voice_call').where({ id: Number(req.params.id) || 0, workspace_id: req.workspaceId }).first();

  router.get('/calls/:id', permit('voice.calls.view'), async (req, res) => {
    const call = await own(req);
    if (!call) return res.status(404).json({ error: 'Not found' });
    const turns = await knex('voice_transcript_turn').where({ call_id: call.id, workspace_id: req.workspaceId }).orderBy('seq')
      .select('seq', 'speaker', 'start_ms', 'end_ms', 'lang', 'text', 'stt_ms', 'llm_ms', 'tts_ms');
    const { recording_key: k, contact, error, ...rest } = call;
    res.json({ ...rest, contact_masked: contact ? `…${String(contact).slice(-4)}` : null, has_recording: !!k, turns });
  });

  router.get('/calls/:id/recording', permit('voice.recordings.listen'), async (req, res) => {
    const call = await own(req);
    const file = call && call.recording_key ? calls.recordingPath(call.recording_key) : null;
    if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
    console.log(`[VOICE] recording of call #${call.id} played by user #${req.session.userId}`); // listening is audited (ids only)
    res.set('Cache-Control', 'private, no-store');
    res.type(file.endsWith('.ogg') ? 'audio/ogg' : file.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav');
    fs.createReadStream(file).pipe(res);
  });

  return router;
};

module.exports.DEFAULTS = DEFAULTS;
module.exports.clean = clean;
