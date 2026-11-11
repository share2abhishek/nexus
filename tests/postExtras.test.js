// Signatures, post sets and RSS feeds.
const request = require('supertest');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeTestKnex } = require('./helpers/db');
const rss = require('../services/rss');

const rssXml = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Sweet Crumbs Blog</title>
${items.map(i => `<item><title><![CDATA[${i.t}]]></title><link>https://blog.example/${i.id}</link><guid>${i.id}</guid>
<description>&lt;p&gt;${i.d || 'Fresh from the oven.'}&lt;/p&gt;</description>${i.img ? `<media:content url="${i.img}" medium="image"/>` : ''}</item>`).join('')}
</channel></rss>`;

describe('feed reading', () => {
  test('RSS: titles, links, plain-text summaries and https pictures', () => {
    const f = rss.parseFeed(rssXml([{ id: 'a1', t: 'Diwali hampers are here', img: 'https://img.example/h.jpg' }, { id: 'a2', t: 'New shop timings', img: 'http://insecure/x.jpg' }]));
    expect(f.title).toBe('Sweet Crumbs Blog');
    expect(f.items[0]).toEqual({ guid: 'a1', title: 'Diwali hampers are here', link: 'https://blog.example/a1', summary: 'Fresh from the oven.', image: 'https://img.example/h.jpg' });
    expect(f.items[1].image).toBe(''); // only https pictures can be posted
  });

  test('Atom (e.g. YouTube) works too', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>My Channel</title>
      <entry><id>yt:video:abc</id><title>How we bake</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc"/><summary>Behind the scenes</summary></entry></feed>`;
    const f = rss.parseFeed(atom);
    expect(f.title).toBe('My Channel');
    expect(f.items[0]).toMatchObject({ guid: 'yt:video:abc', title: 'How we bake', link: 'https://www.youtube.com/watch?v=abc' });
  });

  test('post text: title, short summary, link, signature', () => {
    expect(rss.postText({ title: 'T', summary: 'S', link: 'https://x' }, 'Call 98765')).toBe('T\n\nS\n\nhttps://x\n\nCall 98765');
  });
});

