// Website SEO: sites that build their pages with JavaScript, a sitemap that doesn't
// open, www / non-www both answering, inner pages naming the home page as canonical,
// the sitemap maker and titles for many pages. Websites are stand-ins: nothing leaves the machine.
const request = require('supertest');
const express = require('express');

const mockWeb = {}; // url -> { status, body, headers, finalUrl }
jest.mock('axios', () => {
  const answer = async (url, cfg = {}) => {
    const hit = mockWeb[url] || mockWeb[url.replace(/\?.*$/, '')];
    if (!hit) { const e = new Error('getaddrinfo ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }
    return { status: hit.status || 200, data: hit.body ?? '', headers: hit.headers || { 'content-type': 'text/html' }, request: { res: { responseUrl: hit.finalUrl || url } } };
  };
  const get = jest.fn(answer);
  const head = jest.fn(answer);
  return { get, head, post: jest.fn(), create: () => ({ get, head }), default: { get, head } };
});
const mockAiJSON = jest.fn();
jest.mock('../services/aiHelper', () => ({ ...jest.requireActual('../services/aiHelper'), aiJSON: (...a) => mockAiJSON(...a) }));
jest.mock('../services/knex', () => ({}));
jest.mock('../repos/seoRepo', () => () => ({ list: async () => [], save: async () => 1, remove: async () => {} }));
jest.mock('../repos/historyRepo', () => () => ({ save: async () => {} }));

const dns = require('dns').promises;
const seoCheck = require('../services/seoCheck');
const siteChecks = require('../services/seoSiteChecks');
const { makeSitemap, parseExtra } = require('../services/sitemapMaker');

const SHELL = `<!doctype html><html lang="en"><head><title>Apartment Management Software</title>
<link rel="canonical" href="https://acme.example/"></head><body><app-root></app-root>
<noscript><h1>You must enable JavaScript to view this site</h1></noscript></body></html>`;
const REAL = `<!doctype html><html lang="en"><head><title>Office Interiors in Pune</title></head><body><h1>Office interiors</h1><p>${'We design offices. '.repeat(40)}</p><a href="/services">Services</a><a href="/contact">Contact</a><a href="/old">Old</a></body></html>`;

beforeEach(() => {
  for (const k of Object.keys(mockWeb)) delete mockWeb[k];
  mockAiJSON.mockReset();
  jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});
afterEach(() => jest.restoreAllMocks());

describe('script-built pages', () => {
  test('a page that arrives empty is flagged, a normal page is not', () => {
    expect(seoCheck.looksJsOnly(SHELL, 3)).toBe(true);
    expect(seoCheck.looksJsOnly(REAL, 200)).toBe(false);
    expect(seoCheck.looksJsOnly('<html><body><p>Hi</p></body></html>', 2)).toBe(false); // short, but not a script app
  });

  test('checkPage says the text comes from JavaScript', async () => {
    mockWeb['https://acme.example'] = { body: SHELL };
    const r = await seoCheck.checkPage('acme.example');
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(by.js_only.status).toBe('warn');
    expect(by.js_only.detail).toMatch(/prerender/);
  });
});

describe('sitemap check', () => {
  test('a sitemap named in robots.txt that answers 404 is a warning, not "found"', async () => {
    mockWeb['https://acme.example'] = { body: REAL };
    mockWeb['https://acme.example/robots.txt'] = { body: 'User-agent: *\nAllow: /\nSitemap: https://acme.example/sitemap-dead.xml', headers: { 'content-type': 'text/plain' } };
    mockWeb['https://acme.example/sitemap-dead.xml'] = { status: 404, body: '{"error":"Not Found"}', headers: { 'content-type': 'application/json' } };
    const r = await seoCheck.checkPage('acme.example');
    const sm = r.checks.find((c) => c.id === 'sitemap');
    expect(sm.status).toBe('warn');
    expect(sm.detail).toMatch(/doesn’t open as a sitemap/);
  });

  test('a working sitemap is fine', async () => {
    mockWeb['https://ok.example'] = { body: REAL };
    mockWeb['https://ok.example/robots.txt'] = { body: 'Sitemap: https://ok.example/sitemap.xml', headers: { 'content-type': 'text/plain' } };
    mockWeb['https://ok.example/sitemap.xml'] = { body: '<urlset><url><loc>https://ok.example/</loc></url></urlset>', headers: { 'content-type': 'application/xml' } };
    const r = await seoCheck.checkPage('ok.example');
    expect(r.checks.find((c) => c.id === 'sitemap').status).toBe('good');
  });
});

describe('site-wide checks', () => {
  test('inner pages that name the home page as canonical are flagged, the home page itself is not', () => {
    const issues = siteChecks.canonicalToHome([
      { url: 'https://acme.example/', canonical: 'https://www.acme.example/' },
      { url: 'https://acme.example/blog', canonical: 'https://www.acme.example/' },
      { url: 'https://acme.example/mcs-act', canonical: 'https://acme.example/mcs-act' },
    ], 'https://acme.example/');
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe('canonical-home');
    expect(issues[0].priority).toBe(1);
    expect(issues[0].pages).toEqual(['https://acme.example/blog']);
  });

  test('www and non-www that both open are flagged; a redirect is fine', async () => {
    mockWeb['https://www.acme.example/'] = { body: REAL };
    expect((await siteChecks.hostVariant('https://acme.example/')).map((i) => i.key)).toEqual(['www-split']);

    mockWeb['https://www.acme.example/'] = { body: REAL, finalUrl: 'https://acme.example/' };
    expect(await siteChecks.hostVariant('https://acme.example/')).toEqual([]);
  });
});

describe('sitemap maker', () => {
  test('lists the pages that open, drops the ones that fail, escapes the address', async () => {
    mockWeb['https://acme.example'] = { body: REAL };
    mockWeb['https://acme.example/robots.txt'] = { status: 404, body: 'no' };
    mockWeb['https://acme.example/sitemap.xml'] = { status: 404, body: 'no' };
    mockWeb['https://acme.example/services'] = { body: REAL };
    mockWeb['https://acme.example/contact'] = { body: REAL };
    mockWeb['https://acme.example/old'] = { status: 404, body: 'gone' };
    const r = await makeSitemap('acme.example', { extra: '/blog?a=1&b=2\nhttps://elsewhere.example/x' });
    expect(r.urls).toEqual(expect.arrayContaining(['https://acme.example/', 'https://acme.example/services', 'https://acme.example/contact']));
    expect(r.urls).not.toContain('https://acme.example/old');
    expect(r.skipped.map((s) => s.url)).toContain('https://acme.example/old');
    expect(r.urls).not.toContain('https://elsewhere.example/x'); // another site is left out
    expect(r.xml).toContain('<loc>https://acme.example/blog?a=1&amp;b=2</loc>');
    expect(r.xml).toMatch(/^<\?xml/);
  });

  test('a site with no links to follow says how to add pages', async () => {
    mockWeb['https://shell.example'] = { body: SHELL };
    mockWeb['https://shell.example/robots.txt'] = { status: 404, body: 'no' };
    mockWeb['https://shell.example/sitemap.xml'] = { status: 404, body: 'no' };
    const r = await makeSitemap('shell.example');
    expect(r.count).toBe(1);
    expect(r.note).toMatch(/JavaScript/);
    const typed = await makeSitemap('shell.example', { extra: ['/blog', '/pricing'] });
    expect(typed.urls).toEqual(['https://shell.example/', 'https://shell.example/blog', 'https://shell.example/pricing']);
    expect(typed.note).toBeNull();
  });

  test('lists pages under the host the site names as canonical (www), even when typed without it', async () => {
    const home = REAL.replace('<title>', '<link rel="canonical" href="https://www.acme.example/"><title>');
    mockWeb['https://acme.example'] = { body: home };
    mockWeb['https://acme.example/robots.txt'] = { status: 404, body: 'no' };
    mockWeb['https://acme.example/sitemap.xml'] = { status: 404, body: 'no' };
    for (const p of ['services', 'contact', 'old']) mockWeb[`https://acme.example/${p}`] = { body: REAL };
    const r = await makeSitemap('acme.example');
    expect(r.host).toBe('www.acme.example');
    expect(r.urls).toEqual(expect.arrayContaining(['https://www.acme.example/', 'https://www.acme.example/services']));
    expect(r.urls.every((u) => u.startsWith('https://www.acme.example/'))).toBe(true);
  });

  test('typed lines: paths and same-site addresses only', () => {
    expect(parseExtra('/a\nb\nhttps://acme.example/c#top\nhttps://other.example/d\n\n', 'https://acme.example'))
      .toEqual(['https://acme.example/a', 'https://acme.example/b', 'https://acme.example/c']);
  });

  test('won’t build a sitemap for an address on this PC', async () => {
    await expect(makeSitemap('http://localhost:3000')).rejects.toThrow(/public web address/);
  });
});

describe('routes', () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => { req.workspaceId = 1; req.session = { userId: 1 }; next(); });
    a.use('/api/seo', require('../routes/seo'));
    return a;
  };

  test('POST /api/seo/sitemap needs an address', async () => {
    const res = await request(app()).post('/api/seo/sitemap').send({});
    expect(res.status).toBe(400);
  });

  test('POST /api/seo/sitemap returns the xml', async () => {
    mockWeb['https://acme.example'] = { body: REAL };
    mockWeb['https://acme.example/robots.txt'] = { status: 404, body: 'no' };
    mockWeb['https://acme.example/sitemap.xml'] = { status: 404, body: 'no' };
    mockWeb['https://acme.example/services'] = { body: REAL };
    const res = await request(app()).post('/api/seo/sitemap').send({ url: 'acme.example', pages: '/blog' });
    expect(res.status).toBe(200);
    expect(res.body.xml).toContain('https://acme.example/blog');
  });

  test('POST /api/seo/meta-pages writes titles and escapes the copy-ready HTML', async () => {
    mockAiJSON.mockResolvedValue({ model: 'm', data: { pages: [{ path: '/', title: 'Society Software | "Urban" Society', description: 'Maintenance billing & accounting for housing societies in Pune.' }] } });
    const res = await request(app()).post('/api/seo/meta-pages').send({ business: 'Urban Society', city: 'Pune', pages: [{ path: '/', about: 'home page' }, { path: '', about: 'x' }] });
    expect(res.status).toBe(200);
    expect(res.body.pages).toHaveLength(1);
    expect(res.body.pages[0].tags).toContain('&quot;Urban&quot;');
    expect(res.body.pages[0].tags).toContain('&amp; accounting');
    expect(res.body.pages[0].title.too_long).toBe(false);
    expect(mockAiJSON.mock.calls[0][0]).toMatch(/only say what each page is about/i);
  });

  test('POST /api/seo/meta-pages asks for the business and at least one page', async () => {
    expect((await request(app()).post('/api/seo/meta-pages').send({ pages: [{ path: '/', about: 'x' }] })).status).toBe(400);
    expect((await request(app()).post('/api/seo/meta-pages').send({ business: 'B', pages: [] })).status).toBe(400);
  });
});
