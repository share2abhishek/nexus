// Cloud posting: a safety net for scheduled posts when this PC is off at the time
// (Agency and Full editions, chosen per post: options.cloud).
//
// Every few minutes the app hands Radixile's cloud a copy of each such post (text,
// up to 4 photos, the platform login it needs), keeps them in step with edits and
// re-scheduling, and cancels them when no longer needed. At posting time the app,
// if running, takes the job back and posts itself; if the PC is off, the cloud
// posts 10 minutes later and erases the login and pictures. Results come back here.
const crypto = require('crypto');
const axios = require('axios');
const { seal } = require('./secrets');
const { parseOptions } = require('./postOptions');
const { mediaList } = require('./platforms/media');
const { linkedInText } = require('./platforms/linkedin');

const SUPPORTED = ['facebook', 'instagram', 'linkedin', 'pinterest'];
// Copies go to the cloud only shortly before the post's time, so the login in them
// is current and Radixile holds it as briefly as possible
const HANDOVER_BEFORE = 48 * 3600;
const now = () => Math.floor(Date.now() / 1000);
const base = () => require('./license').serverUrl();
const proof = () => {
  const p = require('./license').licenseProof();
  if (!p) throw new Error('needs an active licence');
  return { 'X-SN-License': p };
};

let statusCache = { at: 0, enabled: false };
async function enabled() {
  if (Date.now() - statusCache.at < 30 * 60 * 1000) return statusCache.enabled;
  try {
    const r = await axios.get(`${base()}/v1/cloud/status`, { headers: proof(), timeout: 10000 });
    statusCache = { at: Date.now(), enabled: !!r.data.enabled };
  } catch { statusCache = { at: Date.now() - 25 * 60 * 1000, enabled: false }; }
  return statusCache.enabled;
}

function accountFields(platform, acc) {
  if (platform === 'facebook') return { page_id: acc.page_id, page_token: acc.page_token };
  if (platform === 'instagram') return { ig_account_id: acc.ig_account_id, page_token: acc.page_token || acc.access_token };
  if (platform === 'linkedin') return { access_token: acc.access_token, external_id: acc.external_id };
  if (platform === 'pinterest') return { access_token: acc.access_token, board_id: acc.board_id };
  return null;
}

async function mediaFor(item) {
  const opts = parseOptions(item.options);
  const out = [];
  for (const m of mediaList(item.image_url, opts, item.workspace_id).slice(0, 4)) {
    const f = await m.file();
    if (f.kind !== 'image' || !['image/jpeg', 'image/png'].includes(f.mime)) throw new Error('Cloud posting takes JPG or PNG photos only.');
    out.push({ mime: f.mime, data: f.buffer.toString('base64') });
  }
  return out;
}

// What a copy depends on: the post and the login (a renewed or new login replaces the copy)
const fingerprint = (item, acc) => crypto.createHash('sha256').update(JSON.stringify([
  item.body, item.image_url, item.options, item.scheduled_at, acc?.access_token || null, acc?.page_token || null, acc?.board_id || null,
])).digest('hex');
async function accountOf(db, item, platform) {
  const chosen = (() => { try { return JSON.parse(item.social_account_ids || '[]'); } catch { return []; } })();
  if (chosen.length) {
    const acc = await db('social_accounts').where({ workspace_id: item.workspace_id, platform }).whereIn('id', chosen).first();
    if (acc) return acc;
  }
  return require('../repos/socialAccountsRepo')(db).getByPlatform(item.workspace_id, platform);
}

async function cancel(db, job, status = 'cancelled') {
  try {
    await axios.delete(`${base()}/v1/cloud/jobs/${encodeURIComponent(job.job_id)}`, { headers: { 'X-Owner': job.owner_token }, timeout: 15000 });
    await db('cloud_jobs').where({ id: job.id }).update({ status });
    return { cancelled: true };
  } catch (err) {
    if (err.response?.status === 409) return { cancelled: false, server: err.response.data }; // already posting / posted
    if (err.response?.status === 404) { await db('cloud_jobs').where({ id: job.id }).update({ status }); return { cancelled: true }; }
    throw err;
  }
}

