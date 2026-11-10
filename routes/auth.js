const express = require('express');
const router = express.Router();
const axios = require('axios');
const { GRAPH, FB_DIALOG } = require('../services/platforms/apiVersions');
const crypto = require('crypto');

const knexInstance = require('../services/knex');
const socialAccountsRepo = require('../repos/socialAccountsRepo')(knexInstance);
const membershipsRepo = require('../repos/membershipsRepo')(knexInstance);
const { can } = require('../services/rbac');
const { callbackUrl } = require('../services/platforms/callback');
const { PUBLISHABLE } = require('../services/platforms/available');
const { reconnectInDays } = require('../services/tokenRefresher');
const connectAccounts = require('../services/platforms/connectAccounts');

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildOAuthUrl(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

// OAuth CSRF protection: a random, single-use state per platform, kept in the session
// for 10 minutes. The callback must present the same value or it is rejected.
const STATE_TTL_MS = 10 * 60 * 1000;

// The state also remembers WHICH workspace started the sign-in, so switching
// workspace in another tab can't attach the account to the wrong client.
// `extra`: anything the callback needs to know about how sign-in started
function issueState(req, platform, wsId, extra = {}) {
  const state = crypto.randomBytes(24).toString('hex');
  if (req.session) {
    req.session.oauthStates = req.session.oauthStates || {};
    req.session.oauthStates[platform] = { ...extra, state, wsId, expires: Date.now() + STATE_TTL_MS };
  }
  return state;
}

// Where each platform's Connect button starts sign-in (Instagram signs in through
// Facebook; YouTube and Google Business through Google). Same as routes/config.js.
const OAUTH_URL = {
  instagram: '/auth/facebook?instagram=1',
  youtube: '/auth/google',
  google_business: '/auth/google',
};
const oauthUrl = (platform) => OAUTH_URL[platform] || `/auth/${platform}`;

// Returns the saved record ({ wsId, ... }) when the state is valid, otherwise null
function consumeState(req, platform) {
  const saved = req.session?.oauthStates?.[platform];
  if (saved) delete req.session.oauthStates[platform];
  const given = String(req.query.state || '');
  if (!saved || !given || saved.expires < Date.now()) return null;
  const a = Buffer.from(saved.state);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? saved : null;
}

// The workspace this request acts on — only if the user is a member with the
// needed permission. `preferred` (e.g. from the OAuth state) must also pass.
async function workspaceId(req, permission = 'social.manage', preferred = null) {
  const userId = req.session?.userId;
  if (!userId) return null;
  try {
    let wsId = preferred || req.session?.activeWorkspaceId || null;
    if (!wsId) {
      const workspaceHelper = require('../services/workspaceHelper');
      wsId = await workspaceHelper.ensureDefaultWorkspace(userId);
      if (wsId && req.session) req.session.activeWorkspaceId = wsId;
    }
    const role = wsId ? await membershipsRepo.roleFor(userId, wsId) : null;
    if (!role) {
      // Stale or forged session value: forget it
      if (req.session && req.session.activeWorkspaceId === wsId) delete req.session.activeWorkspaceId;
      return null;
    }
    return can(role, permission) ? wsId : null;
  } catch (err) {
    console.error('[Auth] Failed to resolve workspaceId:', err.message);
    return null;
  }
}

function emptyStatus() {
  const platforms = PUBLISHABLE;
  const status = {};
  for (const p of platforms) status[p] = { connected: false };
  return status;
}

// ── Status ────────────────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const wsId = await workspaceId(req, 'content.view');
    if (!wsId) return res.json(emptyStatus());

    const connected = await socialAccountsRepo.list(wsId);
    const platforms = PUBLISHABLE;
    const status = {};

    for (const p of platforms) {
      const token = connected.find(t => t.platform === p && t.usable);
      status[p] = token
        ? { connected: true, profile: token.profile, since: token.created_at, page_id: token.page_id, board_id: token.board_id, ig_account_id: token.ig_account_id, reconnect_in_days: reconnectInDays(token) }
        : { connected: false, ...(connected.some(t => t.platform === p) ? { needs_reconnect: true } : {}) };
    }

    res.json(status);
  } catch (err) {
    console.error('[Auth] Status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── LinkedIn OAuth ────────────────────────────────────────────────────────────

router.get('/linkedin', async (req, res) => {
  const startWs = await workspaceId(req);
  if (!startWs) return res.redirect('/?error=not_allowed');
  if (!process.env.LINKEDIN_CLIENT_ID) {
    // Browser navigation, not an API call: send the user back with a readable message
    return res.redirect('/?error=not_configured&platform=linkedin');
  }
  const url = buildOAuthUrl('https://www.linkedin.com/oauth/v2/authorization', {
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: callbackUrl('linkedin'),
    scope: 'openid profile w_member_social',
    state: issueState(req, 'linkedin', startWs),
  });
  res.redirect(url);
});

router.get('/linkedin/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=linkedin_denied');
  const savedState = consumeState(req, 'linkedin');
  if (!savedState) return res.redirect('/?error=oauth_state_invalid');

  const wsId = await workspaceId(req, 'social.manage', savedState.wsId);
  if (!wsId) return res.redirect('/?error=not_allowed');

  try {
    const tokenRes = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
      params: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl('linkedin'),
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET,
      },
    });

    await connectAccounts.completeLinkedIn(knexInstance, wsId, tokenRes.data);
    res.redirect('/?connected=linkedin');
  } catch (err) {
    console.error('[Auth] LinkedIn error:', err.response?.data || err.message);
    res.redirect('/?error=linkedin_failed');
  }
});

