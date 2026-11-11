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
