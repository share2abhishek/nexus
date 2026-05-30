const express = require('express');
const router  = express.Router();
const db      = require('../services/database');
const { requireAuth } = require('../middleware/auth');

// ── Admin guard ───────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const user = db.getUserById(req.userId);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

router.use(requireAuth, requireAdmin);

// ── Platform overview stats ───────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  res.json(db.getPlatformStats());
});

// ── All users ─────────────────────────────────────────────────────────────────

router.get('/users', (req, res) => {
  const users = db.getAllUsers().map(u => ({
    ...u,
    ...db.getUserStats(u.id),
    password_hash: undefined,
  }));
  res.json(users);
});

// ── Single user detail ────────────────────────────────────────────────────────

router.get('/users/:id', (req, res) => {
  const user = db.getUserById(parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  const stats    = db.getUserStats(user.id);
  const settings = db.getUserSettings(user.id);
  const history  = db.getHistory ? [] : [];

  res.json({
    ...user,
    stats,
    has_google_key:     !!settings.google_ai_key,
    has_anthropic_key:  !!settings.anthropic_key,
    has_stability_key:  !!settings.stability_key,
    has_openai_key:     !!settings.openai_key,
    has_luma_key:       !!settings.luma_key,
    ollama_enabled:     !!settings.ollama_enabled,
    ollama_model:       settings.ollama_model,
  });
});

// ── Update user role ──────────────────────────────────────────────────────────

router.patch('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['user','admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (parseInt(req.params.id) === req.userId) return res.status(400).json({ error: 'Cannot change your own role' });
  db.updateUserRole(parseInt(req.params.id), role);
  res.json({ success: true });
});

// ── Suspend / activate user ───────────────────────────────────────────────────

router.patch('/users/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active','suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (parseInt(req.params.id) === req.userId) return res.status(400).json({ error: 'Cannot suspend yourself' });
  db.updateUserStatus(parseInt(req.params.id), status);
  res.json({ success: true });
});

// ── Delete user ───────────────────────────────────────────────────────────────

router.delete('/users/:id', (req, res) => {
  if (parseInt(req.params.id) === req.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.deleteUserData(parseInt(req.params.id));
  res.json({ success: true });
});

// ── Invite codes ──────────────────────────────────────────────────────────────

router.get('/invite-codes', (req, res) => {
  res.json(db.getAllInviteCodes());
});

router.post('/invite-codes', (req, res) => {
  const { note, expires_hours = 168, max_uses = 1 } = req.body;
  const result = db.createInviteCode(req.userId, note, expires_hours, max_uses);
  res.json({ success: true, ...result });
});

router.delete('/invite-codes/:id', (req, res) => {
  db.deleteInviteCode(parseInt(req.params.id));
  res.json({ success: true });
});

// ── Registration mode config ──────────────────────────────────────────────────
// Modes: 'open' (anyone can register), 'invite' (invite code required), 'closed'

router.get('/config', (req, res) => {
  res.json({
    registration_mode: db.getConfig('registration_mode', 'open'),
    app_name:          db.getConfig('app_name', 'NEXUS'),
    max_users:         db.getConfig('max_users', '0'),
  });
});

router.post('/config', (req, res) => {
  const { registration_mode, app_name, max_users } = req.body;
  if (registration_mode) db.setConfig('registration_mode', registration_mode);
  if (app_name)          db.setConfig('app_name',          app_name);
  if (max_users !== undefined) db.setConfig('max_users',   max_users);
  res.json({ success: true });
});

// ── Activity feed (last 50 posts across all users) ────────────────────────────

router.get('/activity', (req, res) => {
  const posts = db.db.prepare(`
    SELECT p.*, u.email, u.name
    FROM posts p
    LEFT JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC LIMIT 50
  `).all().map(p => ({ ...p, platforms: JSON.parse(p.platforms || '[]') }));
  res.json(posts);
});

module.exports = router;
