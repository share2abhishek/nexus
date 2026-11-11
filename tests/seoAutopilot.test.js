// SEO autopilot (server edition): website re-checks, the to-do list, Google post
// drafts that wait for approval, and the whole-site checks. Websites and AI are stand-ins.
const request = require('supertest');
const express = require('express');

const mockSite = {}; // url -> { status, body, headers }
jest.mock('axios', () => {
  const answer = async (url, cfg = {}) => {
    const key = url + (cfg.params?.url ? `?${cfg.params.url}` : '');
    const hit = mockSite[url] || mockSite[key];
    if (!hit) {
      if (/does-not-exist/.test(url)) return { status: 404, data: '', headers: {} };
      const e = new Error('getaddrinfo ENOTFOUND'); e.code = 'ENOTFOUND'; throw e;
    }
    return { status: hit.status || 200, data: hit.body ?? hit.data, headers: hit.headers || { 'content-type': 'text/html' }, request: { res: { responseUrl: hit.finalUrl || url } } };
  };
  const get = jest.fn(answer);
  const head = jest.fn(answer);
  return { get, head, post: jest.fn(), create: () => ({ get, head }), default: { get, head } };
});
jest.mock('../services/aiHelper', () => ({
  ...jest.requireActual('../services/aiHelper'),
  aiGenerate: jest.fn(async () => ({ text: 'Fresh kaju katli every morning at our Pune shop. Visit us for office interiors too!' })),
  aiJSON: jest.fn(async () => ({ data: { title: 'Office Interiors in Pune | Acme', description: 'We design small offices in Pune.' } })),
}));

const dns = require('dns').promises;
const { makeTestKnex } = require('./helpers/db');
const autopilot = require('../services/seoAutopilot');
const siteChecks = require('../services/seoSiteChecks');

const page = (title, { desc = 'A clear description of this page that is long enough for Google to show nicely.', h1 = title, extra = '' } = {}) =>
  `<html lang="en"><head><title>${title}</title>${desc ? `<meta name="description" content="${desc}">` : ''}<meta name="viewport" content="width=device-width">
  <meta property="og:title" content="x"><meta property="og:image" content="x.jpg">${extra}</head>
  <body><h1>${h1}</h1><p>${'We design offices in Pune for small teams. '.repeat(40)}</p><a href="/about">About</a><a href="/missing">Old link</a></body></html>`;

