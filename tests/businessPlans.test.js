// Server edition (hosted for many businesses): each business's trial or plan
// decides whether it may publish, and its plan's limits apply to it alone.
// The desktop app keeps its licence.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

const mockKnex = makeTestKnex();
const knex = mockKnex;
jest.mock('../services/knex', () => mockKnex);
jest.mock('../services/social', () => ({ postToPlatform: jest.fn(async () => ({ success: true })) }));
jest.mock('../services/cloudPosting', () => ({ takeOver: async () => ({}) }));
jest.mock('../services/tokenRefresher', () => ({ ensureFresh: async () => {}, checkFacebook: async () => {} }));

const entitlements = require('../services/entitlements');
const { postToPlatform } = require('../services/social');

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const env = { ...process.env };

async function business(name, fields) {
  const [o] = await knex('organizations').insert({ name, owner_user_id: 1, ...fields }).returning('id');
  const orgId = o?.id ?? o;
  const [w] = await knex('workspaces').insert({ org_id: orgId, name, slug: name.toLowerCase().replace(/\W+/g, '-') }).returning('id');
  return { orgId, wsId: w?.id ?? w };
}
const setOrg = async (orgId, fields) => { await knex('organizations').where({ id: orgId }).update(fields); entitlements.forget(orgId); };

beforeAll(async () => { process.env.NEXUS_MODE = 'server'; await knex.migrate.latest(); });
afterAll(async () => { process.env = env; await knex.destroy(); });

describe('may a business publish?', () => {
  test('trial: yes while it lasts, then no, with a plain message', async () => {
    const { orgId, wsId } = await business('Trial Co', { plan: 'trial', trial_ends_at: now() + 5 * DAY });
    expect(await entitlements.forWorkspace(wsId)).toMatchObject({ can_publish: true, state: 'active', plan_name: 'Free trial', trial_days_left: 5 });

    await setOrg(orgId, { trial_ends_at: now() - 60 });
    const s = await entitlements.forWorkspace(wsId);
    expect(s).toMatchObject({ can_publish: false, state: 'expired' });
    expect(s.message).toBe('The free trial for Trial Co has ended. Choose a plan to keep publishing; your posts and settings are kept.');
  });

  test('paid plan: active, overdue within the grace days, then stopped; cancelled and paused say why', async () => {
    const { orgId, wsId } = await business('Paid Co', { plan: 'agency', plan_status: 'active', paid_until: now() + 20 * DAY });
    expect(await entitlements.forWorkspace(wsId)).toMatchObject({ can_publish: true, state: 'active', plan_name: 'Agency', message: null });

    await setOrg(orgId, { paid_until: now() - DAY }); // a day late: still publishing, with a reminder
    const late = await entitlements.forWorkspace(wsId);
    expect(late.can_publish).toBe(true);
    expect(late.message).toMatch(/payment is overdue: renew within 2 days/);

    await setOrg(orgId, { paid_until: now() - 4 * DAY }); // past the 3 grace days
    expect(await entitlements.forWorkspace(wsId)).toMatchObject({ can_publish: false, state: 'expired' });
    expect((await entitlements.forWorkspace(wsId)).message).toMatch(/isn’t paid up/);

    await setOrg(orgId, { plan_status: 'cancelled', paid_until: now() - 4 * DAY });
    expect((await entitlements.forWorkspace(wsId)).message).toMatch(/was cancelled/);

    await setOrg(orgId, { plan_status: 'suspended', paid_until: now() + 20 * DAY });
    expect(await entitlements.forWorkspace(wsId)).toMatchObject({ can_publish: false, state: 'invalid' });
    expect((await entitlements.forWorkspace(wsId)).message).toMatch(/paused by Radixile/);
  });

  test('routes answer 402 with the business’s reason; another business is not affected', async () => {
    const ended = await business('Ended Co', { plan: 'trial', trial_ends_at: now() - DAY });
    const fine = await business('Fine Co', { plan: 'trial', trial_ends_at: now() + 3 * DAY });
    const { requirePublishLicense } = require('../middleware/license');
    const app = express();
    app.use((req, res, next) => { req.workspaceId = Number(req.headers['x-ws']); next(); });
    app.post('/publish', requirePublishLicense, (req, res) => res.json({ ok: true }));
    const blocked = await request(app).post('/publish').set('x-ws', String(ended.wsId));
    expect(blocked.status).toBe(402);
    expect(blocked.body).toMatchObject({ code: 'LICENSE_REQUIRED', license_state: 'expired' });
    expect(blocked.body.error).toMatch(/free trial for Ended Co has ended/);
    expect(blocked.body.error).not.toMatch(/Settings → Licence/); // no licence keys on the hosted edition
    expect((await request(app).post('/publish').set('x-ws', String(fine.wsId))).status).toBe(200);
  });

  test('the scheduler posts for businesses that may publish and leaves the others’ posts scheduled', async () => {
    const ended = await business('Late Co', { plan: 'trial', trial_ends_at: now() - DAY });
    const fine = await business('Busy Co', { plan: 'individual', plan_status: 'active', paid_until: now() + 30 * DAY });
    const repo = require('../repos/contentRepo')(knex);
    const items = {};
    for (const [key, b] of Object.entries({ ended, fine })) {
      const [a] = await knex('social_accounts').insert({ workspace_id: b.wsId, platform: 'linkedin', external_id: `li-${key}`, access_token: 't' }).returning('id');
      const id = await repo.create(b.wsId, 1, { body: `Post from ${key}`, platforms: ['linkedin'], social_account_ids: [a?.id ?? a] });
      await knex('content_items').where({ id }).update({ status: 'scheduled', scheduled_at: now() - 30 });
      items[key] = id;
    }
    postToPlatform.mockClear();
    await require('../services/scheduler').processDueContent(knex, repo);
    expect(postToPlatform).toHaveBeenCalledTimes(1);
    expect(postToPlatform.mock.calls[0][2]).toBe('Post from fine');
    expect((await knex('content_items').where({ id: items.fine }).first()).status).toBe('published');
    expect((await knex('content_items').where({ id: items.ended }).first()).status).toBe('scheduled'); // waits, not lost

    // Renewed: it goes out on the next run
    await setOrg(ended.orgId, { plan: 'individual', plan_status: 'active', paid_until: now() + 30 * DAY });
    await require('../services/scheduler').processDueContent(knex, repo);
    expect((await knex('content_items').where({ id: items.ended }).first()).status).toBe('published');
  });
});

