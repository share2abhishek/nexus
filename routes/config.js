const express = require('express');
const { callbackUrl } = require('../services/platforms/callback');
const router = express.Router();

// Managing a workspace's social accounts needs the social.manage permission
const { requirePermission } = require('../middleware/tenancy');
const canManageSocial = requirePermission('social.manage');

// Settings stored in .env apply to every user of this install, so only an admin
// may change them. (Per-user AI keys live in /users/settings instead.)
const knexForAdmin = require('../services/knex');
// What each admin-only setting is, so a non-admin is told what to do instead
const ADMIN_ONLY_HINT = {
  platforms: 'Only the admin of this installation can add the app keys for a platform (Client ID and Secret). Ask them to add them in Settings → Social Platforms; then you can click Connect to link your own account.',
  smtp: 'Only the admin of this installation can change the email (SMTP) settings. Ask them to set it up in Settings → Email / SMTP.',
  'ai-keys': 'Only the admin can change the shared AI keys. You can add your own in your profile menu → My API Keys.',
  ollama: 'Only the admin can change the Local AI (Ollama) settings. Ask them, or add your own AI key in your profile menu → My API Keys.',
  'content-folder': 'Only the admin can change the content folder.',
};
async function requireAdmin(req, res, next) {
  const user = await knexForAdmin('users').where({ id: req.session?.userId }).first();
  if (user?.role !== 'admin') {
    const area = req.path.split('/')[1];
    return res.status(403).json({ error: ADMIN_ONLY_HINT[area] || 'Only the admin of this installation can change this setting. Ask your admin.', code: 'ADMIN_ONLY' });
  }
  next();
}
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ── Ollama endpoints ──────────────────────────────────────────────────────────

router.get('/ollama/status', async (req, res) => {
  const base = req.ollamaUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  try {
    const r = await axios.get(`${base}/api/tags`, { timeout: 3000 });
    const models = (r.data.models || []).map(m => ({ name: m.name, size: m.size, modified: m.modified_at }));
    res.json({
      running: true,
      base,
      models,
      enabled: req.ollamaEnabled ?? (process.env.OLLAMA_ENABLED === 'true'),
      current: req.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2'
    });
  } catch (err) {
    console.error('[Ollama status error]', err.message);
    res.json({
      running: false,
      base,
      models: [],
      enabled: req.ollamaEnabled ?? (process.env.OLLAMA_ENABLED === 'true'),
      current: req.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2'
    });
  }
});

router.post('/ollama/enable', requireAdmin, (req, res) => {
  const { enabled, model, base_url } = req.body;
  writeEnvValue('OLLAMA_ENABLED', enabled ? 'true' : 'false');
  if (model) writeEnvValue('OLLAMA_MODEL', model);
  if (base_url) writeEnvValue('OLLAMA_BASE_URL', base_url);
  res.json({ success: true });
});

router.post('/ollama/pull', requireAdmin, async (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'model name required' });
  const base = req.ollamaUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  // Stream pull progress back to client
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const response = await axios.post(`${base}/api/pull`, { name: model }, { responseType: 'stream', timeout: 600000 });
    response.data.on('data', chunk => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {}
      }
    });
    response.data.on('end', () => { res.write('data: {"status":"done"}\n\n'); res.end(); });
    response.data.on('error', () => { res.write('data: {"status":"error"}\n\n'); res.end(); });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ status: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

// Packaged builds run from a read-only asar; Electron points DOTENV_CONFIG_PATH at a writable copy.
const ENV_PATH = process.env.DOTENV_CONFIG_PATH || path.join(__dirname, '..', '.env');

// ── .env read / write helpers ─────────────────────────────────────────────────

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  const result = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    result[key] = val;
  }
  return result;
}

function writeEnvValue(key, value) {
  // A line break in a value would add extra settings to .env (e.g. a fake OAuth
  // callback URL), so refuse it.
  value = String(value ?? '');
  if (/[\r\n]/.test(value) || !/^[A-Z0-9_]+$/.test(key)) throw new Error('Invalid setting value');
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
  process.env[key] = value;
}

function maskSecret(val) {
  if (!val || val.length < 8) return val ? '••••••••' : '';
  return val.slice(0, 4) + '••••••••' + val.slice(-4);
}

// ── GET /api/config/platforms ─────────────────────────────────────────────────

