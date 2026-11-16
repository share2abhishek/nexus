// Email sending for any provider: checking and testing the settings, the advice shown when
// something is wrong, and the hosted-edition rule that a customer can't aim the server at
// an address inside its own network.
const net = require('net');
const dns = require('dns');
const smtp = require('../services/smtpSettings');

// A tiny mail server (loopback only) that accepts one login and keeps what it was sent
function fakeSmtp({ user = 'sender@example.test', pass = 'app-pass-1234' } = {}) {
  const received = [];
  const server = net.createServer((sock) => {
    let data = ''; let inData = false; let msg = ''; let awaitingPlain = false;
    const send = (s) => sock.write(s + '\r\n');
    send('220 fake ESMTP ready');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      data += chunk.toString('utf8');
      let i;
      while ((i = data.indexOf('\r\n')) >= 0) {
        const line = data.slice(0, i); data = data.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; received.push(msg); msg = ''; send('250 queued'); } else msg += line + '\n';
          continue;
        }
        const check = (b64) => {
          const [, u, p] = Buffer.from(b64, 'base64').toString('utf8').split('\0');
          if (u === user && p === pass) send('235 2.7.0 Authentication successful');
          else send('535 5.7.8 Username and Password not accepted');
        };
        if (awaitingPlain) { awaitingPlain = false; check(line); continue; }
        if (/^EHLO|^HELO/i.test(line)) { sock.write('250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n'); }
        else if (/^AUTH PLAIN$/i.test(line)) { awaitingPlain = true; send('334 '); }
        else if (/^AUTH PLAIN /i.test(line)) check(line.slice(11));
        else if (/^MAIL FROM/i.test(line) || /^RCPT TO/i.test(line)) { received.push(line); send('250 ok'); }
        else if (/^DATA/i.test(line)) { inData = true; send('354 go ahead'); }
        else if (/^QUIT/i.test(line)) { send('221 bye'); sock.end(); }
        else send('250 ok');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received })));
}

describe('normalize', () => {
  test('accepts a clean server and port, and picks the usual security', () => {
    expect(smtp.normalize({ host: ' SMTP.Gmail.com ', port: '587' })).toEqual({ host: 'smtp.gmail.com', port: 587, secure: false });
    expect(smtp.normalize({ host: 'smtp.hostinger.com', port: 465 })).toEqual({ host: 'smtp.hostinger.com', port: 465, secure: true });
    expect(smtp.normalize({ host: 'a.test', port: 587, secure: 'ssl' }).secure).toBe(true);
    expect(smtp.normalize({ host: 'a.test', port: 465, secure: 'starttls' }).secure).toBe(false);
    expect(smtp.normalize({ host: 'email-smtp.ap-south-1.amazonaws.com' }).port).toBe(587);
  });

  test('says what is wrong with a bad server or port', () => {
    expect(() => smtp.normalize({ host: '' })).toThrow(/Type the mail server/);
    expect(() => smtp.normalize({ host: 'https://smtp.gmail.com' })).toThrow(/just a name/);
    expect(() => smtp.normalize({ host: 'smtp gmail.com' })).toThrow(/just a name/);
    expect(() => smtp.normalize({ host: 'a.test', port: 'abc' })).toThrow(/port/);
    expect(() => smtp.normalize({ host: 'a.test', port: 70000 })).toThrow(/port/);
  });
});

describe('advice for failures', () => {
  const cfg = { host: 'smtp.example.test', port: 587 };
  test.each([
    [{ code: 'EAUTH', message: 'Invalid login', responseCode: 535 }, /app password/i],
    [{ message: '535 5.7.8 Username and Password not accepted' }, /didn’t accept the email address and password/],
    [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND smtp.example.test' }, /Couldn’t find the mail server “smtp.example.test”/],
    [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }, /refused the connection/],
    [{ code: 'ETIMEDOUT', message: 'Connection timeout' }, /587 uses STARTTLS, 465 uses SSL\/TLS/],
    [{ message: 'error:0A00010B:SSL routines:ssl3_get_record:wrong version number' }, /security setting doesn’t match the port/],
    [{ message: 'self signed certificate' }, /certificate/],
    [{ message: '550 5.7.1 Sender address rejected: not verified', responseCode: 550 }, /verified/],
  ])('%j', (err, expected) => {
    expect(smtp.explain(err, cfg)).toMatch(expected);
  });
});

