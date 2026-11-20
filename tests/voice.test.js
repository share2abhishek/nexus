// Voice assistant, Nexus side (docs/platform/VOICE-AGENTS.md V2): Meta call webhooks, the gateway hand-shake, transcript,
// recording, retention, isolation and the staff routes. Meta and the gateway are fakes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { makeTestKnex } = require('./helpers/db');

const mockKnex = makeTestKnex();
jest.mock('../services/knex', () => mockKnex);
jest.setTimeout(60000);

const sign = require('../services/voice/sign');
const metaCalls = require('../services/voice/metaCalls');
const gateway = require('../services/voice/gateway');
const calls = require('../services/voice/calls');

const SECRET = 'x'.repeat(40);
const metaLog = [];
const gwLog = [];
let ids;

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(process.env, { NEXUS_MODE: 'server', VOICE_ENABLED: 'true', VOICE_GATEWAY_URL: 'http://gw.test', VOICE_GATEWAY_SECRET: SECRET,
    APP_URL: 'https://nexus.test', NEXUS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-voice-')) });
  await mockKnex.migrate.latest();
  const one = async (q) => { const [r] = await q.returning('id'); return r?.id ?? r; };
  const t = Math.floor(Date.now() / 1000);
  const staff = await one(mockKnex('users').insert({ email: 'staff@radixile.test', password_hash: 'h', role: 'superadmin', email_verified_at: 1 }));
  const owner = await one(mockKnex('users').insert({ email: 'owner@b.test', password_hash: 'h', role: 'user', email_verified_at: 1 }));
  const orgA = await one(mockKnex('organizations').insert({ name: 'Radixile', owner_user_id: staff, plan: 'full' }));
  const orgB = await one(mockKnex('organizations').insert({ name: 'Other', owner_user_id: owner, plan: 'trial' }));
  const wsA = await one(mockKnex('workspaces').insert({ org_id: orgA, name: 'Radixile', slug: 'radixile' }));
  const wsB = await one(mockKnex('workspaces').insert({ org_id: orgB, name: 'Other', slug: 'other' }));
  await mockKnex('memberships').insert([{ user_id: staff, workspace_id: wsA, role: 'manager' }, { user_id: owner, workspace_id: wsB, role: 'manager' }]);
  await mockKnex('meta_lead_configs').insert([
    { workspace_id: wsA, verify_token: 'v', whatsapp_phone_number_id: 'PN_A', whatsapp_access_token: 'tok-a', created_at: t, updated_at: t },
    { workspace_id: wsB, verify_token: 'v', whatsapp_phone_number_id: 'PN_B', whatsapp_access_token: 'tok-b', created_at: t, updated_at: t },
  ]);
  await mockKnex('meta_lead_events').insert({ workspace_id: wsA, full_name: 'Prakash Kulkarni', phone_number: '+91 98765 43210', created_at: t, updated_at: t });
  ids = { staff, owner, orgA, orgB, wsA, wsB };
  metaCalls.setClient(async ({ phoneNumberId, body }) => { metaLog.push({ phoneNumberId, ...body }); return { success: true }; });
  gateway.setGateway({
    startSession: async (s) => { gwLog.push({ start: s }); return { sdpAnswer: `ANSWER-FOR-${s.callId}` }; },
    endSession: async (id) => { gwLog.push({ end: id }); },
  });
});
afterAll(async () => {
  console.log.mockRestore(); console.error.mockRestore();
  metaCalls.setClient(null); gateway.setGateway(null);
  for (const k of ['NEXUS_MODE', 'VOICE_ENABLED', 'VOICE_GATEWAY_URL', 'VOICE_GATEWAY_SECRET', 'APP_URL']) delete process.env[k];
  await mockKnex.destroy();
});

const connect = (id, pn = 'PN_A', from = '919876543210') => ({ metadata: { phone_number_id: pn }, calls: [{ id, from, to: '919637000102', event: 'connect', direction: 'USER_INITIATED', timestamp: String(Math.floor(Date.now() / 1000)), session: { sdp_type: 'offer', sdp: `OFFER-${id}` } }] });
const terminate = (id, extra = {}) => ({ metadata: { phone_number_id: 'PN_A' }, calls: [{ id, event: 'terminate', direction: 'USER_INITIATED', status: 'COMPLETED', timestamp: String(Math.floor(Date.now() / 1000)), ...extra }] });

