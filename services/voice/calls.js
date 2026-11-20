// WhatsApp calls answered by the business's AI assistant (docs/platform/VOICE-AGENTS.md, phase V2).
//
// Flow for a customer's call (user-initiated):
//   Meta `calls` webhook (event connect, SDP offer)
//     -> find the business ONLY by the registered phone-number id (never a fallback: isolation rule 7)
//     -> once per call event (voice_webhook_event), check the switch, the assistant and the concurrency limit
//     -> voice gateway session (our SDP answer) -> Meta pre_accept
//   gateway event media_ready -> Meta accept (same SDP) -> the gateway starts the audio after our 200
//   gateway events turn / handover / ended -> transcript, outcome, summary; recording upload -> file
//   Meta terminate webhook -> call ended, duration
// Switch: VOICE_ENABLED=true (server edition). Off = every call is rejected at once (the caller sees "not answered"
// immediately instead of ringing), and nothing reaches the gateway.
const fs = require('fs');
const path = require('path');
const metaCalls = require('./metaCalls');
const gateway = require('./gateway');

const now = () => Math.floor(Date.now() / 1000);
const OUTCOMES = ['interested', 'callback', 'visit_booked', 'demo_booked', 'not_interested', 'wrong_number', 'no_answer', 'handover', 'dropped'];
const ACCEPT_TIMEOUT_MS = 25000;
const pending = new Map(); // wa_call_id -> { sdpAnswer, meta, timer } (this process only)

const enabled = () => String(process.env.VOICE_ENABLED || '').toLowerCase() === 'true' && require('../edition').isServer();
const maxConcurrent = () => Math.max(1, Number(process.env.VOICE_MAX_CONCURRENT || 2));
const dataDir = () => process.env.NEXUS_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const digits = (s) => String(s || '').replace(/\D/g, '');
const log = (...a) => console.log('[VOICE]', ...a); // ids and counts only, never transcript text or full numbers
const mask = (n) => (digits(n).length > 4 ? `…${digits(n).slice(-4)}` : '…');
const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };

async function onceOnly(knex, key) {
  try { await knex('voice_webhook_event').insert({ event_key: key.slice(0, 260), received_at: now() }); return true; } catch { return false; }
}

async function leadFor(knex, workspaceId, contact) {
  const tail = digits(contact).slice(-10);
  if (tail.length < 8) return null;
  const rows = await knex('meta_lead_events').where({ workspace_id: workspaceId }).whereNotNull('phone_number')
    .orderBy('id', 'desc').limit(1000).select('id', 'full_name', 'phone_number').catch(() => []);
  return rows.find((r) => digits(r.phone_number).endsWith(tail)) || null;
}

async function knowledgeFor(knex, workspaceId) {
  const kb = await require('../kbRetrieval').loadKnowledge(knex, workspaceId).catch(() => null);
  if (!kb) return { faqs: [], text: '' };
  return { faqs: (kb.faqs || []).slice(0, 40).map((f) => ({ q: f.question, a: f.answer })), text: String(kb.compiled || '').slice(0, 12000) };
}

function assistantForGateway(a) {
  return {
    name: a.name, greeting: a.greeting, instructions: a.instructions || '', kb_enabled: !!a.kb_enabled,
    voice_controls: json(a.voice_controls, {}), models: json(a.models, {}), handover: json(a.handover, {}), recording_on: !!a.recording_on,
  };
}

// ── Meta webhook ─────────────────────────────────────────────────────────────
async function onMetaCalls(knex, value) {
  const phoneNumberId = String(value?.metadata?.phone_number_id || '');
  if (!phoneNumberId) return;
  const cfg = await knex('meta_lead_configs').where({ whatsapp_phone_number_id: phoneNumberId }).first();
  if (!cfg) { log(`call for unregistered number id ${phoneNumberId}: ignored`); return; }
  const ws = await knex('workspaces').where({ id: cfg.workspace_id }).first('id', 'org_id');
  if (!ws) return;
  const meta = { phoneNumberId, token: cfg.whatsapp_access_token };
  for (const c of value.calls || []) {
    if (!c || !c.id || !c.event) continue;
    if (!(await onceOnly(knex, `${c.id}:${c.event}`))) continue; // Meta retried this event
    try {
      if (c.event === 'connect') await onConnect(knex, ws, meta, c);
      else if (c.event === 'terminate') await onTerminate(knex, ws, c);
    } catch (e) { log(`call ${c.id} ${c.event} failed: ${e.message}`); }
  }
}

