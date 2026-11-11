// WhatsApp broadcasts: one message to many people, sent in the background.
//
//   resolveAudience()  who gets it (all contacts, a tag, or a list), minus people
//                      who replied STOP, numbers that can't be WhatsApp, duplicates
//   start()            records the broadcast and sends one by one, with progress
//   get()              progress / result for the screen
//   recoverInterrupted() a broadcast cut off by the app closing is marked stopped
//
// Official API: only an approved template may start a conversation, so each
// fill-in comes from the contact ("name") or a fixed text the user typed.
// WhatsApp Web (Evolution): free text with {{name}}.

const leadPipelineRepoFactory = require('../../repos/leadPipelineRepo');
const whatsappCloud = require('./whatsappCloud');
const evolutionApi = require('./evolutionApi');
const chatbot = require('./chatbot');

const now = () => Math.floor(Date.now() / 1000);

// Sending to customers needs an active licence (desktop) or plan (server edition), like posting does
function licensed(workspaceId) {
  return require('../entitlements').canPublish(workspaceId);
}
const LICENSE_ERROR = 'Broadcasts need an active licence. Go to Settings → Licence to activate.';
const MAX_RECIPIENTS = 5000;
const DELAY = { cloud_api: 250, evolution: 2500 }; // WhatsApp Web needs a slower, human pace
const running = new Map(); // broadcast id -> { cancel: bool }