router.get('/platforms', async (req, res) => {
  const env = readEnv();
  const knexInstance = require('../services/knex');
  const socialAccountsRepo = require('../repos/socialAccountsRepo')(knexInstance);

  // Only this workspace's accounts. Legacy global tokens are never copied in here —
  // that leaked one user's accounts into every new workspace.
  let tokens = [];
  try {
    if (req.workspaceId) tokens = await socialAccountsRepo.list(req.workspaceId);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // Only accounts with a login token count as connected; the rest need signing in again
  const tokenMap = {};
  const needsReconnect = new Set();
  tokens.forEach(t => { if (t.usable) tokenMap[t.platform] = t; else needsReconnect.add(t.platform); });

  const platforms = {
    linkedin: {
      label: 'LinkedIn',
      icon: '🔵',
      color: '#0a66c2',
      credentials: [
        { key: 'LINKEDIN_CLIENT_ID',     label: 'Client ID',     type: 'text',     value: env.LINKEDIN_CLIENT_ID     || '' },
        { key: 'LINKEDIN_CLIENT_SECRET', label: 'Client Secret', type: 'password', value: maskSecret(env.LINKEDIN_CLIENT_SECRET) },
        { key: 'LINKEDIN_CALLBACK_URL',  label: 'Callback URL',  type: 'url',      value: callbackUrl('linkedin'), readonly: true },
      ],
      configured: !!(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),
      connected: !!tokenMap.linkedin,
      profile: tokenMap.linkedin?.profile || null,
      since: tokenMap.linkedin?.created_at || null,
      oauth_url: '/auth/linkedin',
      scopes: 'openid, profile, w_member_social (products: "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn")',
      setup_url: 'https://www.linkedin.com/developers/apps',
    },
    facebook: {
      label: 'Facebook + Instagram',
      icon: '📘',
      color: '#1877f2',
      credentials: [
        { key: 'FACEBOOK_APP_ID',       label: 'App ID',       type: 'text',     value: env.FACEBOOK_APP_ID     || '' },
        { key: 'FACEBOOK_APP_SECRET',   label: 'App Secret',   type: 'password', value: maskSecret(env.FACEBOOK_APP_SECRET) },
        { key: 'FACEBOOK_CALLBACK_URL', label: 'Callback URL', type: 'url',      value: callbackUrl('facebook'), readonly: true },
      ],
      configured: !!(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET),
      connected: !!tokenMap.facebook,
      instagram_connected: !!tokenMap.instagram,
      profile: tokenMap.facebook?.profile || null,
      page_id: tokenMap.facebook?.page_id || null,
      ig_account_id: tokenMap.instagram?.ig_account_id || null,
      since: tokenMap.facebook?.created_at || null,
      oauth_url: '/auth/facebook',
      scopes: 'pages_manage_posts, pages_read_engagement, pages_show_list, business_management',
      setup_url: 'https://developers.facebook.com/apps',
    },
    pinterest: {
      label: 'Pinterest',
      icon: '📌',
      color: '#e60023',
      credentials: [
        { key: 'PINTEREST_APP_ID',       label: 'App ID',       type: 'text',     value: env.PINTEREST_APP_ID     || '' },
        { key: 'PINTEREST_APP_SECRET',   label: 'App Secret',   type: 'password', value: maskSecret(env.PINTEREST_APP_SECRET) },
        { key: 'PINTEREST_CALLBACK_URL', label: 'Callback URL', type: 'url',      value: callbackUrl('pinterest'), readonly: true },
      ],
      configured: !!(env.PINTEREST_APP_ID && env.PINTEREST_APP_SECRET),
      connected: !!tokenMap.pinterest,
      profile: tokenMap.pinterest?.profile || null,
      board_id: tokenMap.pinterest?.board_id || null,
      since: tokenMap.pinterest?.created_at || null,
      oauth_url: '/auth/pinterest',
      scopes: 'boards:read, pins:write, user_accounts:read',
      setup_url: 'https://developers.pinterest.com/apps',
    },
    twitter: {
      label: 'Twitter / X',
      icon: '🐦',
      color: '#1d9bf0',
      credentials: [
        { key: 'TWITTER_API_KEY',       label: 'API Key',             type: 'text',     value: env.TWITTER_API_KEY       || '' },
        { key: 'TWITTER_API_SECRET',    label: 'API Secret',          type: 'password', value: maskSecret(env.TWITTER_API_SECRET) },
        { key: 'TWITTER_ACCESS_TOKEN',  label: 'Access Token',        type: 'text',     value: env.TWITTER_ACCESS_TOKEN  || '' },
        { key: 'TWITTER_ACCESS_SECRET', label: 'Access Token Secret', type: 'password', value: maskSecret(env.TWITTER_ACCESS_SECRET) },
        { key: 'TWITTER_CALLBACK_URL',  label: 'Callback URL',        type: 'url',      value: callbackUrl('twitter'), readonly: true },
      ],
      configured: !!(env.TWITTER_API_KEY && env.TWITTER_API_SECRET),
      connected: !!tokenMap.twitter,
      profile: tokenMap.twitter?.profile || null,
      since: tokenMap.twitter?.created_at || null,
      oauth_url: '/auth/twitter',
      scopes: 'Read and write (OAuth 1.0a)',
      setup_url: 'https://developer.x.com/en/portal/dashboard',
    },
    instagram: {
      label: 'Instagram',
      icon: '📸',
      color: '#e1306c',
      note: 'Connect Instagram here (it signs in through Facebook). Needs a Business or Creator account linked to your Facebook Page, and the Instagram product added to your Facebook app.',
      credentials: [],
      configured: !!(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET),
      connected: !!tokenMap.instagram,
      profile: tokenMap.instagram?.profile || null,
      ig_account_id: tokenMap.instagram?.ig_account_id || null,
      since: tokenMap.instagram?.created_at || null,
      oauth_url: '/auth/facebook?instagram=1',
      scopes: 'instagram_basic, instagram_content_publish, business_management',
      setup_url: 'https://developers.facebook.com/apps',
    },
    youtube: {
      label: 'YouTube',
      icon: '▶️',
      color: '#ff0000',
      credentials: [
        { key: 'GOOGLE_OAUTH_CLIENT_ID',     label: 'Google OAuth Client ID',     type: 'text',     value: env.GOOGLE_OAUTH_CLIENT_ID     || '' },
        { key: 'GOOGLE_OAUTH_CLIENT_SECRET', label: 'Google OAuth Client Secret', type: 'password', value: maskSecret(env.GOOGLE_OAUTH_CLIENT_SECRET) },
        { key: 'GOOGLE_CALLBACK_URL',        label: 'Callback URL',               type: 'url',      value: callbackUrl('google'), readonly: true },
      ],
      configured: !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
      connected: !!tokenMap.youtube,
      profile: tokenMap.youtube?.profile || null,
      channel_id: tokenMap.youtube?.page_id || null,
      since: tokenMap.youtube?.created_at || null,
      oauth_url: '/auth/google',
      scopes: 'youtube.force-ssl, youtube.upload',
      setup_url: 'https://console.cloud.google.com/apis/credentials',
      note: 'YouTube can be connected, but posting is not available yet: the public YouTube API cannot create Community posts.',
    },
    google_business: {
      label: 'Google Business',
      icon: '🏢',
      color: '#34a853',
      credentials: [
        { key: 'GOOGLE_OAUTH_CLIENT_ID',     label: 'Google OAuth Client ID',     type: 'text',     value: env.GOOGLE_OAUTH_CLIENT_ID     || '' },
        { key: 'GOOGLE_OAUTH_CLIENT_SECRET', label: 'Google OAuth Client Secret', type: 'password', value: maskSecret(env.GOOGLE_OAUTH_CLIENT_SECRET) },
        { key: 'GOOGLE_CALLBACK_URL',        label: 'Callback URL',               type: 'url',      value: callbackUrl('google'), readonly: true },
      ],
      configured: !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
      connected: !!tokenMap.google_business,
      profile: tokenMap.google_business?.profile || null,
      account_name: tokenMap.google_business?.page_id || null,
      since: tokenMap.google_business?.created_at || null,
      oauth_url: '/auth/google',
      scopes: 'business.manage',
      setup_url: 'https://console.cloud.google.com/apis/credentials',
      note: 'Same Google OAuth app as YouTube. Enable "My Business API" in Google Cloud Console.',
    },
    tiktok: {
      label: 'TikTok',
      icon: '🎵',
      color: '#010101',
      credentials: [
        { key: 'TIKTOK_CLIENT_KEY',    label: 'Client Key',    type: 'text',     value: env.TIKTOK_CLIENT_KEY    || '' },
        { key: 'TIKTOK_CLIENT_SECRET', label: 'Client Secret', type: 'password', value: maskSecret(env.TIKTOK_CLIENT_SECRET) },
        { key: 'TIKTOK_CALLBACK_URL',  label: 'Callback URL',  type: 'url',      value: callbackUrl('tiktok'), readonly: true },
      ],
      configured: !!(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),
      connected: !!tokenMap.tiktok,
      profile: tokenMap.tiktok?.profile || null,
      since: tokenMap.tiktok?.created_at || null,
      oauth_url: '/auth/tiktok',
      scopes: 'user.info.basic, video.publish, video.upload',
      setup_url: 'https://developers.tiktok.com/apps',
      note: 'TikTok posts require a video URL. Text-only posts are not supported.',
    },
  };

  // Step-by-step setup guide for each card, with this PC's exact callback URL
  const { GUIDES } = require('../services/platforms/guides');
  for (const [key, p] of Object.entries(platforms)) {
    const g = GUIDES[key];
    if (!g) continue;
    const cb = p.credentials?.find(c => c.key.endsWith('_CALLBACK_URL'))?.value || '';
    p.guide = { ...g, steps: g.steps.map(st => ({ ...st, copy: st.copy ? st.copy.replace('{callback}', cb) : undefined })) };
  }
  for (const [key, p] of Object.entries(platforms)) {
    if (!p.connected && needsReconnect.has(key)) p.needs_reconnect = true;
  }
  res.json(platforms);
});

// ── POST /api/config/platforms/:platform ─────────────────────────────────────
// Save credentials for a platform (updates .env + process.env live)

router.post('/platforms/:platform', requireAdmin, (req, res) => {
  const allowed = {
    linkedin:        ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_CALLBACK_URL'],
    facebook:        ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_CALLBACK_URL'],
    instagram:       ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_CALLBACK_URL'],
    pinterest:       ['PINTEREST_APP_ID', 'PINTEREST_APP_SECRET', 'PINTEREST_CALLBACK_URL'],
    twitter:         ['TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_SECRET', 'TWITTER_CALLBACK_URL'],
    youtube:         ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'],
    google_business: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'],
    tiktok:          ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_CALLBACK_URL'],
  };

  const keys = allowed[req.params.platform];
  if (!keys) return res.status(400).json({ error: 'Unknown platform' });

  const updates = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (!keys.includes(key)) continue;
    if (!value || value.includes('••••')) continue; // skip masked / empty
    writeEnvValue(key, value);
    updates[key] = true;
  }

  res.json({ success: true, updated: Object.keys(updates) });
});

