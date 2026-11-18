// What search engines see: the landing page with its address filled in,
// FAQ structured data that matches the questions on the page, robots.txt and
// sitemap.xml. The old /landing.html address points to "/".
const request = require('supertest');
const express = require('express');
const publicPages = require('../server/publicPages');

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

function app() {
  const a = express();
  a.use(publicPages.router);
  a.get('/', publicPages.sendLanding);
  return a;
}

test('landing page: the site address is filled in everywhere and the FAQ becomes structured data', async () => {
  process.env.APP_URL = 'https://app.example.in/';
  const res = await request(app()).get('/');
  expect(res.status).toBe(200);
  expect(res.text).not.toMatch(/%SITE_URL%/);
  expect(res.text).toContain('<link rel="canonical" href="https://app.example.in/" />');
  expect(res.text).toContain('content="https://app.example.in/og-image.png"');

  const blocks = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = blocks.find((b) => b['@type'] === 'FAQPage');
  const questions = [...res.text.matchAll(/<details><summary>([\s\S]*?)<\/summary>/g)].length;
  expect(faq.mainEntity).toHaveLength(questions);
  expect(faq.mainEntity[0]).toMatchObject({ '@type': 'Question', name: 'What happens after the free trial?' });
  expect(faq.mainEntity[0].acceptedAnswer.text).not.toMatch(/<|&amp;/);
});

test('sign-up and pricing can be switched off: those parts are not sent, and the structured data stays valid', () => {
  const raw = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'landing.html'), 'utf8');
  const off = publicPages.applySwitches(raw, { signup: false, pricing: false });
  expect(off).not.toMatch(/<!--\/?IF:/);
  expect(off).not.toContain('id="pricing"');
  expect(off).not.toContain('href="#pricing"');
  expect(off).not.toMatch(/₹1,275|"price"/);
  expect(off).not.toContain('/login.html#register');
  expect(off).not.toMatch(/free trial/i);
  expect(off).toContain('href="/login.html" class="btn btn-primary">Sign in →</a>');
  for (const m of off.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) expect(() => JSON.parse(m[1].replace(/%SITE_URL%/g, 'https://x.in'))).not.toThrow();

  const on = publicPages.applySwitches(raw, { signup: true, pricing: true });
  expect(on).toContain('id="pricing"');
  expect(on).toContain('/login.html#register');
  expect(on).not.toContain('Sign in →</a><!--');
  expect(on).not.toMatch(/<!--\/?IF:/);
});

test('robots.txt keeps the API out and points to the sitemap; the sitemap lists the public pages', async () => {
  process.env.APP_URL = 'https://app.example.in';
  const robots = await request(app()).get('/robots.txt');
  expect(robots.type).toBe('text/plain');
  expect(robots.text).toContain('Disallow: /api/');
  expect(robots.text).toContain('Sitemap: https://app.example.in/sitemap.xml');

  const map = await request(app()).get('/sitemap.xml');
  expect(map.type).toBe('application/xml');
  expect(map.text).toContain('<loc>https://app.example.in/</loc>');
  expect(map.text).toContain('<loc>https://app.example.in/help.html</loc>');
});

test('without APP_URL the address the page was opened on is used; /landing.html moves to "/"', async () => {
  delete process.env.APP_URL;
  const res = await request(app()).get('/').set('Host', 'localhost:3000');
  expect(res.text).toContain('href="http://localhost:3000/"');
  const old = await request(app()).get('/landing.html');
  expect(old.status).toBe(301);
  expect(old.headers.location).toBe('/');
});

test('FAQ text with a "<" can’t break out of the structured data script', () => {
  const out = publicPages.faqJsonLd('<details><summary>A &lt;b&gt;?</summary><p>x </script><script>alert(1)</p></details>');
  expect(out).not.toMatch(/<\/script><script>/);
});