// Digits only, with India's 91 added to a bare 10-digit mobile number
function normalizePhone(p) {
  let d = String(p || '').replace(/[^0-9]/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

const parseTags = (v) => { try { const t = JSON.parse(v || '[]'); return Array.isArray(t) ? t.map(String) : []; } catch { return []; } };

async function resolveAudience(db, workspaceId, audience = {}) {
  const type = audience.type || 'all';
  let people = [];
  if (type === 'list') {
    people = (Array.isArray(audience.contacts) ? audience.contacts : []).slice(0, MAX_RECIPIENTS * 2)
      .map((c) => ({ name: String(c.name || '').trim().slice(0, 80), phone: c.phone, lead_id: null }));
  } else {
    const rows = await db('meta_lead_events').where({ workspace_id: workspaceId }).whereNotNull('phone_number')
      .select('id', 'full_name', 'phone_number', 'tags_json');
    people = rows
      .filter((r) => type !== 'tag' || parseTags(r.tags_json).includes(String(audience.tag || '')))
      .map((r) => ({ name: r.full_name || '', phone: r.phone_number, lead_id: r.id }));
  }

  const optedOut = await chatbot.optedOutLeadIds(db, workspaceId);
  // Contacts by phone number, built once (looking each row up separately was
  // slow for big spreadsheets). Same match rule as the repo: full number, or the
  // last 10 digits.
  const byPhone = new Map();
  if (type === 'list') {
    const rows = await db('meta_lead_events').where({ workspace_id: workspaceId }).whereNotNull('phone_number').select('id', 'phone_number');
    for (const r of rows) {
      const d = String(r.phone_number).replace(/[^0-9]/g, '');
      if (!d) continue;
      if (!byPhone.has(d)) byPhone.set(d, r.id);
      if (d.length >= 10 && !byPhone.has(`#${d.slice(-10)}`)) byPhone.set(`#${d.slice(-10)}`, r.id);
    }
  }
  const seen = new Set();
  const recipients = [];
  const skipped = { opted_out: 0, invalid: 0, duplicate: 0 };
  for (const p of people) {
    const phone = normalizePhone(p.phone);
    if (!phone) { skipped.invalid++; continue; }
    if (seen.has(phone)) { skipped.duplicate++; continue; }
    seen.add(phone);
    let leadId = p.lead_id;
    if (!leadId) leadId = byPhone.get(phone) || byPhone.get(`#${phone.slice(-10)}`) || null;
    if (leadId && optedOut.has(Number(leadId))) { skipped.opted_out++; continue; }
    recipients.push({ name: p.name, phone, lead_id: leadId });
  }
  const tooMany = recipients.length > MAX_RECIPIENTS;
  return { recipients: recipients.slice(0, MAX_RECIPIENTS), skipped, too_many: tooMany };
}

// Fill-ins for one person: "name" → their first name (or "there"), "text" → the fixed value
function paramsFor(params, person) {
  return (params || []).map((p) => (p?.source === 'name'
    ? (String(person.name || '').split(/\s+/)[0] || String(p.fallback || 'there'))
    : String(p?.value ?? '')));
}
function fillText(text, person) {
  return String(text || '').replace(/\{\{\s*name\s*\}\}/gi, String(person.name || '').split(/\s+/)[0] || 'there');
}

async function sendOne(config, engine, msg, person) {
  if (engine === 'evolution') {
    return evolutionApi.sendTextMessage({
      apiUrl: config.evolution_api_url, apiKey: config.evolution_api_key,
      instanceName: config.evolution_instance_name || 'social-nexus', number: person.phone, text: fillText(msg.text, person),
    });
  }
  return whatsappCloud.sendWhatsAppMessage({
    phoneNumberId: config.whatsapp_phone_number_id, wabaId: config.whatsapp_business_account_id,
    accessToken: config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN,
    to: person.phone, templateName: msg.template.name, languageCode: msg.template.language,
    templateParams: paramsFor(msg.template.params, person),
  });
}

// What a sent message looked like, for the chat history
function previewText(msg, person) {
  if (msg.text) return fillText(msg.text, person);
  const vals = paramsFor(msg.template.params, person);
  const body = String(msg.template.body || '').replace(/\{\{(\d+)\}\}/g, (m, n) => vals[Number(n) - 1] ?? m);
  return body || `Template: ${msg.template.name}`;
}

function validateMessage(engine, msg) {
  if (engine === 'evolution') {
    if (!String(msg.text || '').trim()) return 'Write the message.';
    return null;
  }
  if (!msg.template?.name) return 'Choose an approved template. WhatsApp only allows templates for messages you start.';
  const n = Number(msg.template.var_count || 0);
  const params = msg.template.params || [];
  for (let i = 0; i < n; i++) {
    const p = params[i];
    if (!p || (p.source !== 'name' && !String(p.value || '').trim())) return `Fill in {{${i + 1}}} for the template.`;
  }
  return null;
}

async function start(db, { workspaceId, userId, title, audience, message }) {
  if (!(await licensed(workspaceId))) throw Object.assign(new Error(LICENSE_ERROR), { status: 402, code: 'LICENSE_REQUIRED' });
  const repo = leadPipelineRepoFactory(db);
  const config = await repo.getOrCreateConfig(workspaceId);
  const engine = config.delivery_engine === 'evolution' ? 'evolution' : 'cloud_api';
  if (engine === 'cloud_api' && (!(config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN) || !config.whatsapp_phone_number_id)) {
    throw Object.assign(new Error('Connect WhatsApp first (WhatsApp → Setup).'), { status: 400 });
  }
  if (engine === 'evolution' && !config.evolution_api_url) {
    throw Object.assign(new Error('Connect WhatsApp Web first (WhatsApp → Setup).'), { status: 400 });
  }
  const problem = validateMessage(engine, message || {});
  if (problem) throw Object.assign(new Error(problem), { status: 400 });

  const { recipients, skipped } = await resolveAudience(db, workspaceId, audience);
  if (!recipients.length) throw Object.assign(new Error('Nobody to send to: no contacts with a WhatsApp number (people who replied STOP are left out).'), { status: 400 });

  const t = now();
  const skippedTotal = skipped.opted_out + skipped.invalid + skipped.duplicate;
  const [row] = await db('whatsapp_broadcasts').insert({
    workspace_id: workspaceId,
    title: String(title || '').trim().slice(0, 200) || `Broadcast ${new Date().toLocaleDateString('en-IN')}`,
    delivery_engine: engine,
    template_name: engine === 'cloud_api' ? message.template.name : null,
    template_language: engine === 'cloud_api' ? message.template.language : null,
    message_content: engine === 'cloud_api' ? (message.template.body || '') : String(message.text || ''),
    total_recipients: recipients.length,
    sent_count: 0, failed_count: 0, skipped_count: skippedTotal,
    credits_cost: 0, status: 'sending', created_by: userId || null, created_at: t, updated_at: t,
    results_json: JSON.stringify({ skipped, failures: [] }),
  }).returning('id');
  const id = row?.id ?? row;

  const job = { cancel: false };
  running.set(id, job);
  setImmediate(() => run(db, { id, workspaceId, config, engine, message, recipients, skipped, job })
    .catch((err) => console.error('[Broadcast] Stopped:', err.message)));
  return get(db, workspaceId, id);
}

async function run(db, { id, workspaceId, config, engine, message, recipients, skipped, job }) {
  const repo = leadPipelineRepoFactory(db);
  let sent = 0, failed = 0;
  const failures = [];
  const save = (extra = {}) => db('whatsapp_broadcasts').where({ id }).update({
    sent_count: sent, failed_count: failed, updated_at: now(),
    results_json: JSON.stringify({ skipped, failures: failures.slice(0, 50) }), ...extra,
  });

  let stoppedReason = null;
  for (let i = 0; i < recipients.length; i++) {
    if (job.cancel) break;
    if (!(await licensed(workspaceId))) { stoppedReason = 'The licence or plan stopped being active, so sending stopped.'; break; }
    const person = recipients[i];
    let res;
    try { res = await sendOne(config, engine, message, person); } catch (err) { res = { success: false, error: err.message }; }
    if (res?.success) {
      sent++;
      // In the person's chat, so a reply makes sense to whoever answers
      try {
        let leadId = person.lead_id;
        if (!leadId) {
          const lead = await repo.addLeadEvent(workspaceId, {
            full_name: person.name || 'WhatsApp contact', phone_number: '+' + person.phone,
            form_id: 'whatsapp_broadcast', status: 'contacted', lead_score: 50, intent_summary: 'Got a broadcast',
          });
          leadId = lead.id;
        }
        await repo.addLeadMessage(workspaceId, leadId, { sender_type: 'broadcast', sender_name: 'Broadcast', message_text: previewText(message, person), channel: 'whatsapp' });
      } catch { /* sending matters more than the copy in Chats */ }
    } else {
      failed++;
      failures.push({ name: person.name, phone: person.phone, error: String(res?.error || 'Not sent').slice(0, 200) });
    }
    if (i % 10 === 9) await save();
    if (i < recipients.length - 1) await new Promise((r) => setTimeout(r, DELAY[engine]));
  }
  running.delete(id);
  if (stoppedReason) failures.unshift({ name: '', phone: '', error: stoppedReason });
  await save({ status: job.cancel || stoppedReason ? 'stopped' : sent ? 'completed' : 'failed', finished_at: now() });
}

async function get(db, workspaceId, id) {
  const b = await db('whatsapp_broadcasts').where({ workspace_id: workspaceId, id }).first();
  if (!b) return null;
  let results = {};
  try { results = JSON.parse(b.results_json || '{}'); } catch {}
  return { ...b, results, running: running.has(Number(id)) };
}

function cancel(id) {
  const job = running.get(Number(id));
  if (job) job.cancel = true;
  return !!job;
}

// The app was closed during a broadcast: say so instead of showing "sending" forever
async function recoverInterrupted(db) {
  if (!(await db.schema.hasTable('whatsapp_broadcasts'))) return;
  if (!(await db.schema.hasColumn('whatsapp_broadcasts', 'finished_at'))) return;
  await db('whatsapp_broadcasts').where({ status: 'sending' }).update({ status: 'stopped', finished_at: now() });
}

module.exports = { licensed, LICENSE_ERROR, resolveAudience, start, get, cancel, recoverInterrupted, normalizePhone, paramsFor, validateMessage, MAX_RECIPIENTS, DELAY };
