// Phone companion: a private page on the person's phone (through Radixile's relay,
// encrypted with a key only the PC and the phone have) showing posts waiting for
// their OK, failed posts and what's coming up. Approve / Ask for changes on the
// phone comes back here and is applied with the person's own rights.
const crypto = require('crypto');
const axios = require('axios');
const { seal } = require('./secrets');
const { encrypt, decrypt, b64url, unb64url } = require('./approvals');
const { can } = require('./rbac');

const now = () => Math.floor(Date.now() / 1000);
const base = () => require('./license').serverUrl();
function proof() {
  const p = require('./license').licenseProof();
  if (!p) throw Object.assign(new Error('The phone companion needs an active licence (Settings → Licence).'), { status: 402 });
  return { 'X-SN-License': p };
}
const title = (body) => String(body || '').replace(/\s+/g, ' ').trim().slice(0, 90);

async function pair(db, userId, label = 'My phone') {
  const r = await axios.post(`${base()}/v1/companion`, {}, { headers: proof(), timeout: 15000 })
    .catch((err) => { throw Object.assign(new Error(err.response?.data?.error || 'Couldn’t reach Radixile’s service. Check the internet and try again.'), { status: err.response?.status || 502 }); });
  const key = crypto.randomBytes(32);
  const url = `${r.data.url}#${b64url(key)}`;
  await db('companion_pairs').insert({
    user_id: userId, label: String(label).slice(0, 60), relay_id: r.data.id,
    owner_token: seal(r.data.owner), link_key: seal(b64url(key)), url: seal(url), created_at: now(),
  });
  const p = await db('companion_pairs').where({ relay_id: r.data.id }).first();
  await push(db, p).catch(() => {});
  return { url };
}

async function unpair(db, userId, id) {
  const p = await db('companion_pairs').where({ id, user_id: userId }).first();
  if (!p) return false;
  await axios.delete(`${base()}/v1/companion/${encodeURIComponent(p.relay_id)}`, { headers: { 'X-Owner': p.owner_token }, timeout: 15000 }).catch(() => {});
  await db('companion_pairs').where({ id: p.id }).del();
  return true;
}

// What the person should see: across the workspaces they belong to
async function summary(db, userId) {
  const user = await db('users').where({ id: userId }).first('name', 'email');
  const members = await db('memberships as m').join('workspaces as w', 'w.id', 'm.workspace_id')
    .where({ 'm.user_id': userId }).whereNot('m.status', 'removed').select('m.workspace_id', 'm.role', 'w.name');
  const names = Object.fromEntries(members.map(m => [m.workspace_id, m.name]));
  const approveIn = members.filter(m => can(m.role, 'content.approve')).map(m => m.workspace_id);
  const replyIn = members.filter(m => can(m.role, 'content.publish')).map(m => m.workspace_id);
  const viewIn = members.filter(m => can(m.role, 'content.view')).map(m => m.workspace_id);
  const t = now();
  const parse = (v) => { try { return JSON.parse(v || '[]'); } catch { return []; } };

  const waiting = approveIn.length ? await db('content_items').whereIn('workspace_id', approveIn).where({ status: 'in_review' })
    .orderBy('scheduled_at', 'asc').limit(30) : [];
  const failed = viewIn.length ? await db('content_items').whereIn('workspace_id', viewIn).where({ status: 'failed' })
    .where('updated_at', '>', t - 7 * 86400).orderBy('updated_at', 'desc').limit(10) : [];
  const next = viewIn.length ? await db('content_items').whereIn('workspace_id', viewIn).where({ status: 'scheduled' })
    .where('scheduled_at', '>', t).orderBy('scheduled_at', 'asc').limit(10) : [];

  const comments = replyIn.length && (await db.schema.hasTable('inbox_items'))
    ? await db('inbox_items as i').leftJoin('posts as p', 'p.id', 'i.post_id').whereIn('i.workspace_id', replyIn).whereNull('i.replied_at')
      .where('i.created_at', '>', t - 14 * 86400).orderBy('i.created_at', 'desc').limit(30)
      .select('i.id', 'i.workspace_id', 'i.platform', 'i.author_name', 'i.text', 'i.created_at', 'p.content as post_content')
    : [];
  const done = await db('companion_done').where({ user_id: userId }).where('at', '>', t - 3600).orderBy('at', 'desc').limit(50).catch(() => []);

  return {
    user: user?.name || user?.email || '',
    at: t,
    comments: comments.map(c => ({ id: c.id, workspace_id: c.workspace_id, workspace: names[c.workspace_id], platform: c.platform, author: c.author_name, text: String(c.text || '').slice(0, 600), post: title(c.post_content), at: c.created_at })),
    done: done.map(d => ({ key: d.action_key, ok: !!d.ok, note: d.note })),
    waiting: waiting.map(i => ({ id: i.id, v: i.updated_at || 0, workspace_id: i.workspace_id, workspace: names[i.workspace_id], body: String(i.body || '').slice(0, 1500), platforms: parse(i.platforms), when: i.scheduled_at || null })),
    failed: failed.map(i => ({ title: title(i.body), error: String(i.error_message || '').slice(0, 300) })),
    next: next.map(i => ({ title: title(i.body), when: i.scheduled_at, platforms: parse(i.platforms), workspace: names[i.workspace_id] })),
  };
}

