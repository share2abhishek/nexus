const express = require('express');
const router = express.Router();
const axios = require('axios');

const knexInstance = require('../services/knex');
const socialAccountsRepo = require('../repos/socialAccountsRepo')(knexInstance);

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildOAuthUrl(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

function workspaceId(req) {
  return req.session?.activeWorkspaceId ?? null;
}

function emptyStatus() {
  const platforms = ['linkedin', 'facebook', 'instagram', 'pinterest', 'twitter', 'youtube', 'google_business', 'tiktok'];
  const status = {};
  for (const p of platforms) status[p] = { connected: false };
  return status;
}

// ── Status ────────────────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const wsId = workspaceId(req);
    if (!wsId) return res.json(emptyStatus());

    const connected = await socialAccountsRepo.list(wsId);
    const platforms = ['linkedin', 'facebook', 'instagram', 'pinterest', 'twitter', 'youtube', 'google_business', 'tiktok'];
    const status = {};

    for (const p of platforms) {
      const token = connected.find(t => t.platform === p);
      status[p] = token
        ? { connected: true, profile: token.profile, since: token.created_at, page_id: token.page_id, board_id: token.board_id, ig_account_id: token.ig_account_id }
        : { connected: false };
    }

    res.json(status);
  } catch (err) {
    console.error('[Auth] Status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── LinkedIn OAuth ────────────────────────────────────────────────────────────

router.get('/linkedin', (req, res) => {
  if (!process.env.LINKEDIN_CLIENT_ID) {
    return res.status(400).json({ error: 'LINKEDIN_CLIENT_ID not configured in .env' });
  }
  const url = buildOAuthUrl('https://www.linkedin.com/oauth/v2/authorization', {
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: process.env.LINKEDIN_CALLBACK_URL,
    scope: 'r_liteprofile r_emailaddress w_member_social',
    state: 'nexus-linkedin',
  });
  res.redirect(url);
});

router.get('/linkedin/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=linkedin_denied');

  const wsId = workspaceId(req);
  if (!wsId) return res.redirect('/?error=no_active_workspace');

  try {
    const tokenRes = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
      params: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.LINKEDIN_CALLBACK_URL,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET,
      },
    });

    const { access_token, expires_in } = tokenRes.data;
    const profileRes = await axios.get('https://api.linkedin.com/v2/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const nameRes = await axios.get(
      'https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    await socialAccountsRepo.add(wsId, {
      platform: 'linkedin',
      external_id: profileRes.data.id,
      access_token,
      expires_at: Math.floor(Date.now() / 1000) + expires_in,
      profile: {
        id: profileRes.data.id,
        name: `${nameRes.data.localizedFirstName} ${nameRes.data.localizedLastName}`,
      },
    });

    res.redirect('/?connected=linkedin');
  } catch (err) {
    console.error('[Auth] LinkedIn error:', err.response?.data || err.message);
    res.redirect('/?error=linkedin_failed');
  }
});

// ── Facebook + Instagram OAuth ────────────────────────────────────────────────

router.get('/facebook', (req, res) => {
  if (!process.env.FACEBOOK_APP_ID) {
    return res.status(400).json({ error: 'FACEBOOK_APP_ID not configured in .env' });
  }
  const url = buildOAuthUrl('https://www.facebook.com/v18.0/dialog/oauth', {
    client_id: process.env.FACEBOOK_APP_ID,
    redirect_uri: process.env.FACEBOOK_CALLBACK_URL,
    scope: 'public_profile,email,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_content_publish',
    state: 'nexus-facebook',
  });
  res.redirect(url);
});

router.get('/facebook/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=facebook_denied');

  const wsId = workspaceId(req);
  if (!wsId) return res.redirect('/?error=no_active_workspace');

  try {
    const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: process.env.FACEBOOK_CALLBACK_URL,
        code,
      },
    });

    const { access_token } = tokenRes.data;

    const profileRes = await axios.get('https://graph.facebook.com/v18.0/me', {
      params: { fields: 'id,name,picture', access_token },
    });

    // Get pages
    const pagesRes = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token },
    });

    const pages = pagesRes.data.data || [];
    const firstPage = pages[0];

    let igAccountId = null;
    if (firstPage) {
      try {
        const igRes = await axios.get(`https://graph.facebook.com/v18.0/${firstPage.id}`, {
          params: { fields: 'instagram_business_account', access_token: firstPage.access_token },
        });
        igAccountId = igRes.data.instagram_business_account?.id || null;
      } catch {}
    }

    await socialAccountsRepo.add(wsId, {
      platform: 'facebook',
      external_id: profileRes.data.id,
      access_token,
      page_id: firstPage?.id || null,
      page_token: firstPage?.access_token || null,
      profile: { id: profileRes.data.id, name: profileRes.data.name },
    });

    if (igAccountId) {
      await socialAccountsRepo.add(wsId, {
        platform: 'instagram',
        external_id: igAccountId,
        access_token,
        page_token: firstPage?.access_token,
        ig_account_id: igAccountId,
        profile: { id: igAccountId, name: `${profileRes.data.name} (Instagram)` },
      });
    }

    res.redirect('/?connected=facebook');
  } catch (err) {
    console.error('[Auth] Facebook error:', err.response?.data || err.message);
    res.redirect('/?error=facebook_failed');
  }
});

