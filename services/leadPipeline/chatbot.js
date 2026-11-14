// WhatsApp auto-replies: answers customers who write to your WhatsApp number,
// day and night, with replies you write yourself. In order:
//
//   1. STOP / START       opt out of (or back into) broadcasts — always handled
//   2. Paused chat        after you reply yourself, the bot stays quiet there
//   3. Menu choice        "1", "2"… or the option's name
//   4. Keyword reply      e.g. "price, cost, rate" → your prices
//   5. Greeting / first   "hi", "menu", or someone's first message → welcome + menu
//   6. Closed now         away message (once every 12 hours)
//   7. Anything else      a short holding message, an AI answer, or your n8n workflow's answer
//
// decide() is pure (no database, no sending), so "Try it", tests and the live
// webhook all use exactly the same rules.

const now = () => Math.floor(Date.now() / 1000);

const LIMITS = {
  text: 1000,          // characters per reply (WhatsApp allows 4096; short replies read better)
  keywordRules: 50,
  keywordsPerRule: 20,
  menuOptions: 9,      // one digit per option
  repliesPerHour: 6,   // the bot never sends more than this to one chat in an hour
  knowledge: 20000,    // characters of free-text business knowledge for AI answers
};
const AWAY_EVERY = 12 * 3600;
const FALLBACK_EVERY = 3600;
const WELCOME_AGAIN_AFTER = 24 * 3600;

const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'stop messages', 'stop all'];
const OPT_IN_WORDS = ['start', 'subscribe'];
const GREETING_WORDS = ['hi', 'hii', 'hello', 'hey', 'hlo', 'helo', 'namaste', 'menu', 'start over', 'good morning', 'good evening'];

// Starting point for a new workspace: the structure is ready, but replies that
// need the owner's own facts (prices, hours) are left empty, and empty replies
// are never sent, so nothing made-up goes to a customer.
const DEFAULT_CONFIG = {
  welcome: { enabled: true, text: 'Hi {{name}}! Thanks for messaging {{business}}. How can we help you today?' },
  menu: {
    enabled: true,
    options: [
      { label: 'Prices', reply: '' },
      { label: 'Opening hours & address', reply: '' },
      { label: 'Talk to a person', reply: 'Sure! Someone from our team will reply here soon.', handover: true },
      { label: 'Request a callback', reply: 'We have registered your callback request! An agent has been alerted and will call you on your mobile number shortly.', handover: true },
    ],
  },
  keywords: [
    { keywords: ['price', 'prices', 'cost', 'rate', 'charges', 'fees'], reply: '' },
    { keywords: ['address', 'location', 'where are you', 'directions'], reply: '' },
    { keywords: ['agent', 'human', 'real person', 'talk to someone'], reply: 'Sure! Someone from our team will reply here soon.', handover: true },
    { keywords: ['callback', 'call me', 'call back', 'voice call', 'phone call', 'speak on call'], reply: 'We have registered your callback request! An agent has been alerted and will call you on your mobile number shortly.', handover: true },
  ],
  away: {
    enabled: false,
    days: [1, 2, 3, 4, 5, 6], // 0 = Sunday
    start: '09:00',
    end: '18:00',
    text: 'Thanks for your message! We are closed right now. We will reply when we open ({{opens}}).',
  },
  fallback: { mode: 'message', text: 'Thanks for your message! Someone from our team will reply here soon.' },
  // Free-text business knowledge the AI answer may use (products, hours, policies,
  // delivery, FAQs). Empty by default; the AI only states what's written here.
  knowledge: '',
  handover: { pause_hours: 12 },
  timezone: 'Asia/Kolkata',
};

// ── Cleaning what the user saves ─────────────────────────────────────────────

const str = (v, max = LIMITS.text) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));

