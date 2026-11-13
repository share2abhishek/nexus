const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const knexInstance = require('../services/knex');
const usersRepo    = require('../repos/usersRepo')(knexInstance);

// ── Admin guard & Superadmin Helpers ──────────────────────────────────────────

function isSuperAdminUser(user) {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  const platformEmails = String(process.env.PLATFORM_ADMIN_EMAILS || '').split(/[,\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
  if (platformEmails.includes(String(user.email || '').trim().toLowerCase())) return true;
  if (user.role === 'admin' && (String(user.email).endsWith('@radixile.test') || String(user.email).endsWith('@radixile.com'))) return true;
  return false;
}

async function requireAdmin(req, res, next) {
  const user = await usersRepo.findById(req.userId);
  if (!user || (!['admin', 'superadmin'].includes(user.role) && !isSuperAdminUser(user))) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.currentUser = user;
  req.isSuperAdmin = isSuperAdminUser(user);
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: 'Super Admin access required to manage subscriptions and administrator accounts.' });
  }
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
    
    const safeRole = ['superadmin', 'admin', 'user'].includes(role) ? role : 'user';
    // Only Super Admin can create other admins or superadmins
    if (['superadmin', 'admin'].includes(safeRole) && !req.isSuperAdmin) {
      return res.status(403).json({ error: 'Only a Super Admin can create administrator accounts.' });
    }

    const hash = await bcrypt.hash(password, 10);
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

// ── Subscriptions & Businesses (Super Admin Only) ─────────────────────────────

router.get('/organizations', requireSuperAdmin, async (req, res) => {
  if (!await knexInstance.schema.hasTable('organizations')) {
    return res.json({ organizations: [], plans: [] });
  }
  const ent = require('../services/entitlements');
  const orgs = await knexInstance('organizations as o').leftJoin('users as u', 'u.id', 'o.owner_user_id')
    .select('o.id', 'o.name', 'o.plan', 'o.plan_status', 'o.paid_until', 'o.trial_ends_at', 'o.created_at', 'u.email as owner_email')
    .orderBy('o.id', 'desc').limit(500);
  const out = [];
  for (const o of orgs) {
    const s = await ent.forOrg(o.id, true);
    out.push({
      ...o, can_publish: s.can_publish, state: s.state, plan_name: s.plan_name, message: s.message, trial_days_left: s.trial_days_left ?? null,
      usage: { workspaces: await ent.usage(o.id, 'workspaces'), users: await ent.usage(o.id, 'users'), seo_sites: await ent.usage(o.id, 'seo_sites') },
      limits: s.limits || {},
    });
  }
  res.json({ organizations: out, plans: Object.entries(await ent.plans(true)).map(([id, p]) => ({ id, name: p.name, limits: p.limits })) });
});