// ── POST /api/config/ai-keys ──────────────────────────────────────────────────

router.post('/ai-keys', requireAdmin, (req, res) => {
  const { GOOGLE_AI_KEY, ANTHROPIC_API_KEY, DEFAULT_TEXT_MODEL } = req.body;
  if (GOOGLE_AI_KEY && !GOOGLE_AI_KEY.includes('••••'))  writeEnvValue('GOOGLE_AI_KEY', GOOGLE_AI_KEY);
  if (ANTHROPIC_API_KEY && !ANTHROPIC_API_KEY.includes('••••')) writeEnvValue('ANTHROPIC_API_KEY', ANTHROPIC_API_KEY);
  if (DEFAULT_TEXT_MODEL) writeEnvValue('DEFAULT_TEXT_MODEL', DEFAULT_TEXT_MODEL);
  res.json({ success: true });
});

// ── POST /api/config/smtp ─────────────────────────────────────────────────────

// ── Content Folder ────────────────────────────────────────────────────────────

router.post('/content-folder', requireAdmin, (req, res) => {
  const { folder } = req.body;
  if (!folder) return res.status(400).json({ error: 'folder path required' });
  writeEnvValue('CONTENT_FOLDER', folder.replace(/\\/g, '/'));
  res.json({ success: true, folder });
});

