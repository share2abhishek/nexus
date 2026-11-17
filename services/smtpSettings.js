// Email sending (SMTP) for any provider: checking the settings, testing them, and turning
// the technical failures into advice a person can act on.
//
// On the hosted edition a customer types the mail server's address, so the server must
// not be talked into connecting to something INSIDE its own network. The address is
// resolved here, refused if any answer is private, and the connection is made to the
// resolved IP (with the real name kept for the TLS certificate), so a DNS trick between
// checking and connecting can't change where it goes. See services/safeNet.js.
const dns = require('dns').promises;
const net = require('net');
const nodemailer = require('nodemailer');
const safeNet = require('./safeNet');

const hosted = () => require('./edition').isServer();

function fail(message, code = 'BAD_SETTINGS') {
  return Object.assign(new Error(message), { status: 400, code });
}

// Clean and check what the form sent. Throws a readable error.
function normalize({ host, port, secure }) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) throw fail('Type the mail server (for example smtp.gmail.com).');
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h) || h.length > 253) throw fail('The mail server should be just a name like smtp.example.com (no https://, spaces or slashes).');
  const p = Number(String(port || '587').trim());
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw fail('The port should be a number such as 587 or 465.');
  // true = SSL/TLS from the start (port 465); false = starts plain and upgrades with STARTTLS (587, 25)
  const s = secure == null || secure === '' ? p === 465 : (secure === true || secure === 'true' || secure === 'ssl');
  return { host: h, port: p, secure: s };
}

// At save time (hosted edition): refuse names that plainly mean "inside our network". No DNS
// here, so a server that doesn't resolve yet can still be saved; the real check, with the
// resolved address, happens when connecting (connectionOptions).
function assertAllowedHost(host) {
  if (!hosted()) return;
  try { safeNet.guardHost(host); } catch { throw fail('Use your email provider’s public mail server address.', 'EBLOCKED'); }
}

// Options for nodemailer.createTransport. On the hosted edition the address is pinned (see above).
async function connectionOptions(cfg) {
  const base = {
    host: cfg.host, port: cfg.port, secure: !!cfg.secure, auth: cfg.auth,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  };
  if (!hosted()) return base;
  try { safeNet.guardHost(cfg.host); } catch { throw fail('Use your email provider’s public mail server address.', 'EBLOCKED'); }
  if (net.isIP(cfg.host)) return base;
  let addrs = [];
  try { addrs = await dns.lookup(cfg.host, { all: true }); } catch { throw fail(`Couldn’t find the mail server “${cfg.host}”. Check the spelling.`, 'ENOTFOUND'); }
  if (!addrs.length || addrs.some((a) => safeNet.isPrivateIp(a.address))) throw fail('Use your email provider’s public mail server address.', 'EBLOCKED');
  return { ...base, host: addrs[0].address, servername: cfg.host, tls: { servername: cfg.host } };
}

// What went wrong, in plain words, with what to try
function explain(err, cfg = {}) {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');
  const resp = Number(err?.responseCode) || 0;
  const where = `${cfg.host || 'the mail server'}:${cfg.port || ''}`.replace(/:$/, '');
  if (code === 'EBLOCKED') return msg;
  if (code === 'EAUTH' || [530, 534, 535].includes(resp) || /invalid login|username and password not accepted|authentication (failed|unsuccessful)|auth.*(failed|rejected)|bad credentials|5\.7\.8/i.test(msg)) {
    return 'The mail server didn’t accept the email address and password. Check both. Many providers (Gmail, Outlook, Yahoo, Zoho, iCloud…) need an app password, and services like SendGrid, Brevo or Amazon SES need their own SMTP username and key, not your normal password.';
  }
  if (code === 'ENOTFOUND' || code === 'EDNS' || /getaddrinfo|ENOTFOUND/.test(msg)) return `Couldn’t find the mail server “${cfg.host || ''}”. Check the spelling.`;
  if (code === 'ECONNREFUSED') return `${where} refused the connection. Check the port (587 for STARTTLS, 465 for SSL/TLS).`;
  if (/wrong version number|ssl3_get_record|packet length too long|unknown protocol|tls.*handshake/i.test(msg)) {
    return 'The security setting doesn’t match the port. Use STARTTLS with port 587 (or 25), and SSL/TLS with port 465.';
  }
  if (/self.signed|certificate|CERT_|altnames|unable to verify/i.test(msg)) return `The security certificate of ${cfg.host || 'the mail server'} isn’t valid for that name. Check the mail server name your provider gave you.`;
  if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code) || /timed? ?out|greeting never received|socket (closed|hang)|connection closed/i.test(msg)) {
    return `No answer from ${where}. Check the port and the security setting (587 uses STARTTLS, 465 uses SSL/TLS). Some networks and hosting providers also block outgoing mail ports.`;
  }
  if (/sender|from address|not (verified|allowed|authorized)|domain.*not.*verified|550|553/i.test(msg) && resp >= 500) {
    return 'The server rejected the “Send as” address. Use an address your provider has verified (for Amazon SES, SendGrid, Mailgun, Brevo and Postmark you must verify the sender or domain first).';
  }
  return msg.split('\n')[0].slice(0, 200) || 'The mail server could not be reached.';
}

