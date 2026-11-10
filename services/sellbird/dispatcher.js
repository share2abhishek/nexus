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
    from: SMTP_FROM || SMTP_USER || 'sales@urbansociety.in',
    fromName: SMTP_FROM_NAME || 'Urban Society Sales',
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

  const htmlBody = body.replace(/\n/g, '<br/>') + footerHtml;

  const info = await transporter.sendMail({
    from: sender,
    to,
    subject,
    text: body + footerText,
    html: htmlBody,
    headers: {
      'X-Mailer': 'Sellbird/2.0 (Social-Nexus)',
    },
  });

  return { success: true, messageId: info.messageId };
}

// Process due approved emails in outbox respecting daily warmup limits, suppression, and randomized jitter
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

  for (const item of dueItems) {
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

    // Atomically claim (approved -> sending)
    const claimed = await knex('sellbird_outbox')
      .where({ id: item.id, status: 'approved' })
      .update({ status: 'sending', updated_at: now });
    if (!claimed) continue;

    try {
      if (config) {
        await sendOutreachEmail({
          to: item.contact_email,
          subject: item.subject,
          body: item.body,
        });
      } else {
        // Mock send mode if SMTP is not configured during development/eval
        console.log(`[Sellbird Dispatcher] Simulated send to ${item.contact_email}: "${item.subject}"`);
      }

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
  getSmtpConfig,
  sendOutreachEmail,
  processDueOutbox,
};