describe('legal pages', () => {
  const slugs = ['terms', 'privacy', 'refunds', 'acceptable-use', 'cookies', 'data-deletion', 'dpa'];

  test('every page opens with its title, the company details filled in and no placeholders left', async () => {
    process.env.APP_URL = 'https://app.example.in';
    process.env.LEGAL_ADDRESS = '12 MG Road, Pune <411001>';
    process.env.LEGAL_GRIEVANCE_OFFICER = 'A. Officer';
    for (const slug of ['', ...slugs]) {
      const res = await request(app()).get(`/legal${slug ? `/${slug}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(/%(SITE_URL|COMPANY|EMAIL|ADDRESS|GRIEVANCE|CITY|UPDATED)%/);
      expect(res.text).toContain(`<link rel="canonical" href="https://app.example.in/legal${slug ? `/${slug}` : ''}" />`);
      expect(res.text).toContain('info@radixile.com');
      expect(res.text).not.toContain('support@radixile.com');
    }
    const privacy = await request(app()).get('/legal/privacy');
    expect(privacy.text).toContain('12 MG Road, Pune &lt;411001&gt;'); // escaped
    expect(privacy.text).toContain('A. Officer');
    expect(privacy.text).toMatch(/Limited Use/);
  });

  test('old .html addresses move to the clean ones; unknown pages are not found; the sitemap lists them', async () => {
    const old = await request(app()).get('/legal/terms.html');
    expect(old.status).toBe(301);
    expect(old.headers.location).toBe('/legal/terms');
    expect((await request(app()).get('/legal/nope')).status).toBe(404);
    const map = await request(app()).get('/sitemap.xml');
    for (const slug of slugs) expect(map.text).toContain(`/legal/${slug}</loc>`);
  });
});

test('legal pages name Kajal Aher as Grievance Officer and Pune courts by default', async () => {
  delete process.env.LEGAL_GRIEVANCE_OFFICER; delete process.env.LEGAL_CITY; delete process.env.LEGAL_ADDRESS;
  const privacy = await request(app()).get('/legal/privacy');
  expect(privacy.text).toContain('Kajal Aher');
  expect(privacy.text).toContain('Pune, Maharashtra, India');
  const terms = await request(app()).get('/legal/terms');
  expect(terms.text).toContain('courts at Pune, Maharashtra, India');
});

describe('search engine rules', () => {
  const full = () => {
    const a = express();
    a.use(publicPages.noindexMiddleware);
    a.use(publicPages.router);
    a.get('/', publicPages.sendLanding);
    a.get('/login.html', (req, res) => res.send('login'));
    a.get('*', publicPages.sendNotFound);
    return a;
  };

  test('the landing page has a keyword title, a short description and prices in its structured data', async () => {
    process.env.APP_URL = 'https://app.example.in';
    const res = await request(full()).get('/');
    const title = res.text.match(/<title>([\s\S]*?)<\/title>/)[1].replace(/&amp;/g, '&');
    expect(title).toMatch(/Social Media, WhatsApp & SEO/);
    expect(title.length).toBeLessThanOrEqual(70);
    expect(res.text.match(/<meta name="description" content="([^"]*)"/)[1].length).toBeLessThanOrEqual(165);
    const blocks = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const app = blocks.flatMap((b) => b['@graph'] || [b]).find((n) => n['@type'] === 'SoftwareApplication');
    expect(app.offers.map((o) => [o.name, o.price, o.priceCurrency])).toEqual([['Individual', '1275', 'INR'], ['Agency Pro', '10200', 'INR']]);
    // the prices in the data are the prices on the page
    expect(res.text).toContain('₹1,275');
    expect(res.text).toContain('₹10,200');
  });

  test('robots.txt allows the public pages and keeps the app, sign-in and one-time links out', async () => {
    const robots = (await request(full()).get('/robots.txt')).text;
    for (const p of ['/api/', '/app', '/login.html', '/a/', '/relay/', '/admin']) expect(robots).toContain(`Disallow: ${p}`);
    expect(robots).toContain('Allow: /help.html');
  });

  test('the sign-in page and one-time links carry a noindex header; the landing page does not', async () => {
    expect((await request(full()).get('/login.html')).headers['x-robots-tag']).toBe('noindex, nofollow');
    expect((await request(full()).get('/a/abc123')).headers['x-robots-tag']).toBe('noindex');
    expect((await request(full()).get('/')).headers['x-robots-tag']).toBeUndefined();
  });

  test('the help guides get the site address as canonical', async () => {
    process.env.APP_URL = 'https://app.example.in';
    const res = await request(full()).get('/help.html');
    expect(res.text).toContain('<link rel="canonical" href="https://app.example.in/help.html" />');
    expect(res.text).not.toMatch(/%SITE_URL%/);
  });

  test('a page that does not exist is a real 404 and not for search', async () => {
    const res = await request(full()).get('/no-such-page');
    expect(res.status).toBe(404);
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.text).toContain('We can’t find that page');
  });
});
