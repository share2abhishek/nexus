// Festival calendar: built-in years, signed updates from Radixile, and that a
// festival file can never pass as a licence (and the reverse)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-fest-'));
const pair = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(path.join(DIR, 'pub.pem'), pair.publicKey.export({ type: 'spki', format: 'pem' }));
process.env.NEXUS_DATA_DIR = DIR;
process.env.LICENSE_PUBLIC_KEY_PATH = path.join(DIR, 'pub.pem');
process.env.LICENSE_KEY_ID = 'ktest';

jest.mock('axios');
const axios = require('axios');
const festivals = require('../services/festivals');
const holidays = require('../services/indianHolidays');
const license = require('../services/license');

const sign = (payload, key = pair.privateKey) => {
  const bytes = Buffer.from(JSON.stringify(payload));
  return { v: 2, kid: 'ktest', payload: bytes.toString('base64'), sig: crypto.sign(null, bytes, key).toString('base64') };
};

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { console.log.mockRestore(); console.warn.mockRestore(); fs.rmSync(DIR, { recursive: true, force: true }); });

test('2026 and 2027 are built in, with regional festivals labelled', () => {
  expect(holidays.getHolidaysForMonth('2027-10').map(h => h.name)).toContain('Diwali');
  const onam = holidays.all().find(h => h.name.startsWith('Onam') && h.date.startsWith('2027'));
  expect(onam.region).toBe('Kerala');
  expect(festivals.version()).toBe('built-in');
});

test('a signed update adds a year and replaces corrected ones', async () => {
  axios.get.mockResolvedValue({ data: sign({ doc: 'festivals', version: '2026-11-01', years: {
    2027: [{ date: '2027-10-30', name: 'Diwali', emoji: '🪔', type: 'festival' }],
    2028: [{ date: '2028-10-17', name: 'Diwali', emoji: '🪔', type: 'festival' }],
  } }) });
  expect(await festivals.checkForUpdate('https://license.test')).toBe(true);
  expect(holidays.getHolidaysForMonth('2028-10').map(h => h.date)).toEqual(['2028-10-17']);
  expect(holidays.getHolidaysForMonth('2027-10').map(h => h.date)).toEqual(['2027-10-30']);
  expect(festivals.version()).toBe('2026-11-01');
  // the same or an older version is not downloaded again
  expect(await festivals.checkForUpdate('https://license.test')).toBe(false);
});

test('an update not signed by Radixile is ignored', async () => {
  const other = crypto.generateKeyPairSync('ed25519');
  axios.get.mockResolvedValue({ data: sign({ doc: 'festivals', version: '2099-01-01', years: { 2027: [] } }, other.privateKey) });
  expect(await festivals.checkForUpdate('https://license.test')).toBe(false);
  expect(festivals.version()).toBe('2026-11-01');
});

test('a festival file is not a licence, and a licence is not a festival file', () => {
  const fest = sign({ doc: 'festivals', version: '1', years: {} });
  expect(license._verifySignature(fest)).toBeNull();
  const lic = sign({ license_id: 'L1', edition: 'pro' });
  expect(license._verifySignature(lic)).toMatchObject({ license_id: 'L1' });
  expect(license._verifySignature(lic, 'festivals')).toBeNull();
});
