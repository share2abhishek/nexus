const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const knexInstance = require('../services/knex');
const usersRepo    = require('../repos/usersRepo')(knexInstance);

// ── Admin guard ───────────────────────────────────────────────────────────────

async function requireAdmin(req, res, next) {
  const user = await usersRepo.findById(req.userId);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

router.use(requireAuth, requireAdmin);

// ── Admin create user directly ────────────────────────────────────────────────

router.post('/users/create', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { email, password, name, role = 'user' } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  try {
    // Edition limit on user accounts, same rule as registration
    const { withinLimit, limitMessage } = require('../middleware/license');
    const [{ c }] = await knexInstance('users').count('id as c');
    if (!withinLimit('users', parseInt(c, 10))) return res.status(402).json({ error: limitMessage('users'), code: 'LICENSE_LIMIT' });
    const hash = await bcrypt.hash(password, 10);
    const safeRole = ['admin', 'user'].includes(role) ? role : 'user';
    const rows = await knexInstance('users').insert({
      email: email.toLowerCase().trim(), password_hash: hash, name: name?.trim() || null, role: safeRole,
    }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    res.json({ success: true, id, email, role: safeRole });
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('unique')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ── Admin reset user password ─────────────────────────────────────────────────

router.patch('/users/:id/password', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const hash = await bcrypt.hash(password, 10);
  await knexInstance('users').where({ id: parseInt(req.params.id) }).update({ password_hash: hash });
  res.json({ success: true });
});

// ── Platform overview stats ───────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try { res.json(await usersRepo.getPlatformStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── All users ─────────────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  try {
    const users = await usersRepo.list();
    // Per-user activity counts for the table (posts sent, AI generations, accounts
    // connected in the workspaces they belong to)
    const count = (q) => q.then(rows => Object.fromEntries(rows.map(r => [r.user_id, parseInt(r.c, 10)]))).catch(() => ({}));
    const [posts, ai, platforms] = await Promise.all([
      count(knexInstance('posts').whereNot({ status: 'failed' }).select('user_id').count('id as c').groupBy('user_id')),
      count(knexInstance('history').select('user_id').count('id as c').groupBy('user_id')),
      count(knexInstance('memberships as m').join('social_accounts as s', 's.workspace_id', 'm.workspace_id')
        .select('m.user_id').countDistinct('s.id as c').groupBy('m.user_id')),
    ]);
    res.json(users.map(u => ({
      ...u, password_hash: undefined,
      posts: posts[u.id] || 0, ai_generations: ai[u.id] || 0, platforms_connected: platforms[u.id] || 0,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Single user detail ────────────────────────────────────────────────────────

router.get('/users/:id', async (req, res) => {
  try {
    const user = await usersRepo.findById(parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found' });
    const settings = await usersRepo.getSettings(user.id);
    res.json({
      ...user,
      has_google_key:    !!settings.google_ai_key,
      has_anthropic_key: !!settings.anthropic_key,
      has_stability_key: !!settings.stability_key,
      has_openai_key:    !!settings.openai_key,
      has_luma_key:      !!settings.luma_key,
      ollama_enabled:    !!settings.ollama_enabled,
      ollama_model:      settings.ollama_model,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Update user role ──────────────────────────────────────────────────────────

router.patch('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (parseInt(req.params.id) === req.userId) return res.status(400).json({ error: 'Cannot change your own role' });
  try {
    await usersRepo.updateRole(parseInt(req.params.id), role);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Suspend / activate user ───────────────────────────────────────────────────

router.patch('/users/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (parseInt(req.params.id) === req.userId) return res.status(400).json({ error: 'Cannot suspend yourself' });
  try {
    await usersRepo.updateStatus(parseInt(req.params.id), status);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete user ───────────────────────────────────────────────────────────────

router.delete('/users/:id', async (req, res) => {
  if (parseInt(req.params.id) === req.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
  try {
    await usersRepo.remove(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Invite codes ──────────────────────────────────────────────────────────────

router.get('/invite-codes', async (req, res) => {
  try { res.json(await usersRepo.listInviteCodes()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/invite-codes', async (req, res) => {
  const { note, expires_hours = 168, max_uses = 1 } = req.body;
  try {
    const result = await usersRepo.createInviteCode(req.userId, note, expires_hours, max_uses);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/invite-codes/:id', async (req, res) => {
  try {
    await usersRepo.deleteInviteCode(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Registration mode config ──────────────────────────────────────────────────

router.get('/config', async (req, res) => {
  try {
    res.json({
      registration_mode: await usersRepo.getConfig('registration_mode', 'open'),
      app_name:          await usersRepo.getConfig('app_name', 'Social-Nexus'),
      max_users:         await usersRepo.getConfig('max_users', '0'),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/config', async (req, res) => {
  const { registration_mode, app_name, max_users } = req.body;
  try {
    if (registration_mode) await usersRepo.setConfig('registration_mode', registration_mode);
    if (app_name)          await usersRepo.setConfig('app_name',          app_name);
    if (max_users !== undefined) await usersRepo.setConfig('max_users',   max_users);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Activity feed (last 50 posts across all users) ────────────────────────────

router.get('/activity', async (req, res) => {
  try {
    const posts = await knexInstance('posts as p')
      .leftJoin('users as u', 'u.id', 'p.user_id')
      .orderBy('p.created_at', 'desc')
      .limit(50)
      .select('p.*', 'u.email', 'u.name');
    res.json(posts.map(p => ({ ...p, platforms: safe(p.platforms) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function safe(v) { if (!v) return v; try { return JSON.parse(v); } catch { return v; } }

module.exports = router;
