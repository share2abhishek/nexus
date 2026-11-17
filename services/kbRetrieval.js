// Fast answers from the AI Chat Knowledge Base.
//
// Three things keep the bot quick and its prompt small:
//   1. bestFaq()        – a customer who asks a saved FAQ gets its answer straight away,
//                         with no AI call (a few milliseconds instead of seconds).
//   2. selectContext()  – the AI is given only the parts of the knowledge base that
//                         relate to the question, not all 20,000 characters.
//   3. loadKnowledge()  – the knowledge base is read from the database once a minute
//                         per business (and again right after it is saved), and
//                         answerCache stores recent AI answers for repeat questions.
// Nothing here changes what the owner wrote: answers still come only from their notes.
const crypto = require('crypto');

const KB_TTL_MS = 60_000;
const ANSWER_TTL_MS = 5 * 60_000;
const ANSWER_MAX = 500;
const DEFAULT_CONTEXT_CHARS = 3000;

const STOP = new Set((
  'a an the is are was were be am of to for and or in on at by do does did you your yours we our us i me my mine can could ' +
  'how what when where which who whom with about please pls hi hello hey ok okay tell give get have has had it its this that much many ' +
  'there any some kya hai hain ka ki ke ko se me mein aap aapka mera'
).split(' '));

const FACT_TITLES = {
  business_summary: 'Overview',
  products_services: 'Products & Services',
  pricing_plans: 'Pricing & Payment',
  hours_locations: 'Hours & Address',
  shipping_delivery: 'Shipping & Delivery',
  refunds_returns: 'Returns & Refunds',
  contact_support: 'Contact & Escalation',
};
const CORE_FACTS = new Set(['business_summary', 'contact_support']);

const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFKC')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const stem = w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const tokens = s => norm(s).split(' ').filter(w => w && !STOP.has(w)).map(stem);

// ── Splitting the knowledge into small pieces ───────────────────────────────
function chunkText(text, title, core = false, max = 900) {
  const out = [];
  for (const para of String(text || '').split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= max) { out.push({ title, text: p, core }); continue; }
    let buf = '';
    for (const line of p.split('\n')) {
      if (buf && buf.length + line.length + 1 > max) { out.push({ title, text: buf, core }); buf = ''; }
      buf += (buf ? '\n' : '') + line;
      while (buf.length > max) { out.push({ title, text: buf.slice(0, max), core }); buf = buf.slice(max); }
    }
    if (buf) out.push({ title, text: buf, core });
  }
  return out;
}

// Plain text (an older knowledge base kept only as one block of notes)
function sectionsFromText(text) {
  return chunkText(text, '');
}

function sectionsFromRow(row) {
  const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
  const facts = parse(row.facts_json, {});
  const faqs = parse(row.faqs_json, []);
  const docs = parse(row.documents_json, []);
  const sections = [];
  for (const [k, title] of Object.entries(FACT_TITLES)) {
    const v = String(facts[k] || '').trim();
    if (v) sections.push({ title, text: `${title}: ${v}`, core: CORE_FACTS.has(k) });
  }
  for (const f of Array.isArray(faqs) ? faqs : []) {
    if (!f || f.enabled === false || !f.question || !f.answer) continue;
    sections.push({ title: `${f.question} ${(f.tags || []).join(' ')}`, text: `Q: ${f.question}\nA: ${f.answer}`, core: false });
  }
  for (const d of Array.isArray(docs) ? docs : []) {
    if (d && d.content) sections.push(...chunkText(d.content, d.title || '', false));
  }
  if (row.raw_text) sections.push(...chunkText(row.raw_text, 'Notes', false));
  return sections;
}

// ── Cached read of a business's knowledge ───────────────────────────────────
const kbCache = new Map(); // workspaceId -> { at, value }

// Multi-tenant: every cache entry is keyed by the business (workspace) it belongs to,
// as a string so 7 and '7' are the same business and a save always clears the right one.
const wsKey = id => String(id);

