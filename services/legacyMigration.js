// One-time, idempotent migration of pre-tenancy desktop data into a default org/workspace.
const STAMP_TABLES = ['posts','scheduled_posts','history','analytics','seo_keywords',
  'utm_links','templates','email_subscribers','email_campaigns','apps','brand_kit','user_settings'];

module.exports = async function runLegacyMigration(knex) {
  const cfg = require('../repos/configRepo')(knex);
  if (await cfg.get('tenancy_migrated') === '1') return;

  // Pre-flight schema checks outside the transaction (SQLite schema queries don't participate in transactions)
  const hasTokens = await knex.schema.hasTable('tokens');
  const stampableTables = [];
  for (const tbl of STAMP_TABLES) {
    if (await knex.schema.hasTable(tbl) && await knex.schema.hasColumn(tbl, 'workspace_id')) {
      stampableTables.push(tbl);
    }
  }

  await knex.transaction(async (trx) => {
    const admin = await trx('users').where('role', 'admin').orderBy('id').first();
    if (!admin) { await trx('platform_config').insert({ key: 'tenancy_migrated', value: '1' }).onConflict('key').merge({ value: '1' }); return; }

    const orgName = 'My Organization';
    const orgRows = await trx('organizations').insert({ name: orgName, owner_user_id: admin.id, plan: 'free' }).returning('id');
    const orgId = orgRows[0]?.id ?? orgRows[0];
    await trx('org_members').insert({ org_id: orgId, user_id: admin.id, role: 'owner' });

    const wsRows = await trx('workspaces').insert({ org_id: orgId, name: 'My Workspace', slug: 'my-workspace', timezone: 'UTC' }).returning('id');
    const wsId = wsRows[0]?.id ?? wsRows[0];

    const users = await trx('users');
    for (const u of users) {
      await trx('memberships').insert({ user_id: u.id, workspace_id: wsId, role: 'manager' }).onConflict(['user_id','workspace_id']).ignore();
    }

    if (hasTokens) {
      const tokens = await trx('tokens');
      for (const tk of tokens) {
        await trx('social_accounts').insert({
          workspace_id: wsId, platform: tk.platform, external_id: tk.external_id || tk.platform,
          access_token: tk.access_token, refresh_token: tk.refresh_token || null,
          expires_at: tk.expires_at || null, profile_json: tk.profile || null,
          page_id: tk.page_id || null, page_token: tk.page_token || null,
          ig_account_id: tk.ig_account_id || null, board_id: tk.board_id || null,
        }).onConflict(['workspace_id','platform','external_id']).ignore();
      }
    }

    for (const tbl of stampableTables) {
      await trx(tbl).whereNull('workspace_id').update({ workspace_id: wsId });
    }

    await trx('platform_config').insert({ key: 'tenancy_migrated', value: '1' }).onConflict('key').merge({ value: '1' });
  });
};