async function onConnect(knex, ws, meta, c) {
  const t = now();
  const base = { org_id: ws.org_id, workspace_id: ws.id, direction: c.direction || 'USER_INITIATED', contact: digits(c.from) || null,
    wa_call_id: c.id, wa_phone_number_id: meta.phoneNumberId, started_at: Number(c.timestamp) || t, created_at: t, updated_at: t };
  const assistant = await knex('voice_assistant').where({ workspace_id: ws.id, active: true }).first();
  let refuse = null;
  if (!enabled()) refuse = 'voice_off';
  else if (!assistant) refuse = 'no_assistant';
  else if (!gateway.configured()) refuse = 'gateway_not_configured';
  else {
    const busy = Number((await knex('voice_call').where({ workspace_id: ws.id }).whereIn('status', ['answering', 'active']).count('* as c').first())?.c || 0);
    if (busy >= maxConcurrent()) refuse = 'busy';
  }
  if (refuse) {
    await knex('voice_call').insert({ ...base, status: 'rejected', end_reason: refuse, ended_at: t });
    if (base.direction === 'USER_INITIATED') await metaCalls.reject(meta, c.id).catch((e) => log(`reject ${c.id}: ${e.message}`));
    log(`call ${c.id} from ${mask(c.from)} rejected: ${refuse}`);
    return;
  }

  const lead = await leadFor(knex, ws.id, c.from);
  const [row] = await knex('voice_call').insert({ ...base, assistant_id: assistant.id, lead_id: lead?.id ?? null, status: 'answering', models: assistant.models }).returning('id');
  const callRowId = row?.id ?? row;
  try {
    const { sdpAnswer } = await gateway.startSession({
      callId: c.id, sdpOffer: c.session?.sdp, assistant: assistantForGateway(assistant),
      knowledge: assistant.kb_enabled ? await knowledgeFor(knex, ws.id) : { faqs: [], text: '' },
      caller: { name: lead?.full_name || null, known: !!lead },
      callbackUrl: `${String(process.env.VOICE_CALLBACK_URL || process.env.APP_URL || '').replace(/\/+$/, '')}/api/webhooks/voice-gateway`,
    });
    if (!sdpAnswer) throw new Error('gateway gave no SDP answer');
    const timer = setTimeout(() => failAnswer(knex, c.id, meta, 'accept_timeout'), ACCEPT_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    pending.set(c.id, { sdpAnswer, meta, timer });
    await metaCalls.preAccept(meta, c.id, sdpAnswer);
    log(`call ${c.id} (#${callRowId}) from ${mask(c.from)} pre-accepted`);
  } catch (e) {
    await failAnswer(knex, c.id, meta, 'answer_failed', e.message);
  }
}

async function failAnswer(knex, callId, meta, reason, detail) {
  const p = pending.get(callId);
  if (p) { clearTimeout(p.timer); pending.delete(callId); }
  const n = await knex('voice_call').where({ wa_call_id: callId }).whereIn('status', ['answering']).update({ status: 'failed', end_reason: reason, error: detail ? String(detail).slice(0, 300) : null, ended_at: now(), updated_at: now() });
  if (!n) return;
  await metaCalls.reject(meta, callId).catch(() => metaCalls.terminate(meta, callId).catch(() => {}));
  await gateway.endSession(callId);
  log(`call ${callId} failed: ${reason}${detail ? ` (${detail})` : ''}`);
}

async function onTerminate(knex, ws, c) {
  const p = pending.get(c.id);
  if (p) { clearTimeout(p.timer); pending.delete(c.id); }
  const call = await knex('voice_call').where({ wa_call_id: c.id, workspace_id: ws.id }).first();
  if (!call) return;
  const patch = { updated_at: now(), ended_at: Number(c.end_time) || now() };
  if (c.duration != null) patch.duration_sec = Number(c.duration);
  if (c.start_time && !call.answered_at) patch.answered_at = Number(c.start_time);
  if (['answering', 'active'].includes(call.status)) {
    patch.status = c.status === 'FAILED' ? 'failed' : 'ended';
    patch.end_reason = call.end_reason || (c.start_time ? 'hangup' : 'not_answered');
  }
  if (c.errors) patch.error = JSON.stringify(c.errors).slice(0, 300);
  await knex('voice_call').where({ id: call.id }).update(patch);
  await gateway.endSession(c.id);
  log(`call ${c.id} ended (${patch.duration_sec ?? 0}s)`);
}

// ── Gateway events (signed; routes/voiceGateway.js) ─────────────────────────
// Returns { status, body }. The gateway starts audio only after media_ready answers 200.
async function onGatewayEvent(knex, evt) {
  const call = evt && evt.call_id ? await knex('voice_call').where({ wa_call_id: String(evt.call_id) }).first() : null;
  if (!call) return { status: 404, body: { error: 'no such call' } };
  const t = now();
  switch (evt.type) {
    case 'media_ready': {
      const p = pending.get(call.wa_call_id);
      if (!p || call.status !== 'answering') return { status: 409, body: { error: 'call is not waiting to be answered' } };
      try {
        await metaCalls.accept(p.meta, call.wa_call_id, p.sdpAnswer, `voice:${call.id}`);
      } catch (e) {
        await failAnswer(knex, call.wa_call_id, p.meta, 'accept_failed', e.message);
        return { status: 502, body: { error: 'accept failed' } };
      }
      clearTimeout(p.timer); pending.delete(call.wa_call_id);
      await knex('voice_call').where({ id: call.id }).update({ status: 'active', answered_at: t, updated_at: t });
      return { status: 200, body: { ok: true } };
    }
    case 'turn': {
      const assistant = call.assistant_id ? await knex('voice_assistant').where({ id: call.assistant_id }).first() : null;
      if (assistant && !assistant.recording_on) return { status: 200, body: { ok: true, stored: false } };
      const speaker = ['assistant', 'caller', 'staff'].includes(evt.speaker) ? evt.speaker : null;
      const text = String(evt.text || '').trim().slice(0, 4000);
      if (!speaker || !text || !Number.isInteger(evt.seq)) return { status: 400, body: { error: 'turn needs seq, speaker and text' } };
      const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
      try {
        await knex('voice_transcript_turn').insert({ org_id: call.org_id, workspace_id: call.workspace_id, call_id: call.id, seq: evt.seq, speaker, text,
          start_ms: int(evt.start_ms), end_ms: int(evt.end_ms), lang: evt.lang ? String(evt.lang).slice(0, 12) : null,
          stt_ms: int(evt.stt_ms), llm_ms: int(evt.llm_ms), tts_ms: int(evt.tts_ms) });
      } catch { /* the same turn twice: keep the first */ }
      return { status: 200, body: { ok: true } };
    }
    case 'handover': {
      await knex('voice_call').where({ id: call.id }).update({ outcome: 'handover', next_step: String(evt.note || 'Call back: the caller asked for a person.').slice(0, 500), updated_at: t });
      return { status: 200, body: { ok: true } };
    }
    case 'ended': {
      const u = evt.usage || {};
      const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null);
      const patch = {
        summary: evt.summary ? String(evt.summary).slice(0, 4000) : call.summary,
        outcome: OUTCOMES.includes(evt.outcome) ? (call.outcome === 'handover' ? 'handover' : evt.outcome) : call.outcome,
        next_step: evt.next_step ? String(evt.next_step).slice(0, 500) : call.next_step,
        tokens_in: int(u.tokens_in), tokens_out: int(u.tokens_out), stt_seconds: int(u.stt_seconds), tts_chars: int(u.tts_chars), updated_at: t,
      };
      if (['answering', 'active'].includes(call.status)) Object.assign(patch, { status: 'ended', end_reason: String(evt.reason || 'assistant_ended').slice(0, 60), ended_at: t });
      await knex('voice_call').where({ id: call.id }).update(patch);
      // The assistant ended the call (goodbye, silence, max length): tell Meta so the caller's line closes and billing stops
      if (evt.hangup && call.status === 'active') {
        const cfg = await knex('meta_lead_configs').where({ whatsapp_phone_number_id: call.wa_phone_number_id }).first();
        if (cfg) await metaCalls.terminate({ phoneNumberId: call.wa_phone_number_id, token: cfg.whatsapp_access_token }, call.wa_call_id).catch((e) => log(`terminate ${call.wa_call_id}: ${e.message}`));
      }
      return { status: 200, body: { ok: true } };
    }
    default:
      return { status: 400, body: { error: 'unknown event type' } };
  }
}