// Keep the cloud copies in step with the schedule
async function sync(db) {
  if (!(await db.schema.hasTable('cloud_jobs'))) return;
  const t = now();
  const waiting = await db('cloud_jobs').where({ status: 'waiting' });

  // 1. Copies that are no longer wanted (post edited, unscheduled, deleted, sent)
  for (const job of waiting) {
    const item = await db('content_items').where({ id: job.content_item_id }).first();
    const acc = item ? await accountOf(db, item, job.platform) : null;
    const wanted = item && item.status === 'scheduled' && parseOptions(item.options).cloud && JSON.parse(item.platforms || '[]').includes(job.platform)
      && acc?.access_token && !acc.auth_error && fingerprint(item, acc) === job.fingerprint;
    if (!wanted && job.run_at > t) await cancel(db, job).catch(() => {});
  }

  // 2. New copies for scheduled cloud posts
  if (await enabled()) {
    const items = await db('content_items').where({ status: 'scheduled' }).where('scheduled_at', '>', t + 120).where('scheduled_at', '<=', t + HANDOVER_BEFORE);
    for (const item of items.filter(i => parseOptions(i.options).cloud)) {
      if (item.scheduled_at <= now() + 300) continue; // too close: this PC posts it
      for (const platform of JSON.parse(item.platforms || '[]').filter(p => SUPPORTED.includes(p))) {
        const acc = await accountOf(db, item, platform);
        if (!acc?.access_token || acc.auth_error) continue;
        // Renew a login that would run out before the post goes out
        await require('./tokenRefresher').ensureFresh(db, acc, { within: Math.max(600, item.scheduled_at - t + 3600) }).catch(() => {});
        const fp = fingerprint(item, acc);
        const has = await db('cloud_jobs').where({ content_item_id: item.id, platform, status: 'waiting', fingerprint: fp }).first();
        if (has) continue;
        try {
          const r = await axios.post(`${base()}/v1/cloud/jobs`, {
            platform, run_at: item.scheduled_at, text: item.body,
            text_linkedin: platform === 'linkedin' ? linkedInText(item.body) : null,
            first_comment: parseOptions(item.options).first_comment || null,
            media: await mediaFor(item), account: accountFields(platform, acc),
          }, { headers: proof(), timeout: 60000, maxBodyLength: Infinity });
          await db('cloud_jobs').insert({
            workspace_id: item.workspace_id, content_item_id: item.id, platform, job_id: r.data.id, owner_token: seal(r.data.owner),
            run_at: item.scheduled_at, fingerprint: fp, status: 'waiting', created_at: now(),
          });
          // Published or changed while handing over? Then the copy isn't wanted
          const still = await db('content_items').where({ id: item.id }).first('status', 'scheduled_at');
          if (still?.status !== 'scheduled' || still.scheduled_at !== item.scheduled_at) {
            const job = await db('cloud_jobs').where({ job_id: r.data.id }).first();
            if (job) await cancel(db, job).catch(() => {});
          }
        } catch (err) {
          console.warn(`[Cloud] Couldn't hand over post #${item.id} for ${platform}:`, err.response?.data?.error || err.message);
        }
      }
    }
  }

  // 3. Results of copies the cloud ran (the PC was off)
  const ran = await db('cloud_jobs').whereIn('status', ['waiting', 'running']).where('run_at', '<', now() - 10 * 60);
  for (const job of ran) {
    try {
      const r = await axios.get(`${base()}/v1/cloud/jobs/${encodeURIComponent(job.job_id)}`, { headers: { 'X-Owner': job.owner_token }, timeout: 15000 });
      if (!['done', 'failed'].includes(r.data.status)) continue;
      await db('cloud_jobs').where({ id: job.id }).update({ status: r.data.status, result: JSON.stringify(r.data.result) });
      await settle(db, job.content_item_id);
    } catch (err) {
      if (err.response?.status === 404) await db('cloud_jobs').where({ id: job.id }).update({ status: 'cancelled' });
    }
  }
}