// ── Pinterest OAuth ───────────────────────────────────────────────────────────

router.get('/pinterest', (req, res) => {
  if (!process.env.PINTEREST_APP_ID) {
    return res.status(400).json({ error: 'PINTEREST_APP_ID not configured in .env' });
  }
  const url = buildOAuthUrl('https://www.pinterest.com/oauth/', {
    client_id: process.env.PINTEREST_APP_ID,
    redirect_uri: process.env.PINTEREST_CALLBACK_URL,
    response_type: 'code',
    scope: 'boards:read,pins:write,user_accounts:read',
    state: 'nexus-pinterest',
  });
  res.redirect(url);
});

router.get('/pinterest/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=pinterest_denied');

  const wsId = workspaceId(req);
  if (!wsId) return res.redirect('/?error=no_active_workspace');

  try {
    const tokenRes = await axios.post('https://api.pinterest.com/v5/oauth/token',
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: process.env.PINTEREST_CALLBACK_URL }),
      {
        auth: { username: process.env.PINTEREST_APP_ID, password: process.env.PINTEREST_APP_SECRET },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const { access_token } = tokenRes.data;

    const profileRes = await axios.get('https://api.pinterest.com/v5/user_account', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    // Get first board
    const boardsRes = await axios.get('https://api.pinterest.com/v5/boards', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const firstBoard = boardsRes.data.items?.[0];

    await socialAccountsRepo.add(wsId, {
      platform: 'pinterest',
      external_id: profileRes.data.username,
      access_token,
      board_id: firstBoard?.id || null,
      profile: { id: profileRes.data.username, name: profileRes.data.username },
    });

    res.redirect('/?connected=pinterest');
  } catch (err) {
    console.error('[Auth] Pinterest error:', err.response?.data || err.message);
    res.redirect('/?error=pinterest_failed');
  }
});

// ── Twitter / X OAuth ─────────────────────────────────────────────────────────

router.get('/twitter', (req, res) => {
  if (!process.env.TWITTER_API_KEY) {
    return res.status(400).json({ error: 'TWITTER_API_KEY not configured in .env' });
  }
  // Using OAuth 1.0a flow
  const OAuth = require('oauth').OAuth;
  const oa = new OAuth(
    'https://api.twitter.com/oauth/request_token',
    'https://api.twitter.com/oauth/access_token',
    process.env.TWITTER_API_KEY,
    process.env.TWITTER_API_SECRET,
    '1.0A',
    process.env.TWITTER_CALLBACK_URL,
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

  const wsId = workspaceId(req);
  if (!wsId) return res.redirect('/?error=no_active_workspace');

  try {
    const OAuth = require('oauth').OAuth;
    const oa = new OAuth(
      'https://api.twitter.com/oauth/request_token',
      'https://api.twitter.com/oauth/access_token',
      process.env.TWITTER_API_KEY,
      process.env.TWITTER_API_SECRET,
      '1.0A',
      process.env.TWITTER_CALLBACK_URL,
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

router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID) {
    return res.status(400).json({ error: 'GOOGLE_OAUTH_CLIENT_ID not configured in .env' });
  }
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/business.manage',
  ].join(' ');

  const url = buildOAuthUrl('https://accounts.google.com/o/oauth2/v2/auth', {
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback',
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    state: 'nexus-google',
  });
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=google_denied');

  const wsId = workspaceId(req);
  if (!wsId) return res.redirect('/?error=no_active_workspace');

  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback',
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const profile = { id: profileRes.data.id, name: profileRes.data.name, email: profileRes.data.email, picture: profileRes.data.picture };

    // Try to get YouTube channel info
    let youtubeChannelId = null;
    let youtubeChannelTitle = null;
    try {
      const ytRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'snippet', mine: true },
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const channel = ytRes.data.items?.[0];
      if (channel) {
        youtubeChannelId = channel.id;
        youtubeChannelTitle = channel.snippet?.title;
      }
    } catch {}

    // Try to get Google Business Profile account
    let gmbAccountName = null;
    try {
      const gmbRes = await axios.get('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      gmbAccountName = gmbRes.data.accounts?.[0]?.name || null;
    } catch {}

    await socialAccountsRepo.add(wsId, {
      platform: 'google',
      external_id: profileRes.data.id,
      access_token,
      refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (expires_in || 3600),
      profile,
    });

    if (youtubeChannelId) {
      await socialAccountsRepo.add(wsId, {
        platform: 'youtube',
        external_id: youtubeChannelId,
        access_token,
        refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (expires_in || 3600),
        profile: { id: youtubeChannelId, name: youtubeChannelTitle || profile.name },
        page_id: youtubeChannelId,
      });
    }

    if (gmbAccountName) {
      await socialAccountsRepo.add(wsId, {
        platform: 'google_business',
        external_id: gmbAccountName,
        access_token,
        refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (expires_in || 3600),
        profile: { id: gmbAccountName, name: profile.name },
        page_id: gmbAccountName,
      });
    }

    res.redirect('/?connected=google');
  } catch (err) {
    console.error('[Auth] Google error:', err.response?.data || err.message);
    res.redirect('/?error=google_failed');
  }
});

