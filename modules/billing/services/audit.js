// Append-only audit trail of everything a person changes in billing (requirements rule 12):
// who, when, what, old value, new value and the reason. Never updated, never deleted.
function makeAudit({ knex, clock }) {
  const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
  return {
    // trx: run inside the caller's transaction so the change and its audit row commit together
    async record({ actor, action, entity, entityId = null, accountId = null, oldValue, newValue, reason = null }, trx = knex) {
      await trx('bill_audit').insert({
        actor: String(actor || 'system').slice(0, 255), action, entity, entity_id: entityId == null ? null : String(entityId),
        account_id: accountId, old_value: json(oldValue), new_value: json(newValue),
        reason: reason ? String(reason).slice(0, 500) : null, created_at: clock.now(),
      });
    },
    async list({ entity, entityId, accountId, limit = 100 } = {}) {
      const q = knex('bill_audit').orderBy('id', 'desc').limit(Math.min(500, Math.max(1, limit)));
      if (entity) q.where({ entity });
      if (entityId != null) q.where({ entity_id: String(entityId) });
      if (accountId != null) q.where({ account_id: accountId });
      return q;
    },
  };
}

module.exports = { makeAudit };