async function addAssistant(workspaceId, orgId, extra = {}) {
  const t = Math.floor(Date.now() / 1000);
  await mockKnex('voice_assistant').insert({ org_id: orgId, workspace_id: workspaceId, name: 'Sneha', greeting: 'Namaste', instructions: 'Be kind',
    models: JSON.stringify({ llm: { provider: 'anthropic', model: 'claude-sonnet-5-5' } }), voice_controls: '{}', handover: '{}', active: true, retention_days: 30, created_at: t, updated_at: t, ...extra });
}

describe('signed gateway requests', () => {
  test('a good signature passes; wrong secret, edited body or an old timestamp fail', () => {
    const body = JSON.stringify({ a: 1 });
    const h = sign.sign(body, SECRET);
    expect(sign.verify(Buffer.from(body), h, SECRET)).toBe(true);
    expect(sign.verify(Buffer.from(body), h, 'y'.repeat(40))).toBe(false);
    expect(sign.verify(Buffer.from('{"a":2}'), h, SECRET)).toBe(false);
    expect(sign.verify(Buffer.from(body), sign.sign(body, SECRET, Math.floor(Date.now() / 1000) - 301), SECRET)).toBe(false);
    expect(sign.verify(Buffer.from(body), 'garbage', SECRET)).toBe(false);
  });
});