describe('plan limits apply to each business', () => {
  test('workspaces, team members and autopilot websites, with the plan in the message', async () => {
    const { orgId, wsId } = await business('Small Co', { plan: 'individual', plan_status: 'active', paid_until: now() + 30 * DAY });
    // Individual: 1 workspace (already has it), 2 team members, 1 autopilot website
    expect(await entitlements.limitProblemForOrg(orgId, 'workspaces')).toBe('The Individual plan includes 1 brand/client workspaces. Choose a bigger plan to add more.');
    await knex('memberships').insert([{ user_id: 501, workspace_id: wsId, role: 'manager' }]);
    expect(await entitlements.limitProblem(wsId, 'users')).toBeNull();
    await knex('memberships').insert([{ user_id: 502, workspace_id: wsId, role: 'creator' }]);
    expect(await entitlements.limitProblem(wsId, 'users')).toMatch(/includes 2 team members/);
    expect(await entitlements.limitProblem(wsId, 'seo_sites')).toBeNull();
    await knex('seo_sites').insert({ workspace_id: wsId, url: 'https://small.example', created_at: now(), updated_at: now() });
    expect(await entitlements.limitProblem(wsId, 'seo_sites')).toMatch(/1 websites in the SEO autopilot/);

    // Another business's usage doesn't count against this one
    const other = await business('Other Co', { plan: 'agency', plan_status: 'active', paid_until: now() + 30 * DAY });
    expect(await entitlements.limitProblem(other.wsId, 'users')).toBeNull();
    // The trial says so
    const trial = await business('Try Co', { plan: 'trial', trial_ends_at: now() + DAY });
    await knex('workspaces').insert([{ org_id: trial.orgId, name: 'b', slug: 'try-b' }, { org_id: trial.orgId, name: 'c', slug: 'try-c' }]);
    expect(await entitlements.limitProblemForOrg(trial.orgId, 'workspaces')).toMatch(/includes 3 brand\/client workspaces during the trial/);
  });

  test('invitations past the plan’s team size are refused', async () => {
    const { wsId } = await business('Invite Co', { plan: 'individual', plan_status: 'active', paid_until: now() + 30 * DAY });
    await knex('memberships').insert([{ user_id: 601, workspace_id: wsId, role: 'manager' }, { user_id: 602, workspace_id: wsId, role: 'creator' }]);
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { userId: 601 }; next(); });
    app.use('/invitations', require('../routes/invitations')(knex, (req, res, next) => { req.workspaceId = wsId; next(); }, () => (req, res, next) => next()));
    const r = await request(app).post('/invitations').send({ email: 'third@invite.test', role: 'creator' });
    expect(r.status).toBe(402);
    expect(r.body.error).toMatch(/Individual plan includes 2 team members/);
  });

  test('a Radixile admin can override the plans (saas_plans)', async () => {
    await require('../repos/configRepo')(knex).set('saas_plans', JSON.stringify({ individual: { name: 'Solo', limits: { workspaces: 2, users: 2, seo_sites: 1 } } }));
    const { orgId } = await business('Solo Co', { plan: 'individual', plan_status: 'active', paid_until: now() + 30 * DAY });
    // Plans are cached for a minute; a fresh lookup after the cache sees the override
    const plans = await entitlements.plans(true);
    expect(plans.individual.name).toBe('Solo');
    entitlements.forget();
    expect(await entitlements.limitProblemForOrg(orgId, 'workspaces')).toBeNull(); // 1 used of 2
  });
});

