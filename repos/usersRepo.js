// Personal API keys are stored encrypted (services/secrets.js)
const { seal, SEALED_COLUMNS } = require('../services/secrets');
const sealKeys = (data) => Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, SEALED_COLUMNS.user_settings.cols.includes(k) ? seal(v) : v]));
// repos/usersRepo.js — Knex-based user, settings, config, and invite code operations
// Replaces the synchronous better-sqlite3 calls in services/database.js for
// users/user_settings/platform_config/invite_codes tables.
const crypto = require('crypto');

module.exports = (knex) => {
  function epochNow() {
    return knex.client.config.client === 'pg'
      ? knex.raw("extract(epoch from now())::bigint")
      : knex.raw("strftime('%s','now')");
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async function create(email, passwordHash, name) {
    // Desktop: the first user ever becomes admin of the install. Count + insert run
    // in one transaction so two simultaneous sign-ups can't both be admin.
    // Server edition (hosted for many businesses): a sign-up is never an admin of
    // the service; Radixile staff get that after confirming their email.
    return knex.transaction(async (trx) => {
      const [{ c }] = await trx('users').count('id as c');
      const role    = !require('../services/edition').isServer() && parseInt(c, 10) === 0 ? 'admin' : 'user';
      const rows    = await trx('users').insert({
        email, password_hash: passwordHash, name: name || null, role,
      }).returning('id');
      const id = rows[0]?.id ?? rows[0];
      return { id, role };
    });
  }

  async function findByEmail(email) {
    return knex('users').where({ email }).first();
  }

  async function findById(id) {
    return knex('users').where({ id }).select('id','email','name','role','status','created_at').first();
  }

  async function list() {
    return knex('users').orderBy('created_at', 'desc')
      .select('id','email','name','role','status','created_at','last_active');
  }

  async function updateRole(id, role) {
    return knex('users').where({ id }).update({ role });
  }

  async function updateStatus(id, status) {
    return knex('users').where({ id }).update({ status });
  }

  async function updateLastActive(id) {
    return knex('users').where({ id }).update({ last_active: epochNow() }).catch(() => {});
  }

  async function remove(id) {
    const dataTables = [
      'tokens','posts','scheduled_posts','history','analytics','apps','brand_kit',
      'templates','email_subscribers','email_campaigns','seo_keywords','utm_links','user_settings',
    ];
    for (const tbl of dataTables) {
      if (await knex.schema.hasTable(tbl)) {
        await knex(tbl).where({ user_id: id }).delete().catch(() => {});
      }
    }
    return knex('users').where({ id }).delete();
  }

  async function getPlatformStats() {
    const [[totalUsers], [activeUsers], [totalPosts], [totalAiGen], [scheduled]] = await Promise.all([
      knex('users').count('id as c'),
      knex('users').count('id as c').whereRaw(
        knex.client.config.client === 'pg'
          ? "last_active > extract(epoch from now()) - 86400"
          : "last_active > strftime('%s','now') - 86400"
      ),
      knex('posts').count('id as c'),
      knex('history').count('id as c'),
      knex('scheduled_posts').count('id as c').where({ status: 'pending' }),
    ]);
    return {
      total_users:     parseInt(totalUsers.c,  10),
      active_users:    parseInt(activeUsers.c, 10),
      total_posts:     parseInt(totalPosts.c,  10),
      total_ai_gen:    parseInt(totalAiGen.c,  10),
      scheduled_posts: parseInt(scheduled.c,   10),
    };
  }

  // ── User Settings ──────────────────────────────────────────────────────────

  async function getSettings(userId) {
    return (await knex('user_settings').where({ user_id: userId }).first()) || {};
  }

  async function saveSettings(userId, data) {
    const existing = await knex('user_settings').where({ user_id: userId }).first();
    if (existing) {
      return knex('user_settings').where({ user_id: userId }).update({ ...sealKeys(data), updated_at: epochNow() });
    } else {
      return knex('user_settings').insert({ user_id: userId, ...sealKeys(data), updated_at: epochNow() });
    }
  }

  // ── Platform Config ────────────────────────────────────────────────────────

  async function getConfig(key, defaultVal = null) {
    const row = await knex('platform_config').where({ key }).first();
    return row ? row.value : defaultVal;
  }

  async function setConfig(key, value) {
    const existing = await knex('platform_config').where({ key }).first();
    if (existing) {
      return knex('platform_config').where({ key }).update({ value: String(value) });
    } else {
      return knex('platform_config').insert({ key, value: String(value) });
    }
  }

  // ── Invite Codes ───────────────────────────────────────────────────────────

  // 12 chars from an unambiguous alphabet (no 0/O/1/I), cryptographically random.
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function genCode() {
    const bytes = crypto.randomBytes(12);
    let code = '';
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    return code;
  }

  async function createInviteCode(createdBy, note, expiresHours, maxUses = 1) {
    const code      = genCode();
    const expiresAt = expiresHours
      ? Math.floor(Date.now() / 1000) + expiresHours * 3600
      : null;
    const rows = await knex('invite_codes').insert({
      code, created_by: createdBy, note: note || null, expires_at: expiresAt, max_uses: maxUses,
    }).returning('id');
    return { id: rows[0]?.id ?? rows[0], code };
  }

  async function getInviteCode(code) {
    return knex('invite_codes').where({ code }).first();
  }

  // Atomically take one use of the code; false when it's used up
  async function claimInviteCode(code) {
    const n = await knex('invite_codes').where({ code }).whereRaw('use_count < max_uses')
      .update({ use_count: knex.raw('use_count + 1') });
    return n > 0;
  }

  async function releaseInviteCode(code) {
    return knex('invite_codes').where({ code }).where('use_count', '>', 0)
      .update({ use_count: knex.raw('use_count - 1') });
  }

  // Records who used the code (the use itself was counted by claimInviteCode)
  async function useInviteCode(code, userId) {
    return knex('invite_codes').where({ code }).update({ used_by: userId });
  }

  async function listInviteCodes() {
    return knex('invite_codes as ic')
      .leftJoin('users as u',  'u.id',  'ic.created_by')
      .leftJoin('users as u2', 'u2.id', 'ic.used_by')
      .orderBy('ic.created_at', 'desc')
      .select('ic.*', 'u.email as creator_email', 'u2.email as used_by_email');
  }

  async function deleteInviteCode(id) {
    return knex('invite_codes').where({ id }).delete();
  }

  return {
    create, findByEmail, findById, list,
    updateRole, updateStatus, updateLastActive, remove,
    getPlatformStats,
    getSettings, saveSettings,
    getConfig, setConfig,
    createInviteCode, getInviteCode, claimInviteCode, releaseInviteCode, useInviteCode, listInviteCodes, deleteInviteCode,
  };
};
