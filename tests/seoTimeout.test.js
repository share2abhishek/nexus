// A website check that times out says WHY (could not connect, or connected but slow), and a failed
// check is tried again soon (15 minutes, then less often) instead of always waiting 6 hours.
const EventEmitter = require('events');
const net = require('net');
const { makeTestKnex } = require('./helpers/db');

jest.mock('axios', () => {
  const get = jest.fn(async () => { const e = new Error('timeout of 30000ms exceeded'); e.code = 'ECONNABORTED'; throw e; });
  return { get, head: get, post: jest.fn(), create: () => ({ get, head: get }), default: { get, head: get } };
});

const seoCheck = require('../services/seoCheck');
const autopilot = require('../services/seoAutopilot');

// A stand-in for opening a connection: answers, or says nothing
const fakeSocket = (event) => {
  const s = new EventEmitter();
  s.destroy = () => {};
  setImmediate(() => s.emit(event, event === 'error' ? Object.assign(new Error('x'), { code: 'EHOSTUNREACH' }) : undefined));
  return s;
};

describe('why a page timed out', () => {
  test('could not connect: says so and what to try (same server / network, or a site being updated)', async () => {
    const probe = async () => ({ ok: false, why: 'timeout', ms: 6000 });
    await expect(seoCheck.checkPage('http://8.8.8.8/', { timeout: 30000, probe })).rejects.toThrow(/could not connect to 8\.8\.8\.8.*no answer/);
    await expect(seoCheck.checkPage('http://8.8.8.8/', { timeout: 30000, probe })).rejects.toThrow(/same server or network/);
  });

  test('connected but slow: says the website was slow to send the page', async () => {
    const probe = async () => ({ ok: true, ms: 40 });
    await expect(seoCheck.checkPage('http://8.8.8.8/', { timeout: 30000, probe })).rejects.toThrow(/could connect, but the website was slow/);
  });

  test('the connection probe reports no answer, a refused connection, and never opens a local address', async () => {
    const spy = jest.spyOn(net, 'connect');
    spy.mockImplementationOnce(() => fakeSocket('timeout'));
    expect(await seoCheck.probeConnect('example.test', 443, 50)).toMatchObject({ ok: false, why: 'timeout' });
    spy.mockImplementationOnce(() => fakeSocket('error'));
    expect(await seoCheck.probeConnect('example.test', 443, 50)).toMatchObject({ ok: false, why: 'EHOSTUNREACH' });
    spy.mockImplementationOnce(() => fakeSocket('connect'));
    expect(await seoCheck.probeConnect('example.test', 443, 50)).toMatchObject({ ok: true });
    spy.mockRestore();
    // the real probe resolves names through the safe lookup: a local address is refused, not connected to
    const local = await seoCheck.probeConnect('localhost', 9, 500);
    expect(local.ok).toBe(false);
    expect(local.why).toBe('EBLOCKED');
  });
});

describe('trying again after a failed check', () => {
  test('15 minutes, 1 hour, 3 hours, then every 6 hours', () => {
    expect([1, 2, 3, 4, 5, 20].map(autopilot.retryDelay)).toEqual([900, 3600, 10800, 21600, 21600, 21600]);
    expect(autopilot.retryDelay(0)).toBe(900);
    expect(autopilot.retryDelay(undefined)).toBe(900);
  });

  test('a failed run counts up and schedules the next try; the message explains the failure', async () => {
    const knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'W', slug: 'w-timeout' }).returning('id');
    const ws = w?.id ?? w;
    const t = Math.floor(Date.now() / 1000);
    await knex('seo_sites').insert({ workspace_id: ws, url: 'http://8.8.8.8/', enabled: true, frequency: 'weekly', max_pages: 5, created_at: t, updated_at: t });
    jest.spyOn(net, 'connect').mockImplementation(() => fakeSocket('timeout'));

    const run = async () => autopilot.runSite(knex, await knex('seo_sites').where({ workspace_id: ws }).first(), { pageSpeed: false });
    let r = await run();
    expect(r.ok).toBe(false);
    let site = await knex('seo_sites').where({ workspace_id: ws }).first();
    expect(site.fail_count).toBe(1);
    expect(site.next_run_at - site.last_run_at).toBe(900);               // soon, not 6 hours
    expect(site.last_error).toMatch(/could not connect to 8\.8\.8\.8/);

    await run();
    site = await knex('seo_sites').where({ workspace_id: ws }).first();
    expect(site.fail_count).toBe(2);
    expect(site.next_run_at - site.last_run_at).toBe(3600);              // then less often
    jest.restoreAllMocks();
    await knex.destroy();
  }, 30000);
});