describe('desktop app', () => {
  test('keeps using the install’s licence', async () => {
    delete process.env.NEXUS_MODE;
    const license = require('../services/license');
    const spy = jest.spyOn(license, 'status').mockReturnValue({ can_publish: false, state: 'unlicensed', limits: {} });
    expect(await entitlements.forWorkspace(1)).toMatchObject({ state: 'unlicensed' });
    expect(await entitlements.canPublish(1)).toBe(false);
    spy.mockRestore();
    process.env.NEXUS_MODE = 'server';
  });
});

describe('a Radixile admin sets a business’s plan (until online payment)', () => {
  test('only admins; the change applies straight away; bad values are refused', async () => {
    const session = require('express-session');
    const { orgId, wsId } = await business('Upgrade Co', { plan: 'trial', trial_ends_at: now() - DAY });
    const [admin] = await knex('users').insert({ email: 'ops@radixile.test', password_hash: 'x', role: 'admin' }).returning('id');
    const [customer] = await knex('users').insert({ email: 'owner@upgrade.test', password_hash: 'x', role: 'user' }).returning('id');
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 't', resave: false, saveUninitialized: false }));
    app.post('/as/:id', (req, res) => { req.session.userId = Number(req.params.id); res.json({}); });
    app.use('/admin', require('../routes/admin'));

    const cust = request.agent(app);
    await cust.post(`/as/${customer?.id ?? customer}`);
    expect((await cust.patch(`/admin/organizations/${orgId}/plan`).send({ plan: 'full' })).status).toBe(403);

    const ops = request.agent(app);
    await ops.post(`/as/${admin?.id ?? admin}`);
    expect(await entitlements.canPublish(wsId)).toBe(false);
    const r = await ops.patch(`/admin/organizations/${orgId}/plan`).send({ plan: 'agency', plan_status: 'active', paid_until: '2099-12-31' });
    expect(r.status).toBe(200);
    expect(r.body.status).toMatchObject({ can_publish: true, plan_name: 'Agency' });
    expect(await entitlements.canPublish(wsId)).toBe(true); // no waiting for the cache
    expect((await ops.patch(`/admin/organizations/${orgId}/plan`).send({ plan: 'gold' })).body.error).toMatch(/Unknown plan/);
    expect((await ops.patch(`/admin/organizations/${orgId}/plan`).send({ paid_until: 'next week' })).status).toBe(400);

    const list = (await ops.get('/admin/organizations')).body;
    expect(list.organizations.find((o) => o.id === orgId)).toMatchObject({ plan: 'agency', can_publish: true, usage: { workspaces: 1 } });
  });
});
