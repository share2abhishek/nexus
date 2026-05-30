const express = require('express');
const router = express.Router();
const db = require('../services/database');
const { aiGenerate, aiJSON } = require('../services/aiHelper');

function apiKey(req) {
  return req.headers['x-api-key'] || process.env.GOOGLE_AI_KEY;
}

// ── Subscribers ──────────────────────────────────────────────────────────────

router.get('/subscribers', (req, res) => {
  res.json(db.getEmailSubscribers());
});

router.post('/subscribers', (req, res) => {
  const { email, name, tags } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  try {
    const id = db.saveEmailSubscriber({ email, name, tags });
    res.json({ success: true, id });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already subscribed' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/subscribers/:id', (req, res) => {
  db.updateEmailSubscriber(parseInt(req.params.id), req.body);
  res.json({ success: true });
});

router.delete('/subscribers/:id', (req, res) => {
  db.deleteEmailSubscriber(parseInt(req.params.id));
  res.json({ success: true });
});

// Bulk import subscribers from comma-separated list
router.post('/subscribers/bulk', (req, res) => {
  const { emails } = req.body;
  if (!emails) return res.status(400).json({ error: 'emails string is required' });

  const list = emails.split(/[\n,;]/).map(e => e.trim()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  let added = 0;
  for (const email of list) {
    try { db.saveEmailSubscriber({ email }); added++; } catch {}
  }
  res.json({ success: true, added, total: list.length });
});

// ── Campaigns ────────────────────────────────────────────────────────────────

router.get('/campaigns', (req, res) => {
  res.json(db.getEmailCampaigns());
});

router.post('/campaigns', (req, res) => {
  const { name, subject, html_content, text_content } = req.body;
  if (!name || !subject) return res.status(400).json({ error: 'name and subject are required' });
  const id = db.saveEmailCampaign({ name, subject, html_content, text_content });
  res.json({ success: true, id });
});

router.put('/campaigns/:id', (req, res) => {
  db.updateEmailCampaign(parseInt(req.params.id), req.body);
  res.json({ success: true });
});

router.delete('/campaigns/:id', (req, res) => {
  db.deleteEmailCampaign(parseInt(req.params.id));
  res.json({ success: true });
});

// POST /api/email/campaigns/:id/send — send via SMTP
router.post('/campaigns/:id/send', async (req, res) => {
  const campaign = db.getEmailCampaign(parseInt(req.params.id));
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_FROM_NAME, SMTP_PORT, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return res.status(400).json({
      error: 'SMTP not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS to your .env file.'
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

  const subscribers = db.getEmailSubscribers().filter(s => s.status === 'active');
  if (!subscribers.length) return res.status(400).json({ error: 'No active subscribers' });

  let sent = 0;
  const errors = [];
  for (const sub of subscribers) {
    try {
      await transporter.sendMail({
        from: `${SMTP_FROM_NAME || 'NEXUS'} <${SMTP_FROM || SMTP_USER}>`,
        to: sub.email,
        subject: campaign.subject,
        html: campaign.html_content || `<pre>${campaign.text_content}</pre>`,
        text: campaign.text_content || '',
      });
      sent++;
    } catch (err) {
      errors.push({ email: sub.email, error: err.message });
    }
  }

  db.markCampaignSent(campaign.id, sent);
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
    const { data, model } = await aiJSON(prompt, apiKey(req), 3000);
    db.saveHistory({ prompt: `Email ${type}: ${topic}`, response: JSON.stringify(data), type: 'email_campaign', model });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