/**
 * Check the connection and login without sending anything, or (with `to`) also send one
 * short test email.
 * @returns {{ ok: true, sent: boolean } | { ok: false, error: string }}
 */
async function test(cfg, { to, fromName } = {}) {
  let norm;
  try { norm = normalize(cfg); } catch (err) { return { ok: false, error: err.message }; }
  const full = { ...cfg, ...norm };
  try {
    const transport = nodemailer.createTransport(await connectionOptions({ ...full, auth: cfg.auth }));
    await transport.verify();
    if (to) {
      await transport.sendMail({
        from: `${fromName || 'NexaDrip'} <${cfg.from || cfg.auth?.user}>`,
        to,
        subject: 'Your NexaDrip email settings work',
        text: 'This is a test message from NexaDrip. Your email settings are working: campaigns and outreach emails will be sent from this address.',
      });
    }
    return { ok: true, sent: !!to };
  } catch (err) {
    return { ok: false, error: explain(err, full) };
  }
}

// ── Amazon SES with AWS access keys (the SES API instead of an SMTP login) ─────
// config.ses = { region, accessKeyId, secretAccessKey }. The address is always AWS's own for
// the chosen region, never typed by the user, so there is no mail server to guard.
const SES_REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;
const SES_KEY_ID_RE = /^[A-Z0-9]{16,128}$/;
const SES_SECRET_RE = /^[A-Za-z0-9/+=]{30,128}$/;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

// Clean and check the keys and region. Throws a readable error.
function normalizeSes({ region, accessKeyId, secretAccessKey } = {}) {
  const r = String(region || '').trim().toLowerCase();
  if (!SES_REGION_RE.test(r)) throw fail('Choose the AWS region where you verified your sender (for example ap-south-1).');
  const k = String(accessKeyId || '').trim();
  if (!SES_KEY_ID_RE.test(k)) throw fail('The Access Key ID looks like AKIAIOSFODNN7EXAMPLE (letters and numbers only, no spaces).');
  const s = String(secretAccessKey || '').trim();
  if (!SES_SECRET_RE.test(s)) throw fail('The Secret Access Key is about 40 characters of letters, numbers, + and /. Check you copied all of it.');
  return { region: r, accessKeyId: k, secretAccessKey: s };
}

function sesClient(ses) {
  const { SESv2Client } = require('@aws-sdk/client-sesv2');
  return new SESv2Client({
    region: ses.region,
    credentials: { accessKeyId: ses.accessKeyId, secretAccessKey: ses.secretAccessKey },
    maxAttempts: 2,
    requestHandler: { requestTimeout: 15000, connectionTimeout: 10000 },
  });
}

// A nodemailer transport for either way of sending, so every caller just uses sendMail().
async function createTransport(config) {
  if (config && config.ses) {
    const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
    return nodemailer.createTransport({ SES: { sesClient: sesClient(config.ses), SendEmailCommand } });
  }
  return nodemailer.createTransport(await connectionOptions(config));
}

