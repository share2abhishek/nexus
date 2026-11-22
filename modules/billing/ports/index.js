// What the host product must provide (docs/billing/REQUIREMENTS.md section 3.2). The billing module never
// requires host code: the host passes these in with billing.init({ knex, ports }) (Nexus: services/billingHost.js).
//
//   host.isServer()                         billing exists only on the hosted (server) edition
//   host.enabled()                          BILLING_ENABLED (read on every request, so a switch needs no restart)
//   clock.now()                             epoch seconds
//   clock.todayIST()                        'YYYY-MM-DD' in India time; the only source of "today"
//   accounts.getAccount(id)                 { id, name } or null
//   accounts.listAccounts()                 [{ id, name, created_at }]
//   accounts.countSeatUnits(accountId)      the unit a PER_UNIT price multiplies by
//   accounts.countOnPlan(planCode)          how many accounts are on a plan today (for "clients on this plan")
//   accounts.actorOf(userId)                a label for the audit trail (the staff e-mail)
//   catalogue.defaults()                    { plans: [{ code, name, rank, public, limits, price_monthly_minor }],
//                                             features: [{ key, name, module, requires, requiresAny }],
//                                             limits: [{ key, name, unit }] }
//   catalogue.checkFeatures(enabledKeys)    [] when the set is possible, else ['AI answers needs WhatsApp auto-replies', ...]
//   catalogue.importState(accountId)        the account's plan state today, for the one-off import:
//                                           { plan, plan_status, trial_ends_at, paid_until } (epoch seconds)
//
// notifier and files arrive in later phases (B3 onwards).

const REQUIRED = {
  host: ['isServer', 'enabled'],
  clock: ['now', 'todayIST'],
  accounts: ['getAccount', 'listAccounts', 'countSeatUnits', 'countOnPlan', 'actorOf'],
  catalogue: ['defaults', 'checkFeatures', 'importState'],
};

function check(ports) {
  const missing = [];
  for (const [port, methods] of Object.entries(REQUIRED)) {
    for (const m of methods) if (typeof ports?.[port]?.[m] !== 'function') missing.push(`${port}.${m}`);
  }
  if (missing.length) throw new Error(`[billing] the host did not provide: ${missing.join(', ')}`);
  return ports;
}

module.exports = { REQUIRED, check };
