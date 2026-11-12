// Client approval by link: share a post with a client who has no account. They
// open the link on any phone, see the post with its pictures, and press Approve
// or Ask for changes. The answer comes back to the Calendar automatically.
//
// The post goes through Radixile's relay (the client can't reach this PC), but
// encrypted: the key is only in the link after "#", so the relay can't read it.
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const store = require('./mediaStore');
const { seal } = require('./secrets');
const { parseOptions } = require('./postOptions');

const now = () => Math.floor(Date.now() / 1000);
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const MAX_PICTURE_BYTES = 6 * 1024 * 1024; // in total, so the link opens quickly on a phone

// AES-256-GCM, laid out as WebCrypto expects: iv(12) | ciphertext | tag(16)
function encrypt(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return b64url(Buffer.concat([iv, body, c.getAuthTag()]));
}
function decrypt(key, data) {
  const raw = unb64url(data);
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8'));
}

function relayUrl() { return require('./license').serverUrl(); }
function proofHeader() {
  const proof = require('./license').licenseProof();
  if (!proof) throw Object.assign(new Error('Approval links need an active licence (Settings → Licence).'), { status: 402 });
  return { 'X-SN-License': proof };
}

// Pictures as data: links (library files) or web links, within the size budget
async function pictures(db, workspaceId, item, budget = { left: MAX_PICTURE_BYTES }) {
  const opts = parseOptions(item.options);
  const refs = opts.media?.length ? opts.media : (item.image_url ? [item.image_url] : []);
  const out = [];
  for (const ref of refs.slice(0, 10)) {
    if (/^https?:\/\//i.test(ref)) { out.push(ref); continue; }
    const asset = await store.get(db, workspaceId, store.mediaId(ref));
    if (!asset || asset.size > budget.left) continue;
    try {
      const buf = fs.readFileSync(store.filePath(asset));
      budget.left -= buf.length;
      out.push(`data:${asset.mime};base64,${buf.toString('base64')}`);
    } catch {}
  }
  return out;
}

const MAX_SET = 50;

async function postFor(db, workspaceId, item, budget) {
  const opts = parseOptions(item.options);
  return {
    body: item.body,
    platforms: JSON.parse(item.platforms || '[]'),
    when: item.scheduled_at || null,
    first_comment: opts.first_comment || null,
    images: await pictures(db, workspaceId, item, budget),
  };
}

// Share one post, or several (a "review set": one link, the client answers each)
async function share(db, { workspaceId, userId, itemId, itemIds, days = 14 }) {
  const ids = (itemIds?.length ? itemIds : [itemId]).map(Number).filter(Boolean);
  if (!ids.length) throw Object.assign(new Error('No posts chosen.'), { status: 400 });
  if (ids.length > MAX_SET) throw Object.assign(new Error(`At most ${MAX_SET} posts in one link.`), { status: 400 });
  const rows = await db('content_items').where({ workspace_id: workspaceId }).whereIn('id', ids);
  const items = ids.map(id => rows.find(r => r.id === id)).filter(Boolean);
  if (items.length !== ids.length) throw Object.assign(new Error('Post not found'), { status: 404 });
  const gone = items.find(i => ['published', 'publishing'].includes(i.status));
  if (gone) throw Object.assign(new Error(items.length === 1 ? 'This post has already gone out.' : 'Some of these posts have already gone out.'), { status: 400 });

  const brand = await require('./brand').profile(workspaceId, db);
  const ws = await db('workspaces').where({ id: workspaceId }).first();
  const user = userId ? await db('users').where({ id: userId }).first('name', 'email') : null;
  const budget = { left: MAX_PICTURE_BYTES };
  const posts = [];
  for (const item of items) posts.push(await postFor(db, workspaceId, item, budget));
  const payload = {
    business: brand?.company_name || ws?.name || '',
    from: user?.name || '',
    ...(items.length === 1 ? posts[0] : { posts }),
  };

  const key = crypto.randomBytes(32);
  const res = await axios.post(`${relayUrl()}/v1/approvals`, { ciphertext: encrypt(key, payload), days }, {
    headers: proofHeader(), timeout: 60000, maxBodyLength: Infinity,
  }).catch((err) => {
    throw Object.assign(new Error(err.response?.data?.error || 'Couldn’t reach Radixile’s service to make the link. Check the internet and try again.'), { status: err.response?.status === 402 ? 402 : 502 });
  });
  const url = `${res.data.url}#${b64url(key)}`;

  // Only one open link per post: older ones are closed
  const older = await db('approval_links').where({ workspace_id: workspaceId, status: 'open' }).whereIn('content_item_id', ids);
  for (const o of older) await closeLink(db, o, 'withdrawn').catch(() => {});

  let firstId = null;
  for (let i = 0; i < items.length; i++) {
    const [id] = await db('approval_links').insert({
      workspace_id: workspaceId, content_item_id: items[i].id, relay_id: res.data.id,
      owner_token: seal(res.data.owner), link_key: seal(b64url(key)), url: seal(url),
      status: 'open', created_by: userId || null, created_at: now(), expires_at: res.data.expires_at,
      set_index: items.length > 1 ? i : null, set_size: items.length > 1 ? items.length : null,
    }).returning('id');
    firstId = firstId ?? (id?.id ?? id);
    // The post now waits for the client (also if it was already approved or
    // scheduled: it must not go out while the client may still ask for changes)
    if (['draft', 'approved', 'scheduled', 'failed'].includes(items[i].status)) {
      await db('content_items').where({ id: items[i].id }).update({ status: 'in_review', reviewed_by: null, approved_by: null, updated_at: now() });
    }
  }
  return { id: firstId, url, expires_at: res.data.expires_at, count: items.length };
}

// Close one post's link. The relay copy is deleted when no other post still uses it.
async function closeLink(db, link, status = 'withdrawn') {
  await db('approval_links').where({ id: link.id }).update({ status });
  const others = await db('approval_links').where({ relay_id: link.relay_id, status: 'open' }).count('id as c').first();
  if (!Number(others?.c)) {
    await axios.delete(`${relayUrl()}/v1/approvals/${encodeURIComponent(link.relay_id)}`, { headers: { 'X-Owner': link.owner_token }, timeout: 15000 }).catch(() => {});
  }
}
const withdraw = (db, link) => closeLink(db, link, 'withdrawn');

// A shared post was edited: the client would approve old text, so close its link
async function postChanged(db, workspaceId, itemId) {
  const open = await db('approval_links').where({ workspace_id: workspaceId, content_item_id: itemId, status: 'open' });
  for (const link of open) {
    await closeLink(db, link, 'withdrawn');
    await addComment(db, link, 'The post was changed after it was shared, so the approval link was closed. Make a new link for the client to see the new version.');
  }
  return open.length;
}

// May the person who shared the link put the post in the schedule? (Their role
// must allow scheduling and approving, as in the app, and the licence must be active.)
async function mayAutoSchedule(db, link) {
  if (!link.created_by) return false;
  const m = await db('memberships').where({ workspace_id: link.workspace_id, user_id: link.created_by, status: 'active' }).first('role')
    .catch(() => null);
  const { can } = require('./rbac');
  let licensed = false;
  try { licensed = await require('./entitlements').canPublish(link.workspace_id); } catch {}
  return !!m && can(m.role, 'content.schedule') && can(m.role, 'content.approve') && licensed;
}

async function addComment(db, link, body) {
  await db('content_item_comments').insert({
    content_item_id: link.content_item_id, workspace_id: link.workspace_id, user_id: link.created_by || null, body,
  });
}

// Apply a client's answer to one post
async function apply(db, link, answer) {
  const who = (answer.name || 'The client').slice(0, 80);
  const item = await db('content_items').where({ id: link.content_item_id }).first();
  const t = now();
  let note = '';
  if (answer.decision === 'approve') {
    if (item?.status === 'in_review') {
      // Approved with a time still ahead: it goes into the schedule straight away
      if (item.scheduled_at && item.scheduled_at > t + 60 && await mayAutoSchedule(db, link)) {
        await db('content_items').where({ id: item.id }).update({ status: 'scheduled', approved_by: link.created_by, error_message: null, updated_at: t });
        note = ' It is scheduled.';
      } else {
        await db('content_items').where({ id: item.id }).update({ status: 'approved', approved_by: link.created_by, updated_at: t });
        note = !item.scheduled_at ? ' Choose a time to schedule it.'
          : item.scheduled_at <= t + 60 ? ' Its planned time has passed: choose a new time to schedule it.'
          : ' Someone who can schedule posts needs to schedule it.';
      }
    }
    await addComment(db, link, `✓ Approved by ${who} (client link)${answer.comment ? `: ${answer.comment}` : ''}.${note}`);
  } else {
    if (item?.status === 'in_review') await db('content_items').where({ id: item.id }).update({ status: 'draft', reviewed_by: null, approved_by: null, updated_at: t });
    await addComment(db, link, `✎ ${who} asked for changes (client link): ${answer.comment || '(no comment)'}`);
  }
  await db('approval_links').where({ id: link.id }).update({
    status: answer.decision === 'approve' ? 'approved' : 'changes',
    response_name: who, response_comment: (answer.comment || '').slice(0, 2000), responded_at: answer.at || t,
  });
}

// The answers waiting at the relay, for many links in one request
async function fetchAnswers(links) {
  const items = links.map(l => ({ id: l.relay_id, owner: l.owner_token }));
  const out = {};
  for (let i = 0; i < items.length; i += 100) {
    try {
      const r = await axios.post(`${relayUrl()}/v1/approvals/responses`, { items: items.slice(i, i + 100) }, { timeout: 20000 });
      Object.assign(out, r.data?.answers || {});
    } catch (err) {
      if (err.response?.status !== 404) throw err;
      // An older relay: ask link by link
      for (const it of items.slice(i, i + 100)) {
        try {
          const r = await axios.get(`${relayUrl()}/v1/approvals/${encodeURIComponent(it.id)}/response`, { headers: { 'X-Owner': it.owner }, timeout: 15000 });
          if (r.data?.response) out[it.id] = { response: r.data.response };
        } catch (e) { if (e.response?.status === 404) out[it.id] = { gone: true }; }
      }
    }
  }
  return out;
}

// Collect answers for open links (every 2 minutes)
async function poll(db) {
  if (!(await db.schema.hasTable('approval_links'))) return 0;
  const open = await db('approval_links').where({ status: 'open' });
  if (!open.length) return 0;
  const live = [];
  for (const link of open) {
    if (link.expires_at <= now()) await db('approval_links').where({ id: link.id }).update({ status: 'expired' });
    else live.push(link);
  }
  const byRelay = new Map();
  for (const l of live) byRelay.set(l.relay_id, [...(byRelay.get(l.relay_id) || []), l]);
  const answers = await fetchAnswers([...byRelay.values()].map(ls => ls[0]));

  let applied = 0;
  for (const [relayId, links] of byRelay) {
    const a = answers[relayId];
    if (!a) continue;
    if (a.gone) { for (const l of links) await db('approval_links').where({ id: l.id }).update({ status: 'expired' }); continue; }
    let answer;
    try { answer = decrypt(unb64url(links[0].link_key), a.response); } catch {
      for (const l of links) await db('approval_links').where({ id: l.id }).update({ status: 'error' });
      continue;
    }
    for (const link of links) {
      // A set: one decision per post; a single post: the answer itself
      const d = link.set_index == null ? answer : (answer.decisions || []).find(x => x.i === link.set_index);
      if (!d) { await db('approval_links').where({ id: link.id }).update({ status: 'expired' }); continue; }
      await apply(db, link, { ...d, name: answer.name, at: answer.at });
      applied++;
    }
  }
  return applied;
}

let timer = null;
function start(db) {
  const run = () => poll(db).catch(err => console.warn('[Approvals] Could not check answers:', err.message));
  setTimeout(run, 30 * 1000);
  timer = setInterval(run, 2 * 60 * 1000);
  timer.unref?.();
}

module.exports = { share, withdraw, postChanged, poll, apply, start, encrypt, decrypt, b64url, unb64url, MAX_SET };
