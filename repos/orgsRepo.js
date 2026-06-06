module.exports = (knex) => ({
  async create({ name, ownerUserId, plan = 'free' }) {
    const rows = await knex('organizations').insert({ name, owner_user_id: ownerUserId, plan }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    await knex('org_members').insert({ org_id: id, user_id: ownerUserId, role: 'owner' }).catch(() => {});
    return knex('organizations').where({ id }).first();
  },
  list(userId) {
    return knex('organizations as o')
      .join('org_members as m', 'm.org_id', 'o.id')
      .where('m.user_id', userId)
      .select('o.*', 'm.role as org_role');
  },
});