// ── Recording upload (signed) ────────────────────────────────────────────────
async function saveRecording(knex, waCallId, buffer, contentType) {
  const call = await knex('voice_call').where({ wa_call_id: String(waCallId) }).first();
  if (!call) return { status: 404, body: { error: 'no such call' } };
  const assistant = call.assistant_id ? await knex('voice_assistant').where({ id: call.assistant_id }).first() : null;
  if (assistant && !assistant.recording_on) return { status: 200, body: { ok: true, stored: false } };
  if (!buffer || !buffer.length) return { status: 400, body: { error: 'empty recording' } };
  const ext = /ogg|opus/.test(contentType || '') ? 'ogg' : /mpeg|mp3/.test(contentType || '') ? 'mp3' : 'wav';
  const key = path.posix.join('voice', String(call.org_id), String(call.workspace_id), `${call.id}.${ext}`);
  const file = path.join(dataDir(), key);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, buffer);
  await knex('voice_call').where({ id: call.id }).update({ recording_key: key, recording_bytes: buffer.length, updated_at: now() });
  return { status: 200, body: { ok: true } };
}

const recordingPath = (key) => {
  const root = path.resolve(dataDir(), 'voice');
  const full = path.resolve(dataDir(), key);
  return full.startsWith(root + path.sep) ? full : null; // never outside data/voice
};