// ── Facebook + Instagram OAuth ────────────────────────────────────────────────

router.get('/facebook', async (req, res) => {
  const startWs = await workspaceId(req);
  if (!startWs) return res.redirect('/?error=not_allowed');
  if (!process.env.FACEBOOK_APP_ID) {
    // Browser navigation, not an API call: send the user back with a readable message
    return res.redirect('/?error=not_configured&platform=facebook');
  }
  const url = buildOAuthUrl(FB_DIALOG, {
    client_id: process.env.FACEBOOK_APP_ID,
    redirect_uri: callbackUrl('facebook'),
    // Instagram permissions only when connecting Instagram (?instagram=1): Facebook
    // rejects the whole sign-in ("Invalid Scopes") if the Facebook app has no
    // Instagram product, which would also block plain Facebook Page posting.
    // read_insights: reach numbers in Analytics; pages_manage_engagement: first comment
    scope: 'public_profile,email,pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_posts,pages_manage_engagement,read_insights,business_management' +
      (req.query.instagram === '1' ? ',instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights' : ''),
    state: issueState(req, 'facebook', startWs, { instagram: req.query.instagram === '1' }),
  });
  res.redirect(url);
});

router.get('/facebook/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=facebook_denied');
  const savedState = consumeState(req, 'facebook');
  if (!savedState) return res.redirect('/?error=oauth_state_invalid');

  const wsId = await workspaceId(req, 'social.manage', savedState.wsId);
  if (!wsId) return res.redirect('/?error=not_allowed');

  try {
    const tokenRes = await axios.get(`${GRAPH}/oauth/access_token`, {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: callbackUrl('facebook'),
        code,
      },
    });

    // Swap the 1-2 hour login for a 60-day one. Page tokens taken from a long-lived
    // login don't expire, so posts scheduled days ahead still go out.
    let access_token = tokenRes.data.access_token;
    try {
      const longRes = await axios.get(`${GRAPH}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: process.env.FACEBOOK_APP_ID,
          client_secret: process.env.FACEBOOK_APP_SECRET,
          fb_exchange_token: access_token,
        },
      });
      if (longRes.data?.access_token) access_token = longRes.data.access_token;
    } catch (err) {
      console.warn('[Auth] Facebook long-lived login not available, using the short one:', err.response?.data?.error?.message || err.message);
    }

    const done = await connectAccounts.completeFacebook(knexInstance, wsId, { access_token }, { instagram: !!savedState.instagram });

    if (done.selectPage) return res.redirect(`/?connected=facebook&select_page=1${savedState.instagram ? '&instagram=1' : ''}`);
    if (done.instagramMissing) return res.redirect('/?connected=facebook&error=instagram_not_found');
    res.redirect(savedState.instagram ? '/?connected=instagram' : '/?connected=facebook');
  } catch (err) {
    console.error('[Auth] Facebook error:', err.response?.data || err.message);
    res.redirect('/?error=facebook_failed');
  }
});

// ── Pinterest OAuth ───────────────────────────────────────────────────────────

router.get('/pinterest', async (req, res) => {
  const startWs = await workspaceId(req);
  if (!startWs) return res.redirect('/?error=not_allowed');
  if (!process.env.PINTEREST_APP_ID) {
    // Browser navigation, not an API call: send the user back with a readable message
    return res.redirect('/?error=not_configured&platform=pinterest');
  }
  const url = buildOAuthUrl('https://www.pinterest.com/oauth/', {
    client_id: process.env.PINTEREST_APP_ID,
    redirect_uri: callbackUrl('pinterest'),
    response_type: 'code',
    scope: 'boards:read,pins:write,user_accounts:read',
    state: issueState(req, 'pinterest', startWs),
  });
  res.redirect(url);
});

router.get('/pinterest/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=pinterest_denied');
  const savedState = consumeState(req, 'pinterest');
  if (!savedState) return res.redirect('/?error=oauth_state_invalid');

  const wsId = await workspaceId(req, 'social.manage', savedState.wsId);
  if (!wsId) return res.redirect('/?error=not_allowed');

  try {
    const tokenRes = await axios.post('https://api.pinterest.com/v5/oauth/token',
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl('pinterest') }),
      {
        auth: { username: process.env.PINTEREST_APP_ID, password: process.env.PINTEREST_APP_SECRET },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    await connectAccounts.completePinterest(knexInstance, wsId, tokenRes.data);

    res.redirect('/?connected=pinterest');
  } catch (err) {
    console.error('[Auth] Pinterest error:', err.response?.data || err.message);
    res.redirect('/?error=pinterest_failed');
  }
});

// ── Twitter / X OAuth ─────────────────────────────────────────────────────────

router.get('/twitter', async (req, res) => {
  if (!(await workspaceId(req))) return res.redirect('/?error=not_allowed');
  if (!process.env.TWITTER_API_KEY) {
    // Browser navigation, not an API call: send the user back with a readable message
    return res.redirect('/?error=not_configured&platform=twitter');
  }
  // Using OAuth 1.0a flow
  const OAuth = require('oauth').OAuth;
  const oa = new OAuth(
    'https://api.twitter.com/oauth/request_token',
    'https://api.twitter.com/oauth/access_token',
    process.env.TWITTER_API_KEY,
    process.env.TWITTER_API_SECRET,
    '1.0A',
    callbackUrl('twitter'),
    'HMAC-SHA1'
  );

  oa.getOAuthRequestToken((err, oauthToken, oauthTokenSecret) => {
    if (err) {
      console.error('[Auth] Twitter request token error:', err);
      return res.redirect('/?error=twitter_failed');
    }
    req.session.twitterOauthTokenSecret = oauthTokenSecret;
    res.redirect(`https://api.twitter.com/oauth/authenticate?oauth_token=${oauthToken}`);
  });
});