async function push(db, p) {
  const s = await summary(db, p.user_id);
  const { at, ...content } = s;
  const hash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
  // Unchanged: refresh at most every 10 minutes (so the phone sees the PC is alive)
  if (hash === p.last_hash && p.last_push > now() - 10 * 60) return false;
  await axios.put(`${base()}/v1/companion/${encodeURIComponent(p.relay_id)}`, { ciphertext: encrypt(unb64url(p.link_key), s) },
    { headers: { 'X-Owner': p.owner_token }, timeout: 20000 });
  await db('companion_pairs').where({ id: p.id }).update({ last_hash: hash, last_push: now() });
  return true;
}

async function remember(db, p, a, ok, note = null) {
  if (!a?.key) return;
  await db('companion_done').insert({ user_id: p.user_id, action_key: String(a.key).slice(0, 80), ok: ok ? 1 : 0, note, at: now() }).catch(() => {});
}

// A reply typed on the phone, posted with the person's own rights
async function applyReply(db, p, a) {
  const item = await db('inbox_items').where({ id: a.item_id, workspace_id: a.workspace_id }).first();
  const m = await db('memberships').where({ user_id: p.user_id, workspace_id: a.workspace_id }).first('role', 'status');
  if (!item || !m || m.status === 'removed' || !can(m.role, 'content.publish')) { await remember(db, p, a, false, 'Not allowed'); return false; }
  if (a.text === '' && a.mark_read) { await db('inbox_items').where({ id: item.id }).update({ is_read: 1 }); await remember(db, p, a, true); return true; }
  try {
    await require('./inbox').reply(db, a.workspace_id, p.user_id, item.id, a.text);
    await remember(db, p, a, true);
    return true;
  } catch (err) {
    await remember(db, p, a, false, err.message.slice(0, 200));
    return false;
  }
}

// Apply what was done on the phone, with the person's own rights
async function applyAction(db, p, a) {
  if (a?.type === 'reply') return applyReply(db, p, a);
  if (a?.type !== 'review' || !['approve', 'changes'].includes(a.decision)) return false;
  const m = await db('memberships').where({ user_id: p.user_id, workspace_id: a.workspace_id }).first('role', 'status');
  if (!m || m.status === 'removed' || !can(m.role, 'content.approve')) return false;
  const item = await db('content_items').where({ id: a.item_id, workspace_id: a.workspace_id }).first();
  if (!item || item.status !== 'in_review') { await remember(db, p, a, false, 'Already decided on the PC'); return false; }
  // An answer about an older version (or an old, replayed action) doesn't count
  if (!a.at || a.at < now() - 86400 || (a.v != null && Number(a.v) !== Number(item.updated_at || 0))) {
    await remember(db, p, a, false, 'The post changed since; look again'); return false;
  }
  const t = now();
  if (a.decision === 'approve') {
    await db('content_items').where({ id: item.id }).update({ status: 'approved', approved_by: p.user_id, updated_at: t });
  } else {
    await db('content_items').where({ id: item.id }).update({ status: 'draft', reviewed_by: p.user_id, approved_by: null, updated_at: t });
  }
  await db('content_item_comments').insert({
    content_item_id: item.id, workspace_id: item.workspace_id, user_id: p.user_id,
    body: a.decision === 'approve' ? '✓ Approved on the phone' : `✎ Changes asked on the phone: ${String(a.comment || '').slice(0, 1000)}`,
  });
  await remember(db, p, a, true);
  return true;
}

async function sync(db) {
  if (!(await db.schema.hasTable('companion_pairs'))) return;
  for (const p of await db('companion_pairs')) {
    try {
      const r = await axios.get(`${base()}/v1/companion/${encodeURIComponent(p.relay_id)}/actions`, { headers: { 'X-Owner': p.owner_token }, timeout: 15000 });
      let changed = false;
      for (const c of r.data?.actions || []) {
        try { changed = (await applyAction(db, p, decrypt(unb64url(p.link_key), c))) || changed; } catch {}
      }
      // Any action (done or refused) changes what the phone should show
      const acted = changed || (r.data?.actions || []).length > 0;
      await push(db, { ...p, last_hash: acted ? null : p.last_hash });
    } catch (err) {
      if (err.response?.status === 404) await db('companion_pairs').where({ id: p.id }).del(); // unpaired on the server
    }
  }
}

let timer = null;
function start(db) {
  const run = () => sync(db).catch(err => console.warn('[Companion]', err.message));
  setTimeout(run, 45 * 1000);
  timer = setInterval(run, 2 * 60 * 1000);
  timer.unref?.();
}

module.exports = { pair, unpair, summary, push, applyAction, sync, start };