// All of a post's cloud copies have run: record the outcome like a normal publish
async function settle(db, itemId) {
  const jobs = await db('cloud_jobs').where({ content_item_id: itemId });
  if (jobs.some(j => ['waiting', 'running'].includes(j.status))) return;
  const item = await db('content_items').where({ id: itemId }).first();
  if (!item || !['scheduled', 'failed'].includes(item.status)) return;
  const results = jobs.filter(j => ['done', 'failed'].includes(j.status))
    .map(j => ({ platform: j.platform, cloud: true, ...(JSON.parse(j.result || '{}')) }));
  if (!results.length) return;
  const ok = results.some(r => r.success);
  const t = now();
  const missing = JSON.parse(item.platforms || '[]').filter(p => !results.some(r => r.platform === p && r.success));
  if (ok && missing.length) {
    // Some platforms went out from the cloud, others need this PC: Retry posts the rest
    await db('content_items').where({ id: itemId }).update({
      status: 'failed', updated_at: t,
      error_message: `Posted to ${results.filter(r => r.success).map(r => r.platform).join(', ')} from the cloud while this PC was off. Not posted yet: ${missing.join(', ')} — press Retry to post those (the others won't be posted twice).`,
    });
    await require('../repos/postsRepo')(db).save(item.workspace_id, item.submitted_by, {
      content: item.body, platforms: JSON.parse(item.platforms || '[]'), image_url: item.image_url, results, status: 'published',
    }).catch(() => {});
  } else if (ok) {
    await db('content_items').where({ id: itemId }).update({ status: 'published', published_at: t, error_message: null, updated_at: t });
    await require('../repos/postsRepo')(db).save(item.workspace_id, item.submitted_by, {
      content: item.body, platforms: JSON.parse(item.platforms || '[]'), image_url: item.image_url, results, status: 'published',
    }).catch(() => {});
  } else {
    await db('content_items').where({ id: itemId }).update({ status: 'failed', error_message: `Posted from the cloud while this PC was off, but: ${results.map(r => `${r.platform}: ${r.error}`).join('; ')}`, updated_at: t });
  }
}

// At posting time, with the PC on: take the copies back. Returns results for
// platforms the cloud already handled (those are not posted again here).
async function takeOver(db, item) {
  if (!(await db.schema.hasTable('cloud_jobs'))) return {};
  const handled = {};
  for (const done of await db('cloud_jobs').where({ content_item_id: item.id, status: 'done' })) {
    handled[done.platform] = { platform: done.platform, ...(JSON.parse(done.result || '{}')), cloud: true };
  }
  const jobs = await db('cloud_jobs').where({ content_item_id: item.id, status: 'waiting' });
  for (const job of jobs) {
    try {
      const r = await cancel(db, job, 'taken_back');
      if (!r.cancelled && r.server) {
        if (r.server.status === 'done') handled[job.platform] = { platform: job.platform, ...r.server.result, cloud: true };
        else handled[job.platform] = { platform: job.platform, success: false, pending_cloud: true, error: 'Being posted from the cloud right now; the result appears here in a few minutes.', cloud: true };
        // Still running in the cloud: keep checking for the result
        await db('cloud_jobs').where({ id: job.id }).update({ status: r.server.status === 'running' ? 'running' : r.server.status, result: JSON.stringify(r.server.result || null) });
      }
    } catch {
      // The cloud couldn't be reached: it may still post 10 minutes later — so
      // don't post here too (never twice); the result is collected later.
      handled[job.platform] = { platform: job.platform, success: false, pending_cloud: true, error: 'Handed to the cloud (this PC couldn’t reach it to take it back).' };
    }
  }
  return handled;
}

let timer = null;
let busy = false;
function start(db) {
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await sync(db); } catch (err) { console.warn('[Cloud]', err.message); } finally { busy = false; }
  };
  setTimeout(run, 60 * 1000);
  timer = setInterval(run, 3 * 60 * 1000);
  timer.unref?.();
}

module.exports = { sync, takeOver, settle, enabled, start, SUPPORTED, _reset: () => { statusCache = { at: 0, enabled: false }; } };