async function loadKnowledge(db, workspaceId) {
  const hit = kbCache.get(wsKey(workspaceId));
  if (hit && Date.now() - hit.at < KB_TTL_MS) return hit.value;
  let value = null;
  try {
    if (await db.schema.hasTable('ai_knowledge_bases')) {
      const row = await db('ai_knowledge_bases').where({ workspace_id: workspaceId }).first();
      if (row) {
        const faqs = (() => { try { return JSON.parse(row.faqs_json || '[]'); } catch { return []; } })()
          .filter(f => f && f.enabled !== false && f.question && f.answer);
        let persona = null;
        try { persona = row.persona_json ? JSON.parse(row.persona_json) : null; } catch { /* keep null */ }
        const compiled = String(row.compiled_knowledge || '').trim();
        value = {
          // changes whenever anything the answer depends on changes, even within one second
          stamp: hash([row.compiled_knowledge, row.faqs_json, row.facts_json, row.documents_json, row.raw_text, row.persona_json].join('\u0001')),
          persona,
          faqs,
          compiled,
          sections: compiled ? sectionsFromRow(row) : [],
        };
        if (!value.sections.length && compiled) value.sections = sectionsFromText(compiled);
      }
    }
  } catch { value = null; }
  kbCache.set(wsKey(workspaceId), { at: Date.now(), value });
  return value;
}

// Call after the owner saves the knowledge base so the next answer uses the new notes
function invalidate(workspaceId) {
  if (workspaceId == null) kbCache.clear(); else kbCache.delete(wsKey(workspaceId));
}

// ── 1. A saved FAQ answers straight away ────────────────────────────────────
// Only a close match counts: the customer's words must cover the FAQ question (two or
// more meaningful words) with at most two extra words. Looser questions go to the AI.
function bestFaq(faqs, text) {
  const m = new Set(tokens(text));
  if (!m.size) return null;
  const mNorm = norm(text);
  let best = null;
  for (const f of faqs || []) {
    if (norm(f.question) === mNorm && mNorm) return f;
    const q = [...new Set(tokens(f.question))];
    if (q.length < 2) continue;
    const covered = q.filter(w => m.has(w)).length;
    const extra = [...m].filter(w => !q.includes(w)).length;
    const cover = covered / q.length;
    if (cover >= 0.85 && extra <= 2 && (!best || cover > best.cover)) best = { f, cover };
  }
  return best ? best.f : null;
}

// ── 2. Only the relevant part of the knowledge goes to the AI ───────────────
function scoreSection(section, q) {
  if (!q.size) return 0;
  const body = new Set(tokens(section.text));
  const head = new Set(tokens(section.title));
  let s = 0;
  for (const w of q) { if (body.has(w)) s += 1; if (head.has(w)) s += 1.5; }
  return s;
}

function selectContext(sections, text, maxChars = DEFAULT_CONTEXT_CHARS) {
  const list = Array.isArray(sections) ? sections : [];
  const total = list.reduce((n, s) => n + s.text.length + 2, 0);
  if (total <= maxChars) return list.map(s => s.text).join('\n\n');

  const q = new Set(tokens(text));
  const scored = list.map((s, i) => ({ s, i, score: scoreSection(s, q) }));
  const hits = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i);
  const order = hits.length ? hits : scored.slice(0, 3);
  // The overview and contact details go last, if there is room: they rarely hurt
  const core = scored.filter(x => x.s.core && !order.includes(x));

  const chosen = [];
  let used = 0;
  for (const x of [...order, ...core]) {
    const len = x.s.text.length + 2;
    if (used + len > maxChars) {
      if (!chosen.length) { chosen.push({ i: x.i, text: x.s.text.slice(0, maxChars) }); used = maxChars; }
      continue;
    }
    chosen.push({ i: x.i, text: x.s.text });
    used += len;
  }
  return chosen.sort((a, b) => a.i - b.i).map(c => c.text).join('\n\n');
}

// ── 3. Recent AI answers, so the same question is not paid for twice ────────
const answers = new Map(); // key -> { at, text }
const hash = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

function answerKey(workspaceId, stamp, facts, text) {
  const n = norm(text);
  if (!n || n.length > 200) return null; // long, one-off messages are not worth keeping
  if (workspaceId == null) return null; // never share an answer without knowing whose it is
  return `${wsKey(workspaceId)}|${stamp}|${hash(facts)}|${n}`;
}

function getCachedAnswer(key) {
  if (!key) return null;
  const hit = answers.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ANSWER_TTL_MS) { answers.delete(key); return null; }
  return hit.text;
}

function setCachedAnswer(key, text) {
  if (!key || !text) return;
  answers.set(key, { at: Date.now(), text });
  if (answers.size > ANSWER_MAX) {
    for (const k of answers.keys()) { answers.delete(k); if (answers.size <= ANSWER_MAX * 0.8) break; }
  }
}

function _reset() { kbCache.clear(); answers.clear(); }

module.exports = {
  loadKnowledge, invalidate, bestFaq, selectContext, sectionsFromText,
  answerKey, getCachedAnswer, setCachedAnswer, tokens, _reset,
};
