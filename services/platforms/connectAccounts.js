// After a platform sign-in: read the profile (and Pages, boards…) with the new
// login and save the account. Used by the normal sign-in (customer's own developer
// app, routes/auth.js) and by one-click connect through Radixile's approved apps
// (services/connectBroker.js), so both behave the same.
//
// via: 'own' (the customer's app) or 'radixile' (renewed through Radixile's helper)
const axios = require('axios');
const { GRAPH } = require('./apiVersions');

const now = () => Math.floor(Date.now() / 1000);
const repoFor = (db) => require('../../repos/socialAccountsRepo')(db);

async function completeLinkedIn(db, wsId, t, { via = 'own' } = {}) {
  // OpenID Connect profile: "sub" is the member id used to post (urn:li:person:<sub>)
  const me = (await axios.get('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).data;
  await repoFor(db).add(wsId, {
    platform: 'linkedin',
    external_id: me.sub,
    access_token: t.access_token,
    expires_at: t.expires_in ? now() + t.expires_in : null,
    // Only some LinkedIn apps get a renewal login; without it, Settings counts down to re-sign-in
    refresh_token: t.refresh_token || null,
    refresh_expires_at: t.refresh_token_expires_in ? now() + t.refresh_token_expires_in : null,
    profile: { id: me.sub, name: me.name || [me.given_name, me.family_name].filter(Boolean).join(' '), picture: me.picture || null },
    via,
  });
  return { connected: 'linkedin' };
}

// t.access_token must already be the long-lived Facebook login
async function completeFacebook(db, wsId, t, { instagram = false, via = 'own' } = {}) {
  const access_token = t.access_token;
  const profile = (await axios.get(`${GRAPH}/me`, { params: { fields: 'id,name,picture', access_token } })).data;
  const pages = (await axios.get(`${GRAPH}/me/accounts`, { params: { access_token } })).data.data || [];

  // Auto-select only when there is exactly one Page. With several, keep the Page
  // chosen before (signing in again must not lose it); otherwise the user chooses
  // in Settings → Facebook → Select page (no silent pages[0] pick).
  const repo = repoFor(db);
  const previous = await repo.getByPlatform(wsId, 'facebook');
  const page = pages.length === 1 ? pages[0]
    : (previous?.page_id && pages.find(p => String(p.id) === String(previous.page_id))) || null;

  let igAccountId = null;
  if (page) {
    try {
      const ig = await axios.get(`${GRAPH}/${page.id}`, { params: { fields: 'instagram_business_account', access_token: page.access_token } });
      igAccountId = ig.data.instagram_business_account?.id || null;
    } catch {}
  }

  await repo.add(wsId, {
    platform: 'facebook',
    external_id: profile.id,
    access_token,
    page_id: page?.id || null,
    page_token: page?.access_token || null,
    profile: { id: profile.id, name: profile.name, page_name: page?.name },
    via,
  });

  // Only when this sign-in asked for Instagram permissions: a Facebook-only
  // reconnect must not replace a working Instagram login with one that can't post
  if (igAccountId && instagram) {
    await repo.add(wsId, {
      platform: 'instagram',
      external_id: igAccountId,
      access_token,
      page_token: page.access_token,
      page_id: page.id, // the Facebook Page it belongs to
      ig_account_id: igAccountId,
      profile: { id: igAccountId, name: `${profile.name} (Instagram)` },
      via,
    });
  }

  // When does the Page login end? (never, when it came from the long-lived sign-in)
  const { checkFacebook } = require('../tokenRefresher');
  const saved = await db('social_accounts').where({ workspace_id: wsId }).whereIn('platform', ['facebook', 'instagram']);
  await Promise.all(saved.map(acc => checkFacebook(db, acc)));

  return {
    connected: instagram ? 'instagram' : 'facebook',
    selectPage: !page && pages.length > 1,
    instagramMissing: instagram && !igAccountId,
  };
}

async function completePinterest(db, wsId, t, { via = 'own' } = {}) {
  const auth = { headers: { Authorization: `Bearer ${t.access_token}` } };
  const profile = (await axios.get('https://api.pinterest.com/v5/user_account', auth)).data;
  const boards = (await axios.get('https://api.pinterest.com/v5/boards', auth)).data.items || [];
  await repoFor(db).add(wsId, {
    platform: 'pinterest',
    external_id: profile.username,
    access_token: t.access_token,
    refresh_token: t.refresh_token || null,
    expires_at: t.expires_in ? now() + t.expires_in : null,
    refresh_expires_at: t.refresh_token_expires_in ? now() + t.refresh_token_expires_in : null,
    board_id: boards[0]?.id || null,
    profile: { id: profile.username, name: profile.username },
    via,
  });
  return { connected: 'pinterest' };
}

async function completeGoogle(db, wsId, t, { via = 'own' } = {}) {
  const auth = { headers: { Authorization: `Bearer ${t.access_token}` } };
  const p = (await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', auth)).data;
  const profile = { id: p.id, name: p.name, email: p.email, picture: p.picture };
  // Every location this login manages (the first account is often a personal one with none)
  let locations = [];
  let googleBusinessError = null;
  try {
    locations = await require('./googleBusiness').listLocations(t.access_token);
  } catch (err) { googleBusinessError = err.message; }
  const expires_at = now() + (t.expires_in || 3600);
  const repo = repoFor(db);
  await repo.add(wsId, { platform: 'google', external_id: p.id, access_token: t.access_token, refresh_token: t.refresh_token, expires_at, profile, via });
  if (locations.length) {
    // One location: post there. Several: the person chooses on the Google Business card.
    const only = locations.length === 1 ? locations[0] : null;
    // One Google Business row per workspace (older versions keyed it by account name)
    await db('social_accounts').where({ workspace_id: wsId, platform: 'google_business' }).whereNot({ external_id: p.id }).del();
    await repo.add(wsId, {
      platform: 'google_business', external_id: p.id, access_token: t.access_token, refresh_token: t.refresh_token,
      expires_at, page_id: (only || locations[0]).account, board_id: only ? only.location : null,
      profile: { id: p.id, name: profile.name, email: profile.email, location_title: only ? only.title : null, location_count: locations.length },
      via,
    });
  }
  return {
    connected: 'google',
    googleBusinessMissing: !locations.length,
    googleBusinessError,
    selectLocation: locations.length > 1,
  };
}

async function completeThreads(db, wsId, t, { via = 'radixile' } = {}) {
  const me = (await axios.get('https://graph.threads.net/v1.0/me', { params: { fields: 'id,username,name,threads_profile_picture_url', access_token: t.access_token } })).data;
  await repoFor(db).add(wsId, {
    platform: 'threads', external_id: me.id, access_token: t.access_token,
    expires_at: now() + (t.expires_in || 60 * 86400),
    profile: { id: me.id, name: me.name || me.username, handle: me.username, picture: me.threads_profile_picture_url || null },
    via,
  });
  return { connected: 'threads' };
}

const COMPLETE = { linkedin: completeLinkedIn, facebook: completeFacebook, instagram: completeFacebook, pinterest: completePinterest, google_business: completeGoogle, google: completeGoogle, threads: completeThreads };

module.exports = { completeLinkedIn, completeFacebook, completePinterest, completeGoogle, completeThreads, COMPLETE };
