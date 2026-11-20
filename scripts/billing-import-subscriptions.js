#!/usr/bin/env node
// Import today's organisations into the built-in billing (ROADMAP B0). A deliberate staff step.
//   node scripts/billing-import-subscriptions.js            dry run: prints what would be created, writes nothing
//   node scripts/billing-import-subscriptions.js --apply    creates the missing rows (automatic invoicing OFF), audited
// On the server: docker compose exec nexus-app node scripts/billing-import-subscriptions.js
require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || undefined });
const apply = process.argv.includes('--apply');

(async () => {
  const knex = require('../services/knex');
  try {
    await knex.migrate.latest(); // same migrations the app runs at start
    const { billing } = require('../services/billingHost');
    const b = billing();
    await b.seed();
    const plan = await b.importer.preview();
    console.log(`Today (IST): ${plan.today}`);
    for (const r of plan.rows) {
      const p = r.proposed;
      console.log(`${String(r.action).padEnd(6)} #${r.account_id} ${r.name}: ${p ? `${p.plan_code} ${p.status} trial_end=${p.trial_end_date || '-'} paid_until=${p.current_period_end || '-'}` : '-'}${r.reason ? `  (${r.reason})` : ''}`);
    }
    console.log(`create ${plan.counts.create}, already imported ${plan.counts.exists}, skipped ${plan.counts.skip}`);
    if (!apply) { console.log('Dry run: nothing written. Run again with --apply to create these rows.'); return; }
    const out = await b.importer.apply(`import script (${require('os').userInfo().username})`);
    console.log(`Created ${out.created} subscription rows (automatic invoicing off).`);
  } finally {
    await knex.destroy();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