router.get('/twitter/callback', async (req, res) => {
  const { oauth_token, oauth_verifier, denied } = req.query;
  if (denied || !oauth_token) return res.redirect('/?error=twitter_denied');

  const wsId = await workspaceId(req);
  if (!wsId) return res.redirect('/?error=no_active_workspace');

  try {
    const OAuth = require('oauth').OAuth;
    const oa = new OAuth(
      'https://api.twitter.com/oauth/request_token',
      'https://api.twitter.com/oauth/access_token',
      process.env.TWITTER_API_KEY,
      process.env.TWITTER_API_SECRET,
      '1.0A',
      callbackUrl('twitter'),
      'HMAC-SHA1'
    );

    oa.getOAuthAccessToken(
      oauth_token,
      req.session.twitterOauthTokenSecret,
      oauth_verifier,
      async (err, accessToken, accessTokenSecret, results) => {
        if (err) {
          console.error('[Auth] Twitter access token error:', err);
          return res.redirect('/?error=twitter_failed');
        }

        try {
          await socialAccountsRepo.add(wsId, {
            platform: 'twitter',
            external_id: results.user_id,
            access_token: accessToken,
            refresh_token: accessTokenSecret,
            profile: { id: results.user_id, name: results.screen_name },
          });
        } catch (saveErr) {
          console.error('[Auth] Twitter save error:', saveErr.message);
        }

        res.redirect('/?connected=twitter');
      }
    );
  } catch (err) {
    console.error('[Auth] Twitter error:', err.message);
    res.redirect('/?error=twitter_failed');
  }
});

