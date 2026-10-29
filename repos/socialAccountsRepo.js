module.exports = (knex) => ({
  add(workspaceId, data) {
    return knex('social_accounts').insert({
      workspace_id: workspaceId,
      platform: data.platform,
      account_label: data.account_label || null,
      external_id: data.external_id || null,
      access_token: data.access_token || null,
      refresh_token: data.refresh_token || null,
      expires_at: data.expires_at || null,
      profile_json: data.profile ? JSON.stringify(data.profile) : null,
      page_id: data.page_id || null,
      page_token: data.page_token || null,
      ig_account_id: data.ig_account_id || null,
      board_id: data.board_id || null,
    }).onConflict(['workspace_id', 'platform', 'external_id']).merge();
  },
  async list(workspaceId) {
    const rows = await knex('social_accounts').where({ workspace_id: workspaceId });
    return rows.map(r => {
      if (r.profile_json) {
        try { r.profile = JSON.parse(r.profile_json); } catch {}
      }
      // A row without a login token can't post (the publisher skips it), e.g. one
      // copied from an old version without its token: show it as "sign in again".
      r.usable = !!r.access_token;
      return r;
    });
  },
  getByPlatform(workspaceId, platform) {
    return knex('social_accounts').where({ workspace_id: workspaceId, platform }).first();
  },
  remove(workspaceId, id) {
    return knex('social_accounts').where({ workspace_id: workspaceId, id }).del();
  },
});
