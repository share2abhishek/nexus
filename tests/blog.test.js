// The blog: a file in server/blog/posts is a post; drafts and future dates stay hidden.
const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');
const blog = require('../server/blog');
const publicPages = require('../server/publicPages');

const mk = (slug, head, body = '<p>Hello</p>') => fs.writeFileSync(path.join(blog.POSTS_DIR, `${slug}.html`), `---\n${head}\n---\n${body}`);
const made = [];
const add = (slug, head, body) => { mk(slug, head, body); made.push(slug); };
afterEach(() => { for (const s of made.splice(0)) fs.rmSync(path.join(blog.POSTS_DIR, `${s}.html`), { force: true }); });
const app = () => { const a = express(); a.use(publicPages.router); return a; };

test('a published post is listed, served with canonical and article data, and in the sitemap', async () => {
  add('zz-test-post', 'title: Test post\ndescription: A test.\ndate: 2020-01-01');
  const post = await request(app()).get('/blog/zz-test-post');
  expect(post.status).toBe(200);
  expect(post.text).toContain('<link rel="canonical"');
  expect(post.text).toContain('"@type":"BlogPosting"');
  expect((await request(app()).get('/blog')).text).toContain('Test post');
  expect((await request(app()).get('/sitemap.xml')).text).toContain('/blog/zz-test-post');
});

test('drafts, future dates and files without a valid header are not published', async () => {
  add('zz-draft', 'title: D\ndate: 2020-01-01\ndraft: true');
  add('zz-future', 'title: F\ndate: 2999-01-01');
  fs.writeFileSync(path.join(blog.POSTS_DIR, 'zz-bad.html'), '<p>no header</p>'); made.push('zz-bad');
  for (const s of ['zz-draft', 'zz-future', 'zz-bad']) expect((await request(app()).get(`/blog/${s}`)).status).toBe(404);
  expect((await request(app()).get('/sitemap.xml')).text).not.toMatch(/zz-(draft|future|bad)/);
});

test('robots.txt allows the blog', async () => {
  expect((await request(app()).get('/robots.txt')).text).toContain('Allow: /blog');
});
