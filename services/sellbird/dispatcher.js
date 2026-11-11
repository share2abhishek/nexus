// services/sellbird/dispatcher.js
// Safe email delivery engine for Sellbird with deliverability warmup caps and staggered dispatch.

const nodemailer = require('nodemailer');

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

function getSmtpConfig() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_FROM_NAME, SMTP_PORT, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }
  return {
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    from: SMTP_FROM || SMTP_USER,
    fromName: SMTP_FROM_NAME || '',
  };
}

async function sendOutreachEmail({ to, subject, body, fromName, fromEmail }) {
  const config = getSmtpConfig();
  if (!config) {
    throw new Error('SMTP mailer not configured. Please enter your mail server details in Settings → Email.');
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  const sender = `${fromName || config.fromName} <${fromEmail || config.from}>`;
  const footerText = `\n\n---\nTo opt out of future emails, reply with "unsubscribe".`;
  const footerHtml = `<p style="font-size:12px;color:#888;margin-top:28px">To opt out of future emails, reply with "unsubscribe".</p>`;

  // The email text is shown as text: a '<' or '&' in it must not turn into HTML
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const htmlBody = esc(body).replace(/\n/g, '<br/>') + footerHtml;

  const info = await transporter.sendMail({
    from: sender,
    to,
    subject,
    text: body + footerText,
    html: htmlBody,
    headers: {
      'X-Mailer': 'Social-Nexus',
    },
  });

  return { success: true, messageId: info.messageId };
}

// "Pause sending" for a whole workspace (Sales outreach → Pause sending)
const pauseKey = (workspaceId) => `sellbird_paused_${workspaceId}`;
async function isPaused(knex, workspaceId) {
  return (await require('../../repos/configRepo')(knex).get(pauseKey(workspaceId))) === '1';
}
async function setPaused(knex, workspaceId, paused) {
  await require('../../repos/configRepo')(knex).set(pauseKey(workspaceId), paused ? '1' : '0');
}

// Someone who replied (or unsubscribed) gets no more follow-ups from any campaign
async function hasReplied(knex, workspaceId, email) {
  if (!email) return false;
  return !!(await knex('sellbird_replies').where({ workspace_id: workspaceId })
    .whereRaw('LOWER(sender_email) = ?', [String(email).toLowerCase().trim()]).first('id'));
}

// Text the AI (or a template) left for someone to fill in, like [Name] or {{first_name}}.
// An email with these would go out looking unfinished, so it isn't sent.
const PLACEHOLDER = /\[(?:name|first ?name|sender|your name|company|company name|topic|previous subject|prospect)\]|\{\{\s*[\w.]+\s*\}\}/i;
function findPlaceholder(...texts) {
  for (const t of texts) { const m = String(t || '').match(PLACEHOLDER); if (m) return m[0]; }
  return null;
}

// Process due approved emails: daily cap per campaign, paused campaigns and
// workspaces skipped, people who replied or opted out never emailed again.
async function processDueOutbox(knex, repo, options = {}) {
  const now = nowEpoch();
  const todayStart = now - (now % 86400);

  const maxBatch = typeof options === 'number' ? options : options.maxBatch || 10;
  const workspaceId = typeof options === 'object' ? options.workspaceId : null;
  const enableJitter = typeof options === 'object' && options.enableJitter !== undefined ? options.enableJitter : true;

  // Check pending approved emails (scoped to workspaceId if provided)
  let q = knex('sellbird_outbox as o')
    .join('sellbird_contacts as c', 'o.contact_id', 'c.id')
    .join('sellbird_campaigns as camp', 'o.campaign_id', 'camp.id')
    .where('o.status', 'approved')
    .whereNot('camp.status', 'paused')
    .where('o.scheduled_at', '<=', now);

  if (workspaceId) {
    q = q.where('o.workspace_id', workspaceId);
  }

  const dueItems = await q
    .select('o.*', 'c.email as contact_email', 'c.full_name as contact_name', 'c.email_status as contact_email_status', 'camp.max_emails_per_day', 'camp.sequence_template_json')
    .limit(maxBatch);

  if (!dueItems.length) {
    return { sent: 0, pending: 0, total_due: 0 };
  }

  let sentCount = 0;
  const config = getSmtpConfig();
  // Without email sending set up nothing goes out — and nothing is marked
  // "sent" (it used to pretend, so people thought prospects had been emailed)
  if (!config) {
    return { sent: 0, total_due: dueItems.length, error: 'Email sending isn’t set up yet (Settings → Email sending). Approved emails wait until it is.' };
  }
  const pausedWs = new Map();

  for (const item of dueItems) {
    if (!pausedWs.has(item.workspace_id)) pausedWs.set(item.workspace_id, await isPaused(knex, item.workspace_id));
    if (pausedWs.get(item.workspace_id)) continue;
    // Server edition: only businesses with an active trial or plan send
    if (require('../edition').isServer() && !(await require('../entitlements').canPublish(item.workspace_id))) continue;

    // Check daily cap for this campaign
    const [todayCount] = await knex('sellbird_outbox')
      .where({ campaign_id: item.campaign_id, status: 'sent' })
      .where('sent_at', '>=', todayStart)
      .count('id as c');

    const sentToday = parseInt(todayCount?.c || 0, 10);
    const maxPerDay = item.max_emails_per_day || 25;

    if (sentToday >= maxPerDay) {
      // Reached today's warmup cap, push to tomorrow
      const tomorrow = now + 86400;
      await repo.updateOutboxItem(item.workspace_id, item.id, { scheduled_at: tomorrow });
      continue;
    }

    if (!item.contact_email) {
      await repo.updateOutboxItem(item.workspace_id, item.id, { status: 'failed', error_message: 'Contact email is missing' });
      continue;
    }

    // Check deliverability: suppress invalid syntax or dead MX
    if (item.contact_email_status === 'invalid') {
      await repo.updateOutboxItem(item.workspace_id, item.id, {
        status: 'failed',
        error_message: 'Contact email has invalid MX or syntax. Suppressed from delivery.',
      });
      continue;
    }

    // Check opt-out / suppression list in this workspace (case-insensitive)
    const optedOut = await knex('sellbird_replies')
      .where({ workspace_id: item.workspace_id })
      .whereRaw('LOWER(sender_email) = ?', [item.contact_email.toLowerCase().trim()])
      .whereIn('intent_category', ['unsubscribe', 'not_interested'])
      .first();

    if (optedOut) {
      await repo.updateOutboxItem(item.workspace_id, item.id, {
        status: 'rejected',
        error_message: 'Recipient previously opted out or unsubscribed',
      });
      continue;
    }
    // A follow-up to someone who already replied isn't sent
    if ((item.step_number || 1) > 1 && await hasReplied(knex, item.workspace_id, item.contact_email)) {
      await repo.updateOutboxItem(item.workspace_id, item.id, { status: 'rejected', error_message: 'Not sent: they already replied.' });
      continue;
    }

    // Follow-ups go out in order: step 2 only after step 1 really went out,
    // and at least a day after it. (When an email goes out late, its later
    // steps are moved by the same delay, below, so the planned gaps stay.)
    if ((item.step_number || 1) > 1) {
      const prev = await knex('sellbird_outbox')
        .where({ workspace_id: item.workspace_id, campaign_id: item.campaign_id, contact_id: item.contact_id, step_number: item.step_number - 1 })
        .orderBy('id', 'desc').first();
      if (prev && ['rejected', 'failed'].includes(prev.status)) {
        await repo.updateOutboxItem(item.workspace_id, item.id, { status: 'rejected', error_message: 'Not sent: the email before it wasn’t sent.' });
        continue;
      }
      if (prev && prev.status !== 'sent') continue; // waits for the earlier email
      const current = await knex('sellbird_outbox').where({ id: item.id }).first('scheduled_at');
      if ((current?.scheduled_at || 0) > now) continue; // moved later while this batch ran
      if (prev && (prev.sent_at || 0) + 86400 > now) {
        await repo.updateOutboxItem(item.workspace_id, item.id, { scheduled_at: (prev.sent_at || now) + 86400 });
        continue;
      }
    }

    const unfilled = findPlaceholder(item.subject, item.body);
    if (unfilled) {
      await repo.updateOutboxItem(item.workspace_id, item.id, { status: 'pending_approval', error_message: `Not sent: “${unfilled}” needs to be filled in. Edit the email, then approve it again.` });
      continue;
    }

    // Atomically claim (approved -> sending)
    const claimed = await knex('sellbird_outbox')
      .where({ id: item.id, status: 'approved' })
      .update({ status: 'sending', updated_at: now });
    if (!claimed) continue;

    try {
      await sendOutreachEmail({ to: item.contact_email, subject: item.subject, body: item.body });

      await repo.updateOutboxItem(item.workspace_id, item.id, {
        status: 'sent',
        sent_at: now,
        error_message: null,
      });

      // Update company status to 'contacted'
      const contact = await knex('sellbird_contacts').where({ id: item.contact_id }).first();
      if (contact?.company_id) {
        await knex('sellbird_companies').where({ id: contact.company_id }).update({ status: 'contacted', updated_at: now });
      }

      // Sent later than planned: move this person's next steps by the same delay
      const late = now - (item.scheduled_at || now);
      if (late > 0) {
        await knex('sellbird_outbox')
          .where({ workspace_id: item.workspace_id, campaign_id: item.campaign_id, contact_id: item.contact_id })
          .where('step_number', '>', item.step_number || 1)
          .whereIn('status', ['pending_approval', 'approved'])
          .update({ scheduled_at: knex.raw('scheduled_at + ?', [late]), updated_at: now });
      }

      sentCount++;

      // Warmup deliverability: Randomized jitter (1.5s - 3.5s) between sends
      if (enableJitter && config && sentCount < dueItems.length) {
        const jitter = Math.floor(Math.random() * 2000) + 1500;
        await new Promise((resolve) => setTimeout(resolve, jitter));
      }
    } catch (err) {
      console.error(`[Sellbird Dispatcher] Error sending outbox #${item.id}:`, err.message);
      await repo.updateOutboxItem(item.workspace_id, item.id, {
        status: 'failed',
        error_message: err.message,
      });
    }
  }

  return { sent: sentCount, total_due: dueItems.length };
}

module.exports = {
  findPlaceholder,
  isPaused,
  setPaused,
  hasReplied,
  getSmtpConfig,
  sendOutreachEmail,
  processDueOutbox,
};