// ── TikTok OAuth ──────────────────────────────────────────────────────────────

router.get('/tiktok', (req, res) => {
  if (!process.env.TIKTOK_CLIENT_KEY) {
    return res.status(400).json({ error: 'TIKTOK_CLIENT_KEY not configured in .env' });
  }
  const url = buildOAuthUrl('https://www.tiktok.com/v2/auth/authorize/', {
    client_key: process.env.TIKTOK_CLIENT_KEY,
    response_type: 'code',
    scope: 'user.info.basic,video.publish,video.upload',
    redirect_uri: process.env.TIKTOK_CALLBACK_URL || 'http://localhost:3000/auth/tiktok/callback',
    state: 'nexus-tiktok',
  });
  res.redirect(url);
});

router.get('/tiktok/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=tiktok_denied');

  const wsId = workspaceId(req);
  if (!wsId) return res.redirect('/?error=no_active_workspace');

  try {
    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.TIKTOK_CALLBACK_URL || 'http://localhost:3000/auth/tiktok/callback',
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

// ── Disconnect ────────────────────────────────────────────────────────────────

router.post('/disconnect/:platform', async (req, res) => {
  const { platform } = req.params;
  const wsId = workspaceId(req);
  if (!wsId) return res.status(401).json({ error: 'No active workspace' });

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
  if (!access_token) return res.status(400).json({ error: 'access_token is required' });

  const wsId = workspaceId(req);
  if (!wsId) return res.status(401).json({ error: 'No active workspace' });

  try {
    let profile = { id: 'manual', name: 'Manual Token' };
    let igAccountId = null;

    if (platform === 'facebook') {
      // Verify token and get profile
      try {
        const me = await axios.get('https://graph.facebook.com/v18.0/me', {
          params: { fields: 'id,name,picture', access_token },
        });
        profile = { id: me.data.id, name: me.data.name };

        // Auto-fetch pages if no page_id provided
        if (!page_id) {
          const pages = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
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
              const igRes = await axios.get(`https://graph.facebook.com/v18.0/${firstPage.id}`, {
                params: { fields: 'instagram_business_account', access_token: firstPage.access_token },
              });
              igAccountId = igRes.data.instagram_business_account?.id;
              if (igAccountId) {
                await socialAccountsRepo.add(wsId, {
                  platform: 'instagram',
                  external_id: igAccountId,
                  access_token,
                  page_token: firstPage.access_token,
                  ig_account_id: igAccountId,
                  profile: { id: igAccountId, name: `${profile.name} (Instagram)` },
                });
              }
            } catch {}

            return res.json({ success: true, platform, profile, page_id: firstPage.id, instagram_detected: !!igAccountId });
          }
        }
      } catch (err) {
        console.error('[Manual Token] Verification failed:', err.message);
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

router.get('/facebook/pages', async (req, res) => {
  const wsId = workspaceId(req);
  if (!wsId) return res.status(401).json({ error: 'No active workspace' });

  const token = await socialAccountsRepo.getByPlatform(wsId, 'facebook');
  if (!token) return res.status(401).json({ error: 'Facebook not connected' });

  try {
    const pagesRes = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token: token.access_token },
    });
    res.json(pagesRes.data.data || []);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

router.post('/facebook/set-page', async (req, res) => {
  const { page_id, page_token } = req.body;
  const wsId = workspaceId(req);
  if (!wsId) return res.status(401).json({ error: 'No active workspace' });

  const token = await socialAccountsRepo.getByPlatform(wsId, 'facebook');
  if (!token) return res.status(401).json({ error: 'Facebook not connected' });

  try {
    // Parse profile_json so add() can re-serialize it correctly
    let profile = null;
    if (token.profile_json) {
      try { profile = JSON.parse(token.profile_json); } catch {}
    }
    await socialAccountsRepo.add(wsId, {
      platform: token.platform,
      external_id: token.external_id,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: token.expires_at,
      profile,
      page_id,
      page_token,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
