// Who is a platform (Radixile staff) administrator, and the live user check used on
// every request. One place, so the rule can't drift between files.
//
// A platform admin is a user whose role is 'superadmin' (assigned in the database
// by another super admin), or whose email is listed in PLATFORM_ADMIN_EMAILS. On the
// server edition a listed email only counts once it is VERIFIED: sign-up logs people
// in without confirming the address, so typing a listed address must never be enough.
// No address is hard-coded here.
const knex = require('./knex');

const TTL = 5000; // seconds-level: a suspension or role change takes effect almost at once
const cache = new Map();

function adminEmails() {
  return String(process.env.PLATFORM_ADMIN_EMAILS || '').split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

function isListedEmail(email) {
  return adminEmails().includes(String(email || '').trim().toLowerCase());
}

// user: { role, email, email_verified_at }. email_verified_at undefined = unknown
// (e.g. a list of other users): counted as admin, which only ever PROTECTS them.
function isPlatformAdmin(user) {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  if (!isListedEmail(user.email)) return false;
  const server = require('./edition').isServer();
  return !server || user.email_verified_at === undefined || !!user.email_verified_at;
}

// The user as the database has them now (cached for a few seconds); null if gone
async function loadUser(id) {
  if (!id) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.user;
  const user = (await knex('users').where({ id }).first('id', 'email', 'name', 'role', 'status', 'email_verified_at')) || null;
  cache.set(id, { at: Date.now(), user });
  if (cache.size > 5000) cache.clear();
  return user;
}

function forget(id) { if (id == null) cache.clear(); else cache.delete(id); }

module.exports = { isPlatformAdmin, isListedEmail, adminEmails, loadUser, forget };
