const express = require('express');
const router = express.Router();
const { aiGenerate, aiJSON, aiArgsFromReq } = require('../services/aiHelper');
const knexInstance  = require('../services/knex');
const seoRepo       = require('../repos/seoRepo')(knexInstance);
const historyRepo   = require('../repos/historyRepo')(knexInstance);

// The user's own AI keys / Ollama / chosen model (not just the shared .env key)
function ai(req) { return aiArgsFromReq(req); }

// POST /api/seo/meta — generate SEO meta tags
router.post('/meta', async (req, res) => {
  const { page_title, page_content, target_keyword, url } = req.body;
  if (!page_title && !page_content) return res.status(400).json({ error: 'page_title or page_content is required' });

  const prompt = `Generate optimized SEO meta tags for the following page.
Page Title: ${page_title || 'Not provided'}
Target Keyword: ${target_keyword || 'Not specified'}
URL: ${url || 'Not provided'}
Content: ${page_content ? page_content.substring(0, 600) : 'Not provided'}

Return ONLY valid JSON (no markdown):
{
  "meta_title": "SEO title 50-60 chars",
  "meta_description": "Compelling description 150-160 chars",
  "focus_keywords": ["kw1", "kw2", "kw3"],
  "og_title": "Open Graph title",
  "og_description": "Open Graph description",
  "schema_type": "WebPage",
  "seo_score": 82,
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

  try {
    const { data, model } = await aiJSON(prompt, ai(req).apiKey, 1024, ai(req).options, ai(req).model);
    historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `SEO meta: ${page_title}`, response: JSON.stringify(data), type: 'seo_meta', model }).catch(() => {});
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo/keywords — AI keyword research
router.post('/keywords', async (req, res) => {
  const { topic, niche, competitors } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  const prompt = `Generate keyword research for: "${topic}"
Niche: ${niche || 'general'}
Competitors: ${competitors || 'not specified'}

Return ONLY valid JSON (no markdown):
{
  "primary_keywords": [
    {"keyword": "example", "intent": "commercial", "difficulty": "medium", "notes": "why valuable"}
  ],
  "long_tail_keywords": [
    {"keyword": "long tail example", "intent": "informational", "difficulty": "low", "notes": "use case"}
  ],
  "questions": ["What is...", "How to..."],
  "negative_keywords": ["irrelevant1", "irrelevant2"],
  "content_ideas": ["Blog post 1", "Blog post 2", "Tutorial on X"]
}
Include 6 primary, 10 long-tail, 5 questions, 3 negatives, 5 content ideas.`;

  try {
    const { data, model } = await aiJSON(prompt, ai(req).apiKey, 2048, ai(req).options, ai(req).model);
    historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `Keyword research: ${topic}`, response: JSON.stringify(data), type: 'seo_keywords', model }).catch(() => {});
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo/optimize — SEO content optimizer
router.post('/optimize', async (req, res) => {
  const { content, target_keyword, content_type = 'blog_post' } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });

  const prompt = `Analyze and optimize this ${content_type} for SEO.
Target Keyword: ${target_keyword || 'not specified'}
Content: ${content.substring(0, 2000)}

Return ONLY valid JSON (no markdown):
{
  "seo_score": 72,
  "readability_score": 80,
  "keyword_density": "1.8%",
  "word_count": 420,
  "issues": [
    {"type": "warning", "message": "Keyword missing from first paragraph"},
    {"type": "error", "message": "No meta description detected"}
  ],
  "suggestions": ["Add keyword to H1", "Include 2-3 internal links"],
  "optimized_intro": "Improved intro paragraph suggestion",
  "suggested_headings": ["H2: Main Topic", "H2: Benefits", "H3: Examples"]
}`;

  try {
    const { data } = await aiJSON(prompt, ai(req).apiKey, 1024, ai(req).options, ai(req).model);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/seo/keywords/tracked — list tracked keywords
router.get('/keywords/tracked', async (req, res) => {
  try { res.json(await seoRepo.list(req.workspaceId)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/seo/keywords/tracked — add keyword to track
router.post('/keywords/tracked', async (req, res) => {
  const { keyword, url, notes } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });
  try {
    const id = await seoRepo.save(req.workspaceId, { keyword, url, notes });
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/seo/keywords/tracked/:id
router.delete('/keywords/tracked/:id', async (req, res) => {
  try {
    await seoRepo.remove(req.workspaceId, parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/seo/aso — App Store Optimization
router.post('/aso', async (req, res) => {
  const { app_name, app_description, category, platform = 'both', competitors } = req.body;
  if (!app_name) return res.status(400).json({ error: 'app_name is required' });

  const prompt = `Generate optimized App Store listing for:
App Name: ${app_name}
Description: ${app_description || 'Not provided'}
Category: ${category || 'Not specified'}
Platform: ${platform}
Competitors: ${competitors || 'Not specified'}

Return ONLY valid JSON (no markdown):
{
  "app_store": {
    "title": "App Name (max 30 chars)",
    "subtitle": "Value prop (max 30 chars)",
    "keywords": "kw1,kw2,kw3 (max 100 chars)",
    "short_description": "First hook paragraph",
    "description": "Full 4000-char description with features and benefits"
  },
  "play_store": {
    "title": "App Title (max 50 chars)",
    "short_description": "Short desc (max 80 chars)",
    "full_description": "Detailed description with features",
    "keywords": ["kw1", "kw2", "kw3"]
  },
  "screenshots_suggestions": ["Screenshot 1 idea", "Screenshot 2 idea", "Screenshot 3 idea"],
  "icon_suggestions": "Icon design brief",
  "aso_tips": ["Tip 1", "Tip 2", "Tip 3"]
}`;

  try {
    const { data, model } = await aiJSON(prompt, ai(req).apiKey, 3000, ai(req).options, ai(req).model);
    historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `ASO: ${app_name}`, response: JSON.stringify(data), type: 'aso', model }).catch(() => {});
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