describe('testing settings against a mail server', () => {
  let srv;
  beforeAll(async () => { delete process.env.NEXUS_MODE; srv = await fakeSmtp(); });
  afterAll(() => srv.server.close());
  const cfg = (over = {}) => ({ host: '127.0.0.1', port: srv.port, secure: 'starttls', auth: { user: 'sender@example.test', pass: 'app-pass-1234' }, from: 'sender@example.test', ...over });

  test('right login: connects and signs in, sending nothing', async () => {
    const before = srv.received.length;
    expect(await smtp.test(cfg())).toEqual({ ok: true, sent: false });
    expect(srv.received.length).toBe(before);
  });

  test('wrong password: a plain-words message, not a stack trace', async () => {
    const r = await smtp.test(cfg({ auth: { user: 'sender@example.test', pass: 'nope' } }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/didn’t accept the email address and password/);
    expect(r.error).not.toMatch(/535|at .*\.js/);
  });

  test('"send me a test email" really delivers one short message', async () => {
    const r = await smtp.test(cfg(), { to: 'me@example.test', fromName: 'Sweet Crumbs' });
    expect(r).toEqual({ ok: true, sent: true });
    const all = srv.received.join('\n');
    expect(all).toMatch(/RCPT TO:<me@example\.test>/);
    expect(all).toMatch(/Subject: Your NexaDrip email settings work/);
    expect(all).toMatch(/Sweet Crumbs/);
  });

  test('nothing listening on the port: says to check the port', async () => {
    const r = await smtp.test(cfg({ port: 1 }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/refused the connection|No answer from/);
  });

  test('a name that does not exist', async () => {
    const r = await smtp.test(cfg({ host: 'no-such-host.invalid' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Couldn’t find the mail server|No answer/);
  });

  test('bad form values are reported, not thrown', async () => {
    expect((await smtp.test(cfg({ host: 'https://x' }))).error).toMatch(/just a name/);
  });
});

describe('hosted edition: the mail server must be a public address', () => {
  const OLD = process.env.NEXUS_MODE;
  beforeAll(() => { process.env.NEXUS_MODE = 'server'; });
  afterAll(() => { if (OLD === undefined) delete process.env.NEXUS_MODE; else process.env.NEXUS_MODE = OLD; });
  afterEach(() => jest.restoreAllMocks());

  test.each(['127.0.0.1', 'localhost', '169.254.169.254', '10.0.0.5', '[::1]', 'intranet'])('%s is refused', async (host) => {
    await expect(smtp.connectionOptions({ host, port: 587, secure: false, auth: {} })).rejects.toMatchObject({ code: expect.stringMatching(/EBLOCKED|ENOTFOUND/) });
    const r = await smtp.test({ host: host.replace(/^\[|\]$/g, ''), port: 587, auth: { user: 'a', pass: 'b' } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/public mail server|Couldn’t find|just a name/);
  });

  test('a public name is pinned to the address it resolved to, keeping the name for the certificate', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '203.0.113.9', family: 4 }]);
    const o = await smtp.connectionOptions({ host: 'smtp.example.test', port: 587, secure: false, auth: { user: 'u', pass: 'p' } });
    expect(o).toMatchObject({ host: '203.0.113.9', servername: 'smtp.example.test', tls: { servername: 'smtp.example.test' }, port: 587 });
  });

  test('a public name that resolves to a private address is refused (DNS trick)', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '203.0.113.9', family: 4 }, { address: '10.1.2.3', family: 4 }]);
    await expect(smtp.connectionOptions({ host: 'smtp.evil.test', port: 587, secure: false, auth: {} })).rejects.toMatchObject({ code: 'EBLOCKED' });
  });
});

describe('on a desktop the mail server may be anything (a local relay is normal)', () => {
  test('connection options pass through unchanged', async () => {
    delete process.env.NEXUS_MODE;
    const o = await smtp.connectionOptions({ host: '127.0.0.1', port: 2525, secure: false, auth: { user: 'u', pass: 'p' } });
    expect(o).toMatchObject({ host: '127.0.0.1', port: 2525, secure: false });
    expect(o.servername).toBeUndefined();
  });
});

describe('saving on the hosted edition', () => {
  const OLD = process.env.NEXUS_MODE;
  afterEach(() => { if (OLD === undefined) delete process.env.NEXUS_MODE; else process.env.NEXUS_MODE = OLD; });
  test('private names are refused without any network lookup, other names are accepted', () => {
    process.env.NEXUS_MODE = 'server';
    expect(() => smtp.assertAllowedHost('127.0.0.1')).toThrow(/public mail server/);
    expect(() => smtp.assertAllowedHost('localhost')).toThrow(/public mail server/);
    expect(() => smtp.assertAllowedHost('smtp.not-yet-resolving.test')).not.toThrow();
    delete process.env.NEXUS_MODE;
    expect(() => smtp.assertAllowedHost('127.0.0.1')).not.toThrow(); // desktop: a local relay is fine
  });
});
