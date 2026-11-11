const express = require('express');
const router = express.Router();
const { aiGenerate, aiJSON, aiArgsFromReq } = require('../services/aiHelper');
const knexInstance   = require('../services/knex');
const appsRepo       = require('../repos/appsRepo')(knexInstance);
const brandKitRepo   = require('../repos/brandKitRepo')(knexInstance);
const templatesRepo  = require('../repos/templatesRepo')(knexInstance);
const utmRepo        = require('../repos/utmRepo')(knexInstance);
const historyRepo    = require('../repos/historyRepo')(knexInstance);

// The user's own AI keys / Ollama / chosen model (not just the shared .env key)
function ai(req) { return aiArgsFromReq(req); }

// ── Apps ──────────────────────────────────────────────────────────────────────

router.get('/apps', async (req, res) => {
  try { res.json(await appsRepo.list(req.workspaceId)); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/apps', async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'name is required' });
  try {
    const id = await appsRepo.save(req.workspaceId, req.body);
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/apps/:id', async (req, res) => {
  try {
    await appsRepo.update(req.workspaceId, parseInt(req.params.id), req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/apps/:id', async (req, res) => {
  try {
    await appsRepo.remove(req.workspaceId, parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Brand Kit ────────────────────────────────────────────────────────────────

router.get('/brand-kit', async (req, res) => {
  try { res.json(await brandKitRepo.get(req.workspaceId) || {}); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/brand-kit', async (req, res) => {
  try {
    await brandKitRepo.upsert(req.workspaceId, req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Content Templates ─────────────────────────────────────────────────────────

router.get('/templates', async (req, res) => {
  try { res.json(await templatesRepo.list(req.workspaceId, req.query.type)); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/templates', async (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'name and content are required' });
  try {
    const id = await templatesRepo.save(req.workspaceId, req.body);
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    await templatesRepo.remove(req.workspaceId, parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── UTM Links ─────────────────────────────────────────────────────────────────

router.get('/utm-links', async (req, res) => {
  try { res.json(await utmRepo.list(req.workspaceId)); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/utm-links', async (req, res) => {
  const { original_url, utm_source, utm_campaign } = req.body;
  if (!original_url || !utm_source || !utm_campaign) {
    return res.status(400).json({ error: 'original_url, utm_source, utm_campaign are required' });
  }

  const params = new URLSearchParams();
  const fields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  fields.forEach(f => { if (req.body[f]) params.set(f, req.body[f]); });

  const sep = original_url.includes('?') ? '&' : '?';
  const full_url = `${original_url}${sep}${params.toString()}`;

  try {
    const id = await utmRepo.save(req.workspaceId, { ...req.body, full_url });
    res.json({ success: true, id, full_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/utm-links/:id', async (req, res) => {
  try {
    await utmRepo.remove(req.workspaceId, parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Hashtag Research ──────────────────────────────────────────────────────────

router.post('/hashtags', async (req, res) => {
  const { topic, platform = 'all', count = 25 } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  const prompt = `Generate ${count} relevant hashtags for "${topic}" on ${platform === 'all' ? 'social media' : platform}.

Return ONLY valid JSON (no markdown):
{
  "hashtags": {
    "high_volume": ["#hashtag1", "#hashtag2", "#hashtag3"],
    "medium_volume": ["#hashtag4", "#hashtag5", "#hashtag6", "#hashtag7", "#hashtag8"],
    "niche": ["#niche1", "#niche2", "#niche3", "#niche4", "#niche5"],
    "trending": ["#trend1", "#trend2"]
  },
  "recommended_mix": "#hashtag1 #hashtag5 #niche1 #niche2 #trend1",
  "instagram_set": "#tag1 #tag2 #tag3 #tag4 #tag5 #tag6 #tag7 #tag8 #tag9 #tag10",
  "tip": "One actionable tip for using hashtags effectively"
}`;

  try {
    const { data } = await aiJSON(prompt, ai(req).apiKey, 1024, ai(req).options, ai(req).model);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Ad Copy ───────────────────────────────────────────────────────────────────

router.post('/ad-copy', async (req, res) => {
  const { product, target_audience, platform = 'google', goal = 'conversions', usp } = req.body;
  if (!product) return res.status(400).json({ error: 'product is required' });

  const prompt = `Generate ${platform} ad copy for:
Product/App: ${product}
Target Audience: ${target_audience || 'general'}
Goal: ${goal}
Unique Selling Proposition: ${usp || 'not specified'}

Return ONLY valid JSON (no markdown):
{
  "google_ads": {
    "headline_1": "Headline 1 (max 30 chars)",
    "headline_2": "Headline 2 (max 30 chars)",
    "headline_3": "Headline 3 (max 30 chars)",
    "description_1": "Description 1 (max 90 chars)",
    "description_2": "Description 2 (max 90 chars)",
    "display_url_path": "/path"
  },
  "meta_ads": {
    "primary_text": "Main text (125 chars)",
    "headline": "Headline (40 chars)",
    "description": "Description (30 chars)",
    "cta": "Learn More"
  },
  "variations": [
    {"headline": "Alt 1", "text": "Alt text 1"},
    {"headline": "Alt 2", "text": "Alt text 2"}
  ],
  "target_keywords": ["kw1", "kw2", "kw3"]
}`;

  try {
    const { data, model } = await aiJSON(prompt, ai(req).apiKey, 1024, ai(req).options, ai(req).model);
    historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `Ad copy: ${product}`, response: JSON.stringify(data), type: 'ad_copy', model }).catch(() => {});
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Press Release ─────────────────────────────────────────────────────────────

router.post('/press-release', async (req, res) => {
  const { app_name, announcement, company_name, features, quote } = req.body;
  if (!app_name || !announcement) return res.status(400).json({ error: 'app_name and announcement are required' });

  const prompt = `Write a professional press release for:
App: ${app_name}
Announcement: ${announcement}
Company: ${company_name || 'Company Name'}
Key Features: ${features || 'not specified'}
Quote: ${quote || ''}

Write a complete, publication-ready press release with:
- FOR IMMEDIATE RELEASE header
- City, Date dateline
- Compelling headline
- Strong lead paragraph (who, what, when, where, why)
- Body paragraphs with key features
- Quote from company spokesperson
- "About [Company]" boilerplate
- Media contact placeholder
- ### END ###

Return as plain text.`;

  try {
    const { text, model } = await aiGenerate(prompt, ai(req).apiKey, 2000, ai(req).model, ai(req).options);
    historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `Press release: ${app_name}`, response: text, type: 'press_release', model }).catch(() => {});
    res.json({ content: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Best Time to Post ─────────────────────────────────────────────────────────

router.post('/best-times', async (req, res) => {
  const { industry, audience, platforms } = req.body;
  if (!industry) return res.status(400).json({ error: 'industry is required' });

  const prompt = `Suggest the best times to post on social media for:
Industry: ${industry}
Target Audience: ${audience || 'general'}
Platforms: ${platforms ? platforms.join(', ') : 'LinkedIn, Facebook, Instagram, Twitter'}

Return ONLY valid JSON (no markdown):
{
  "recommendations": {
    "linkedin": {"best_days": ["Tuesday", "Wednesday", "Thursday"], "best_times": ["8:00 AM", "12:00 PM", "5:00 PM"], "timezone": "audience local time", "tip": "Professional audience tip"},
    "facebook": {"best_days": ["Wednesday", "Thursday", "Friday"], "best_times": ["9:00 AM", "1:00 PM", "3:00 PM"], "timezone": "audience local time", "tip": "Facebook-specific tip"},
    "instagram": {"best_days": ["Monday", "Wednesday", "Friday"], "best_times": ["8:00 AM", "11:00 AM", "7:00 PM"], "timezone": "audience local time", "tip": "Instagram-specific tip"},
    "twitter": {"best_days": ["Tuesday", "Wednesday", "Thursday"], "best_times": ["9:00 AM", "12:00 PM", "6:00 PM"], "timezone": "audience local time", "tip": "Twitter-specific tip"},
    "pinterest": {"best_days": ["Saturday", "Sunday", "Friday"], "best_times": ["8:00 PM", "11:00 PM"], "timezone": "audience local time", "tip": "Pinterest-specific tip"}
  },
  "general_advice": "Overall strategy tip",
  "optimal_frequency": {"linkedin": "3-5x/week", "facebook": "1-2x/day", "instagram": "1-3x/day", "twitter": "3-5x/day", "pinterest": "15-25 pins/day"}
}`;

  try {
    const { data } = await aiJSON(prompt, ai(req).apiKey, 1024, ai(req).options, ai(req).model);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Recurring Schedules ───────────────────────────────────────────────────────

const recurringDb = new Map();

router.get('/recurring', (req, res) => {
  res.json([...recurringDb.values()]);
});

router.post('/recurring', (req, res) => {
  const { name, content, platforms, image_url, frequency, time } = req.body;
  if (!name || !content || !platforms || !frequency || !time) {
    return res.status(400).json({ error: 'name, content, platforms, frequency, time are required' });
  }
  const id = Date.now().toString();
  recurringDb.set(id, { id, name, content, platforms, image_url, frequency, time, active: true, created_at: Date.now() });
  res.json({ success: true, id });
});

router.delete('/recurring/:id', (req, res) => {
  recurringDb.delete(req.params.id);
  res.json({ success: true });
});

module.exports = router;