router.get('/content-folder', (req, res) => {
  res.json({ folder: process.env.CONTENT_FOLDER || 'D:/social' });
});

router.post('/smtp', requireAdmin, (req, res) => {
  const fields = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME'];
  for (const f of fields) {
    const val = req.body[f];
    if (val && !val.includes('••••')) writeEnvValue(f, val);
  }
  res.json({ success: true });
});

// ── GET /api/config/env-status ────────────────────────────────────────────────
// Returns which keys are configured (no values, just boolean)

router.get('/env-status', (req, res) => {
  const env = readEnv();
  const check = (key) => !!(env[key] && !env[key].includes('your-key-here') && env[key].length > 3);
  res.json({
    google_ai: check('GOOGLE_AI_KEY'),
    anthropic: check('ANTHROPIC_API_KEY'),
    stability: check('STABILITY_API_KEY'),
    openai:    check('OPENAI_API_KEY'),
    luma:      check('LUMA_API_KEY'),
    runway:    check('RUNWAY_API_KEY'),
    smtp:      check('SMTP_HOST') && check('SMTP_USER') && check('SMTP_PASS'),
    linkedin:  check('LINKEDIN_CLIENT_ID'),
    facebook:  check('FACEBOOK_APP_ID'),
    pinterest: check('PINTEREST_APP_ID'),
    twitter:   check('TWITTER_API_KEY'),
    default_text_model: env.DEFAULT_TEXT_MODEL || 'ollama',
  });
});

// ── GET /api/config/facebook/pages ───────────────────────────────────────────

