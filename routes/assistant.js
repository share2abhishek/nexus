// Help chat: one for visitors on the landing page (no sign-in) and one inside the app.
// Both answer from services/helpKnowledge.js; the visitor one is rate limited and uses
// Radixile's AI keys, the in-app one uses the person's own AI (with Radixile's as backup).
const express = require('express');
const { rateLimit, byIp, byUserOrIp } = require('../middleware/rateLimit');
const assistant = require('../services/helpAssistant');
const knowledge = require('../services/helpKnowledge');
const safety = require('../services/aiSafety');

const clean = (v, max) => safety.neutralize(String(v == null ? '' : v), max).trim();
const now = () => Math.floor(Date.now() / 1000);

// Short chat history from the browser: only the last few lines, plain text
function readHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-6).filter((t) => t && (t.role === 'user' || t.role === 'bot') && typeof t.text === 'string')
    .map((t) => ({ role: t.role, text: clean(t.text, 400) }));
}

// Visitors share one daily AI budget so a public chat can't run up a bill
let budgetDay = 0, budgetUsed = 0;
function publicBudgetLeft() {
  const d = Math.floor(Date.now() / 86400000);
  if (d !== budgetDay) { budgetDay = d; budgetUsed = 0; }
  return budgetUsed < (Number(process.env.HELP_PUBLIC_DAILY_LIMIT) || 400);
}

const validContact = (c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) || (c.replace(/\D/g, '').length >= 7 && /^[+\d][\d\s().-]{6,}$/.test(c));

async function saveEnquiry(knex, row) {
  const [id] = await knex('help_enquiries').insert({ ...row, status: 'new', created_at: now() }).returning('id');
  const newId = id?.id ?? id;
  // Tell the team by email when the operator has set a mailbox for it
  const to = process.env.SUPPORT_NOTIFY_EMAIL;
  if (to) {
    require('../services/accounts').sendMail(to, `New NexaDrip enquiry (${row.source})`,
      `From: ${row.name || '(no name)'}\nContact: ${row.contact || '(none)'}\nWhere: ${row.source}${row.page ? ` / ${row.page}` : ''}\n\n${row.message}\n\n— Chat —\n${row.transcript || ''}`).catch(() => {});
  }
  return newId;
}

const transcriptOf = (history) => history.map((t) => `${t.role === 'user' ? 'Visitor' : 'Bot'}: ${t.text}`).join('\n').slice(0, 3000);

// Website switches (services/siteSwitches.js): with sign-up closed or pricing hidden, the
// visitor chat neither offers nor answers those (the AI only sees the answers left)
const switches = require('../services/siteSwitches');
const PRICING = /₹|\bprices?\b|\bpricing\b|\bper month\b|\ba month\b/i;
const SIGNUP = /free trial|sign ?up|create (an |your )?account/i;
function visible(entry, on) {
  const id = entry.builtin || entry.id;
  const text = `${entry.q} ${entry.a}`;
  if (!on.pricing && (id === 'price' || PRICING.test(text))) return false;
  if (!on.signup && (id === 'trial' || SIGNUP.test(text))) return false;
  return true;
}
async function publicEntries(knex) {
  const on = await switches.get();
  return (await knowledge.load(knex)).filter((e) => visible(e, on))
    .map((e) => (!on.signup && /register|signup/i.test(e.go || '') ? { ...e, go: undefined } : e));
}
async function publicSuggestions(knex) {
  const on = await switches.get();
  const hidden = (q) => (!on.pricing && PRICING.test(q)) || (!on.signup && SIGNUP.test(q)) || /cost/i.test(q) && !on.pricing;
  const list = knowledge.SUGGESTIONS.public.filter((q) => !hidden(q));
  for (const extra of ['What is NexaDrip?', 'Can agencies manage many clients?', 'What is sales outreach?']) {
    if (list.length >= 4) break;
    if (!list.includes(extra)) list.push(extra);
  }
  return list;
}