router.patch('/organizations/:id/plan', requireSuperAdmin, async (req, res) => {
  if (!await knexInstance.schema.hasTable('organizations')) {
    return res.status(404).json({ error: 'Organizations table does not exist.' });
  }
  const ent = require('../services/entitlements');
  const id = Number(req.params.id);
  const org = await knexInstance('organizations').where({ id }).first();
  if (!org) return res.status(404).json({ error: 'Business not found' });
  const b = req.body || {};
  const patch = {};
  const plans = await ent.plans(true);
  if (b.plan !== undefined) {
    if (!plans[b.plan]) return res.status(400).json({ error: `Unknown plan. Choose one of: ${Object.keys(plans).join(', ')}.` });
    patch.plan = b.plan;
  }
  if (b.plan_status !== undefined) {
    if (![null, 'active', 'past_due', 'cancelled', 'suspended'].includes(b.plan_status)) return res.status(400).json({ error: 'Status must be active, past_due, cancelled or suspended.' });
    patch.plan_status = b.plan_status;
  }
  // Dates as YYYY-MM-DD (end of that day, India time) or seconds
  const toEpoch = (v) => {
    if (v === null || v === '') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return Math.floor(new Date(`${v}T23:59:59+05:30`).getTime() / 1000);
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  };
  for (const k of ['paid_until', 'trial_ends_at']) {
    if (b[k] === undefined) continue;
    const e = toEpoch(b[k]);
    if (e === undefined) return res.status(400).json({ error: `${k === 'paid_until' ? 'Paid until' : 'Trial ends'} must be a date (YYYY-MM-DD).` });
    patch[k] = e;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change.' });
  await knexInstance('organizations').where({ id }).update(patch);
  ent.forget(id); // takes effect straight away
  console.log(`[SuperAdmin] ${req.session?.userEmail || req.userId} changed the subscription plan of business #${id}:`, JSON.stringify(patch));
  res.json({ success: true, status: await ent.forOrg(id, true) });
});

// ── Extend subscription duration for a business ──────────────────────────────

router.post('/organizations/:id/extend', requireSuperAdmin, async (req, res) => {
  if (!await knexInstance.schema.hasTable('organizations')) {
    return res.status(404).json({ error: 'Organizations table does not exist.' });
  }
  const ent = require('../services/entitlements');
  const id = Number(req.params.id);
  const org = await knexInstance('organizations').where({ id }).first();
  if (!org) return res.status(404).json({ error: 'Business not found' });

  const { days = 30, plan, target = 'paid' } = req.body || {};
  const addDays = parseInt(days, 10);
  if (isNaN(addDays) || addDays <= 0) return res.status(400).json({ error: 'Specify a valid positive number of days to extend.' });

  const nowSec = Math.floor(Date.now() / 1000);
  const patch = {};

  if (target === 'trial' || (org.plan === 'trial' && !plan)) {
    const baseTrial = org.trial_ends_at && org.trial_ends_at > nowSec ? org.trial_ends_at : nowSec;
    patch.trial_ends_at = baseTrial + (addDays * 86400);
    patch.plan = 'trial';
  } else {
    const basePaid = org.paid_until && org.paid_until > nowSec ? org.paid_until : nowSec;
    patch.paid_until = basePaid + (addDays * 86400);
    patch.plan_status = 'active';
    if (plan && plan !== 'trial') {
      patch.plan = plan;
    } else if (org.plan === 'trial') {
      patch.plan = 'agency';
    }
  }

  await knexInstance('organizations').where({ id }).update(patch);
  ent.forget(id);

  console.log(`[SuperAdmin] ${req.session?.userEmail || req.userId} extended subscription for business #${id} (${org.name}) by +${addDays} days:`, patch);

  const status = await ent.forOrg(id, true);
  const newDate = patch.paid_until || patch.trial_ends_at;
  const dateStr = newDate ? new Date(newDate * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  res.json({
    success: true,
    message: `Extended ${org.name} by +${addDays} days until ${dateStr}!`,
    added_days: addDays,
    status,
    paid_until: patch.paid_until || org.paid_until,
    trial_ends_at: patch.trial_ends_at || org.trial_ends_at,
  });
});

// ── Platform-default AI keys (Super Admin only) ───────────────────────────────
// Radixile's own keys, used as a last-resort fallback for businesses that haven't
// added their own. Server edition only (the desktop app uses .env / Local AI).

router.get('/platform-ai', requireSuperAdmin, async (req, res) => {
  try {
    res.json({ keys: await require('../services/platformAi').publicView() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/platform-ai', requireSuperAdmin, async (req, res) => {
  const platformAi = require('../services/platformAi');
  const body = req.body || {};
  // Accept only known keys; empty / masked values keep what is saved
  const values = {};
  for (const k of Object.keys(platformAi.AI_KEYS)) {
    if (typeof body[k] === 'string') values[k] = body[k];
  }
  const clear = Array.isArray(body.clear) ? body.clear : [];
  try {
    await platformAi.save(values, { clear });
    console.log(`[SuperAdmin] ${req.session?.userEmail || req.userId} updated platform-default AI keys:`, Object.keys(values).filter(k => values[k] && !values[k].includes('••••')).join(', ') || '(cleared)');
    res.json({ success: true, keys: await platformAi.publicView() });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
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
      is_super_admin: isSuperAdminUser(u),
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
      is_super_admin:    isSuperAdminUser(user),
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

// ── Update user role (Super Admin Only to modify Admins) ──────────────────────

router.patch('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin', 'superadmin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const targetId = parseInt(req.params.id);
  if (targetId === req.userId) return res.status(400).json({ error: 'Cannot change your own role' });

  const targetUser = await usersRepo.findById(targetId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // Only Super Admin can promote, demote, or modify admin roles
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: 'Only a Super Admin can promote, demote, or manage other administrators.' });
  }

  // Cannot demote another platform admin configured via environment
  if (isSuperAdminUser(targetUser) && !req.isSuperAdmin) {
    return res.status(403).json({ error: 'Super Admin accounts cannot be demoted.' });
  }

  try {
    await usersRepo.updateRole(targetId, role);
    console.log(`[SuperAdmin] ${req.session?.userEmail || req.userId} changed role of user #${targetId} (${targetUser.email}) to '${role}'`);
    res.json({ success: true, role });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Suspend / activate user ───────────────────────────────────────────────────

router.patch('/users/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const targetId = parseInt(req.params.id);
  if (targetId === req.userId) return res.status(400).json({ error: 'Cannot suspend yourself' });

  const targetUser = await usersRepo.findById(targetId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // Protected: Cannot suspend a Super Admin
  if (isSuperAdminUser(targetUser)) {
    return res.status(403).json({ error: 'Cannot suspend a Super Admin account.' });
  }

  // Regular admins cannot suspend other admins
  if (['admin', 'superadmin'].includes(targetUser.role) && !req.isSuperAdmin) {
    return res.status(403).json({ error: 'Only a Super Admin can suspend administrator accounts.' });
  }

  try {
    await usersRepo.updateStatus(targetId, status);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete user ───────────────────────────────────────────────────────────────

router.delete('/users/:id', async (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.userId) return res.status(400).json({ error: 'Cannot delete yourself' });

  const targetUser = await usersRepo.findById(targetId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // Protected: Cannot delete a Super Admin
  if (isSuperAdminUser(targetUser)) {
    return res.status(403).json({ error: 'Cannot delete a Super Admin account.' });
  }

  // Regular admins cannot delete other admins
  if (['admin', 'superadmin'].includes(targetUser.role) && !req.isSuperAdmin) {
    return res.status(403).json({ error: 'Only a Super Admin can delete administrator accounts.' });
  }

  try {
    await usersRepo.remove(targetId);
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