describe('a customer calls the business on WhatsApp', () => {
  test('no assistant yet: the call is rejected at once and recorded', async () => {
    await calls.onMetaCalls(mockKnex, connect('wacid.1'));
    expect(metaLog.pop()).toMatchObject({ phoneNumberId: 'PN_A', call_id: 'wacid.1', action: 'reject' });
    expect(await mockKnex('voice_call').where({ wa_call_id: 'wacid.1' }).first()).toMatchObject({ status: 'rejected', end_reason: 'no_assistant', workspace_id: ids.wsA });
  });

  test('a number Nexus does not know is ignored (no reject, no row): never guessed from the payload', async () => {
    await calls.onMetaCalls(mockKnex, connect('wacid.x', 'PN_UNKNOWN'));
    expect(metaLog).toHaveLength(0);
    expect(await mockKnex('voice_call').where({ wa_call_id: 'wacid.x' }).first()).toBeUndefined();
  });

  test('with the assistant: gateway session, pre-accept, then accept on media_ready with the same SDP; replays are ignored', async () => {
    await addAssistant(ids.wsA, ids.orgA);
    await calls.onMetaCalls(mockKnex, connect('wacid.2'));
    await calls.onMetaCalls(mockKnex, connect('wacid.2')); // Meta retried
    const starts = gwLog.filter((g) => g.start && g.start.callId === 'wacid.2');
    expect(starts).toHaveLength(1);
    expect(starts[0].start).toMatchObject({ sdpOffer: 'OFFER-wacid.2', callbackUrl: 'https://nexus.test/api/webhooks/voice-gateway', caller: { name: 'Prakash Kulkarni', known: true } });
    expect(starts[0].start.assistant).toMatchObject({ name: 'Sneha', greeting: 'Namaste' });
    expect(JSON.stringify(starts[0].start)).not.toContain('tok-a'); // the WhatsApp token never goes to the gateway
    expect(metaLog.filter((m) => m.call_id === 'wacid.2')).toEqual([expect.objectContaining({ action: 'pre_accept', session: { sdp_type: 'answer', sdp: 'ANSWER-FOR-wacid.2' } })]);

    const r = await calls.onGatewayEvent(mockKnex, { type: 'media_ready', call_id: 'wacid.2' });
    expect(r.status).toBe(200);
    expect(metaLog.filter((m) => m.call_id === 'wacid.2').map((m) => [m.action, m.session?.sdp])).toEqual([['pre_accept', 'ANSWER-FOR-wacid.2'], ['accept', 'ANSWER-FOR-wacid.2']]);
    const call = await mockKnex('voice_call').where({ wa_call_id: 'wacid.2' }).first();
    expect(call.status).toBe('active');
    expect(call.lead_id).not.toBeNull();
    expect((await calls.onGatewayEvent(mockKnex, { type: 'media_ready', call_id: 'wacid.2' })).status).toBe(409); // only once
  });

  test('turns, hand-over and the end of the call are stored; Meta terminate records the duration', async () => {
    await calls.onGatewayEvent(mockKnex, { type: 'turn', call_id: 'wacid.2', seq: 0, speaker: 'assistant', text: 'Namaste! Main Sneha…', llm_ms: 400, tts_ms: 200 });
    await calls.onGatewayEvent(mockKnex, { type: 'turn', call_id: 'wacid.2', seq: 1, speaker: 'caller', text: 'Society mein 240 flats hain', stt_ms: 300 });
    await calls.onGatewayEvent(mockKnex, { type: 'turn', call_id: 'wacid.2', seq: 1, speaker: 'caller', text: 'duplicate' });
    expect((await calls.onGatewayEvent(mockKnex, { type: 'turn', call_id: 'wacid.2', speaker: 'robot', text: 'x', seq: 2 })).status).toBe(400);
    await calls.onGatewayEvent(mockKnex, { type: 'handover', call_id: 'wacid.2', note: 'Wants pricing for 800 flats' });
    await calls.onGatewayEvent(mockKnex, { type: 'ended', call_id: 'wacid.2', outcome: 'demo_booked', summary: 'Chairman, 240 flats, demo Sunday', next_step: 'Demo Sun 11:00', usage: { tokens_in: 900, tokens_out: 300 } });
    await calls.onMetaCalls(mockKnex, terminate('wacid.2', { start_time: 1, end_time: 181, duration: 180 }));
    const call = await mockKnex('voice_call').where({ wa_call_id: 'wacid.2' }).first();
    expect(call).toMatchObject({ status: 'ended', duration_sec: 180, outcome: 'handover', summary: 'Chairman, 240 flats, demo Sunday', next_step: 'Demo Sun 11:00', tokens_in: 900 });
    const turns = await mockKnex('voice_transcript_turn').where({ call_id: call.id }).orderBy('seq');
    expect(turns.map((t) => [t.seq, t.speaker, t.text])).toEqual([[0, 'assistant', 'Namaste! Main Sneha…'], [1, 'caller', 'Society mein 240 flats hain']]);
    expect(gwLog.some((g) => g.end === 'wacid.2')).toBe(true);
  });

  test('the assistant hanging up tells Meta to terminate', async () => {
    await calls.onMetaCalls(mockKnex, connect('wacid.3'));
    await calls.onGatewayEvent(mockKnex, { type: 'media_ready', call_id: 'wacid.3' });
    await calls.onGatewayEvent(mockKnex, { type: 'ended', call_id: 'wacid.3', outcome: 'callback', hangup: true, reason: 'goodbye' });
    expect(metaLog.filter((m) => m.call_id === 'wacid.3').map((m) => m.action)).toEqual(['pre_accept', 'accept', 'terminate']);
  });

  test('too many calls at once: the next one is rejected as busy', async () => {
    process.env.VOICE_MAX_CONCURRENT = '1';
    await calls.onMetaCalls(mockKnex, connect('wacid.4'));
    await calls.onMetaCalls(mockKnex, connect('wacid.5'));
    expect(await mockKnex('voice_call').where({ wa_call_id: 'wacid.5' }).first()).toMatchObject({ status: 'rejected', end_reason: 'busy' });
    delete process.env.VOICE_MAX_CONCURRENT;
    await calls.onMetaCalls(mockKnex, terminate('wacid.4'));
  });

  test('a gateway failure rejects the call instead of leaving it ringing', async () => {
    gateway.setGateway({ startSession: async () => { throw new Error('gateway down'); }, endSession: async () => {} });
    await calls.onMetaCalls(mockKnex, connect('wacid.6'));
    expect(await mockKnex('voice_call').where({ wa_call_id: 'wacid.6' }).first()).toMatchObject({ status: 'failed', end_reason: 'answer_failed' });
    expect(metaLog.filter((m) => m.call_id === 'wacid.6').map((m) => m.action)).toEqual(['reject']);
    gateway.setGateway({ startSession: async (s) => ({ sdpAnswer: `ANSWER-FOR-${s.callId}` }), endSession: async () => {} });
  });

  test('the switch off: every call rejected, nothing sent to the gateway', async () => {
    process.env.VOICE_ENABLED = 'false';
    const before = gwLog.length;
    await calls.onMetaCalls(mockKnex, connect('wacid.7'));
    expect(gwLog.length).toBe(before);
    expect(await mockKnex('voice_call').where({ wa_call_id: 'wacid.7' }).first()).toMatchObject({ status: 'rejected', end_reason: 'voice_off' });
    process.env.VOICE_ENABLED = 'true';
  });
});