function normalizeConfig(input = {}) {
  const c = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_CONFIG;
  const menuOpts = Array.isArray(c.menu?.options) ? c.menu.options : d.menu.options;
  const rules = Array.isArray(c.keywords) ? c.keywords : d.keywords;
  const days = Array.isArray(c.away?.days) ? c.away.days.map(Number).filter(n => n >= 0 && n <= 6) : d.away.days;
  return {
    welcome: { enabled: !!(c.welcome?.enabled ?? d.welcome.enabled), text: str(c.welcome?.text ?? d.welcome.text) },
    menu: {
      enabled: !!(c.menu?.enabled ?? d.menu.enabled),
      options: menuOpts.slice(0, LIMITS.menuOptions)
        .map(o => ({ label: str(o?.label, 60), reply: str(o?.reply), handover: !!o?.handover }))
        .filter(o => o.label),
    },
    keywords: rules.slice(0, LIMITS.keywordRules).map(r => ({
      keywords: (Array.isArray(r?.keywords) ? r.keywords : String(r?.keywords || '').split(','))
        .map(k => normalizeText(k)).filter(Boolean).slice(0, LIMITS.keywordsPerRule),
      reply: str(r?.reply),
      handover: !!r?.handover,
    })).filter(r => r.keywords.length),
    away: {
      enabled: !!(c.away?.enabled ?? d.away.enabled),
      days: [...new Set(days)].sort(),
      start: isTime(c.away?.start) ? c.away.start : d.away.start,
      end: isTime(c.away?.end) ? c.away.end : d.away.end,
      text: str(c.away?.text ?? d.away.text),
    },
    fallback: {
      mode: ['none', 'message', 'ai', 'n8n'].includes(c.fallback?.mode) ? c.fallback.mode : d.fallback.mode,
      text: str(c.fallback?.text ?? d.fallback.text),
    },
    knowledge: str(c.knowledge ?? d.knowledge, LIMITS.knowledge),
    handover: { pause_hours: Math.min(72, Math.max(1, Number(c.handover?.pause_hours) || d.handover.pause_hours)) },
    timezone: typeof c.timezone === 'string' && c.timezone.length < 64 ? c.timezone : d.timezone,
  };
}

// ── Matching ─────────────────────────────────────────────────────────────────