// What AWS said, in plain words, with what to try
function explainSes(err, ses = {}) {
  const name = String(err?.name || err?.Code || '');
  const msg = String(err?.message || err || '');
  const where = ses.region ? ` in ${ses.region}` : '';
  if (/^(UnrecognizedClientException|InvalidClientTokenId|InvalidSignatureException|SignatureDoesNotMatch|IncompleteSignature|InvalidAccessKeyId)$/.test(name) || /security token.*invalid|signature we calculated|invalid.*access key/i.test(msg)) {
    return 'AWS did not accept the Access Key ID or Secret Access Key. Check both, and that the key is active (AWS console → IAM → your user → Security credentials).';
  }
  if (name === 'AccessDeniedException' || /not authorized to perform|is not authorized/i.test(msg)) {
    return 'The keys are valid but are not allowed to send email. In AWS IAM give the user the permission ses:SendEmail (for example the policy AmazonSESFullAccess).';
  }
  if (name === 'MessageRejected' || /not verified|sandbox/i.test(msg)) {
    if (/not verified/i.test(msg)) return `Amazon SES refused it because an address is not verified${where}. The “Send as” address (or its domain) must be verified in SES → Verified identities in this same region. While your SES account is in the sandbox, the person you email must be verified too.`;
    return `Amazon SES refused the message${where}: ${msg.split('\n')[0].slice(0, 160)}`;
  }
  if (name === 'MailFromDomainNotVerifiedException') return 'The MAIL FROM domain of this sender is not verified in SES. Finish the domain setup in SES → Verified identities.';
  if (name === 'AccountSuspendedException') return 'Amazon has suspended sending for this SES account. Open the SES console or contact AWS support.';
  if (name === 'SendingPausedException') return 'Sending is paused for this SES account or sender. Open the SES console to resume it.';
  if (name === 'TooManyRequestsException' || name === 'LimitExceededException') return 'You reached your Amazon SES sending limit. Wait a little, or ask AWS for a higher limit.';
  if (name === 'NotFoundException') return `Amazon SES could not find that sender${where}. Check the region matches where you verified it.`;
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|TimeoutError|socket hang up|getaddrinfo/i.test(`${name} ${msg} ${err?.code || ''}`)) {
    return `Could not reach Amazon SES${where}. Check your internet connection and the region.`;
  }
  return msg.split('\n')[0].slice(0, 200) || 'Amazon SES did not accept the request.';
}

// A display name that can not break out of the From header
const safeName = (n) => String(n || '').replace(/[\r\n"<>\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * Check the keys and the "Send as" address with one real send (needs only ses:SendEmail): to
 * Amazon's own simulator address, which accepts mail without delivering it, or, with `to`, to a
 * real inbox. Passing means the keys, the region, the permission and the verified sender all work.
 */
async function testSes(cfg, { to, fromName } = {}) {
  let ses;
  try { ses = normalizeSes(cfg.ses); } catch (err) { return { ok: false, error: err.message }; }
  const from = String(cfg.from || '').trim();
  if (!EMAIL_RE.test(from)) return { ok: false, error: 'Fill in “Send as” with a verified email address (an address or domain you verified in SES).' };
  try {
    const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
    const name = safeName(fromName);
    await sesClient(ses).send(new SendEmailCommand({
      FromEmailAddress: name ? `${name} <${from}>` : from,
      Destination: { ToAddresses: [to || 'success@simulator.amazonses.com'] },
      Content: { Simple: {
        Subject: { Data: 'Your NexaDrip email settings work' },
        Body: { Text: { Data: 'This is a test message from NexaDrip. Your Amazon SES settings are working: campaigns and outreach emails will be sent from this address.' } },
      } },
    }));
    return { ok: true, sent: !!to };
  } catch (err) {
    return { ok: false, error: explainSes(err, ses) };
  }
}

module.exports = { normalize, assertAllowedHost, connectionOptions, explain, test, normalizeSes, createTransport, explainSes, testSes, SES_REGION_RE, SES_KEY_ID_RE, SES_SECRET_RE, EMAIL_RE };