describe('SEO autopilot', () => {
  let knex, app, ws;
  const env = { ...process.env };

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'W', slug: 'w' }).returning('id');
    ws = w?.id ?? w;
    await knex('brand_kit').insert({ workspace_id: ws, company_name: 'Acme Interiors' });
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = ws; req.session = { userId: 1 }; next(); });
    app.use('/api/seo/autopilot', require('../routes/seoAutopilot')(knex, () => (req, res, next) => next()));
  }, 30000);
  afterAll(async () => { process.env = env; await knex.destroy(); });
  // The tests build on each other (one website, checked again and again): the stand-in site is kept
  beforeEach(() => jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]));
  afterEach(() => jest.restoreAllMocks());

  test('desktop app: switched off; server edition: on', async () => {
    delete process.env.NEXUS_MODE; delete process.env.DB_CLIENT;
    expect((await request(app).get('/api/seo/autopilot/features')).body).toEqual({ server: false, seo_autopilot: false });
    const r = await request(app).get('/api/seo/autopilot');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SERVER_ONLY');
    process.env.NEXUS_MODE = 'server';
    expect((await request(app).get('/api/seo/autopilot/features')).body.seo_autopilot).toBe(true);
  });

  const runOnce = async () => {
    const site = await knex('seo_sites').where({ workspace_id: ws }).first();
    return autopilot.runSite(knex, site, { pageSpeed: false });
  };
  const open = () => knex('seo_tasks').where({ workspace_id: ws, status: 'open' }).orderBy('priority');

  test('first check: finds pages from the sitemap and lists to-dos in plain words', async () => {
    process.env.NEXUS_MODE = 'server';
    const H = 'https://acme.example';
    Object.assign(mockSite, {
      [H]: { body: page('Acme Interiors — Office interiors in Pune', { extra: '<script type="application/ld+json">{bad</script>' }) },
      [`${H}/robots.txt`]: { body: `User-agent: *\nAllow: /\nUser-agent: GPTBot\nDisallow: /\nSitemap: ${H}/sitemap.xml`, headers: { 'content-type': 'text/plain' } },
      [`${H}/sitemap.xml`]: { body: `<urlset><url><loc>${H}/services</loc></url><url><loc>${H}/contact</loc></url><url><loc>${H}/old</loc></url></urlset>`, headers: { 'content-type': 'application/xml' } },
      [`${H}/services`]: { body: page('Services', { desc: '' }) },
      [`${H}/contact`]: { body: page('Services', { desc: '', extra: '<meta name="robots" content="noindex">' }) },
      [`${H}/old`]: { status: 404, body: 'gone' },
      [`${H}/about`]: { body: page('About us') },
    });
    const put = await request(app).put('/api/seo/autopilot/site').send({ url: 'acme.example', phrases: 'office interiors pune\nhome renovation pune', frequency: 'weekly', gbp_quiet_days: 0 });
    expect(put.status).toBe(200);
    expect(await runOnce()).toMatchObject({ ok: true, pages: 4 });

    const titles = (await open()).map((t) => t.title);
    expect(titles).toEqual(expect.arrayContaining([
      '1 page doesn’t open for Google',
      '1 page is hidden from Google (“noindex”)',
      '2 pages have no description',
      '2 pages share the same title with another page',
      'No page is about “home renovation pune”',
      'Your sitemap lists 1 address that redirects or fails',
      '1 page has broken structured data',
      'AI assistants can’t read your site (ChatGPT)',
    ]));
    expect(titles.some((t) => /broken link/.test(t))).toBe(true); // /missing doesn't exist
    expect(titles).not.toContain('No page is about “office interiors pune”'); // the home page title has it
    // the most urgent first
    expect((await open())[0].priority).toBe(1);
    const site = await knex('seo_sites').where({ workspace_id: ws }).first();
    expect(site).toMatchObject({ last_status: 'ok' });
    expect(site.next_run_at - site.last_run_at).toBe(7 * 86400);
  });

  test('a fixed problem disappears by itself; one marked done that is still there comes back; “not relevant” stays hidden', async () => {
    const H = 'https://acme.example';
    const noindex = (await open()).find((t) => /noindex/.test(t.title));
    const ai = (await open()).find((t) => /AI assistants/.test(t.title));
    await request(app).post(`/api/seo/autopilot/tasks/${noindex.id}/done`);
    await request(app).post(`/api/seo/autopilot/tasks/${ai.id}/dismiss`);
    const desc = (await open()).find((t) => /no description/.test(t.title));
    await request(app).post(`/api/seo/autopilot/tasks/${desc.id}/done`);

    // The descriptions get fixed; the noindex doesn't
    mockSite[`${H}/services`] = { body: page('Our services') };
    mockSite[`${H}/contact`] = { body: page('Contact us', { extra: '<meta name="robots" content="noindex">' }) };
    await runOnce();
    const byId = async (id) => knex('seo_tasks').where({ id }).first();
    expect((await byId(desc.id)).status).toBe('resolved');
    expect(await byId(noindex.id)).toMatchObject({ status: 'open' });
    expect((await byId(noindex.id)).detail).toMatch(/Still found on the latest check/);
    expect((await byId(ai.id)).status).toBe('dismissed');
  });

  test('something that got worse since the last check jumps to the top', async () => {
    const H = 'https://acme.example';
    mockSite[`${H}/services`] = { body: page('Our services', { extra: '<meta name="robots" content="noindex">' }) };
    await runOnce();
    const t = (await open()).find((x) => /noindex/.test(x.title));
    expect(t).toMatchObject({ priority: 1 });
    expect(t.detail).toMatch(/appeared since the last check/);
  });

  test('“Write it for me” drafts titles and descriptions for the pages', async () => {
    await knex('seo_tasks').insert({ workspace_id: ws, key: 'test:title-draft', kind: 'fix', priority: 3, title: '1 page title is too short or too long', pages_json: JSON.stringify(['https://acme.example/services']), status: 'open', created_at: 1, updated_at: 1 });
    const task = await knex('seo_tasks').where({ workspace_id: ws, key: 'test:title-draft' }).first();
    const r = await request(app).post(`/api/seo/autopilot/tasks/${task.id}/draft`);
    expect(r.status).toBe(200);
    expect(r.body.draft).toMatchObject({ type: 'meta', pages: [{ url: 'https://acme.example/services', title: 'Office Interiors in Pune | Acme' }] });
  });

  test('a quiet Google profile gets a draft post that waits for approval (never posted by itself)', async () => {
    await knex('social_accounts').insert({ workspace_id: ws, platform: 'google_business', external_id: 'g1', access_token: 't' });
    await knex('seo_sites').where({ workspace_id: ws }).update({ gbp_quiet_days: 7 });
    await runOnce();
    const task = await knex('seo_tasks').where({ workspace_id: ws, kind: 'post', status: 'open' }).first();
    expect(task.title).toBe('Your Google Business profile has had no post for 7 days');
    const item = await knex('content_items').where({ id: task.content_item_id }).first();
    expect(item).toMatchObject({ status: 'in_review' });
    expect(JSON.parse(item.platforms)).toEqual(['google_business']);

    // No second draft while one waits; once it's scheduled the to-do closes
    await runOnce();
    expect(await knex('seo_tasks').where({ workspace_id: ws, kind: 'post' })).toHaveLength(1);
    await knex('content_items').where({ id: item.id }).update({ status: 'scheduled' });
    await runOnce();
    expect((await knex('seo_tasks').where({ id: task.id }).first()).status).toBe('resolved');
  });

  test('the Home summary and the scheduler only on the server edition', async () => {
    const s = (await request(app).get('/api/seo/autopilot/summary')).body;
    expect(s.open).toBeGreaterThan(0);
    expect(s.top.length).toBeLessThanOrEqual(3);

    delete process.env.NEXUS_MODE;
    await knex('seo_sites').where({ workspace_id: ws }).update({ next_run_at: 1 });
    await autopilot.processDue(knex);
    expect((await knex('seo_sites').where({ workspace_id: ws }).first()).next_run_at).toBe(1); // desktop: not run
  });
});