// ── Retention: audio and transcript turns deleted after the assistant's retention days ─────────────────────────
async function purgeExpired(knex, at = now()) {
  let files = 0; let turns = 0;
  const assistants = await knex('voice_assistant').select('id', 'workspace_id', 'retention_days');
  for (const a of assistants) {
    const cutoff = at - Math.max(1, Number(a.retention_days) || 30) * 86400;
    const calls = await knex('voice_call').where({ workspace_id: a.workspace_id }).where('started_at', '<', cutoff)
      .where((q) => q.whereNull('recording_deleted_at').orWhereNull('transcript_deleted_at')).select('id', 'recording_key', 'recording_deleted_at', 'transcript_deleted_at');
    for (const c of calls) {
      const patch = {};
      if (!c.recording_deleted_at) {
        const p = c.recording_key ? recordingPath(c.recording_key) : null;
        if (p) { await fs.promises.unlink(p).catch(() => {}); files += 1; }
        patch.recording_deleted_at = at; patch.recording_key = null;
      }
      if (!c.transcript_deleted_at) {
        turns += await knex('voice_transcript_turn').where({ call_id: c.id }).del();
        patch.transcript_deleted_at = at;
      }
      await knex('voice_call').where({ id: c.id }).update({ ...patch, updated_at: at });
    }
  }
  if (files || turns) log(`retention: ${files} recordings and ${turns} transcript turns deleted`);
  return { files, turns };
}

module.exports = { onMetaCalls, onGatewayEvent, saveRecording, purgeExpired, recordingPath, enabled, OUTCOMES, _pending: pending };
