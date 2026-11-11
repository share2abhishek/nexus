// Keeps platform logins working, so a post scheduled for next week still goes out.
//
//   Google Business  access lasts 1 hour; renewed with the saved refresh login
//   Pinterest        access lasts 30 days, renewal login 1 year; renewed
//   LinkedIn         60 days; renewed only if LinkedIn gave a renewal login
//                    (most apps don't get one), otherwise "Reconnect in N days"
//   Facebook/Instagram  posts use the Page login, which doesn't expire when it came
//                    from a long-lived sign-in; checked with Facebook once a day
//   X                never expires
//
// ensureFresh() runs before each post; checkAll() once a day and at start-up.
const axios = require('axios');
const { GRAPH } = require('./platforms/apiVersions');

const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
const RENEW_BEFORE = 10 * 60;      // renew when less than 10 minutes are left
const RENEW_EARLY = 7 * DAY;       // daily check: renew anything ending within a week

// A login the platform says is no longer valid: nothing to retry until the user signs in.
// (invalid_client means the app keys in Settings are wrong — signing in won't help.)
const errorCode = (err) => err.response?.data?.error?.code || err.response?.data?.error;
const isRevoked = (err) => {
  const code = errorCode(err);
  return code === 'invalid_grant' || code === 'invalid_token' || code === 190 /* Meta / Threads: login expired */ || (err.response?.status === 401 && code !== 'invalid_client');
};
const isBadAppKeys = (err) => ['invalid_client', 'unauthorized_client'].includes(errorCode(err));
const reason = (err) => err.response?.data?.error_description || err.response?.data?.error?.message
  || err.response?.data?.message || err.message;

const RENEWERS = {
  // Threads: 60-day login, renewed without the app secret
  threads: (acc) => require('./platforms/threads').refreshThreads(acc),

  async google_business(acc) {
    const r = await axios.post('https://oauth2.googleapis.com/token', {
      grant_type: 'refresh_token',
      refresh_token: acc.refresh_token,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    });
    return { access_token: r.data.access_token, expires_at: now() + (r.data.expires_in || 3600) };
  },

  async pinterest(acc) {
    const r = await axios.post('https://api.pinterest.com/v5/oauth/token',
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: acc.refresh_token }),
      {
        auth: { username: process.env.PINTEREST_APP_ID, password: process.env.PINTEREST_APP_SECRET },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    const out = { access_token: r.data.access_token, expires_at: now() + (r.data.expires_in || 30 * DAY) };
    if (r.data.refresh_token) out.refresh_token = r.data.refresh_token;
    if (r.data.refresh_token_expires_in) out.refresh_expires_at = now() + r.data.refresh_token_expires_in;
    return out;
  },

  async linkedin(acc) {
    const r = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
      params: {
        grant_type: 'refresh_token',
        refresh_token: acc.refresh_token,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET,
      },
    });
    const out = { access_token: r.data.access_token, expires_at: now() + (r.data.expires_in || 60 * DAY) };
    if (r.data.refresh_token) out.refresh_token = r.data.refresh_token;
    if (r.data.refresh_token_expires_in) out.refresh_expires_at = now() + r.data.refresh_token_expires_in;
    return out;
  },
};

// Google's renewal is shared: the Google Business row and the plain "google" row
// hold the same login, so both get the new one.
const SHARED = { google_business: ['google', 'google_business'] };

// Accounts connected in one click (via='radixile') are renewed by Radixile's
// helper, which holds those apps' secrets. The answer has the same shape.
const BROKER_RENEW = {
  async google_business(acc) {
    const d = await require('./connectBroker').refresh('google_business', acc.refresh_token);
    return { access_token: d.access_token, expires_at: now() + (d.expires_in || 3600) };
  },
  async pinterest(acc) { return fromTokenResponse(await require('./connectBroker').refresh('pinterest', acc.refresh_token), 30 * DAY); },
  async linkedin(acc) { return fromTokenResponse(await require('./connectBroker').refresh('linkedin', acc.refresh_token), 60 * DAY); },
};
function fromTokenResponse(d, life) {
  const out = { access_token: d.access_token, expires_at: now() + (d.expires_in || life) };
  if (d.refresh_token) out.refresh_token = d.refresh_token;
  if (d.refresh_token_expires_in) out.refresh_expires_at = now() + d.refresh_token_expires_in;
  return out;
}
const renewerFor = (acc) => (acc.via === 'radixile' && BROKER_RENEW[acc.platform]) || RENEWERS[acc.platform];