router.get('/facebook/pages', canManageSocial, async (req, res) => {
  const knexInstance = require('../services/knex');
  const socialAccountsRepo = require('../repos/socialAccountsRepo')(knexInstance);
  const token = req.workspaceId ? await socialAccountsRepo.getByPlatform(req.workspaceId, 'facebook') : null;
  if (!token) return res.status(401).json({ error: 'Facebook not connected' });
  try {
    const r = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token: token.access_token, fields: 'id,name,category' },
    });
    // Never send page access tokens to the browser
    res.json((r.data.data || []).map(p => ({ id: p.id, name: p.name, category: p.category })));
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

router.post('/facebook/set-page', canManageSocial, async (req, res) => {
  const { page_id } = req.body;
  const knexInstance = require('../services/knex');
  const socialAccountsRepo = require('../repos/socialAccountsRepo')(knexInstance);
  const token = req.workspaceId ? await socialAccountsRepo.getByPlatform(req.workspaceId, 'facebook') : null;
  if (!token) return res.status(401).json({ error: 'Facebook not connected' });

  // Look the page (and its token) up on Facebook ourselves — the browser only says which page
  let page;
  try {
    const r = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token: token.access_token, fields: 'id,name,access_token' },
    });
    page = (r.data.data || []).find(p => String(p.id) === String(page_id));
  } catch (err) {
    return res.status(502).json({ error: err.response?.data?.error?.message || err.message });
  }
  if (!page) return res.status(400).json({ error: 'That page is not one you manage on Facebook.' });

  let igId = null;
  try {
    const r = await axios.get(`https://graph.facebook.com/v18.0/${page.id}`, {
      params: { fields: 'instagram_business_account', access_token: page.access_token },
    });
    igId = r.data.instagram_business_account?.id || null;
  } catch {}

  let profile = token.profile;
  if (!profile && token.profile_json) {
    try { profile = JSON.parse(token.profile_json); } catch {}
  }

  await socialAccountsRepo.add(req.workspaceId, {
    platform: 'facebook',
    external_id: token.external_id,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: token.expires_at,
    profile: { ...profile, page_name: page.name },
    page_id: page.id,
    page_token: page.access_token,
  });

  // Connect Instagram only if this Facebook sign-in was allowed to post to it
  // (signed in from the Instagram card); otherwise posts to it would fail.
  let canPostToInstagram = false;
  if (igId) {
    try {
      const r = await axios.get('https://graph.facebook.com/v18.0/me/permissions', { params: { access_token: token.access_token } });
      canPostToInstagram = (r.data.data || []).some(p => p.permission === 'instagram_content_publish' && p.status === 'granted');
    } catch {}
  }

  if (igId && canPostToInstagram) {
    await socialAccountsRepo.add(req.workspaceId, {
      platform: 'instagram',
      external_id: igId,
      access_token: token.access_token,
      page_token: page.access_token,
      ig_account_id: igId,
      profile: { id: igId, name: `${page.name} (Instagram)` },
    });
  }

  res.json({ success: true, page_id: page.id, instagram_detected: !!igId, instagram_connected: !!(igId && canPostToInstagram) });
});

// ── GET /api/config/pinterest/boards ─────────────────────────────────────────

router.get('/pinterest/boards', canManageSocial, async (req, res) => {
  const knexInstance = require('../services/knex');
  const socialAccountsRepo = require('../repos/socialAccountsRepo')(knexInstance);
  const token = req.workspaceId ? await socialAccountsRepo.getByPlatform(req.workspaceId, 'pinterest') : null;
  if (!token) return res.status(401).json({ error: 'Pinterest not connected' });
  try {
    const r = await axios.get('https://api.pinterest.com/v5/boards', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    res.json(r.data.items || []);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

router.post('/pinterest/set-board', canManageSocial, async (req, res) => {
  const { board_id, board_name } = req.body;
  const knexInstance = require('../services/knex');
  const socialAccountsRepo = require('../repos/socialAccountsRepo')(knexInstance);
  const token = req.workspaceId ? await socialAccountsRepo.getByPlatform(req.workspaceId, 'pinterest') : null;
  if (!token) return res.status(401).json({ error: 'Pinterest not connected' });

  let profile = token.profile;
  if (!profile && token.profile_json) {
    try { profile = JSON.parse(token.profile_json); } catch {}
  }

  await socialAccountsRepo.add(req.workspaceId, {
    platform: token.platform,
    external_id: token.external_id,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: token.expires_at,
    profile: { ...profile, board_name },
    board_id,
  });

  res.json({ success: true });
});

module.exports = router;
