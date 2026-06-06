module.exports = (knex) => ({
  async get(key, def = null) {
    const row = await knex('platform_config').where({ key }).first();
    return row ? row.value : def;
  },
  set(key, value) {
    return knex('platform_config').insert({ key, value: String(value) })
      .onConflict('key').merge({ value: String(value) });
  },
});
