// Website SEO page check, App store listing limits, Google Business locations.
// Websites and Google's API are stand-ins: nothing leaves the machine.
const request = require('supertest');
const express = require('express');

const mockWeb = {};      // url -> { status, body, headers }
const mockPosts = [];
jest.mock('axios', () => {
  const get = jest.fn(async (url, cfg = {}) => {
    const hit = mockWeb[url] || mockWeb[url.replace(/\?.*$/, '')];
    if (typeof hit === 'function') return hit(url, cfg);
    if (!hit) { const e = new Error('getaddrinfo ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }
    if (hit.error) throw hit.error;
    return { status: hit.status || 200, data: hit.body ?? hit.data, headers: hit.headers || { 'content-type': 'text/html' }, request: { res: { responseUrl: url } } };
  });
  const post = jest.fn(async (url, body) => { mockPosts.push({ url, body }); return { data: { name: 'post/1' } }; });
  return { get, post, create: () => ({ get, post }), default: { get, post } };
});
jest.mock('../services/aiHelper', () => ({
  ...jest.requireActual('../services/aiHelper'),
  aiJSON: jest.fn(async () => { throw new Error('no AI'); }),
}));
jest.mock('../services/knex', () => ({}));
jest.mock('../repos/seoRepo', () => () => ({ list: async () => [], save: async () => 1, remove: async () => {} }));
jest.mock('../repos/historyRepo', () => () => ({ save: async () => {} }));

const dns = require('dns').promises;
const seoCheck = require('../services/seoCheck');
const aiHelper = require('../services/aiHelper');

const PAGE = `<!doctype html><html lang="en"><head>
<title>Office Interiors in Pune | Acme Interiors</title>
<meta name="description" content="Office interiors in Pune: we design and fit out small offices in 4 weeks, from plan to furniture. See our recent projects and ask for a quote.">
<meta name="viewport" content="width=device-width">
<link rel="canonical" href="https://acme.example/">
<meta property="og:title" content="Acme Interiors">
</head><body><h1>Office interiors in Pune</h1><p>${'We design offices. '.repeat(40)}</p>
<img src="a.jpg" alt="Our studio"><img src="b.jpg"><a href="/about">About</a><a href="https://other.example">x</a></body></html>`;

describe('Website SEO: check a page', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockWeb)) delete mockWeb[k];
    jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });
  afterEach(() => jest.restoreAllMocks());

  test('reads what Google reads: robots.txt, noindex, sitemap, title, description, headings, pictures', async () => {
    mockWeb['https://acme.example'] = { body: PAGE };
    mockWeb['https://acme.example/robots.txt'] = { body: 'User-agent: *\nDisallow: /admin\nSitemap: https://acme.example/sitemap.xml', headers: { 'content-type': 'text/plain' } };
    const r = await seoCheck.checkPage('acme.example', { keyword: 'office interiors' });
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(by.status.status).toBe('good');
    expect(by.robots_txt.status).toBe('good');
    expect(by.noindex.status).toBe('good');
    expect(by.sitemap.detail).toMatch(/sitemap\.xml/);
    expect(by.title.status).toBe('good');
    expect(by.h1.detail).toMatch(/Office interiors in Pune/);
    expect(by.alt.detail).toBe('1 of 2 pictures have none.');
    expect(by.kw_title.status).toBe('good');
    expect(by.social.status).toBe('warn'); // no og:image
    expect(r.page.word_count).toBeGreaterThan(100);
  });

  test('finds what keeps a page out of Google', async () => {
    mockWeb['https://acme.example/private'] = { body: PAGE.replace('<head>', '<head><meta name="robots" content="noindex,follow">') };
    mockWeb['https://acme.example/robots.txt'] = { body: 'User-agent: Googlebot\nDisallow: /private\n\nUser-agent: *\nAllow: /', headers: { 'content-type': 'text/plain' } };
    const r = await seoCheck.checkPage('https://acme.example/private');
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(by.robots_txt.status).toBe('bad');
    expect(by.noindex.status).toBe('bad');
    expect(by.sitemap.status).toBe('warn');
  });

  test('won’t open addresses on this PC or the local network', async () => {
    await expect(seoCheck.checkPage('http://localhost:3000')).rejects.toThrow(/public web address/);
    await expect(seoCheck.checkPage('192.168.1.10')).rejects.toThrow(/public web address/);
    dns.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(seoCheck.checkPage('intranet.example.com')).rejects.toThrow(/local network/);
  });

  test('text numbers are measured, not guessed', () => {
    const s = seoCheck.analyzeText('Office booking is easy. Our office booking app helps small teams book desks.', 'office booking');
    expect(s).toMatchObject({ word_count: 13, sentence_count: 2, keyword_count: 2, keyword_in_first_100_words: true });
    expect(s.keyword_density).toBeCloseTo(30.8, 1);
  });
});

