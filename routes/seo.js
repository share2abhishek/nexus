const express = require('express');
const router = express.Router();
const { aiGenerate, aiJSON, aiArgsFromReq } = require('../services/aiHelper');
const knexInstance  = require('../services/knex');
const seoRepo       = require('../repos/seoRepo')(knexInstance);
const historyRepo   = require('../repos/historyRepo')(knexInstance);

const seoCheck = require('../services/seoCheck');

// The user's own AI keys / Ollama / chosen model (not just the shared .env key)
function ai(req) { return aiArgsFromReq(req); }
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// POST /api/seo/check — open a page the way Google's crawler does and measure it
router.post('/check', async (req, res) => {
  const { url, keyword } = req.body || {};
  if (!str(url)) return res.status(400).json({ error: 'Type the address of the page to check.' });
  try {
    res.json(await seoCheck.checkPage(url, { keyword: str(keyword) }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/seo/meta — write a title and description (reads the page when an address is given)
router.post('/meta', async (req, res) => {
  let { page_title, page_content, target_keyword, url } = req.body || {};
  page_title = str(page_title); page_content = str(page_content); target_keyword = str(target_keyword); url = str(url);
  let current = null;
  if (url) {
    try {
      const r = await seoCheck.checkPage(url, { keyword: target_keyword });
      current = { title: r.page.title, description: r.page.description, h1: r.page.h1[0] || '' };
      page_title = page_title || r.page.title || r.page.h1[0] || '';
      page_content = page_content || r.page.text_sample;
    } catch (err) {
      return res.status(400).json({ error: `Couldn’t read that page: ${err.message}` });
    }
  }
  if (!page_title && !page_content) return res.status(400).json({ error: 'Type the page address, or its title and what it is about.' });

  const prompt = `Write the Google search title and description for this web page.
Page title now: ${page_title || '(none)'}
Main search phrase: ${target_keyword || '(not given)'}
What the page says: ${page_content ? page_content.substring(0, 1500) : '(not given)'}

Rules: only say what the page really offers; no made-up numbers or claims.
The title is 50-60 characters and starts with the main search phrase if one is given.
The description is 140-160 characters and ends with a reason to click.

Reply with JSON only:
{"meta_title":"...","meta_description":"...","focus_keywords":["...","...","..."],"og_title":"...","og_description":"...","suggestions":["...","..."]}`;

  try {
    const { data, model } = await aiJSON(prompt, ai(req).apiKey, 1024, ai(req).options, ai(req).model);
    const out = {
      meta_title: str(data.meta_title),
      meta_description: str(data.meta_description),
      focus_keywords: Array.isArray(data.focus_keywords) ? data.focus_keywords.map(str).filter(Boolean).slice(0, 6) : [],
      og_title: str(data.og_title) || str(data.meta_title),
      og_description: str(data.og_description) || str(data.meta_description),
      suggestions: Array.isArray(data.suggestions) ? data.suggestions.map(str).filter(Boolean).slice(0, 6) : [],
      current,
    };
    historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `SEO meta: ${page_title || url}`, response: JSON.stringify(out), type: 'seo_meta', model }).catch(() => {});
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo/keywords — AI keyword research
router.post('/keywords', async (req, res) => {
  const { topic, niche, competitors } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  const prompt = `Suggest search phrases people might type into Google for: "${topic}"
Niche: ${niche || 'general'}
Competitors: ${competitors || 'not specified'}

"competition" is your rough guess (low / medium / high) of how hard it is to rank, from general knowledge: you have no search data.
"intent" is what the searcher wants: informational, commercial, transactional or local.

Reply with JSON only:
{"primary_keywords":[{"keyword":"...","intent":"...","competition":"low|medium|high"}],
 "long_tail_keywords":[{"keyword":"...","intent":"...","competition":"low|medium|high"}],
 "questions":["..."],"content_ideas":["..."]}
Give 6 primary, 10 long-tail, 5 questions and 5 content ideas.`;

  try {
    const { data, model } = await aiJSON(prompt, ai(req).apiKey, 2048, ai(req).options, ai(req).model);
    const level = (v) => (['low', 'medium', 'high'].includes(String(v).toLowerCase()) ? String(v).toLowerCase() : null);
    const kw = (list) => (Array.isArray(list) ? list : []).map((k) => (typeof k === 'string' ? { keyword: k } : k))
      .filter((k) => str(k?.keyword)).map((k) => ({ keyword: str(k.keyword), intent: str(k.intent) || null, competition: level(k.competition || k.difficulty) }));
    const out = {
      primary_keywords: kw(data.primary_keywords),
      long_tail_keywords: kw(data.long_tail_keywords),
      questions: (data.questions || []).map(str).filter(Boolean),
      content_ideas: (data.content_ideas || []).map(str).filter(Boolean),
    };
    historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `Keyword research: ${topic}`, response: JSON.stringify(out), type: 'seo_keywords', model }).catch(() => {});
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seo/optimize — SEO content optimizer
router.post('/optimize', async (req, res) => {
  const { content, target_keyword, content_type = 'blog_post' } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });

  // Numbers are measured here; AI only suggests improvements
  const stats = seoCheck.analyzeText(content, str(target_keyword));
  const prompt = `Suggest how to improve this ${content_type.replace(/_/g, ' ')} so it ranks better on Google.
Main search phrase: ${target_keyword || 'not given'}
Measured: ${stats.word_count} words, ${stats.avg_sentence_words} words per sentence, the phrase appears ${stats.keyword_count} times${stats.keyword_in_first_100_words === false ? ', not in the first 100 words' : ''}.
Text: ${content.substring(0, 3000)}

Only point out things that are really in (or missing from) this text.
Reply with JSON only:
{"suggestions":["..."],"better_intro":"a rewritten first paragraph","headings":["..."]}`;

  let advice = { suggestions: [], better_intro: '', headings: [] };
  let ai_error = null;
  try {
    const { data } = await aiJSON(prompt, ai(req).apiKey, 1024, ai(req).options, ai(req).model);
    advice = {
      suggestions: (data.suggestions || []).map(str).filter(Boolean).slice(0, 8),
      better_intro: str(data.better_intro || data.optimized_intro),
      headings: (data.headings || data.suggested_headings || []).map(str).filter(Boolean).slice(0, 8),
    };
  } catch (err) {
    ai_error = err.message; // the measured numbers are still useful
  }
  res.json({ ...stats, ...advice, ai_error });
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

  const wantIos = platform !== 'android';
  const wantAndroid = platform !== 'ios';
  const prompt = `Write store listing text for this app. Only describe what it really does (from the description); no made-up awards, ratings or user numbers.
App name: ${app_name}
What it does: ${app_description || 'Not provided'}
Category: ${category || 'Not specified'}
Competitors: ${competitors || 'Not specified'}

Reply with JSON only:
{${wantIos ? `"app_store":{"name":"app name, at most 30 characters","subtitle":"at most 30 characters","promotional_text":"at most 170 characters","keywords":"comma separated words, at most 100 characters","description":"up to 4000 characters"},` : ''}${wantAndroid ? `"play_store":{"title":"at most 30 characters","short_description":"at most 80 characters","full_description":"up to 4000 characters"},` : ''}"screenshot_ideas":["...","...","..."],"tips":["...","...","..."]}`;

  try {
    const { data, model } = await aiJSON(prompt, ai(req).apiKey, 3000, ai(req).options, ai(req).model);
    const field = (value, max) => { const v = str(value); return { text: v, length: v.length, max, too_long: v.length > max }; };
    const out = { screenshot_ideas: (data.screenshot_ideas || data.screenshots_suggestions || []).map(str).filter(Boolean), tips: (data.tips || data.aso_tips || []).map(str).filter(Boolean) };
    if (wantIos && data.app_store) {
      const a = data.app_store;
      const name = str(a.name || a.title); const subtitle = str(a.subtitle);
      // Apple's keyword field: commas, no spaces, no words already in the name or subtitle (they count anyway)
      const used = new Set(`${name} ${subtitle}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
      const kw = [];
      for (const k of String(Array.isArray(a.keywords) ? a.keywords.join(',') : a.keywords || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        if (used.has(k) || kw.includes(k)) continue;
        if ([...kw, k].join(',').length > 100) break;
        kw.push(k);
      }
      out.app_store = {
        name: field(name, 30), subtitle: field(subtitle, 30), promotional_text: field(a.promotional_text || a.short_description, 170),
        keywords: field(kw.join(','), 100), description: field(a.description, 4000),
      };
    }
    if (wantAndroid && data.play_store) {
      const p = data.play_store;
      out.play_store = { title: field(p.title, 30), short_description: field(p.short_description, 80), full_description: field(p.full_description || p.description, 4000) };
    }
    if (!out.app_store && !out.play_store) return res.status(502).json({ error: 'The AI didn’t return a listing. Try again.' });
    // Small AI models sometimes leave one store out: say so instead of showing nothing
    out.missing = [wantIos && !out.app_store && 'App Store', wantAndroid && !out.play_store && 'Google Play'].filter(Boolean);
    historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `ASO: ${app_name}`, response: JSON.stringify(out), type: 'aso', model }).catch(() => {});
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
