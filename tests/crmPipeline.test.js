// CRM Kanban pipeline: leads carry a stage, deal value, owner and expected close,
// updatable via PATCH /leads/:id, and the old status funnel still works.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

describe('CRM pipeline on leads', () => {
  let knex, app, workspaceId, repo, leadId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'CRM Org', owner_user_id: 1 }).returning('id');
    const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'Pipeline Co', slug: 'pipe' }).returning('id');
    workspaceId = ws?.id ?? ws;
    repo = require('../repos/leadPipelineRepo')(knex);
    const lead = await repo.addLeadEvent(workspaceId, { full_name: 'Ravi', phone_number: '+9199', status: 'new' });
    leadId = lead.id;

    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = workspaceId; req.session = { userId: 1 }; next(); });
    app.use('/api/lead-pipeline', require('../routes/leadPipeline')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { await knex.destroy(); });

  test('the migration adds the pipeline columns and defaults stage to new', async () => {
    for (const col of ['pipeline_stage', 'deal_value', 'expected_close', 'assigned_agent_name']) {
      expect(await knex.schema.hasColumn('meta_lead_events', col)).toBe(true);
    }
    expect((await repo.getLeadEvent(workspaceId, leadId)).pipeline_stage).toBe('new');
  });

  test('PATCH updates stage, deal value, owner and expected close', async () => {
    const r = await request(app).patch(`/api/lead-pipeline/leads/${leadId}`)
      .send({ pipeline_stage: 'qualified', deal_value: 50000, assigned_agent_name: 'Asha', expected_close: 1800000000 });
    expect(r.status).toBe(200);
    const got = await repo.getLeadEvent(workspaceId, leadId);
    expect(got.pipeline_stage).toBe('qualified');
    expect(got.deal_value).toBe(50000);
    expect(got.assigned_agent_name).toBe('Asha');
    expect(Number(got.expected_close)).toBe(1800000000);
  });

  test('a blank deal value clears it, and the old status field still updates independently', async () => {
    await request(app).patch(`/api/lead-pipeline/leads/${leadId}`).send({ deal_value: '', status: 'contacted' });
    const got = await repo.getLeadEvent(workspaceId, leadId);
    expect(got.deal_value).toBeNull();
    expect(got.status).toBe('contacted');
    expect(got.pipeline_stage).toBe('qualified'); // unchanged
  });

  test('only this workspace’s lead is updated (tenant scoped)', async () => {
    const [org2] = await knex('organizations').insert({ name: 'Other', owner_user_id: 2 }).returning('id');
    const [ws2] = await knex('workspaces').insert({ org_id: org2?.id ?? org2, name: 'Other Co', slug: 'other' }).returning('id');
    const other = await require('../repos/leadPipelineRepo')(knex).addLeadEvent(ws2?.id ?? ws2, { full_name: 'X', phone_number: '+91', status: 'new' });
    // try to update the other workspace's lead through our workspace-scoped app
    const r = await request(app).patch(`/api/lead-pipeline/leads/${other.id}`).send({ pipeline_stage: 'won' });
    expect(r.status).toBe(200); // route returns ok, but nothing should change in the other workspace
    const unchanged = await require('../repos/leadPipelineRepo')(knex).getLeadEvent(ws2?.id ?? ws2, other.id);
    expect(unchanged.pipeline_stage).toBe('new');
  });
});