// ── Google OAuth (YouTube + Google Business Profile) ─────────────────────────

router.get('/google', async (req, res) => {
  const startWs = await workspaceId(req);
  if (!startWs) return res.redirect('/?error=not_allowed');
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID) {
    // Browser navigation, not an API call: send the user back with a readable message
    return res.redirect('/?error=not_configured&platform=google');
  }
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/business.manage',
  ].join(' ');

  const url = buildOAuthUrl('https://accounts.google.com/o/oauth2/v2/auth', {
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: callbackUrl('google'),
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    state: issueState(req, 'google', startWs),
  });
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=google_denied');
  const savedState = consumeState(req, 'google');
  if (!savedState) return res.redirect('/?error=oauth_state_invalid');

  const wsId = await workspaceId(req, 'social.manage', savedState.wsId);
  if (!wsId) return res.redirect('/?error=not_allowed');

  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: callbackUrl('google'),
      grant_type: 'authorization_code',
    });

    await connectAccounts.completeGoogle(knexInstance, wsId, tokenRes.data);

    res.redirect('/?connected=google');
  } catch (err) {
    console.error('[Auth] Google error:', err.response?.data || err.message);
    res.redirect('/?error=google_failed');
  }
});

// ── TikTok OAuth ──────────────────────────────────────────────────────────────

router.get('/tiktok', async (req, res) => {
  if (!require('../services/platforms/available').isPublishable('tiktok')) return res.redirect('/?error=not_available&platform=tiktok');
  const startWs = await workspaceId(req);
  if (!startWs) return res.redirect('/?error=not_allowed');
  if (!process.env.TIKTOK_CLIENT_KEY) {
    // Browser navigation, not an API call: send the user back with a readable message
    return res.redirect('/?error=not_configured&platform=tiktok');
  }
  const url = buildOAuthUrl('https://www.tiktok.com/v2/auth/authorize/', {
    client_key: process.env.TIKTOK_CLIENT_KEY,
    response_type: 'code',
    scope: 'user.info.basic,video.publish,video.upload',
    redirect_uri: callbackUrl('tiktok'),
    state: issueState(req, 'tiktok', startWs),
  });
  res.redirect(url);
});

router.get('/tiktok/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=tiktok_denied');
  const savedState = consumeState(req, 'tiktok');
  if (!savedState) return res.redirect('/?error=oauth_state_invalid');

  const wsId = await workspaceId(req, 'social.manage', savedState.wsId);
  if (!wsId) return res.redirect('/?error=not_allowed');

  try {
    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl('tiktok'),
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { access_token, refresh_token, expires_in, open_id } = tokenRes.data;

    const profileRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      params: { fields: 'display_name,avatar_url' },
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const user = profileRes.data.data?.user || {};

    await socialAccountsRepo.add(wsId, {
      platform: 'tiktok',
      external_id: open_id,
      access_token,
      refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (expires_in || 86400),
      profile: { id: open_id, name: user.display_name || 'TikTok User', picture: user.avatar_url },
    });

    res.redirect('/?connected=tiktok');
  } catch (err) {
    console.error('[Auth] TikTok error:', err.response?.data || err.message);
    res.redirect('/?error=tiktok_failed');
  }
});

// ── One-click connect (Radixile's approved apps) ─────────────────────────────

router.get('/connect/platforms', async (req, res) => {
  res.json({ platforms: await require('../services/connectBroker').platforms() });
});

