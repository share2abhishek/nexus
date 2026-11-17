// Lead actions: log a call/WhatsApp/email/meeting/demo/note/task with WHO did it and WHEN,
// default to the logged-in user, assign to a team member, edit, and never cross businesses.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const repoFactory = require('../repos/leadPipelineRepo');

jest.mock('axios');

describe('Lead actions (who and when)', () => {
  let knex, repo, app, ws1, ws2, lead1, lead2, ana, ben, outsider;
  const as = (userId, ws) => ({ 'x-user': String(userId), 'x-ws': String(ws) });

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'Acts Org', owner_user_id: 1 }).returning('id');
    const orgId = org?.id ?? org;
    const mkWs = async (slug) => { const [w] = await knex('workspaces').insert({ org_id: orgId, name: slug, slug }).returning('id'); return w?.id ?? w; };
    ws1 = await mkWs('acts-one'); ws2 = await mkWs('acts-two');
    const now = Math.floor(Date.now() / 1000);
    const mkUser = async (name, email) => { const [u] = await knex('users').insert({ email, name, password_hash: 'x', created_at: now }).returning('id'); return u?.id ?? u; };
    ana = await mkUser('Ana', 'ana@a.test');
    ben = await mkUser('Ben', 'ben@a.test');
    outsider = await mkUser('Olga', 'olga@b.test'); // belongs to the other business only
    await knex('memberships').insert([
      { user_id: ana, workspace_id: ws1, role: 'owner', status: 'active', created_at: now },
      { user_id: ben, workspace_id: ws1, role: 'editor', status: 'active', created_at: now },
      { user_id: outsider, workspace_id: ws2, role: 'owner', status: 'active', created_at: now },
    ]);
    repo = repoFactory(knex);
    lead1 = await repo.addLeadEvent(ws1, { full_name: 'Lead One', phone_number: '919000000001' });
    lead2 = await repo.addLeadEvent(ws2, { full_name: 'Lead Two', phone_number: '919000000002' });

    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = Number(req.headers['x-ws']); req.session = { userId: Number(req.headers['x-user']) }; next(); });
    app.use('/api/lead-pipeline', require('../routes/leadPipeline')(knex, () => (q, s, n) => n()));
  });
  afterAll(async () => { await knex.destroy(); });

  test('an action is credited to the logged-in user by default, with a timestamp', async () => {
    const before = Math.floor(Date.now() / 1000);
    const r = await request(app).post(`/api/lead-pipeline/leads/${lead1.id}/activities`).set(as(ana, ws1)).send({ kind: 'call', body: 'Spoke about pricing' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'call', actor_user_id: ana, actor_name: 'Ana' });
    expect(Number(r.body.acted_at)).toBeGreaterThanOrEqual(before);
  });

  test('can be credited to, or a task assigned to, another team member, at a chosen time', async () => {
    const when = Math.floor(Date.now() / 1000) - 3600;
    const r = await request(app).post(`/api/lead-pipeline/leads/${lead1.id}/activities`).set(as(ana, ws1))
      .send({ kind: 'task', body: 'Send quote', actor_user_id: ben, acted_at: when, due_at: when + 86400 });
    expect(r.body).toMatchObject({ kind: 'task', actor_user_id: ben, actor_name: 'Ben' });
    expect(Number(r.body.acted_at)).toBe(when);
    const list = await request(app).get(`/api/lead-pipeline/leads/${lead1.id}/activities`).set(as(ana, ws1));
    expect(list.body.length).toBe(2);
  });

  test('a time far in the future is not accepted', async () => {
    const r = await request(app).post(`/api/lead-pipeline/leads/${lead1.id}/activities`).set(as(ana, ws1))
      .send({ kind: 'note', body: 'future', acted_at: Math.floor(Date.now() / 1000) + 10 * 86400 });
    expect(Number(r.body.acted_at)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 301);
  });

  test('a person from another business can not be chosen', async () => {
    const r = await request(app).post(`/api/lead-pipeline/leads/${lead1.id}/activities`).set(as(ana, ws1)).send({ kind: 'call', body: 'x', actor_user_id: outsider });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not in your team/);
  });

  test('a lead of another business can not be written to', async () => {
    const r = await request(app).post(`/api/lead-pipeline/leads/${lead2.id}/activities`).set(as(ana, ws1)).send({ kind: 'call', body: 'x' });
    expect(r.status).toBe(404);
    expect(await knex('lead_activities').where({ lead_event_id: lead2.id }).count({ c: '*' }).first().then(x => Number(x.c))).toBe(0);
  });

  test('an entry can be edited: who, when, type and text', async () => {
    const created = await request(app).post(`/api/lead-pipeline/leads/${lead1.id}/activities`).set(as(ana, ws1)).send({ kind: 'note', body: 'first' });
    const when = Math.floor(Date.now() / 1000) - 7200;
    const r = await request(app).put(`/api/lead-pipeline/activities/${created.body.id}`).set(as(ana, ws1)).send({ kind: 'meeting', body: 'edited', actor_user_id: ben, acted_at: when });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'meeting', body: 'edited', actor_user_id: ben, actor_name: 'Ben' });
    expect(Number(r.body.acted_at)).toBe(when);
    expect(r.body.updated_at).toBeTruthy();
  });

  test('another business can not edit it, and an empty text is refused', async () => {
    const created = await request(app).post(`/api/lead-pipeline/leads/${lead1.id}/activities`).set(as(ana, ws1)).send({ kind: 'note', body: 'mine' });
    const other = await request(app).put(`/api/lead-pipeline/activities/${created.body.id}`).set(as(outsider, ws2)).send({ body: 'hijack' });
    expect(other.status).toBe(404);
    expect((await knex('lead_activities').where({ id: created.body.id }).first()).body).toBe('mine');
    const empty = await request(app).put(`/api/lead-pipeline/activities/${created.body.id}`).set(as(ana, ws1)).send({ body: '   ' });
    expect(empty.status).toBe(400);
  });

  test('team list: only this business, the logged-in user listed', async () => {
    const r = await request(app).get('/api/lead-pipeline/team').set(as(ana, ws1));
    expect(r.body.me.user_id).toBe(ana);
    expect(r.body.people.map(p => p.name).sort()).toEqual(['Ana', 'Ben']);
    const o = await request(app).get('/api/lead-pipeline/team').set(as(outsider, ws2));
    expect(o.body.people.map(p => p.name)).toEqual(['Olga']);
  });

  test('the leads list carries the last action (what, who, when) and the lead’s own timestamp', async () => {
    const r = await request(app).get('/api/lead-pipeline/leads').set(as(ana, ws1));
    const l = r.body.find(x => x.id === lead1.id);
    expect(l.created_at).toBeTruthy();
    expect(l.last_action).toMatchObject({ by: expect.any(String) });
    expect(l.last_action.at).toBeGreaterThan(0);
    const none = (await request(app).get('/api/lead-pipeline/leads').set(as(outsider, ws2))).body.find(x => x.id === lead2.id);
    expect(none.last_action).toBeNull(); // business two's lead shows nothing of business one's actions
  });
});
