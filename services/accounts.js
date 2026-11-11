// Server edition (SaaS) accounts: each sign-up gets its own business with a
// 14-day trial, and account emails (verify your email, reset your password)
// carry one-time links.
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const TRIAL_DAYS = 14;
const DAY = 86400;
const VERIFY_TTL = 3 * DAY;
const RESET_TTL = 3600;
const now = () => Math.floor(Date.now() / 1000);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Radixile staff: platform admins of the hosted service (never a customer)
function isPlatformAdminEmail(email) {
  const list = String(process.env.PLATFORM_ADMIN_EMAILS || '').split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(email || '').trim().toLowerCase());
}

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'business';

// A new business for a new owner: organization on a trial, its first workspace,
// and the owner as manager. Runs inside the caller's transaction.
async function createBusiness(trx, { userId, businessName }) {
  const name = String(businessName || '').trim().slice(0, 120);
  const [orgRow] = await trx('organizations')
    .insert({ name, owner_user_id: userId, plan: 'trial', trial_ends_at: now() + TRIAL_DAYS * DAY })
    .returning('id');
  const orgId = orgRow?.id ?? orgRow;
  await trx('org_members').insert({ org_id: orgId, user_id: userId, role: 'owner' }).onConflict(['org_id', 'user_id']).ignore();
  // India is the main market: Indian time by default (changeable per workspace)
  const [wsRow] = await trx('workspaces').insert({ org_id: orgId, name, slug: slugify(name), timezone: 'Asia/Kolkata' }).returning('id');
  const workspaceId = wsRow?.id ?? wsRow;
  await trx('memberships').insert({ user_id: userId, workspace_id: workspaceId, role: 'manager' }).onConflict(['user_id', 'workspace_id']).ignore();
  return { orgId, workspaceId };
}

// ── One-time links ──────────────────────────────────────────────────────────
// Only a hash of the token is stored, so the database alone can't be used to
// verify an email or reset a password.
async function issueToken(knex, userId, kind) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  // A new link replaces older unused ones of the same kind
  await knex('auth_tokens').where({ user_id: userId, kind }).whereNull('used_at').update({ used_at: t });
  await knex('auth_tokens').insert({
    user_id: userId, kind, token_hash: sha256(token), created_at: t,
    expires_at: t + (kind === 'reset_password' ? RESET_TTL : VERIFY_TTL),
  });
  return token;
}

// The user the link belongs to, once: null when unknown, used or expired
async function useToken(knex, token, kind) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const row = await knex('auth_tokens').where({ token_hash: sha256(token), kind }).first();
  if (!row || row.used_at || row.expires_at < now()) return null;
  const claimed = await knex('auth_tokens').where({ id: row.id }).whereNull('used_at').update({ used_at: now() });
  return claimed ? row.user_id : null;
}

// ── Account emails ──────────────────────────────────────────────────────────
// Sent with the platform's mail settings (PLATFORM_SMTP_*, else SMTP_*).
function mailSettings() {
  const e = (k) => process.env[`PLATFORM_${k}`] || process.env[k];
  if (!e('SMTP_HOST') || !e('SMTP_USER') || !e('SMTP_PASS')) return null;
  const port = Number(e('SMTP_PORT') || 587);
  return {
    host: e('SMTP_HOST'), port, secure: e('SMTP_SECURE') ? e('SMTP_SECURE') === 'true' : port === 465,
    auth: { user: e('SMTP_USER'), pass: e('SMTP_PASS') },
    from: `${e('SMTP_FROM_NAME') || 'Social-Nexus'} <${e('SMTP_FROM') || e('SMTP_USER')}>`,
  };
}

async function sendMail(to, subject, text) {
  const s = mailSettings();
  if (!s) {
    // No email set up on the server: the link goes to the server log (for the operator)
    console.warn(`[Accounts] Email isn't set up on the server (PLATFORM_SMTP_*). Not sent to ${to}: ${subject}\n${text}`);
    return false;
  }
  const t = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.auth, connectionTimeout: 10000, socketTimeout: 15000 });
  await t.sendMail({ from: s.from, to, subject, text });
  return true;
}

function appUrl(req) {
  return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

async function sendVerification(knex, req, user) {
  const token = await issueToken(knex, user.id, 'verify_email');
  const link = `${appUrl(req)}/users/verify-email?token=${encodeURIComponent(token)}`;
  return sendMail(user.email, 'Confirm your email for Social-Nexus',
    `Hello${user.name ? ` ${user.name}` : ''},\n\nPlease confirm your email address for Social-Nexus by opening this link:\n${link}\n\nThe link works for 3 days. If you didn't create an account, you can ignore this email.\n\nSocial-Nexus by Radixile Technology Solutions`);
}

async function sendReset(knex, req, user) {
  const token = await issueToken(knex, user.id, 'reset_password');
  const link = `${appUrl(req)}/login.html?reset=${encodeURIComponent(token)}`;
  return sendMail(user.email, 'Reset your Social-Nexus password',
    `Hello${user.name ? ` ${user.name}` : ''},\n\nSomeone (hopefully you) asked to reset your Social-Nexus password. Choose a new one here:\n${link}\n\nThe link works for 1 hour and only once. If you didn't ask for this, ignore this email: your password stays the same.\n\nSocial-Nexus by Radixile Technology Solutions`);
}

// The business a user belongs to, for "Trial: N days left"
async function businessFor(knex, userId) {
  const m = await knex('org_members as m').join('organizations as o', 'o.id', 'm.org_id')
    .where('m.user_id', userId).orderByRaw("CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END").orderBy('o.id')
    .first('o.id', 'o.name', 'o.plan', 'o.trial_ends_at', 'm.role');
  if (m) return m;
  // Joined through a workspace invitation only
  return knex('memberships as ms').join('workspaces as w', 'w.id', 'ms.workspace_id').join('organizations as o', 'o.id', 'w.org_id')
    .where('ms.user_id', userId).orderBy('o.id').first('o.id', 'o.name', 'o.plan', 'o.trial_ends_at').then((r) => (r ? { ...r, role: 'member' } : null));
}

module.exports = { TRIAL_DAYS, createBusiness, issueToken, useToken, sendVerification, sendReset, sendMail, isPlatformAdminEmail, businessFor, slugify };
