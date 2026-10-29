// repos/historyRepo.js — workspace-scoped AI generation history
module.exports = (knex) => ({
  async save(workspaceId, userId, data) {
    await knex('history').insert({
      workspace_id: workspaceId,
      user_id:      userId       || null,
      prompt:       data.prompt,
      response:     data.response,
      type:         data.type        || 'social_post',
      model:        data.model       || null,
      tokens_used:  data.tokens_used || null,
    });
  },

  async list(workspaceId, limit = 50) {
    return knex('history')
      .where({ workspace_id: workspaceId })
      .orderBy('created_at', 'desc')
      .limit(limit);
  },
});
