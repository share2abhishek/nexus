// The billing module (docs/billing/REQUIREMENTS.md). A bounded context: nothing here requires host code; the host
// passes knex and its ports in (Nexus: services/billingHost.js). tests/billing/boundary.test.js enforces it.
//
//   const billing = require('./modules/billing').init({ knex, ports });
//   billing.seed()            insert-only catalogue seed (safe to run on every start)
//   billing.adminRouter()     staff routes (B0: catalogue, prices, tax, coupons, quote, import preview)
//   billing.catalogue, billing.importer, billing.audit
const { check } = require('./ports');
const { makeAudit } = require('./services/audit');
const { makeCatalogue } = require('./services/catalogue');
const { makeImporter } = require('./services/importer');
const { seed } = require('./services/seeder');
const { makeAdminRouter } = require('./routes/admin');

function init({ knex, ports }) {
  check(ports);
  const clock = ports.clock;
  const audit = makeAudit({ knex, clock });
  const catalogue = makeCatalogue({ knex, clock, audit, ports });
  const importer = makeImporter({ knex, clock, audit, ports });

  let seeding = null;
  const doSeed = () => seed({ knex, clock, ports });
  // Seeds once per process, the first time billing is used (and again after a failure)
  const ready = () => {
    if (!seeding) seeding = doSeed().catch((e) => { seeding = null; throw e; });
    return seeding;
  };

  const svc = { audit, catalogue, importer };
  return { ...svc, seed: doSeed, ready, adminRouter: () => makeAdminRouter({ svc, ports, ready }) };
}

module.exports = { init };
