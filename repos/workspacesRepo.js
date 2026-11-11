// Factory: pass a knex instance, get async data methods. (Enables test injection.)
module.exports = (knex) => ({
  async create({ orgId, name, slug, timezone = 'UTC' }) {
    const rows = await knex('workspaces')
      .insert({ org_id: orgId, name, slug, timezone })
      .returning('id');
    const id = Array.isArray(rows) ? (rows[0]?.id ?? rows[0]) : rows;
    return knex('workspaces').where({ id }).first();
  },
  list(orgId)   { return knex('workspaces').where({ org_id: orgId }).orderBy('name'); },
  get(id)       { return knex('workspaces').where({ id }).first(); },
  update(id, p) { return knex('workspaces').where({ id }).update(p); },
  remove(id)    { return knex('workspaces').where({ id }).del(); },
});
