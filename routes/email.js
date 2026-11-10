const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/tenancy');
// Sending mail to the whole list or deleting subscribers is a publishing action
const { requirePublishLicense } = require('../middleware/license');
const canPublish = requirePermission('content.publish');
const { aiGenerate, aiJSON, aiArgsFromReq } = require('../services/aiHelper');
const knexInstance = require('../services/knex');
const emailRepo    = require('../repos/emailRepo')(knexInstance);
const historyRepo  = require('../repos/historyRepo')(knexInstance);

function escapeForHtml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The user's own AI keys / Ollama / chosen model (not just the shared .env key)
function ai(req) { return aiArgsFromReq(req); }

// ── Subscribers ──────────────────────────────────────────────────────────────

router.get('/subscribers', async (req, res) => {
  try { res.json(await emailRepo.listSubscribers(req.workspaceId)); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/subscribers', async (req, res) => {
  const { email, name, tags } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  try {
    const id = await emailRepo.addSubscriber(req.workspaceId, { email, name, tags });
    res.json({ success: true, id });
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('unique')) return res.status(409).json({ error: 'Email already subscribed' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/subscribers/:id', async (req, res) => {
  try {
    await emailRepo.updateSubscriber(req.workspaceId, parseInt(req.params.id), req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/subscribers/:id', canPublish, async (req, res) => {
  try {
    await emailRepo.removeSubscriber(req.workspaceId, parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk import subscribers from comma-separated list
router.post('/subscribers/bulk', async (req, res) => {
  const { emails } = req.body;
  if (!emails) return res.status(400).json({ error: 'emails string is required' });

  const list = emails.split(/[\n,;]/).map(e => e.trim()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  let added = 0;
  for (const email of list) {
    try { await emailRepo.addSubscriber(req.workspaceId, { email }); added++; } catch {}
  }
  res.json({ success: true, added, total: list.length });
});

// ── Campaigns ──────────────────────────────────────────────────────────────────────────────

router.get('/campaigns', async (req, res) => {
  try { res.json(await emailRepo.listCampaigns(req.workspaceId)); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/campaigns', async (req, res) => {
  const { name, subject, html_content, text_content } = req.body;
  if (!name || !subject) return res.status(400).json({ error: 'name and subject are required' });
  try {
    const id = await emailRepo.saveCampaign(req.workspaceId, { name, subject, html_content, text_content });
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/campaigns/:id', async (req, res) => {
  try {
    await emailRepo.updateCampaign(req.workspaceId, parseInt(req.params.id), req.body);
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.delete('/campaigns/:id', async (req, res) => {
  try {
    await emailRepo.removeCampaign(req.workspaceId, parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/email/campaigns/:id/send — send via SMTP
router.post('/campaigns/:id/send', canPublish, requirePublishLicense, async (req, res) => {
  const campaign = await emailRepo.getCampaign(req.workspaceId, parseInt(req.params.id));
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_FROM_NAME, SMTP_PORT, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return res.status(400).json({
      error: 'Email sending is not set up yet. Go to Settings → Email sending and enter your mail server details (Gmail users: use an App Password).'
    });
  }

  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch { return res.status(500).json({ error: 'nodemailer not installed. Run: npm install nodemailer' }); }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587'),
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const allSubs = await emailRepo.listSubscribers(req.workspaceId);
  const subscribers = allSubs.filter(s => s.status === 'active');
  if (!subscribers.length) return res.status(400).json({ error: 'No active subscribers' });

  // Claim the campaign so a double-click or a second tab can't send it twice
  const claimed = await emailRepo.claimForSending(req.workspaceId, campaign.id);
  if (!claimed) return res.status(409).json({ error: 'This campaign has already been sent (or is sending right now). Duplicate it to send again.' });

  // Every email carries an unsubscribe option (required by anti-spam law).
  // A desktop app can't host a public web page, so it's a mailto: link — mail
  // apps show it as an "Unsubscribe" button. Mark replies as unsubscribed in
  // Email Marketing → Subscribers.
  const fromAddr = SMTP_FROM || SMTP_USER;
  const unsubMailto = `mailto:${fromAddr}?subject=${encodeURIComponent('Unsubscribe')}`;
  const footerHtml = `<p style="font-size:12px;color:#888;margin-top:24px">You received this because you subscribed to updates from ${escapeForHtml(SMTP_FROM_NAME || fromAddr)}. <a href="${unsubMailto}">Unsubscribe</a> — or reply with "unsubscribe".</p>`;
  const footerText = `\n\n—\nTo unsubscribe, reply to this email with "unsubscribe".`;

  let sent = 0;
  const errors = [];
  try {
    for (const sub of subscribers) {
      try {
        await transporter.sendMail({
          from: `${SMTP_FROM_NAME || 'Social-Nexus'} <${fromAddr}>`,
          to: sub.email,
          subject: campaign.subject,
          html: (campaign.html_content || `<pre>${escapeForHtml(campaign.text_content || '')}</pre>`) + footerHtml,
          text: (campaign.text_content || '') + footerText,
          headers: { 'List-Unsubscribe': `<${unsubMailto}>` },
        });
        sent++;
      } catch (err) {
        errors.push({ email: sub.email, error: err.message });
      }
    }
  } catch (err) {
    await emailRepo.markFailed(req.workspaceId, campaign.id);
    throw err;
  }

  if (sent === 0) {
    await emailRepo.markFailed(req.workspaceId, campaign.id);
    return res.status(502).json({ error: `No emails could be sent: ${errors[0]?.error || 'unknown error'}`, failed: errors.length });
  }
  await emailRepo.markSent(req.workspaceId, campaign.id, sent);
  res.json({ success: true, sent, failed: errors.length, total: subscribers.length });
});

// POST /api/email/generate — AI generate email content
router.post('/generate', async (req, res) => {
  const { type = 'newsletter', topic, app_name, tone = 'professional' } = req.body;

  const typeLabels = {
    newsletter: 'email newsletter', launch: 'product launch announcement',
    promo: 'promotional email with CTA', onboarding: 'welcome/onboarding email',
    reengagement: 're-engagement email for inactive users', update: 'product update email',
  };

  const prompt = `Write a ${typeLabels[type] || 'newsletter'} for "${app_name || 'our product'}" about: ${topic || 'general update'}.
Tone: ${tone}

Return ONLY valid JSON (no markdown):
{
  "subject": "Primary subject line",
  "subject_b": "A/B test alternative subject",
  "preview_text": "Preview text under 60 chars",
  "html_body": "Full HTML email with inline styles, ready to send",
  "text_body": "Plain text version",
  "cta_text": "Call-to-action button text",
  "cta_url": "https://yourdomain.com/cta"
}`;

  try {
    const { data, model } = await aiJSON(prompt, ai(req).apiKey, 3000, ai(req).options, ai(req).model);
    historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `Email ${type}: ${topic}`, response: JSON.stringify(data), type: 'email_campaign', model }).catch(() => {});
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
