const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const db       = require('../services/database');
const { requireAuth } = require('../middleware/auth');

// ── Registration mode check ───────────────────────────────────────────────────

router.get('/registration-info', (req, res) => {
  const mode    = db.getConfig('registration_mode', 'open');
  const appName = db.getConfig('app_name', 'NEXUS');
  const userCount = db.db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  res.json({ mode, app_name: appName, is_first_user: userCount === 0 });
});

// ── Register ──────────────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { email, password, name, invite_code } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (password.length < 6)  return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });

  // Check registration mode (skip for very first user — they become admin)
  const userCount = db.db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount > 0) {
    const mode = db.getConfig('registration_mode', 'open');
    if (mode === 'closed') return res.status(403).json({ error: 'Registration is currently closed. Contact the admin.' });
    if (mode === 'invite') {
      if (!invite_code) return res.status(403).json({ error: 'An invite code is required to register.', needs_invite: true });
      const invite = db.getInviteCode(invite_code.trim().toUpperCase());
      if (!invite) return res.status(403).json({ error: 'Invalid invite code.' });
      if (invite.expires_at && invite.expires_at < Math.floor(Date.now() / 1000)) return res.status(403).json({ error: 'This invite code has expired.' });
      if (invite.use_count >= invite.max_uses) return res.status(403).json({ error: 'This invite code has already been used.' });
      req._validInvite = invite_code.trim().toUpperCase();
    }
  }

  try {
    const hash   = await bcrypt.hash(password, 10);
    const result = db.createUser(email.toLowerCase().trim(), hash, name?.trim());
    const { id, role } = result;

    if (req._validInvite) db.useInviteCode(req._validInvite, id);

    req.session.userId    = id;
    req.session.userEmail = email.toLowerCase().trim();
    req.session.userName  = name?.trim() || email.split('@')[0];
    req.session.userRole  = role;

    res.json({ success: true, user: { id, email, name: req.session.userName, role } });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.getUserByEmail(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  if (user.status === 'suspended') return res.status(403).json({ error: 'Your account has been suspended. Contact the admin.' });

  req.session.userId    = user.id;
  req.session.userEmail = user.email;
  req.session.userName  = user.name || user.email.split('@')[0];
  req.session.userRole  = user.role;

  db.updateLastActive(user.id);
  res.json({ success: true, user: { id: user.id, email: user.email, name: req.session.userName, role: user.role } });
});

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── Current user ──────────────────────────────────────────────────────────────

router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.json({ authenticated: false });
  const user = db.getUserById(req.session.userId);
  if (!user) return res.json({ authenticated: false });
  if (user.status === 'suspended') { req.session.destroy(); return res.json({ authenticated: false, error: 'suspended' }); }
  res.json({
    authenticated: true,
    user: { id: user.id, email: user.email, name: user.name || user.email.split('@')[0], role: user.role },
  });
});

// ── User settings (AI keys per user) ─────────────────────────────────────────

router.get('/settings', requireAuth, (req, res) => {
  const s = db.getUserSettings(req.userId);
  // Never send actual key values — just whether they're set
  res.json({
    google_ai_key:    s.google_ai_key    ? '••••••••' + s.google_ai_key.slice(-4)    : '',
    anthropic_key:    s.anthropic_key    ? '••••••••' + s.anthropic_key.slice(-4)    : '',
    stability_key:    s.stability_key    ? '••••••••' + s.stability_key.slice(-4)    : '',
    openai_key:       s.openai_key       ? '••••••••' + s.openai_key.slice(-4)       : '',
    luma_key:         s.luma_key         ? '••••••••' + s.luma_key.slice(-4)         : '',
    runway_key:       s.runway_key       ? '••••••••' + s.runway_key.slice(-4)       : '',
    ollama_enabled:   !!s.ollama_enabled,
    ollama_model:     s.ollama_model  || 'llama3.2',
    ollama_url:       s.ollama_url    || 'http://localhost:11434',
    default_text_model: s.default_text_model || 'ollama',
  });
});

router.post('/settings', requireAuth, (req, res) => {
  const allowed = ['google_ai_key','anthropic_key','stability_key','openai_key','luma_key','runway_key','ollama_enabled','ollama_model','ollama_url','default_text_model'];
  const data = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!allowed.includes(k)) continue;
    if (typeof v === 'string' && v.includes('••••')) continue; // skip masked
    data[k] = v;
  }
  db.saveUserSettings(req.userId, data);
  res.json({ success: true });
});

// ── Admin: list users ─────────────────────────────────────────────────────────

router.get('/list', requireAuth, (req, res) => {
  const user = db.getUserById(req.userId);
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json(db.getAllUsers());
});

module.exports = router;
