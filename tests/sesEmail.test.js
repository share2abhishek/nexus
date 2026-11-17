// Amazon SES with AWS access keys: the SES API instead of an SMTP login. Settings are saved
// per business (secret encrypted), emails go out through the same sendMail() as SMTP, errors
// are explained in plain words, and one business never uses another's keys.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

const mockKnex = makeTestKnex();
const knex = mockKnex;
jest.mock('../services/knex', () => mockKnex);

const { SESv2Client } = require('@aws-sdk/client-sesv2');
const smtp = require('../services/smtpSettings');
const bs = require('../services/businessSettings');
const env = { ...process.env };

const KEY = 'AKIAIOSFODNN7EXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

async function user(email, role = 'user') {
  const [u] = await knex('users').insert({ email, password_hash: 'x', role }).returning('id');
  return u?.id ?? u;
}
async function business(name, ownerId) {
  const [o] = await knex('organizations').insert({ name, owner_user_id: ownerId, plan: 'trial' }).returning('id');
  const orgId = o?.id ?? o;
  await knex('org_members').insert({ org_id: orgId, user_id: ownerId, role: 'owner' });
  const [w] = await knex('workspaces').insert({ org_id: orgId, name, slug: name.toLowerCase().replace(/\W+/g, '-') }).returning('id');
  const wsId = w?.id ?? w;
  await knex('memberships').insert({ user_id: ownerId, workspace_id: wsId, role: 'manager' });
  return { orgId, wsId };
}
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => {
    req.session = { userId: Number(req.headers['x-user']), userEmail: req.headers['x-email'] || '' };
    req.workspaceId = Number(req.headers['x-ws']);
    next();
  });
  a.use('/api/config', require('../routes/config'));
  return a;
}
const as = (u, ws, email) => ({ 'x-user': String(u), 'x-ws': String(ws), 'x-email': email || '' });

let sendSpy;
beforeAll(async () => {
  process.env.NEXUS_MODE = 'server';
  await knex.migrate.latest();
});
afterAll(async () => { process.env = env; await knex.destroy(); });
beforeEach(() => { sendSpy = jest.spyOn(SESv2Client.prototype, 'send').mockResolvedValue({ MessageId: 'ses-msg-1' }); });
afterEach(() => sendSpy.mockRestore());

describe('SES keys: checks and plain-language errors', () => {
  test('keys and region are checked', () => {
    expect(smtp.normalizeSes({ region: 'AP-South-1', accessKeyId: ` ${KEY} `, secretAccessKey: SECRET })).toEqual({ region: 'ap-south-1', accessKeyId: KEY, secretAccessKey: SECRET });
    expect(() => smtp.normalizeSes({ region: 'mumbai', accessKeyId: KEY, secretAccessKey: SECRET })).toThrow(/region/);
    expect(() => smtp.normalizeSes({ region: 'ap-south-1', accessKeyId: 'short', secretAccessKey: SECRET })).toThrow(/Access Key ID/);
    expect(() => smtp.normalizeSes({ region: 'ap-south-1', accessKeyId: KEY, secretAccessKey: 'abc' })).toThrow(/Secret Access Key/);
    expect(() => smtp.normalizeSes({ region: 'evil.test/x', accessKeyId: KEY, secretAccessKey: SECRET })).toThrow(); // never a typed address
  });

  test('AWS errors become advice', () => {
    const e = (name, message = '') => Object.assign(new Error(message), { name });
    expect(smtp.explainSes(e('UnrecognizedClientException', 'The security token included in the request is invalid.'))).toMatch(/Access Key ID or Secret/);
    expect(smtp.explainSes(e('SignatureDoesNotMatch'))).toMatch(/Access Key ID or Secret/);
    expect(smtp.explainSes(e('AccessDeniedException', 'User is not authorized to perform: ses:SendEmail'))).toMatch(/ses:SendEmail/);
    expect(smtp.explainSes(e('MessageRejected', 'Email address is not verified. The following identities failed the check in region AP-SOUTH-1: a@b.test'), { region: 'ap-south-1' })).toMatch(/verified.*ap-south-1/s);
    expect(smtp.explainSes(e('AccountSuspendedException'))).toMatch(/suspended/);
    expect(smtp.explainSes(e('TooManyRequestsException'))).toMatch(/limit/);
    expect(smtp.explainSes(Object.assign(new Error('getaddrinfo ENOTFOUND email.xx.amazonaws.com'), { code: 'ENOTFOUND' }), { region: 'ap-south-1' })).toMatch(/Could not reach Amazon SES in ap-south-1/);
  });
});

