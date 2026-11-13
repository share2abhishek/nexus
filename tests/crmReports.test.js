// CRM pipeline report: value by stage, win rate, owner leaderboard, task summary.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

describe('CRM pipeline report', () => {
  let knex, app, workspaceId, repo;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'Rep Org', owner_user_id: 1 }).returning('id');
    const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'Rep Co', slug: 'rep' }).returning('id');
    workspaceId = ws?.id ?? ws;
    repo = require('../repos/leadPipelineRepo')(knex);
    const mk = async (stage, val, owner) => {
      const l = await repo.addLeadEvent(workspaceId, { full_name: 'L', phone_number: '+91' });
      await repo.updateLeadEvent(workspaceId, l.id, { pipeline_stage: stage, deal_value: val, assigned_agent_name: owner });
      return l;
    };
    await mk('qualified', 100000, 'Asha');
    await mk('proposal', 200000, 'Asha');
    await mk('won', 75000, 'Rahul');
    await mk('lost', 0, 'Rahul');
    const t = await mk('contacted', 25000, 'Asha');
    await repo.addActivity(workspaceId, t.id, { kind: 'task', body: 'call', due_at: 1 });

    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = workspaceId; req.session = { userId: 1 }; next(); });
    app.use('/api/lead-pipeline', require('../routes/leadPipeline')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { await knex.destroy(); });

  test('totals, open/won value and win rate', async () => {
    const r = (await request(app).get('/api/lead-pipeline/reports')).body;
    expect(r.total).toBe(5);
    expect(r.open_value).toBe(325000);   // qualified + proposal + contacted
    expect(r.won_value).toBe(75000);
    expect(r.win_rate).toBe(50);          // 1 won of 2 closed
    expect(r.tasks).toEqual({ open: 1, overdue: 1 });
  });

  test('stage breakdown and owner leaderboard', async () => {
    const r = (await request(app).get('/api/lead-pipeline/reports')).body;
    const byStage = Object.fromEntries(r.stages.map((s) => [s.stage, s]));
    expect(byStage.proposal.value).toBe(200000);
    expect(byStage.won.count).toBe(1);
    expect(r.owners[0].owner).toBe('Asha');       // highest combined value
    expect(r.owners[0].open_value).toBe(325000);
  });

  test('the report is scoped to the workspace', async () => {
    const [org2] = await knex('organizations').insert({ name: 'O2', owner_user_id: 2 }).returning('id');
    const [ws2] = await knex('workspaces').insert({ org_id: org2?.id ?? org2, name: 'W2', slug: 'w2' }).returning('id');
    const r2 = await repo.pipelineReport(ws2?.id ?? ws2);
    expect(r2.total).toBe(0);
    expect(r2.open_value).toBe(0);
  });
});
