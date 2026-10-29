// Installs from before the admin role existed have only plain users, so nobody
// can activate a licence or change admin-only settings. Runs once per install
// (after that, admins are managed in Settings → Users; the app already stops an
// admin removing their own role, so one always remains).
//
// Who becomes admin: the owner of the install's first organization (on an upgraded
// install that is the person who set it up), else the most recently active
// account, else the first one — never a suspended account if another exists.
// Returns the promoted user, or null when nothing changed.
const FLAG = 'admin_ensured';

module.exports = async function ensureAdmin(knex) {
  const cfg = require('../repos/configRepo')(knex);
  if (await cfg.get(FLAG) === '1') return null;

  const promoted = await knex.transaction(async (trx) => {
    if (await trx('users').where({ role: 'admin' }).first('id')) return null;
    const active = () => trx('users').where(q => q.whereNull('status').orWhereNot('status', 'suspended'));

    let pick = null;
    if (await trx.schema.hasTable('organizations')) {
      const org = await trx('organizations').whereNotNull('owner_user_id').orderBy('id', 'asc').first('owner_user_id');
      if (org) pick = await active().where({ id: org.owner_user_id }).first('id', 'email');
    }
    if (!pick) pick = await active().whereNotNull('last_active').orderBy('last_active', 'desc').first('id', 'email');
    if (!pick) pick = await active().orderBy('id', 'asc').first('id', 'email');
    if (!pick) pick = await trx('users').orderBy('id', 'asc').first('id', 'email');
    if (!pick) return undefined; // no accounts yet: the first sign-up becomes admin

    await trx('users').where({ id: pick.id }).update({ role: 'admin' });
    console.log(`[Setup] No admin found: ${pick.email} is now the admin of this installation.`);
    return pick;
  });

  // Fresh install with no accounts: check again next start
  if (promoted !== undefined) await cfg.set(FLAG, '1');
  return promoted || null;
};
