// Media library: upload, list, view, delete; files kept per workspace
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.NEXUS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-media-'));

const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const { requirePermission } = require('../middleware/tenancy');
const store = require('../services/mediaStore');

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64)]);

function makeApp(knex, wsId, role) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: 1 }; req.workspaceId = wsId; req.role = role; next(); });
  app.use('/api/media-library', require('../routes/mediaLibrary')(knex, requirePermission));
  return app;
}

let knex, ws1, ws2;
beforeAll(async () => {
  knex = makeTestKnex();
  await knex.migrate.latest();
  const mk = async (slug) => {
    const [o] = await knex('organizations').insert({ name: slug, owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: slug, slug }).returning('id');
    return w?.id ?? w;
  };
  ws1 = await mk('a'); ws2 = await mk('b');
});
afterAll(async () => { await knex.destroy(); fs.rmSync(process.env.NEXUS_DATA_DIR, { recursive: true, force: true }); });

test('what a file really is comes from its first bytes', () => {
  expect(store.sniff(PNG).mime).toBe('image/png');
  expect(store.sniff(MP4)).toMatchObject({ kind: 'video', mime: 'video/mp4' });
  expect(store.sniff(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
});

test('upload, list and view a photo; another workspace cannot see it', async () => {
  const app = makeApp(knex, ws1, 'creator');
  const up = await request(app).post('/api/media-library')
    .set('Content-Type', 'application/octet-stream').set('X-File-Name', encodeURIComponent('Diwali offer.png')).send(PNG);
  expect(up.status).toBe(201);
  expect(up.body).toMatchObject({ kind: 'image', mime: 'image/png', original_name: 'Diwali offer.png', ref: `media:${up.body.id}` });

  const list = await request(app).get('/api/media-library');
  expect(list.body.map(r => r.id)).toContain(up.body.id);

  const file = await request(app).get(`/api/media-library/${up.body.id}/file`);
  expect(file.status).toBe(200);
  expect(file.headers['content-type']).toBe('image/png');

  const other = makeApp(knex, ws2, 'creator');
  expect((await request(other).get(`/api/media-library/${up.body.id}/file`)).status).toBe(404);
  expect((await request(other).get('/api/media-library')).body).toEqual([]);

  // A post resolves the library file for posting
  const f = await store.resolve(knex, ws1, `media:${up.body.id}`);
  expect(f.buffer.equals(PNG)).toBe(true);
  await expect(store.resolve(knex, ws2, `media:${up.body.id}`)).rejects.toThrow(/deleted from the media library/);
});

test('rejects files that are not photos or videos', async () => {
  const res = await request(makeApp(knex, ws1, 'creator')).post('/api/media-library')
    .set('Content-Type', 'application/octet-stream').send(Buffer.from('MZ this is an exe file padding'));
  expect(res.status).toBe(415);
});

test('a reviewer cannot upload', async () => {
  const res = await request(makeApp(knex, ws1, 'reviewer')).post('/api/media-library')
    .set('Content-Type', 'application/octet-stream').send(PNG);
  expect(res.status).toBe(403);
});

test('saving an AI picture (base64) into the library', async () => {
  const res = await request(makeApp(knex, ws1, 'creator')).post('/api/media-library/import').send({ base64: PNG.toString('base64') });
  expect(res.status).toBe(201);
  expect((await knex('media_assets').where({ id: res.body.id }).first()).source).toBe('ai');
});

test('deleting a file used by an unsent post asks first; force deletes the file from disk', async () => {
  const app = makeApp(knex, ws1, 'creator');
  const up = await request(app).post('/api/media-library').set('Content-Type', 'application/octet-stream').send(PNG);
  await knex('content_items').insert({ workspace_id: ws1, body: 'x', status: 'scheduled', platforms: '[]', image_url: up.body.ref });
  const first = await request(app).delete(`/api/media-library/${up.body.id}`);
  expect(first.status).toBe(409);
  expect(first.body.code).toBe('IN_USE');

  const asset = await store.get(knex, ws1, up.body.id);
  const onDisk = store.filePath(asset);
  expect(fs.existsSync(onDisk)).toBe(true);
  expect((await request(app).delete(`/api/media-library/${up.body.id}?force=1`)).status).toBe(200);
  expect(fs.existsSync(onDisk)).toBe(false);
});