describe('SES keys: sending', () => {
  const cfg = { ses: { region: 'ap-south-1', accessKeyId: KEY, secretAccessKey: SECRET }, from: 'info@urbansociety.in', fromName: 'Urban Society' };

  test('the check sends one message to Amazon’s simulator, or to the person when asked', async () => {
    expect(await smtp.testSes(cfg)).toEqual({ ok: true, sent: false });
    let cmd = sendSpy.mock.calls[0][0].input;
    expect(cmd.Destination.ToAddresses).toEqual(['success@simulator.amazonses.com']);
    expect(cmd.FromEmailAddress).toBe('info@urbansociety.in');

    expect(await smtp.testSes(cfg, { to: 'me@x.test', fromName: 'Urban "Society" <x>\r\nBcc: evil@x.test' })).toEqual({ ok: true, sent: true });
    cmd = sendSpy.mock.calls[1][0].input;
    expect(cmd.Destination.ToAddresses).toEqual(['me@x.test']);
    expect(cmd.FromEmailAddress).not.toMatch(/[\r\n"]/);   // a name can not add headers
    expect(cmd.FromEmailAddress).toMatch(/<info@urbansociety\.in>$/);
  });

  test('a failed check explains why; bad input never reaches AWS', async () => {
    sendSpy.mockRejectedValueOnce(Object.assign(new Error('Email address is not verified.'), { name: 'MessageRejected' }));
    const r = await smtp.testSes(cfg);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not verified/);
    sendSpy.mockClear();
    expect((await smtp.testSes({ ...cfg, from: 'not-an-address' })).ok).toBe(false);
    expect((await smtp.testSes({ ...cfg, ses: { ...cfg.ses, accessKeyId: 'x' } })).ok).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('every sender uses the same sendMail(): the message goes out through the SES API', async () => {
    const transport = await smtp.createTransport(cfg);
    const info = await transport.sendMail({ from: 'Urban Society <info@urbansociety.in>', to: 'client@x.test', subject: 'Hello there', text: 'Body text', html: '<p>Body</p>' });
    expect(info.messageId).toBeTruthy();
    const cmd = sendSpy.mock.calls[0][0].input;
    expect(cmd.Destination.ToAddresses).toEqual(['client@x.test']);
    expect(cmd.FromEmailAddress).toContain('info@urbansociety.in');
    const raw = Buffer.from(cmd.Content.Raw.Data).toString('utf8');
    expect(raw).toMatch(/Subject: Hello there/);
    expect(raw).toMatch(/Body text/);
  });

  test('a normal mail server still uses SMTP (nothing changed for it)', async () => {
    const t = await smtp.createTransport({ host: '8.8.8.8', port: 587, secure: false, auth: { user: 'a', pass: 'b' } });
    expect(t.options.host).toBe('8.8.8.8');
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('SES keys: saved per business, secret encrypted, never mixed', () => {
  let ownerA, ownerB, A, B;
  beforeAll(async () => {
    ownerA = await user('a@ses.test'); ownerB = await user('b@ses.test');
    A = await business('Biz A', ownerA); B = await business('Biz B', ownerB);
  });

  test('saving: validated, secret stored encrypted, never sent back, blank keeps it', async () => {
    const bad = await request(app()).post('/api/config/smtp').set(as(ownerA, A.wsId)).send({ MAIL_PROVIDER: 'ses_api', SES_REGION: 'nowhere', SES_ACCESS_KEY_ID: KEY, SES_SECRET_ACCESS_KEY: SECRET, SMTP_FROM: 'info@a.test' });
    expect(bad.status).toBe(400);
    const noFrom = await request(app()).post('/api/config/smtp').set(as(ownerA, A.wsId)).send({ MAIL_PROVIDER: 'ses_api', SES_REGION: 'ap-south-1', SES_ACCESS_KEY_ID: KEY, SES_SECRET_ACCESS_KEY: SECRET, SMTP_FROM: '' });
    expect(noFrom.status).toBe(400);
    expect(noFrom.body.error).toMatch(/Send as/);

    const ok = await request(app()).post('/api/config/smtp').set(as(ownerA, A.wsId))
      .send({ MAIL_PROVIDER: 'ses_api', SES_REGION: 'ap-south-1', SES_ACCESS_KEY_ID: KEY, SES_SECRET_ACCESS_KEY: SECRET, SMTP_FROM: 'info@a.test', SMTP_FROM_NAME: 'Biz A' });
    expect(ok.status).toBe(200);

    // read under another name: query results are decrypted automatically
    const raw = await knex.raw('select value, secret_value as stored from business_settings where org_id = ? and key = ?', [A.orgId, 'ses_secret_access_key']);
    const row = (raw.rows || raw)[0];
    expect(row.value).toBeNull();
    expect(String(row.stored)).toMatch(/^enc:v1:/);
    expect(String(row.stored)).not.toContain(SECRET);

    const got = await request(app()).get('/api/config/smtp').set(as(ownerA, A.wsId));
    expect(got.body).toMatchObject({ MAIL_PROVIDER: 'ses_api', SES_ACCESS_KEY_ID: KEY, SES_REGION: 'ap-south-1', ses_secret_set: true, configured: true, SMTP_FROM: 'info@a.test' });
    expect(JSON.stringify(got.body)).not.toContain(SECRET);

    // saved again with the secret left blank: the saved one stays
    const again = await request(app()).post('/api/config/smtp').set(as(ownerA, A.wsId))
      .send({ MAIL_PROVIDER: 'ses_api', SES_REGION: 'us-east-1', SES_ACCESS_KEY_ID: KEY, SES_SECRET_ACCESS_KEY: '', SMTP_FROM: 'info@a.test' });
    expect(again.status).toBe(200);
    expect((await bs.getAll(A.orgId)).ses_secret_access_key).toBe(SECRET);
    expect((await bs.getAll(A.orgId)).ses_region).toBe('us-east-1');
  });

  test('the sender config for sending, and each business keeps its own', async () => {
    const { smtpConfigFor } = require('../services/sellbird/dispatcher');
    expect(await smtpConfigFor(A.wsId)).toMatchObject({ ses: { region: 'us-east-1', accessKeyId: KEY, secretAccessKey: SECRET }, from: 'info@a.test', fromName: 'Biz A' });
    expect(await smtpConfigFor(B.wsId)).toBeNull(); // business B has nothing: it never falls back to A's keys

    await request(app()).post('/api/config/smtp').set(as(ownerB, B.wsId))
      .send({ MAIL_PROVIDER: 'ses_api', SES_REGION: 'eu-west-1', SES_ACCESS_KEY_ID: 'AKIAB7777777777777XX', SES_SECRET_ACCESS_KEY: 'b'.repeat(40), SMTP_FROM: 'hello@b.test' });
    expect((await smtpConfigFor(B.wsId)).ses.accessKeyId).toBe('AKIAB7777777777777XX');
    expect((await smtpConfigFor(A.wsId)).ses.accessKeyId).toBe(KEY);
  });

  test('outreach emails use the business’s own SES keys', async () => {
    const { sendOutreachEmail } = require('../services/sellbird/dispatcher');
    const r = await sendOutreachEmail({ to: 'prospect@x.test', subject: 'Hi', body: 'Hello there', workspaceId: A.wsId });
    expect(r.success).toBe(true);
    const cmd = sendSpy.mock.calls[0][0].input;
    expect(cmd.FromEmailAddress).toContain('info@a.test');
    expect(cmd.Destination.ToAddresses).toEqual(['prospect@x.test']);
  });

  test('the test button uses the saved secret when it is left blank, and says why when it fails', async () => {
    const t = await request(app()).post('/api/config/smtp/test').set(as(ownerA, A.wsId))
      .send({ MAIL_PROVIDER: 'ses_api', SES_REGION: 'us-east-1', SES_ACCESS_KEY_ID: KEY, SES_SECRET_ACCESS_KEY: '', SMTP_FROM: 'info@a.test' });
    expect(t.body).toMatchObject({ ok: true });
    expect(sendSpy).toHaveBeenCalledTimes(1);

    sendSpy.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AccessDeniedException', message: 'not authorized to perform ses:SendEmail' }));
    const bad = await request(app()).post('/api/config/smtp/test').set(as(ownerA, A.wsId))
      .send({ MAIL_PROVIDER: 'ses_api', SES_REGION: 'us-east-1', SES_ACCESS_KEY_ID: KEY, SES_SECRET_ACCESS_KEY: '', SMTP_FROM: 'info@a.test' });
    expect(bad.body.ok).toBe(false);
    expect(bad.body.error).toMatch(/ses:SendEmail/);

    // a business with no secret saved: it can not borrow A's, so it has to type its own
    const ownerC = await user('c@ses.test');
    const C = await business('Biz C', ownerC);
    const other = await request(app()).post('/api/config/smtp/test').set(as(ownerC, C.wsId))
      .send({ MAIL_PROVIDER: 'ses_api', SES_REGION: 'us-east-1', SES_ACCESS_KEY_ID: KEY, SES_SECRET_ACCESS_KEY: '', SMTP_FROM: 'info@c.test' });
    expect(other.body.ok).toBe(false);
    expect(other.body.error).toMatch(/Secret Access Key/);
  });

  test('switching back to a normal mail server turns the SES way off', async () => {
    const r = await request(app()).post('/api/config/smtp').set(as(ownerA, A.wsId))
      .send({ MAIL_PROVIDER: '', SMTP_HOST: 'smtp.a.test', SMTP_PORT: '587', SMTP_USER: 'u@a.test', SMTP_PASS: 'pw', SMTP_FROM: 'u@a.test' });
    expect(r.status).toBe(200);
    const { smtpConfigFor } = require('../services/sellbird/dispatcher');
    const c = await smtpConfigFor(A.wsId);
    expect(c.ses).toBeUndefined();
    expect(c).toMatchObject({ host: 'smtp.a.test', port: 587 });
  });

  test('only a manager of the business can change it', async () => {
    const creator = await user('creator@ses.test');
    await knex('memberships').insert({ user_id: creator, workspace_id: A.wsId, role: 'creator' });
    const denied = await request(app()).post('/api/config/smtp').set(as(creator, A.wsId))
      .send({ MAIL_PROVIDER: 'ses_api', SES_REGION: 'ap-south-1', SES_ACCESS_KEY_ID: KEY, SES_SECRET_ACCESS_KEY: SECRET, SMTP_FROM: 'evil@x.test' });
    expect(denied.status).toBe(403);
  });
});