// Lower case, no punctuation or emoji, single spaces ("Price??" → "price")
function normalizeText(t) {
  return String(t || '').toLowerCase().normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Whole words only: "rate" matches "what is the rate" but not "grateful"
function containsPhrase(text, phrase) {
  if (!phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

function fill(template, vars) {
  return String(template || '')
    .replace(/\{\{\s*name\s*\}\}/gi, vars.name || 'there')
    .replace(/\{\{\s*business\s*\}\}/gi, vars.business || 'us')
    .replace(/\{\{\s*opens\s*\}\}/gi, vars.opens || 'soon')
    .trim();
}

function menuText(cfg) {
  const opts = usableMenu(cfg);
  if (!cfg.menu.enabled || !opts.length) return '';
  return `Reply with a number:\n${opts.map((o, i) => `${i + 1}. ${o.label}`).join('\n')}`;
}
// Options without a reply (and not "talk to a person") aren't offered
function usableMenu(cfg) {
  return cfg.menu.options.filter(o => o.reply || o.handover);
}

// Business hours in the business's own time zone
function localClock(at, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(at * 1000));
  const get = (t) => parts.find(p => p.type === t)?.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return { day, minutes };
}
const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

function isOpen(cfg, at) {
  if (!cfg.away.enabled) return true;
  const { day, minutes } = localClock(at, cfg.timezone);
  const start = toMinutes(cfg.away.start), end = toMinutes(cfg.away.end);
  if (!cfg.away.days.includes(day)) return false;
  return start <= end ? (minutes >= start && minutes < end) : (minutes >= start || minutes < end); // overnight hours
}

// "Mon 09:00" — when the business opens next, for the away message
function nextOpening(cfg, at) {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const { day, minutes } = localClock(at, cfg.timezone);
  const start = toMinutes(cfg.away.start);
  for (let i = 0; i < 8; i++) {
    const d = (day + i) % 7;
    if (!cfg.away.days.includes(d)) continue;
    if (i === 0 && minutes >= start) continue;
    return `${i === 0 ? 'today' : i === 1 ? 'tomorrow' : names[d]} at ${cfg.away.start}`;
  }
  return 'soon';
}

/**
 * What the bot does with one incoming message.
 * @param cfg    normalized config
 * @param msg    { text, name, business }
 * @param state  { welcomed_at, away_sent_at, fallback_sent_at, paused_until, opted_out } (may be empty)
 * @returns { replies: string[], action: 'opt_out'|'opt_in'|'handover'|null, ai: bool, n8n: bool, reason }
 */
function decide(cfg, msg, state = {}, at = now()) {
  const text = normalizeText(msg.text);
  const vars = { name: (msg.name || '').split(' ')[0], business: msg.business };
  const out = (replies, extra) => ({ replies: replies.map(r => fill(r, vars)).filter(Boolean), action: null, ai: false, ...extra });

  if (!text) return out([], { reason: 'empty' });

  // 1. Opt out / back in (also while paused: it's the customer's right)
  if (OPT_OUT_WORDS.includes(text)) {
    return out(['You won’t get any more broadcast messages from us. Reply START if you change your mind.'], { action: 'opt_out', reason: 'opt_out' });
  }
  if (OPT_IN_WORDS.includes(text) && state.opted_out) {
    return out(['Welcome back! You’ll get our updates again. Reply STOP any time to stop them.'], { action: 'opt_in', reason: 'opt_in' });
  }

  // 2. A person is answering this chat
  if (state.paused_until && state.paused_until > at) return out([], { reason: 'paused' });

  const open = isOpen(cfg, at);
  const awayDue = !open && cfg.away.text && !(state.away_sent_at && at - state.away_sent_at < AWAY_EVERY);
  const withAway = (replies, extra) => {
    const r = awayDue ? [...replies, fill(cfg.away.text, { ...vars, opens: nextOpening(cfg, at) })] : replies;
    return out(r, { ...extra, away: !!awayDue });
  };

  // 3. Menu choice: "2" or the option's name
  const menu = cfg.menu.enabled ? usableMenu(cfg) : [];
  const n = /^\d$/.test(text) ? Number(text) : NaN;
  const choice = (n >= 1 && n <= menu.length) ? menu[n - 1] : menu.find(o => normalizeText(o.label) === text);
  if (choice) {
    return choice.handover
      ? withAway([choice.reply], { action: 'handover', reason: 'menu_handover' })
      : out([choice.reply], { reason: 'menu' });
  }

  // 4. Keyword replies (first rule that matches)
  const rule = cfg.keywords.find(r => (r.reply || r.handover) && r.keywords.some(k => containsPhrase(text, k)));
  if (rule) {
    return rule.handover
      ? withAway([rule.reply], { action: 'handover', reason: 'keyword_handover' })
      : withAway([rule.reply], { reason: 'keyword' });
  }

  // 5. Greeting, or someone's first message in a day: welcome + menu
  const firstTime = !state.welcomed_at || at - state.welcomed_at > WELCOME_AGAIN_AFTER;
  if (cfg.welcome.enabled && (GREETING_WORDS.includes(text) || firstTime)) {
    const m = menuText(cfg);
    return withAway([[cfg.welcome.text, m].filter(Boolean).join('\n\n')], { reason: 'welcome', welcomed: true });
  }

  // 6. Closed: the away message is enough
  if (awayDue) return withAway([], { reason: 'away' });

  // 7. Anything else
  if (cfg.fallback.mode === 'ai') return out([], { ai: true, reason: 'ai' });
  if (cfg.fallback.mode === 'n8n') return out([], { n8n: true, reason: 'n8n' });
  if (cfg.fallback.mode === 'message' && cfg.fallback.text && !(state.fallback_sent_at && at - state.fallback_sent_at < FALLBACK_EVERY)) {
    return out([cfg.fallback.text], { reason: 'fallback', fallback: true });
  }
  return out([], { reason: 'no_match' });
}

// ── Storage ──────────────────────────────────────────────────────────────────

async function getSettings(db, workspaceId) {
  const row = await db('whatsapp_bot_settings').where({ workspace_id: workspaceId }).first();
  let cfg = {};
  try { cfg = row?.config_json ? JSON.parse(row.config_json) : {}; } catch { cfg = {}; }
  return { enabled: !!row?.enabled, config: normalizeConfig(row ? cfg : DEFAULT_CONFIG), updated_by: row?.updated_by || null, saved: !!row };
}

async function saveSettings(db, workspaceId, userId, { enabled, config }) {
  const cfg = normalizeConfig(config);
  const row = { enabled: !!enabled, config_json: JSON.stringify(cfg), updated_by: userId || null, updated_at: now() };
  const existing = await db('whatsapp_bot_settings').where({ workspace_id: workspaceId }).first('id');
  if (existing) await db('whatsapp_bot_settings').where({ id: existing.id }).update(row);
  else await db('whatsapp_bot_settings').insert({ workspace_id: workspaceId, ...row });
  return getSettings(db, workspaceId);
}

async function getState(db, workspaceId, leadId) {
  return (await db('whatsapp_bot_state').where({ workspace_id: workspaceId, lead_id: leadId }).first()) || null;
}
async function setState(db, workspaceId, leadId, patch) {
  const existing = await getState(db, workspaceId, leadId);
  const row = { ...patch, updated_at: now() };
  if (existing) await db('whatsapp_bot_state').where({ id: existing.id }).update(row);
  else {
    await db('whatsapp_bot_state').insert({ workspace_id: workspaceId, lead_id: leadId, window_count: 0, opted_out: false, ...row })
      .onConflict(['workspace_id', 'lead_id']).merge(row);
  }
}

// A person replied in this chat: keep the bot quiet there for a while
async function pauseForHuman(db, workspaceId, leadId) {
  if (!(await db.schema.hasTable('whatsapp_bot_state'))) return;
  const { config } = await getSettings(db, workspaceId);
  await setState(db, workspaceId, leadId, { paused_until: now() + config.handover.pause_hours * 3600 });
}
async function resume(db, workspaceId, leadId) {
  await setState(db, workspaceId, leadId, { paused_until: null });
}

// Phone numbers (digits only) that replied STOP: broadcasts skip them
async function optedOutLeadIds(db, workspaceId) {
  if (!(await db.schema.hasTable('whatsapp_bot_state'))) return new Set();
  const rows = await db('whatsapp_bot_state').where({ workspace_id: workspaceId, opted_out: true }).pluck('lead_id');
  return new Set(rows.map(Number));
}

async function businessName(db, workspaceId) {
  const brand = await require('../brand').profile(workspaceId, db);
  if (brand.company_name) return brand.company_name;
  const ws = await db('workspaces').where({ id: workspaceId }).first('name').catch(() => null);
  return ws?.name || '';
}

// AI answer for "anything else", with the owner's replies as the only facts.
// Uses the keys of the person who turned AI answers on, or the workspace manager.
async function aiAnswer(db, workspaceId, userId, cfg, msg) {
  const { injectUserKeys } = require('../../middleware/auth');
  const { aiGenerate, aiArgsFromReq } = require('../aiHelper');
  const { brandContext } = require('../brandContext');
  const req = { session: { userId }, body: {} };
  await new Promise((resolve, reject) => injectUserKeys(req, null, (err) => (err ? reject(err) : resolve())));
  const { apiKey, options } = aiArgsFromReq(req);

  // Check if there is an active knowledge base with compiled knowledge & persona
  let kb = (cfg.knowledge || '').trim();
  let persona = null;
  try {
    if (await db.schema.hasTable('ai_knowledge_bases')) {
      const kbRow = await db('ai_knowledge_bases').where({ workspace_id: workspaceId }).first();
      if (kbRow) {
        if (kbRow.compiled_knowledge && kbRow.compiled_knowledge.trim()) {
          kb = kbRow.compiled_knowledge.trim();
        }
        if (kbRow.persona_json) {
          try { persona = JSON.parse(kbRow.persona_json); } catch {}
        }
      }
    }
  } catch {}

  const facts = [
    ...cfg.menu.options.filter(o => o.reply).map(o => `${o.label}: ${o.reply}`),
    ...cfg.keywords.filter(r => r.reply && !r.handover).map(r => `${r.keywords.join('/')}: ${r.reply}`),
  ].join('\n');

  const toneRule = persona?.tone === 'professional' ? 'Tone: Professional, crisp, and polite.'
    : persona?.tone === 'casual' ? 'Tone: Friendly, conversational, and casual.'
    : persona?.tone === 'concise' ? 'Tone: Minimal, direct, and concise.'
    : 'Tone: Friendly, warm, and helpful.';

  const lengthRule = persona?.response_length === 'concise' ? 'Answer in 1 or 2 short sentences.'
    : persona?.response_length === 'detailed' ? 'Answer in 2 to 4 helpful sentences.'
    : 'Answer in 1 to 3 short sentences.';

  const strictRule = persona?.strictness === 'strict'
    ? 'Use ONLY the facts and business knowledge below. If the answer is not in the knowledge base, say our team will reply soon. Never invent prices, dates, or promises.'
    : 'Use the facts and business knowledge below as your primary source of truth. If unsure, invite the customer to connect with our team. Never invent prices or promises.';

  const customRule = persona?.custom_instructions ? `\nINSTRUCTIONS: ${persona.custom_instructions}\n` : '';

  const prompt = `${await brandContext(workspaceId, db)}
You reply to a customer on WhatsApp for ${msg.business || 'this business'}.
${toneRule}
${lengthRule}
In the customer's language.
${strictRule}${customRule}

FACTS & MENU REPLIES:
${facts || '(none)'}
${kb ? `\nBUSINESS KNOWLEDGE BASE:\n${kb}\n` : ''}
Customer${msg.name ? ` (${msg.name})` : ''}: """${String(msg.text).slice(0, 1000)}"""
Reply:`;
  const r = await aiGenerate(prompt, apiKey, 250, null, options);
  return String(r.text || '').trim().replace(/^["“]|["”]$/g, '').slice(0, LIMITS.text);
}

/**
 * Runs the bot for one incoming WhatsApp message (called by the webhooks after
 * the message is saved). send(text) delivers a reply; returns what was sent.
 */
async function handleInbound(db, { workspaceId, lead, text, name, send, askN8n }) {
  if (!(await db.schema.hasTable('whatsapp_bot_settings'))) return { sent: [] };
  const settings = await getSettings(db, workspaceId);
  const state = (await getState(db, workspaceId, lead.id)) || {};
  const at = now();

  const business = await businessName(db, workspaceId);
  const d = decide(settings.config, { text, name, business }, state, at);

  // STOP/START are honoured even when the bot is off or the licence isn't
  // active: they're the customer's consent, not a feature
  const patch = {};
  if (d.action === 'opt_out') patch.opted_out = true;
  if (d.action === 'opt_in') patch.opted_out = false;
  const consent = !!d.action?.startsWith('opt');
  if (!settings.enabled && !consent) {
    if (Object.keys(patch).length) await setState(db, workspaceId, lead.id, patch);
    return { sent: [], reason: 'off', action: d.action || null };
  }
  // Auto-replies (and n8n answers) need an active licence, like posting does;
  // the customer's message is still saved in Chats
  let licensed = false;
  try { licensed = await require('../entitlements').canPublish(workspaceId); } catch {}
  if (!licensed && !consent) return { sent: [], reason: 'unlicensed', action: d.action || null };

  let replies = d.replies;
  let n8nAsked = false;
  if (d.n8n) {
    // Your n8n workflow answers: it gets the message and may respond {"reply": "…"}
    if (askN8n) {
      n8nAsked = true;
      try {
        const r = await askN8n();
        replies = r ? [String(r).trim().slice(0, LIMITS.text)].filter(Boolean) : [];
      } catch (err) {
        console.warn('[WhatsApp bot] n8n answer failed:', err.message);
        replies = settings.config.fallback.text ? [settings.config.fallback.text] : [];
      }
    } else if (settings.config.fallback.text) {
      replies = [settings.config.fallback.text]; // no n8n address saved yet
    }
  }
  if (d.ai) {
    const aiUserId = settings.updated_by
      || (await db('memberships').where({ workspace_id: workspaceId, role: 'manager' }).first('user_id').then(r => r?.user_id).catch(() => null))
      || (await db('users').first('id').then(r => r?.id).catch(() => null));
    if (aiUserId) {
      try {
        const a = await aiAnswer(db, workspaceId, aiUserId, settings.config, { text, name, business });
        if (a) replies = [a];
      } catch (err) {
        console.warn('[WhatsApp bot] AI answer failed:', err.message);
        if (settings.config.fallback.text) replies = [settings.config.fallback.text];
      }
    }
  }

  // Never more than a few bot messages per chat per hour
  const windowFresh = state.window_start && at - state.window_start < 3600;
  let count = windowFresh ? state.window_count || 0 : 0;
  const sent = [];
  for (const r of replies) {
    if (count >= LIMITS.repliesPerHour) break;
    const res = await send(r).catch(err => ({ success: false, error: err.message }));
    if (res?.success === false) { console.warn('[WhatsApp bot] Reply not sent:', res.error); break; }
    count++;
    sent.push(r);
    await db('lead_conversation_messages').insert({
      workspace_id: workspaceId, lead_id: lead.id, sender_type: 'bot', sender_name: n8nAsked ? 'n8n' : 'Auto-reply',
      message_text: r, channel: 'whatsapp', created_at: now(),
    });
  }

  if (sent.length) {
    Object.assign(patch, { window_start: windowFresh ? state.window_start : at, window_count: count });
    // Any answer counts as the greeting: don't send the welcome on their next message
    if (d.welcomed || !state.welcomed_at) patch.welcomed_at = at;
    if (d.away) patch.away_sent_at = at;
    if (d.fallback) patch.fallback_sent_at = at;
  } else if (!state.welcomed_at && d.reason !== 'paused') {
    patch.welcomed_at = at; // don't greet later as if it were the first message
  }
  if (d.action === 'handover') {
    patch.paused_until = at + settings.config.handover.pause_hours * 3600;
    try {
      const repo = require('../../repos/leadPipelineRepo')(db);
      const isCall = containsPhrase(normalizeText(text), 'call') || containsPhrase(normalizeText(text), 'phone') || d.reason === 'menu_handover';
      const taskBody = isCall
        ? `🚨 Callback Requested by ${lead.full_name || 'Customer'}: "${String(text).slice(0, 100)}"`
        : `💬 Agent Handover Requested by ${lead.full_name || 'Customer'}: "${String(text).slice(0, 100)}"`;

      await repo.addActivity(workspaceId, lead.id, {
        kind: 'task',
        body: taskBody,
        due_at: at + 15 * 60,
      }).catch(() => {});

      if (isCall) {
        const tags = Array.isArray(lead.tags_json) ? lead.tags_json : [];
        if (!tags.includes('📞 Call Inbound')) tags.push('📞 Call Inbound');
        await repo.updateLeadEvent(workspaceId, lead.id, {
          lead_score: Math.max(Number(lead.lead_score || 0), 95),
          tags_json: tags,
        }).catch(() => {});
      }
    } catch (_) {}
  }
  if (Object.keys(patch).length) await setState(db, workspaceId, lead.id, patch);
  return { sent, reason: d.reason, action: d.action, n8nAsked };
}

module.exports = {
  DEFAULT_CONFIG, LIMITS,
  normalizeConfig, normalizeText, decide, isOpen, nextOpening,
  getSettings, saveSettings, getState, pauseForHuman, resume, optedOutLeadIds, handleInbound,
};