describe('whole-site checks', () => {
  beforeEach(() => jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]));
  afterEach(() => jest.restoreAllMocks());

  test('a missing page that answers “OK” is a soft 404', async () => {
    const axios = require('axios');
    axios.head.mockImplementationOnce(async () => ({ status: 200, headers: {}, request: { res: {} } }));
    expect(await siteChecks.soft404('https://acme.example/')).toEqual([expect.objectContaining({ key: 'soft-404' })]);
  });

  test('page speed from PageSpeed Insights becomes a plain to-do when slow', async () => {
    mockSite['https://www.googleapis.com/pagespeedonline/v5/runPagespeed?https://acme.example/'] = { data: {
      loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 5200 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 }, INTERACTION_TO_NEXT_PAINT: { percentile: 150 } } },
      lighthouseResult: { categories: { performance: { score: 0.41 } } },
    } };
    const r = await siteChecks.coreWebVitals('https://acme.example/');
    expect(r.vitals).toMatchObject({ lcp_ms: 5200, cls: 0.05, inp_ms: 150, score: 41, source: 'real visitors (last 28 days)' });
    expect(r.issues[0]).toMatchObject({ key: 'page-speed', priority: 2, title: 'Your home page is slow on phones' });
    expect(r.issues[0].detail).toMatch(/5\.2 s/);
  });
});
