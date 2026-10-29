const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { requireAuth } = require('../middleware/auth');
const knexInstance = require('../services/knex');
const usersRepo    = require('../repos/usersRepo')(knexInstance);
const loginGuard   = require('../services/loginGuard');
const crypto       = require('crypto');

// Recovery code: 20 letters/digits in 4 groups, without look-alikes (0/O, 1/I/L)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newRecoveryCode() {
  const bytes = crypto.randomBytes(20);
  const raw = Array.from(bytes, b => CODE_CHARS[b % CODE_CHARS.length]).join('');
  return raw.match(/.{5}/g).join('-');
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
async function setRecoveryCode(userId) {
  const code = newRecoveryCode();
  await knexInstance('users').where({ id: userId }).update({ recovery_hash: await bcrypt.hash(normCode(code), 10) });
  return code;
}

// ── Registration mode check ───────────────────────────────────────────────────

router.get('/registration-info', async (req, res) => {
  try {
    const [mode, appName, [{ c }]] = await Promise.all([
      usersRepo.getConfig('registration_mode', 'open'),
      usersRepo.getConfig('app_name', 'Social-Nexus'),
      knexInstance('users').count('id as c'),
    ]);
    res.json({ mode, app_name: appName, is_first_user: parseInt(c, 10) === 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Register ──────────────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { email, password, name, invite_code } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (password.length < 6)  return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });

  try {
    // Check registration mode (skip for very first user — they become admin)
    const [{ c }] = await knexInstance('users').count('id as c');
    if (parseInt(c, 10) > 0) {
      // Edition limit on user accounts (the first account — the admin — is always allowed)
      const { withinLimit, limitMessage } = require('../middleware/license');
      if (!withinLimit('users', parseInt(c, 10))) {
        return res.status(402).json({ error: limitMessage('users'), code: 'LICENSE_LIMIT' });
      }
      const mode = await usersRepo.getConfig('registration_mode', 'open');
      if (mode === 'closed') return res.status(403).json({ error: 'Registration is currently closed. Contact the admin.' });
      if (mode === 'invite') {
        if (!invite_code) return res.status(403).json({ error: 'An invite code is required to register.', needs_invite: true });
        const invite = await usersRepo.getInviteCode(invite_code.trim().toUpperCase());
        if (!invite) return res.status(403).json({ error: 'Invalid invite code.' });
        if (invite.expires_at && invite.expires_at < Math.floor(Date.now() / 1000)) return res.status(403).json({ error: 'This invite code has expired.' });
        if (invite.use_count >= invite.max_uses) return res.status(403).json({ error: 'This invite code has already been used.' });
        // Claim a use now (atomically) so two sign-ups can't share the last use
        if (!(await usersRepo.claimInviteCode(invite.code))) return res.status(403).json({ error: 'This invite code has already been used.' });
        req._validInvite = invite.code;
      }
    }

    const hash = await bcrypt.hash(password, 10);
    let created;
    try {
      created = await usersRepo.create(email.toLowerCase().trim(), hash, name?.trim());
    } catch (err) {
      if (req._validInvite) await usersRepo.releaseInviteCode(req._validInvite); // give the use back
      throw err;
    }
    const { id, role } = created;

    if (req._validInvite) await usersRepo.useInviteCode(req._validInvite, id);

    req.session.userId    = id;
    req.session.userEmail = email.toLowerCase().trim();
    req.session.userName  = name?.trim() || email.split('@')[0];
    req.session.userRole  = role;

    const recovery_code = await setRecoveryCode(id);
    res.json({ success: true, user: { id, email, name: req.session.userName, role }, recovery_code });
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('unique')) return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const wait = loginGuard.check(email);
  if (wait) return res.status(429).json({ error: wait });

  try {
    const user = await usersRepo.findByEmail(email.toLowerCase().trim());
    if (!user) { loginGuard.failed(email); return res.status(401).json({ error: 'Invalid email or password' }); }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) { loginGuard.failed(email); return res.status(401).json({ error: 'Invalid email or password' }); }
    loginGuard.succeeded(email);

    if (user.status === 'suspended') return res.status(403).json({ error: 'Your account has been suspended. Contact the admin.' });

    req.session.userId    = user.id;
    req.session.userEmail = user.email;
    req.session.userName  = user.name || user.email.split('@')[0];
    req.session.userRole  = user.role;

    usersRepo.updateLastActive(user.id).catch(() => {});
    res.json({ success: true, user: { id: user.id, email: user.email, name: req.session.userName, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Forgotten password: reset with the recovery code ─────────────────────────
router.post('/recover', async (req, res) => {
  const { email, code, password } = req.body || {};
  if (!email || !code || !password) return res.status(400).json({ error: 'Email, recovery code and a new password are needed.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'The new password needs at least 6 characters.' });
  const wait = loginGuard.check(email);
  if (wait) return res.status(429).json({ error: wait });
  try {
    const user = await usersRepo.findByEmail(String(email).toLowerCase().trim());
    const ok = user?.recovery_hash && await bcrypt.compare(normCode(code), user.recovery_hash);
    if (!ok) {
      loginGuard.failed(email);
      return res.status(401).json({ error: 'That email and recovery code don\u2019t match. Ask your admin to reset your password if you don\u2019t have the code.' });
    }
    loginGuard.succeeded(email);
    await knexInstance('users').where({ id: user.id }).update({ password_hash: await bcrypt.hash(String(password), 10) });
    // The code is used up: give a new one
    const recovery_code = await setRecoveryCode(user.id);
    res.json({ success: true, recovery_code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A new recovery code for the signed-in user (needs the current password)
router.post('/recovery-code', requireAuth, async (req, res) => {
  try {
    const user = await knexInstance('users').where({ id: req.session.userId }).first('id', 'password_hash');
    if (!user || !(await bcrypt.compare(String(req.body?.password || ''), user.password_hash))) {
      return res.status(401).json({ error: 'Your current password is not right.' });
    }
    res.json({ recovery_code: await setRecoveryCode(user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── Current user ──────────────────────────────────────────────────────────────

router.get('/me', async (req, res) => {
  if (!req.session?.userId) return res.json({ authenticated: false });
  try {
    const user = await usersRepo.findById(req.session.userId);
    if (!user) return res.json({ authenticated: false });
    if (user.status === 'suspended') { req.session.destroy(); return res.json({ authenticated: false, error: 'suspended' }); }
    res.json({
      authenticated: true,
      user: { id: user.id, email: user.email, name: user.name || user.email.split('@')[0], role: user.role, has_recovery_code: !!(await knexInstance('users').where({ id: user.id }).first('recovery_hash'))?.recovery_hash },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── User settings (AI keys per user) ─────────────────────────────────────────

router.get('/settings', requireAuth, async (req, res) => {
  try {
    const s = await usersRepo.getSettings(req.userId) || {};
    res.json({
      google_ai_key:      s.google_ai_key      ? '••••••••' + s.google_ai_key.slice(-4)      : '',
      anthropic_key:      s.anthropic_key      ? '••••••••' + s.anthropic_key.slice(-4)      : '',
      groq_key:           s.groq_key           ? '••••••••' + s.groq_key.slice(-4)           : '',
      openrouter_key:     s.openrouter_key     ? '••••••••' + s.openrouter_key.slice(-4)     : '',
      mistral_key:        s.mistral_key        ? '••••••••' + s.mistral_key.slice(-4)        : '',
      stability_key:      s.stability_key      ? '••••••••' + s.stability_key.slice(-4)      : '',
      openai_key:         s.openai_key         ? '••••••••' + s.openai_key.slice(-4)         : '',
      luma_key:           s.luma_key           ? '••••••••' + s.luma_key.slice(-4)           : '',
      runway_key:         s.runway_key         ? '••••••••' + s.runway_key.slice(-4)         : '',
      ollama_enabled:     !!s.ollama_enabled,
      ollama_model:       s.ollama_model       || 'llama3.2',
      ollama_url:         s.ollama_url         || 'http://localhost:11434',
      default_text_model: s.default_text_model || 'ollama',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/settings', requireAuth, async (req, res) => {
  const allowed = [
    'google_ai_key', 'anthropic_key',
    'groq_key', 'openrouter_key', 'mistral_key',
    'stability_key', 'openai_key', 'luma_key', 'runway_key',
    'ollama_enabled', 'ollama_model', 'ollama_url', 'default_text_model',
    'ui_mode',
  ];
  if ('ui_mode' in req.body && !['simple', 'agency', null].includes(req.body.ui_mode)) {
    return res.status(400).json({ error: 'ui_mode must be simple or agency' });
  }
  const data = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!allowed.includes(k)) continue;
    if (typeof v === 'string' && v.includes('••••')) continue; // skip masked
    data[k] = v;
  }
  try {
    await usersRepo.saveSettings(req.userId, data);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Admin: list users ─────────────────────────────────────────────────────────

router.get('/list', requireAuth, async (req, res) => {
  try {
    const user = await usersRepo.findById(req.userId);
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    res.json(await usersRepo.list());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
