module.exports = (knex) => ({
  async get(userId) {
    return (await knex('user_settings').where({ user_id: userId }).first()) || {};
  },
  async save(userId, data) {
    const existing = await knex('user_settings').where({ user_id: userId }).first();
    if (existing) {
      return knex('user_settings').where({ user_id: userId }).update({ ...data, updated_at: Math.floor(Date.now()/1000) });
    }
    return knex('user_settings').insert({ user_id: userId, ...data });
  },
});
