// Personal API keys are stored encrypted (services/secrets.js)
const { seal, SEALED_COLUMNS } = require('../services/secrets');
const sealKeys = (data) => Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, SEALED_COLUMNS.user_settings.cols.includes(k) ? seal(v) : v]));
module.exports = (knex) => ({
  async get(userId) {
    return (await knex('user_settings').where({ user_id: userId }).first()) || {};
  },
  async save(userId, data) {
    const existing = await knex('user_settings').where({ user_id: userId }).first();
    if (existing) {
      return knex('user_settings').where({ user_id: userId }).update({ ...sealKeys(data), updated_at: Math.floor(Date.now()/1000) });
    }
    return knex('user_settings').insert({ user_id: userId, ...sealKeys(data) });
  },
});