async function save(db, acc, fields) {
  let ids = [acc.id];
  const platforms = SHARED[acc.platform];
  if (platforms) {
    // Values are read decrypted, so compare in code (stored ones are encrypted)
    const rows = await db('social_accounts').where({ workspace_id: acc.workspace_id }).whereIn('platform', platforms).select('id', 'refresh_token');
    ids = rows.filter(r => r.id === acc.id || (r.refresh_token && r.refresh_token === acc.refresh_token)).map(r => r.id);
  }
  const { seal } = require('./secrets');
  const stored = { ...fields };
  for (const k of ['access_token', 'refresh_token']) if (stored[k]) stored[k] = seal(stored[k]);
  await db('social_accounts').whereIn('id', ids).update(stored);
  Object.assign(acc, fields);
}

// Renews the login if it is about to run out. Returns the account (updated in place).
// Throws a plain message when the login can no longer be used.
async function ensureFresh(db, acc, { within = RENEW_BEFORE } = {}) {
  if (!acc || !acc.access_token) return acc;
  const renew = renewerFor(acc);
  const endsSoon = acc.expires_at && acc.expires_at - now() < within;
  if (!renew || !endsSoon || (!acc.refresh_token && acc.platform !== 'threads')) return acc;

  try {
    const fresh = await renew(acc);
    await save(db, acc, { ...fresh, auth_error: null, checked_at: now() });
    console.log(`[Logins] Renewed ${acc.platform} login (workspace ${acc.workspace_id})`);
  } catch (err) {
    if (isBadAppKeys(err)) {
      throw new Error(`${acc.platform.replace('_', ' ')} refused Social-Nexus's app keys while renewing the login. Check the app ID and secret in Settings → Connected accounts (an admin can fix this), then press Retry.`);
    }
    if (isRevoked(err)) {
      const hint = acc.platform === 'google_business' ? ' (A Google app still in "Testing" mode ends logins after 7 days: publish the app in Google Cloud Console.)' : '';
      const msg = `The ${acc.platform.replace('_', ' ')} login was cancelled or has run out (${reason(err)}).${hint}`;
      await save(db, acc, { auth_error: msg, checked_at: now() });
      throw new Error(`${msg} Click Connect in Settings → Connected accounts to sign in again, then press Retry.`);
    }
    // Network trouble: keep the old login and try again later
    console.warn(`[Logins] Could not renew ${acc.platform} yet:`, reason(err));
  }
  return acc;
}

// Facebook: ask Facebook whether the Page login still works and when it ends
async function checkFacebook(db, acc) {
  const token = acc.page_token || acc.access_token;
  const viaRadixile = acc.via === 'radixile';
  if (!token || (!viaRadixile && (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET))) return;
  try {
    // Checking a login needs the app's own key: Radixile's helper for one-click accounts
    const r = viaRadixile
      ? { data: await require('./connectBroker').facebookDebug(token) }
      : await axios.get(`${GRAPH}/debug_token`, {
        params: { input_token: token, access_token: `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}` },
      });
    const d = r.data?.data || {};
    if (d.is_valid === false) {
      await save(db, acc, { auth_error: 'Facebook says this login no longer works (password changed, or access removed).', checked_at: now() });
    } else {
      await save(db, acc, { expires_at: d.expires_at || null, auth_error: null, checked_at: now() });
    }
  } catch (err) {
    console.warn('[Logins] Could not check the Facebook login:', reason(err));
  }
}

// Daily: renew what ends within a week, check Facebook/Instagram Page logins
async function checkAll(db) {
  if (!(await db.schema.hasColumn('social_accounts', 'auth_error'))) return;
  const accounts = await db('social_accounts').whereNotNull('access_token');
  for (const acc of accounts) {
    try {
      if (acc.platform === 'facebook' || acc.platform === 'instagram') await checkFacebook(db, acc);
      else await ensureFresh(db, acc, { within: RENEW_EARLY });
    } catch (err) {
      console.warn(`[Logins] ${acc.platform}: ${err.message}`);
    }
  }
}

// For Settings: days until the user must sign in again, or null when the app renews it
function reconnectInDays(acc) {
  if (!acc?.access_token) return null;
  const canRenew = !!(renewerFor(acc) && (acc.refresh_token || acc.platform === 'threads'));
  const ends = canRenew ? acc.refresh_expires_at : acc.expires_at;
  if (!ends) return null;
  return Math.max(0, Math.floor((ends - now()) / DAY));
}

let timer = null;
function start(db) {
  const run = () => checkAll(db).catch(err => console.error('[Logins] Daily check failed:', err.message));
  setTimeout(run, 60 * 1000); // shortly after start-up, not during it
  timer = setInterval(run, DAY * 1000);
  timer.unref?.();
}

module.exports = { ensureFresh, checkAll, checkFacebook, reconnectInDays, start, RENEWERS };