describe('recordings and retention', () => {
  test('a recording is stored under the organisation and workspace; audio and transcript go after 30 days; the summary stays', async () => {
    const r = await calls.saveRecording(mockKnex, 'wacid.2', Buffer.from('OggS fake audio'), 'audio/ogg');
    expect(r.status).toBe(200);
    const call = await mockKnex('voice_call').where({ wa_call_id: 'wacid.2' }).first();
    expect(call.recording_key).toBe(`voice/${ids.orgA}/${ids.wsA}/${call.id}.ogg`);
    const file = calls.recordingPath(call.recording_key);
    expect(fs.existsSync(file)).toBe(true);
    expect(calls.recordingPath('voice/../../etc/passwd')).toBeNull();

    expect(await calls.purgeExpired(mockKnex)).toEqual({ files: 0, turns: 0 }); // not 30 days old yet
    const out = await calls.purgeExpired(mockKnex, Math.floor(Date.now() / 1000) + 31 * 86400);
    expect(out.files).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(file)).toBe(false);
    const after = await mockKnex('voice_call').where({ id: call.id }).first();
    expect([after.recording_key, after.summary]).toEqual([null, 'Chairman, 240 flats, demo Sunday']);
    expect(Number((await mockKnex('voice_transcript_turn').where({ call_id: call.id }).count('* as c').first()).c)).toBe(0);
  });
});

describe('routes', () => {
  function app(userId) {
    const a = express();
    a.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
    a.use(session({ secret: 'test-secret-test-secret-test-secret', resave: false, saveUninitialized: true }));
    a.use('/api/webhooks/voice-gateway', require('../routes/voiceGateway')(mockKnex));
    a.use((req, res, next) => { req.session.userId = userId; next(); });
    const { makeWithWorkspace } = require('../middleware/tenancy');
    const pa = require('../services/platformAdmin');
    a.use('/api/voice', makeWithWorkspace(require('../repos/membershipsRepo')(mockKnex), { loadUser: pa.loadUser }), require('../routes/voice')(mockKnex, require('../modules/access').middleware));
    return a;
  }
  beforeEach(() => require('../services/platformAdmin').forget());

  test('staff can set up the assistant; bad input is refused with a field', async () => {
    const res = await request(app(ids.staff)).put('/api/voice/assistant').send({ name: 'Sneha', greeting: 'Namaste! Main Sneha…', instructions: 'UrbanSociety script', active: true,
      handover: { phone: '+91 98765 43210', hoursFrom: '08:00', hoursTo: '22:00' }, retention_days: 30 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ exists: true, name: 'Sneha', active: true, retention_days: 30, handover: { phone: '+919876543210' } });
    const bad = await request(app(ids.staff)).put('/api/voice/assistant').send({ name: 'x', greeting: 'y', models: { llm: { provider: 'llama', model: 'x' } } });
    expect([bad.status, bad.body.field]).toEqual([400, 'models']);
  });

  test('a customer owner cannot see or change it (PoC: staff only)', async () => {
    expect((await request(app(ids.owner)).get('/api/voice/assistant')).status).toBe(403);
    expect((await request(app(ids.owner)).get('/api/voice/calls')).status).toBe(403);
  });

  test('calls list masks the number; another workspace\'s call id is 404; the transcript comes with the call', async () => {
    const list = await request(app(ids.staff)).get('/api/voice/calls');
    expect(list.status).toBe(200);
    expect(list.body.every((c) => !c.contact && (!c.contact_masked || c.contact_masked.startsWith('…')))).toBe(true);
    const t = Math.floor(Date.now() / 1000);
    const [other] = await mockKnex('voice_call').insert({ org_id: ids.orgB, workspace_id: ids.wsB, direction: 'USER_INITIATED', status: 'ended', wa_call_id: 'wacid.b', created_at: t, updated_at: t }).returning('id');
    const otherId = other?.id ?? other;
    expect((await request(app(ids.staff)).get(`/api/voice/calls/${otherId}`)).status).toBe(404);
    expect((await request(app(ids.staff)).get(`/api/voice/calls/${otherId}/recording`)).status).toBe(404);
  });

  test('gateway callbacks need the signature', async () => {
    const body = JSON.stringify({ type: 'turn', call_id: 'wacid.3', seq: 9, speaker: 'caller', text: 'hi' });
    expect((await request(app(ids.staff)).post('/api/webhooks/voice-gateway/events').set('Content-Type', 'application/json').send(body)).status).toBe(401);
    const ok = await request(app(ids.staff)).post('/api/webhooks/voice-gateway/events').set('Content-Type', 'application/json').set('X-Voice-Signature', sign.sign(body, SECRET)).send(body);
    expect(ok.status).toBe(200);
    const audio = Buffer.from('RIFF fake');
    expect((await request(app(ids.staff)).post('/api/webhooks/voice-gateway/recording/wacid.3').set('Content-Type', 'audio/wav').send(audio)).status).toBe(401);
    const rec = await request(app(ids.staff)).post('/api/webhooks/voice-gateway/recording/wacid.3').set('Content-Type', 'audio/wav').set('X-Voice-Signature', sign.sign(audio, SECRET)).send(audio);
    expect(rec.status).toBe(200);
  });
});