describe('signatures, post sets and feeds (routes)', () => {
  let knex, app, workspaceId, feedXml;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'PX Org', owner_user_id: 1 }).returning('id');
    const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'PX', slug: 'px' }).returning('id');
    workspaceId = ws?.id ?? ws;
    await knex('users').insert({ id: 1, email: 'px@example.test', password_hash: 'x' }).onConflict('id').ignore().catch(() => {});
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = workspaceId; req.session = { userId: 1 }; next(); });
    app.use('/api/post-extras', require('../routes/postExtras')(knex, () => (req, res, next) => next()));
    jest.spyOn(axios, 'get').mockImplementation(async (url) => {
      if (url.includes('not-a-feed')) return { data: '<html><body>Hello</body></html>' };
      return { data: feedXml };
    });
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });

  test('only one default signature at a time', async () => {
    await request(app).post('/api/post-extras/signatures').send({ name: 'Contact', text: 'Call 98765 43210', is_default: true });
    const b = await request(app).post('/api/post-extras/signatures').send({ name: 'Hashtags', text: '#pune #bakery', is_default: true });
    const list = (await request(app).get('/api/post-extras/signatures')).body;
    expect(list.filter(s => s.is_default).map(s => s.name)).toEqual(['Hashtags']);
    await request(app).put(`/api/post-extras/signatures/${list[0].id}`).send({ is_default: true });
    const after = (await request(app).get('/api/post-extras/signatures')).body;
    expect(after.filter(s => s.is_default).map(s => s.name)).toEqual(['Contact']);
    expect(b.status).toBe(200);
  });

  test('post sets keep only real platforms', async () => {
    const bad = await request(app).post('/api/post-extras/sets').send({ name: 'x', platforms: ['myspace'] });
    expect(bad.status).toBe(400);
    await request(app).post('/api/post-extras/sets').send({ name: 'Insta + FB stories', platforms: ['instagram', 'facebook', 'myspace'], options: { ig_format: 'story' } });
    const sets = (await request(app).get('/api/post-extras/sets')).body;
    expect(sets[0]).toMatchObject({ name: 'Insta + FB stories', platforms: ['instagram', 'facebook'], options: { ig_format: 'story' } });
  });

  test('a web page instead of a feed gets a plain explanation', async () => {
    const r = await request(app).post('/api/post-extras/feeds').send({ url: 'https://shop.example/not-a-feed', platforms: ['facebook'] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not a feed/);
  });

  test('adding a feed remembers old articles; new ones become drafts with the signature (max 3 per check)', async () => {
    feedXml = rssXml([{ id: 'old1', t: 'Old post' }, { id: 'old2', t: 'Older post' }]);
    const add = await request(app).post('/api/post-extras/feeds').send({ url: 'https://blog.example/feed', platforms: ['facebook', 'linkedin'] });
    expect(add.status).toBe(200);
    expect(add.body).toMatchObject({ name: 'Sweet Crumbs Blog', mode: 'draft', posts_created: 0 });
    expect(await knex('content_items').count('id as c').first()).toMatchObject({ c: 0 });

    feedXml = rssXml([1, 2, 3, 4, 5].map(n => ({ id: `new${n}`, t: `New article ${n}`, img: 'https://img.example/p.jpg' })).concat([{ id: 'old1', t: 'Old post' }]));
    const check = await request(app).post(`/api/post-extras/feeds/${add.body.id}/check`);
    expect(check.body.created).toBe(rss.MAX_NEW_PER_CHECK);
    const posts = await knex('content_items').orderBy('id');
    expect(posts).toHaveLength(3);
    expect(posts[0].status).toBe('draft');
    expect(posts[0].body).toMatch(/New article 3[\s\S]*https:\/\/blog\.example\/new3[\s\S]*Call 98765 43210$/);
    expect(JSON.parse(posts[0].platforms)).toEqual(['facebook', 'linkedin']);
    expect(posts[0].image_url).toBe('https://img.example/p.jpg');

    // all five are now known: the next check makes nothing new
    const again = await request(app).post(`/api/post-extras/feeds/${add.body.id}/check`);
    expect(again.body.created).toBe(0);
  });

  test('"schedule automatically" schedules new articles 15 minutes ahead', async () => {
    feedXml = rssXml([{ id: 's0', t: 'Before' }]);
    const add = await request(app).post('/api/post-extras/feeds').send({ url: 'https://news.example/rss', platforms: ['linkedin'], mode: 'schedule', add_signature: false });
    feedXml = rssXml([{ id: 's1', t: 'Brand new' }, { id: 's0', t: 'Before' }]);
    await request(app).post(`/api/post-extras/feeds/${add.body.id}/check`);
    const p = await knex('content_items').where('body', 'like', 'Brand new%').first();
    expect(p.status).toBe('scheduled');
    expect(p.scheduled_at - Math.floor(Date.now() / 1000)).toBeGreaterThan(rss.SCHEDULE_DELAY - 60);
    expect(p.body).not.toMatch(/Call 98765/);
  });

  test('a feed that stops working shows why', async () => {
    const f = await knex('rss_feeds').first();
    axios.get.mockRejectedValueOnce({ response: { status: 404 } });
    const r = await request(app).post(`/api/post-extras/feeds/${f.id}/check`);
    expect(r.body.error).toMatch(/404/);
    expect((await knex('rss_feeds').where({ id: f.id }).first()).last_error).toMatch(/404/);
  });
});

describe('Create post: signature is added once', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '18-post-extras.js'), 'utf8');
  const ctx = { window: {}, document: { getElementById: () => null }, console };
  vm.createContext(ctx);
  vm.runInContext(`${src}\nthis.__t = { PX, withSignature };`, ctx);
  const { PX, withSignature } = ctx.__t;
  PX.signatures = [{ id: 1, name: 'Contact', text: 'Call 98765 43210' }];
  PX.sigId = 1;

  test('ticked: added at the end; already there: not added again; unticked: unchanged', () => {
    PX.sigOn = true;
    expect(withSignature('Fresh cakes today!')).toBe('Fresh cakes today!\n\nCall 98765 43210');
    expect(withSignature('Fresh cakes today!\n\nCall 98765 43210')).toBe('Fresh cakes today!\n\nCall 98765 43210');
    PX.sigOn = false;
    expect(withSignature('Fresh cakes today!')).toBe('Fresh cakes today!');
  });
});