module.exports = (knex, requirePermission) => {
  // ── Public (landing page) ────────────────────────────────────────────────
  const pub = express.Router();
  pub.use(express.json({ limit: '20kb' }));

  pub.get('/suggestions', async (req, res) => res.json({ suggestions: await publicSuggestions(knex) }));

  pub.post('/chat', rateLimit({ windowMs: 10 * 60 * 1000, max: 30, key: byIp, name: 'help-public', message: 'You’ve asked a lot of questions. Please wait a few minutes, or leave your details and we’ll reply.' }), async (req, res) => {
    try {
      let ai = null;
      if (publicBudgetLeft()) {
        const keys = await require('../services/platformAi').keys();
        if (Object.keys(keys).length) {
          const { aiGenerate } = require('../services/aiHelper');
          ai = { generate: async (prompt) => { budgetUsed++; return (await aiGenerate(prompt, keys.googleKey, 350, null, { ...keys, ollamaEnabled: false })).text; } };
        }
      }
      res.json(await assistant.answer({ audience: 'public', message: req.body?.message, history: readHistory(req.body?.history), ai, entries: await publicEntries(knex) }));
    } catch (err) { res.status(500).json({ error: 'The assistant is unavailable right now. Please try again.' }); }
  });

  pub.post('/enquiry', rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: byIp, name: 'help-enquiry', message: 'Thanks, we already have your message. We’ll reply soon.' }), async (req, res) => {
    try {
      if (req.body?.website) return res.json({ success: true }); // hidden field filled in by bots
      const name = clean(req.body?.name, 80), contact = clean(req.body?.contact, 120), message = clean(req.body?.message, 1000);
      if (!message) return res.status(400).json({ error: 'Tell us what you’d like to know.' });
      if (!validContact(contact)) return res.status(400).json({ error: 'Add an email address or phone number so we can reply.' });
      await saveEnquiry(knex, { source: 'landing', name, contact, message, transcript: transcriptOf(readHistory(req.body?.history)) });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Could not send that. Please try again.' }); }
  });

  // ── Signed in (inside the app) ───────────────────────────────────────────
  const app = express.Router();
  app.use(express.json({ limit: '20kb' }));

  app.get('/suggestions', (req, res) => res.json({ suggestions: knowledge.SUGGESTIONS.app }));

  app.post('/chat', rateLimit({ windowMs: 10 * 60 * 1000, max: 40, key: byUserOrIp, name: 'help-app', message: 'Lots of questions! Wait a few minutes and ask again.' }), async (req, res) => {
    try {
      const { aiGenerate, aiOptionsFromReq } = require('../services/aiHelper');
      const opts = aiOptionsFromReq(req);
      const hasKey = !!(opts.googleKey || opts.groqKey || opts.openrouterKey || opts.mistralKey || opts.anthropicKey || opts.openaiKey || opts.ollamaEnabled);
      const ai = hasKey ? { generate: async (prompt) => (await aiGenerate(prompt, opts.googleKey, 350, null, opts)).text } : null;
      res.json(await assistant.answer({ audience: 'app', message: req.body?.message, history: readHistory(req.body?.history), page: clean(req.body?.page, 40), ai, entries: await knowledge.load(knex) }));
    } catch (err) { res.status(500).json({ error: 'The assistant is unavailable right now. Please try again.' }); }
  });

  app.post('/enquiry', rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: byUserOrIp, name: 'help-app-enquiry' }), async (req, res) => {
    try {
      const message = clean(req.body?.message, 1000);
      if (!message) return res.status(400).json({ error: 'Tell us what you need help with.' });
      const user = await knex('users').where({ id: req.session.userId }).first();
      await saveEnquiry(knex, {
        source: 'app', name: clean(req.body?.name, 80) || user?.name || '', contact: clean(req.body?.contact, 120) || user?.email || '',
        message, transcript: transcriptOf(readHistory(req.body?.history)), page: clean(req.body?.page, 40),
        user_id: req.session.userId, workspace_id: req.workspaceId || null,
      });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Could not send that. Please try again.' }); }
  });

  return { pub, app };
};