router.post('/connect/:platform/start', async (req, res) => {
  const wsId = await workspaceId(req, 'social.manage');
  if (!wsId) return res.status(403).json({ error: 'You do not have permission to manage social accounts in this workspace.' });
  try {
    res.json(await require('../services/connectBroker').start({ wsId, platform: req.params.platform }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/connect/session/:id', async (req, res) => {
  const wsId = await workspaceId(req, 'social.manage');
  if (!wsId) return res.status(403).json({ error: 'Not allowed' });
  try {
    res.json(await require('../services/connectBroker').check(knexInstance, req.params.id, wsId));
  } catch (err) {
    console.error('[Auth] One-click connect:', err.response?.data || err.message);
    res.json({ status: 'error', error: 'The account could not be saved. Click Connect to try again.' });
  }
});

// ── Refresh & Trigger Connection ──────────────────────────────────────────────

router.post('/refresh/:platform', async (req, res) => {
  const { platform } = req.params;
  const wsId = await workspaceId(req);
  if (!wsId) return res.status(403).json({ error: 'You do not have permission to manage social accounts in this workspace.' });

  try {
    const token = await socialAccountsRepo.getByPlatform(wsId, platform);

    if (!token || !token.access_token) {
      return res.json({ connected: false, message: `${platform} is not connected. Starting authorization...`, oauth_url: oauthUrl(platform) });
    }
    // The platform already cancelled this sign-in: "Check" must not report it as working
    // (Facebook is re-checked below, which can clear a stale flag)
    if (token.auth_error && platform !== 'facebook') {
      return res.status(400).json({ error: token.auth_error, oauth_url: oauthUrl(platform) });
    }

    // Live verification & auto-healing per platform
    if (platform === 'facebook') {
      const meRes = await axios.get(`${GRAPH}/me`, {
        params: { fields: 'id,name', access_token: token.access_token },
      });
      const pagesRes = await axios.get(`${GRAPH}/me/accounts`, {
        params: { access_token: token.access_token },
      });

      const pages = pagesRes.data.data || [];
      // Only keep the page the user chose; never silently switch to another page
      const selectedPage = pages.find(p => p.id === token.page_id);

      let igAccountId = token.ig_account_id || null;
      if (selectedPage) {
        try {
          const igRes = await axios.get(`${GRAPH}/${selectedPage.id}`, {
            params: { fields: 'instagram_business_account', access_token: selectedPage.access_token },
          });
          igAccountId = igRes.data.instagram_business_account?.id || igAccountId;
        } catch {}
      }

      let profile = token.profile;
      if (!profile && token.profile_json) {
        try { profile = JSON.parse(token.profile_json); } catch {}
      }

      await socialAccountsRepo.add(wsId, {
        platform: 'facebook',
        external_id: meRes.data.id || token.external_id,
        access_token: token.access_token,
        page_id: selectedPage?.id || token.page_id || null,
        page_token: selectedPage?.access_token || token.page_token || null,
        profile: { ...profile, name: meRes.data.name || profile?.name, page_name: selectedPage?.name || profile?.page_name },
      });

      if (igAccountId) {
        await socialAccountsRepo.add(wsId, {
          platform: 'instagram',
          external_id: igAccountId,
          access_token: token.access_token,
          page_token: selectedPage?.access_token || token.page_token,
          page_id: selectedPage?.id || token.page_id || null,
          ig_account_id: igAccountId,
          profile: { id: igAccountId, name: `${meRes.data.name || 'Facebook'} (Instagram)` },
        });
      }

      const healed = await knexInstance('social_accounts').where({ workspace_id: wsId }).whereIn('platform', ['facebook', 'instagram']);
      await Promise.all(healed.map(acc => require('../services/tokenRefresher').checkFacebook(knexInstance, acc)));
      return res.json({ success: true, connected: true, platform, page_id: selectedPage?.id, ig_account_id: igAccountId });
    }

    if (platform === 'linkedin') {
      const me = (await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      })).data;
      return res.json({ success: true, connected: true, platform, profile_id: me.sub });
    }

    if (platform === 'pinterest') {
      const pRes = await axios.get('https://api.pinterest.com/v5/user_account', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      return res.json({ success: true, connected: true, platform, username: pRes.data.username });
    }

    // Default return for other platforms
    return res.json({ success: true, connected: true, platform });

  } catch (err) {
    console.error(`[Auth] Refresh ${platform} error:`, err.response?.data || err.message);
    res.status(400).json({ error: `Connection expired or invalid: ${err.response?.data?.error?.message || err.message}. Please reconnect.`, oauth_url: oauthUrl(platform) });
  }
});

// ── Disconnect ────────────────────────────────────────────────────────────────

router.post('/disconnect/:platform', async (req, res) => {
  const { platform } = req.params;
  const wsId = await workspaceId(req);
  if (!wsId) return res.status(403).json({ error: 'You do not have permission to manage social accounts in this workspace.' });

  try {
    await knexInstance('social_accounts').where({ workspace_id: wsId, platform }).del();
    // Cascade disconnects
    if (platform === 'facebook') {
      await knexInstance('social_accounts').where({ workspace_id: wsId, platform: 'instagram' }).del();
    }
    if (platform === 'google') {
      await knexInstance('social_accounts').where({ workspace_id: wsId, platform: 'youtube' }).del();
      await knexInstance('social_accounts').where({ workspace_id: wsId, platform: 'google_business' }).del();
    }
    res.json({ success: true, platform });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Manual Token Save (for platforms with strict OAuth) ──────────────────────

router.post('/manual-token/:platform', async (req, res) => {
  const { platform } = req.params;
  const { access_token, page_id, page_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'Paste the access token first.' });
  // Only Facebook offers this (Instagram comes with it); other platforms connect by signing in
  if (platform !== 'facebook') return res.status(400).json({ error: 'Pasting a token only works for Facebook. Use Connect for this platform.' });

  const wsId = await workspaceId(req);
  if (!wsId) return res.status(403).json({ error: 'You do not have permission to manage social accounts in this workspace.' });

  try {
    let profile = { id: 'manual', name: 'Manual Token' };
    let igAccountId = null;

    if (platform === 'facebook') {
      // Verify token and get profile
      try {
        const me = await axios.get(`${GRAPH}/me`, {
          params: { fields: 'id,name,picture', access_token },
        });
        profile = { id: me.data.id, name: me.data.name };

        // Auto-fetch pages if no page_id provided
        if (!page_id) {
          const pages = await axios.get(`${GRAPH}/me/accounts`, {
            params: { access_token },
          });
          const firstPage = pages.data.data?.[0];
          if (firstPage) {
            await socialAccountsRepo.add(wsId, {
              platform: 'facebook',
              external_id: profile.id,
              access_token,
              profile,
              page_id: firstPage.id,
              page_token: firstPage.access_token,
            });

            // Check for Instagram
            try {
              const igRes = await axios.get(`${GRAPH}/${firstPage.id}`, {
                params: { fields: 'instagram_business_account', access_token: firstPage.access_token },
              });
              igAccountId = igRes.data.instagram_business_account?.id;
              if (igAccountId) {
                await socialAccountsRepo.add(wsId, {
                  platform: 'instagram',
                  external_id: igAccountId,
                  access_token,
                  page_token: firstPage.access_token,
                  page_id: firstPage.id,
                  ig_account_id: igAccountId,
                  profile: { id: igAccountId, name: `${profile.name} (Instagram)` },
                });
              }
            } catch {}

            return res.json({ success: true, platform, profile, page_id: firstPage.id, instagram_detected: !!igAccountId });
          }
        }
      } catch (err) {
        // Don't save a token Facebook rejects: it would show "Connected" but every post would fail
        console.error('[Manual Token] Verification failed:', err.response?.data?.error?.message || err.message);
        return res.status(400).json({ error: `Facebook didn't accept this token: ${err.response?.data?.error?.message || err.message}. Generate a new one and paste it again.` });
      }

      await socialAccountsRepo.add(wsId, {
        platform: 'facebook',
        external_id: profile.id,
        access_token,
        profile,
        page_id: page_id || null,
        page_token: page_token || null,
      });
    } else {
      await socialAccountsRepo.add(wsId, {
        platform,
        external_id: profile.id,
        access_token,
        profile,
      });
    }

    res.json({ success: true, platform, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Facebook Pages ────────────────────────────────────────────────────────────

// Facebook page listing / selection lives in routes/config.js (/api/config/facebook/*)

module.exports = router;
