// CRM activities: notes and follow-up tasks on a lead, via the lead-pipeline API.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

describe('CRM activities & tasks', () => {
  let knex, app, workspaceId, leadId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'Act Org', owner_user_id: 1 }).returning('id');
    const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'Act Co', slug: 'act' }).returning('id');
    workspaceId = ws?.id ?? ws;
    const repo = require('../repos/leadPipelineRepo')(knex);
    leadId = (await repo.addLeadEvent(workspaceId, { full_name: 'Ravi', phone_number: '+91' })).id;

    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = workspaceId; req.session = { userId: 1 }; next(); });
    app.use('/api/lead-pipeline', require('../routes/leadPipeline')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { await knex.destroy(); });

  test('add a note and a task, then list them (newest first)', async () => {
    await request(app).post(`/api/lead-pipeline/leads/${leadId}/activities`).send({ kind: 'note', body: 'Called, interested' });
    await request(app).post(`/api/lead-pipeline/leads/${leadId}/activities`).send({ kind: 'task', body: 'Send quote', due_at: 1000 });
    const list = (await request(app).get(`/api/lead-pipeline/leads/${leadId}/activities`)).body;
    expect(list.length).toBe(2);
    expect(list[0].kind).toBe('task'); // newest first
    expect(list[1].body).toBe('Called, interested');
  });

  test('an empty note is rejected', async () => {
    const r = await request(app).post(`/api/lead-pipeline/leads/${leadId}/activities`).send({ kind: 'note', body: '   ' });
    expect(r.status).toBe(400);
  });

  test('open task shows on the lead list badge, and marking it done clears it', async () => {
    let lead = (await request(app).get('/api/lead-pipeline/leads')).body.find((l) => l.id === leadId);
    expect(lead.open_tasks).toBe(1);
    expect(lead.overdue_tasks).toBe(1); // due_at 1000 is in the past

    const task = (await request(app).get(`/api/lead-pipeline/leads/${leadId}/activities`)).body.find((a) => a.kind === 'task');
    await request(app).patch(`/api/lead-pipeline/activities/${task.id}`).send({ done: true });

    lead = (await request(app).get('/api/lead-pipeline/leads')).body.find((l) => l.id === leadId);
    expect(lead.open_tasks).toBe(0);
  });

  test('delete removes an activity', async () => {
    const note = (await request(app).get(`/api/lead-pipeline/leads/${leadId}/activities`)).body.find((a) => a.kind === 'note');
    await request(app).delete(`/api/lead-pipeline/activities/${note.id}`);
    const list = (await request(app).get(`/api/lead-pipeline/leads/${leadId}/activities`)).body;
    expect(list.find((a) => a.id === note.id)).toBeUndefined();
  });
});