describe('Website SEO and App store routes', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = 1; req.session = { userId: 1 }; next(); });
    app.use('/api/seo', require('../routes/seo'));
  });
  beforeEach(() => jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]));
  afterEach(() => { jest.restoreAllMocks(); aiHelper.aiJSON.mockReset(); });

  test('“Check my text” still gives the measured numbers when AI isn’t available', async () => {
    aiHelper.aiJSON.mockRejectedValue(new Error('No AI set up'));
    const r = await request(app).post('/api/seo/optimize').send({ content: 'Desk booking for small offices. Book a desk in seconds.', target_keyword: 'desk booking' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ word_count: 10, keyword_count: 1, ai_error: 'No AI set up' });
    expect(r.body).not.toHaveProperty('seo_score');
  });

  test('the title writer reads the page when given an address', async () => {
    mockWeb['https://acme.example'] = { body: PAGE };
    aiHelper.aiJSON.mockImplementation(async (prompt) => {
      expect(prompt).toMatch(/We design offices/);
      return { data: { meta_title: 'Office Interiors in Pune — Acme', meta_description: 'x', seo_score: 99 } };
    });
    const r = await request(app).post('/api/seo/meta').send({ url: 'acme.example' });
    expect(r.status).toBe(200);
    expect(r.body.current.title).toBe('Office Interiors in Pune | Acme Interiors');
    expect(r.body).not.toHaveProperty('seo_score');
  });

  test('App store listing: real store fields, limits checked, keyword box cleaned up', async () => {
    aiHelper.aiJSON.mockResolvedValue({ data: {
      app_store: { name: 'TaskFlow Smart To-Do List Planner App', subtitle: 'Plan your day', promotional_text: 'New!', keywords: 'taskflow, planner, todo, todo, reminders, habits', description: 'd' },
      play_store: { title: 'TaskFlow', short_description: 's', full_description: 'f', keywords: ['x'] },
      screenshot_ideas: ['a'], tips: ['b'],
    } });
    const r = await request(app).post('/api/seo/aso').send({ app_name: 'TaskFlow', platform: 'both' });
    expect(r.status).toBe(200);
    expect(r.body.app_store.name).toMatchObject({ max: 30, too_long: true });
    // words already in the name/subtitle and repeats are left out
    expect(r.body.app_store.keywords.text).toBe('todo,reminders,habits');
    expect(r.body.play_store).not.toHaveProperty('keywords'); // Google Play has no keyword box
    expect(r.body.play_store.title).toMatchObject({ text: 'TaskFlow', max: 30, too_long: false });

    const ios = await request(app).post('/api/seo/aso').send({ app_name: 'TaskFlow', platform: 'ios' });
    expect(ios.body.play_store).toBeUndefined();
  });
});

describe('Google Business locations', () => {
  const gb = require('../services/platforms/googleBusiness');
  const ACC = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
  const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
  beforeEach(() => { for (const k of Object.keys(mockWeb)) delete mockWeb[k]; mockPosts.length = 0; });

  test('finds locations in any account (the first is often a personal one with none)', async () => {
    mockWeb[ACC] = { data: { accounts: [{ name: 'accounts/1', accountName: 'Me' }, { name: 'accounts/2', accountName: 'Acme' }] } };
    mockWeb[`${INFO}/accounts/1/locations`] = { data: {} };
    mockWeb[`${INFO}/accounts/2/locations`] = { data: { locations: [
      { name: 'locations/10', title: 'Acme Baner', storefrontAddress: { addressLines: ['Baner Road'], locality: 'Pune' } },
      { name: 'locations/11', title: 'Acme Kothrud' }] } };
    const list = await gb.listLocations('tok');
    expect(list).toEqual([
      { account: 'accounts/2', account_title: 'Acme', location: 'locations/10', title: 'Acme Baner', address: 'Baner Road, Pune' },
      { account: 'accounts/2', account_title: 'Acme', location: 'locations/11', title: 'Acme Kothrud', address: '' },
    ]);

    // several locations and none chosen: it asks instead of guessing
    await expect(gb.postToGoogleBusiness('tok', 'accounts/2', 'Hello')).rejects.toThrow(/choose one on the Google Business card/);
    // the chosen one
    await gb.postToGoogleBusiness('tok', 'accounts/2', 'Hello', null, { location: 'locations/11' });
    expect(mockPosts[0].url).toBe('https://mybusiness.googleapis.com/v4/accounts/2/locations/11/localPosts');
  });

  test('says why when Google hasn’t approved API access', async () => {
    const e = new Error('429'); e.response = { status: 429, data: { error: { message: 'Quota exceeded for quota metric' } } };
    mockWeb[ACC] = { error: e };
    await expect(gb.listLocations('tok')).rejects.toThrow(/hasn’t given your Google Cloud project access/);
  });

  test('connecting with one location saves it; with several, asks to choose', async () => {
    const { makeTestKnex } = require('./helpers/db');
    const knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'W', slug: 'w' }).returning('id');
    const ws = w?.id ?? w;
    const { completeGoogle } = require('../services/platforms/connectAccounts');
    mockWeb['https://www.googleapis.com/oauth2/v2/userinfo'] = { data: { id: 'g1', name: 'Asha', email: 'a@x.example' } };
    mockWeb[ACC] = { data: { accounts: [{ name: 'accounts/2' }] } };
    mockWeb[`${INFO}/accounts/2/locations`] = { data: { locations: [{ name: 'locations/10', title: 'Acme Baner' }] } };
    expect(await completeGoogle(knex, ws, { access_token: 't', refresh_token: 'r' })).toMatchObject({ googleBusinessMissing: false, selectLocation: false });
    let row = await knex('social_accounts').where({ workspace_id: ws, platform: 'google_business' }).first();
    expect(row).toMatchObject({ page_id: 'accounts/2', board_id: 'locations/10' });
    expect(JSON.parse(row.profile_json).location_title).toBe('Acme Baner');

    mockWeb[`${INFO}/accounts/2/locations`] = { data: { locations: [{ name: 'locations/10', title: 'A' }, { name: 'locations/11', title: 'B' }] } };
    expect(await completeGoogle(knex, ws, { access_token: 't', refresh_token: 'r' })).toMatchObject({ selectLocation: true });
    const rows = await knex('social_accounts').where({ workspace_id: ws, platform: 'google_business' });
    expect(rows).toHaveLength(1);
    expect(rows[0].board_id).toBeNull();
    await knex.destroy();
  }, 30000);
});
