// Bulk scheduling from CSV and Excel
const zlib = require('zlib');
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const { requirePermission } = require('../middleware/tenancy');
const bulk = require('../services/bulkImport');

global.__licensed = true;
jest.mock('../services/license', () => ({ status: () => ({ state: 'active', can_publish: global.__licensed, limits: {} }) }));

const NEXT_YEAR = new Date().getFullYear() + 1;

// A minimal .xlsx (zip with a shared-strings sheet), like Excel writes
function makeXlsx(rows) {
  const strings = [];
  const si = (v) => { let i = strings.indexOf(v); if (i < 0) { strings.push(v); i = strings.length - 1; } return i; };
  const cols = 'ABCDEFGH';
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (typeof v === 'number'
    ? `<c r="${cols[ci]}${ri + 1}"><v>${v}</v></c>`
    : `<c r="${cols[ci]}${ri + 1}" t="s"><v>${si(String(v))}</v></c>`)).join('')}</row>`).join('');
  const files = {
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst>${strings.map(s => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`,
  };
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = zlib.deflateRawSync(Buffer.from(text));
    const nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data); centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

describe('reading the sheet', () => {
  test('CSV with Indian dates, AM/PM times, platform nicknames and library file names', () => {
    const csv = `Date,Time,Text,Platforms,Image,First comment
08/11/${NEXT_YEAR},6:30 PM,"Happy Diwali, from all of us",fb; ig,diwali.png,#diwali
${NEXT_YEAR}-11-09,09:00,Plain post,linkedin,,
${NEXT_YEAR}-11-10,10:00,Needs a picture,instagram,,
01/01/2020,10:00,Old,facebook,,
${NEXT_YEAR}-11-11,25:00,Bad time,facebook,,
${NEXT_YEAR}-11-12,10:00,Wrong platform,myspace,,`;
    const { rows, counts } = bulk.parseSheet(Buffer.from(csv), { mediaByName: { 'diwali.png': 'media:7' } });
    expect(counts).toEqual({ ok: 2, failed: 4 });
    expect(rows[0].post).toMatchObject({ body: 'Happy Diwali, from all of us', platforms: ['facebook', 'instagram'], image_url: 'media:7', options: { first_comment: '#diwali' } });
    // 18:30 India time = 13:00 UTC
    expect(new Date(rows[0].post.scheduled_at * 1000).toISOString()).toBe(`${NEXT_YEAR}-11-08T13:00:00.000Z`);
    expect(rows[2].error).toMatch(/Instagram needs a picture/);
    expect(rows[3].error).toMatch(/already passed/);
    expect(rows[4].error).toMatch(/Time/);
    expect(rows[5].error).toMatch(/myspace/);
  });

  test('Excel (.xlsx) with a date number and a time fraction', () => {
    const excelDate = Math.round(Date.UTC(NEXT_YEAR, 0, 26) / 86400000) + 25569; // 26 Jan
    const xlsx = makeXlsx([['Date', 'Time', 'Post', 'Channels'], [excelDate, 0.4375, 'Republic Day greetings', 'Facebook, LinkedIn']]);
    const { rows } = bulk.parseSheet(xlsx, { name: 'plan.xlsx' });
    expect(rows[0].ok).toBe(true);
    expect(rows[0].post.platforms).toEqual(['facebook', 'linkedin']);
    expect(new Date(rows[0].post.scheduled_at * 1000).toISOString()).toBe(`${NEXT_YEAR}-01-26T05:00:00.000Z`); // 10:30 IST
  });

  test('missing columns are explained', () => {
    expect(() => bulk.parseSheet(Buffer.from('a,b\n1,2'))).toThrow(/"text" column/);
  });
});

describe('POST /api/content/bulk', () => {
  let knex, ws;
  const app = (role) => {
    const a = express();
    a.use((req, _res, next) => { req.session = { userId: 1 }; req.workspaceId = ws; req.role = role; next(); });
    a.use('/api/content', require('../routes/content')(knex, requirePermission));
    return a;
  };
  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [o] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'W', slug: 'w' }).returning('id');
    ws = w?.id ?? w;
  });
  afterAll(() => knex.destroy());
  const csv = Buffer.from(`date,time,text,platforms\n${NEXT_YEAR}-03-01,10:00,One,facebook\n${NEXT_YEAR}-03-02,10:00,Two,linkedin\nbad,10:00,Three,facebook`);

  test('preview changes nothing; import schedules the good rows', async () => {
    const pre = await request(app('manager')).post('/api/content/bulk?dry_run=1').set('Content-Type', 'application/octet-stream').send(csv);
    expect(pre.status).toBe(200);
    expect(pre.body).toMatchObject({ counts: { ok: 2, failed: 1 }, will: 'schedule' });
    expect(await knex('content_items').count('id as c').first()).toMatchObject({ c: 0 });

    const r = await request(app('manager')).post('/api/content/bulk').set('Content-Type', 'application/octet-stream').send(csv);
    expect(r.body).toMatchObject({ imported: 2, skipped: 1, status: 'scheduled' });
    expect((await knex('content_items').pluck('status')).sort()).toEqual(['scheduled', 'scheduled']);
  });

  test('someone who cannot approve gets drafts for review', async () => {
    await knex('content_items').del();
    const r = await request(app('creator')).post('/api/content/bulk').set('Content-Type', 'application/octet-stream').send(csv);
    expect(r.body.status).toBe('draft');
    expect(await knex('content_items').pluck('status')).toEqual(['draft', 'draft']);
  });
});
