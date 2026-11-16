// The "local folder" routes read the computer the app runs on. A file name from the
// request must never leave the content folder, and the hosted edition never offers them.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');

jest.mock('../services/knex', () => require('./helpers/db').makeTestKnex());

describe('local folder routes', () => {
  let root, outside, app;
  const OLD = { ...process.env };

  beforeAll(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-'));
    root = path.join(base, 'content'); fs.mkdirSync(root);
    outside = path.join(base, 'secret.txt'); fs.writeFileSync(outside, 'TOP SECRET');
    fs.writeFileSync(path.join(root, 'note.txt'), 'hello');
    fs.writeFileSync(path.join(root, 'schedule.csv'), 'content,platforms,scheduled_at,image\n');
    fs.writeFileSync(path.join(root, '.env'), 'KEY=1');
    process.env.CONTENT_FOLDER = root;
    delete process.env.NEXUS_MODE;
    app = express();
    app.use((req, res, next) => { req.session = { userId: 1 }; req.workspaceId = 1; next(); });
    app.use('/api', require('../routes/api'));
  });
  afterAll(() => { process.env = OLD; });

  const read = (file) => request(app).get('/api/local/read').query({ file });

  test('reads a file in the folder', async () => {
    const r = await read('note.txt');
    expect(r.status).toBe(200);
    expect(r.body.content).toBe('hello');
  });

  test('refuses ../ and absolute paths', async () => {
    const winStyle = ['..', 'secret.txt'].join(String.fromCharCode(92));
    for (const bad of ['../secret.txt', winStyle, outside, 'sub/../../secret.txt', '%2e%2e/secret.txt']) {
      const r = await read(bad);
      expect(JSON.stringify(r.body)).not.toContain('TOP SECRET'); // never leaks
      expect([bad, [400, 404].includes(r.status)]).toEqual([bad, true]); // refused, or simply not found
    }
  });

  test('refuses files that are not plain content files (.env, no extension)', async () => {
    expect((await read('.env')).status).toBe(400);
    expect((await read('')).status).toBe(400);
  });

  test('the folder check itself (used by read and import-csv) stays inside the folder', () => {
    const inside = require('../routes/api')._inContentFolder;
    expect(inside('note.txt')).toBe(path.join(root, 'note.txt'));
    expect(inside('schedule.csv')).toBe(path.join(root, 'schedule.csv'));
    for (const bad of ['../secret.txt', ['..', 'secret.txt'].join(String.fromCharCode(92)), outside, 'a/../../secret.txt', 'note.txt\0.png', '.env', 'noext', '']) expect([bad, inside(bad)]).toEqual([bad, null]);
  });

  test('import-csv is refused for a file outside the folder (whatever the licence)', async () => {
    const r = await request(app).post('/api/local/import-csv').query({ file: '../secret.txt' });
    expect([400, 402, 403]).toContain(r.status);
    expect(JSON.stringify(r.body)).not.toContain('TOP SECRET');
  });

  test('the hosted edition does not offer them at all', async () => {
    process.env.NEXUS_MODE = 'server';
    try {
      expect((await read('note.txt')).status).toBe(404);
      expect((await request(app).get('/api/local/files')).status).toBe(404);
    } finally { delete process.env.NEXUS_MODE; }
  });
});
