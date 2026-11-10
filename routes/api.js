const express = require('express');
const { checkPlatforms } = require('../services/platforms/available');
const router = express.Router();
const { requirePermission } = require('../middleware/tenancy');
const { requirePublishLicense } = require('../middleware/license');
// Publishing needs both the workspace permission and an active licence
const canPublish = [requirePermission('content.publish'), requirePublishLicense];
const fs = require('fs');
const path = require('path');
const { postToPlatform } = require('../services/social');
const { aiGenerate } = require('../services/aiHelper');
const aiAssist = require('../services/aiAssist');
const { brandContext, shortestLimit } = require('../services/brandContext');
const indianHolidays = require('../services/indianHolidays');
const knexInstance = require('../services/knex');
const { ensureFresh } = require('../services/tokenRefresher');
const postsRepo     = require('../repos/postsRepo')(knexInstance);
const scheduledRepo = require('../repos/scheduledRepo')(knexInstance);
const socialRepo    = require('../repos/socialAccountsRepo')(knexInstance);
const historyRepo   = require('../repos/historyRepo')(knexInstance);
const analyticsRepo = require('../repos/analyticsRepo')(knexInstance);

// Social networks show Markdown literally ("**Sale**"), so strip it from AI output.
function stripMarkdown(text) {
  return String(text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
    // small models often wrap the whole post in quote marks
    .replace(/^["“]([^"“”]*)["”]$/, '$1');
}

// Multi-platform output comes back as "=== linkedin ===" sections; split it.
function splitVariants(text, platforms) {
  const variants = {};
  const re = /^===\s*([a-z_]+)\s*===\s*$/gim;
  const marks = [...text.matchAll(re)];
  marks.forEach((m, i) => {
    const key = m[1].toLowerCase();
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    if (platforms.includes(key)) variants[key] = stripMarkdown(text.slice(m.index + m[0].length, end));
  });
  return Object.keys(variants).length ? variants : null;
}

// ── AI Assist on text that isn't saved yet (Create Post: Improve / Shorter / Hashtags)
const TEXT_ASSIST_ACTIONS = ['rewrite', 'shorten', 'hashtags'];
router.post('/assist', async (req, res) => {
  const { action, text, platform, model } = req.body || {};
  if (!TEXT_ASSIST_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${TEXT_ASSIST_ACTIONS.join(', ')}` });
  }
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Write some text first' });
  if (text.length > 10000) return res.status(400).json({ error: 'Text is too long for AI Assist (max 10,000 characters)' });
  try {
    const result = await aiAssist.assist({
      action, text, platform: typeof platform === 'string' ? platform : undefined,
      apiKey: req.googleKey, model: typeof model === 'string' && model ? model : null,
      // Brand voice + "don't invent facts" for edits; hashtags need only the post
      context: action === 'hashtags' ? '' : await brandContext(req.workspaceId),
      options: {
        googleKey: req.googleKey, anthropicKey: req.anthropicKey,
        groqKey: req.groqKey, openrouterKey: req.openrouterKey, mistralKey: req.mistralKey,
        ollamaEnabled: req.ollamaEnabled, ollamaModel: req.ollamaModel, ollamaBaseUrl: req.ollamaUrl,
      },
    });
    res.json({ ...result, text: stripMarkdown(result.text) });
  } catch (err) {
    console.error('[API] Assist error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── AI Generate ───────────────────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const { prompt, max_tokens = 1024, type = 'social_post', tone, platforms: targetPlatforms, model: modelOverride, language, holiday, single } = req.body;

  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const apiKey = req.googleKey;

  try {
    let systemPrompt = buildSystemPrompt(type, tone, targetPlatforms, language);

    // Use the Brand Kit so the AI writes in the brand's voice and doesn't invent facts
    systemPrompt += `\n\n${await brandContext(req.workspaceId)}`;

    // single: Create Post has one text box, so write one post that suits every chosen platform
    const multi = !single && Array.isArray(targetPlatforms) && targetPlatforms.length > 1;
    // Also with 0 or 1 platforms: the per-platform tips above otherwise make small
    // models write a separate "LinkedIn: … Instagram: …" version for each one.
    if (single) {
      systemPrompt += (Array.isArray(targetPlatforms) && targetPlatforms.length > 1
        ? '\n\nWrite ONE post that can be shared as-is on all of these platforms.'
        : '\n\nWrite exactly ONE post.') +
        ' Return only the post text: no platform names, labels, headings or alternative versions.';
      const limit = shortestLimit(targetPlatforms);
      if (limit && limit < 1000) systemPrompt += `\nKeep it under ${limit} characters (the limit of the shortest platform).`;
    }
    if (multi) {
      systemPrompt += `\n\nWrite one separate post for EACH of these platforms: ${targetPlatforms.join(', ')}.` +
        `\nStart each post with a line containing only === platform === using exactly these names, e.g. === ${targetPlatforms[0]} ===` +
        '\nNothing before the first marker.';
    }

    // If a holiday is passed, prepend holiday context
    let finalPrompt = prompt;
    if (holiday) {
      const h = indianHolidays.all().find(x => x.date === holiday || x.name === holiday);
      if (h) systemPrompt += `\n\nThis content is for ${h.name} (${h.emoji}) celebrated on ${h.date}. Make it festive and relevant for Indian audiences.`;
    }

    const fullPrompt = `${systemPrompt}\n\nUser request: ${finalPrompt}`;

    const { text: responseText, model: modelName } = await aiGenerate(
      fullPrompt,
      apiKey,
      max_tokens,
      modelOverride,
      {
        googleKey:    req.googleKey,
        anthropicKey: req.anthropicKey,
        groqKey:      req.groqKey,
        openrouterKey: req.openrouterKey,
        mistralKey:   req.mistralKey,
        ollamaEnabled: req.ollamaEnabled,
        ollamaModel:  req.ollamaModel,
        ollamaBaseUrl: req.ollamaUrl,
      }
    );

    historyRepo.save(req.workspaceId, req.session?.userId, { prompt, response: responseText, type, model: modelName, tokens_used: null }).catch(() => {});
    const variants = multi ? splitVariants(responseText, targetPlatforms) : null;
    const content = variants
      ? targetPlatforms.filter(p => variants[p]).map(p => `${p}:\n${variants[p]}`).join('\n\n')
      : stripMarkdown(responseText);
    res.json({ content, variants, model: modelName, tokens: { total: null } });

  } catch (err) {
    console.error('[API] Generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


function buildSystemPrompt(type, tone, platforms, language) {
  const toneMap = {
    professional:  'authoritative, formal, and trustworthy',
    casual:        'friendly, conversational, and approachable',
    witty:         'clever, humorous, and engaging',
    inspirational: 'motivating, uplifting, and thought-provoking',
    educational:   'informative, clear, and instructive',
  };

  const toneStr    = toneMap[tone] || 'engaging and authentic';
  const platformStr = platforms?.length ? `optimized for ${platforms.join(', ')}` : 'suitable for all social platforms';

  const languageMap = {
    hi: 'Hindi (Devanagari script)',
    ta: 'Tamil',
    te: 'Telugu',
    mr: 'Marathi',
    bn: 'Bengali',
    pa: 'Punjabi (Gurmukhi script)',
    kn: 'Kannada',
    gu: 'Gujarati',
    en: 'English',
  };
  const langStr = language && language !== 'en' ? `\nIMPORTANT: Write the post in ${languageMap[language] || language}. Do NOT translate to English.` : '';

  return `You are Social-Nexus, an expert social media content creator for the Indian market.
Generate ${platformStr} content that is ${toneStr}.
Keep posts concise and impactful. Include relevant emojis where appropriate.
If writing for LinkedIn, be professional. For Instagram/Pinterest, be visual and descriptive.
For Twitter/X, keep it under 280 characters. For Facebook, aim for engagement.
For WhatsApp, make it warm and conversational.
Only output the post content itself — no explanations or meta-commentary.${langStr}`;
}

// ── Available Models ─────────────────────────────────────────────────────────

// Returns true only if key exists, is non-empty, and not a placeholder
function isConfigured(key) {
  return !!(key && key.length > 8 && !key.includes('your-key-here') && !key.includes('your-'));
}

router.get('/models', async (req, res) => {
  const models = [];
  const defaultModel = req.defaultTextModel || process.env.DEFAULT_TEXT_MODEL || 'ollama';

  const ollamaEnabled = req.ollamaEnabled !== undefined ? req.ollamaEnabled : (process.env.OLLAMA_ENABLED !== 'false');
  const ollamaModel   = req.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2';
  const ollamaBaseUrl = req.ollamaUrl   || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  // Ollama — only if running
  try {
    const axios = require('axios');
    const r = await axios.get(`${ollamaBaseUrl}/api/tags`, { timeout: 2000 });
    (r.data.models || []).forEach(m => {
      // Coding and embedding models can't write social posts: don't offer them
      if (/coder|codellama|starcoder|code-|embed|nomic|bge-|minilm/i.test(m.name)) return;
      const isDefault = defaultModel === 'ollama' || defaultModel.startsWith('ollama:') || defaultModel === `ollama:${m.name}`;
      const isActive  = isDefault && (ollamaModel === m.name.split(':')[0] || ollamaModel === m.name || m.name.startsWith('llama3.2'));
      models.push({ id: `ollama:${m.name}`, label: `${m.name.replace(/:latest$/, '')} (on this PC)`, provider: 'ollama', free: true, local: true, size: m.size, active: isActive });
    });
    models.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || (a.size || 0) - (b.size || 0));
  } catch {}

  // Google Gemini — free tier
  const hasGemini = isConfigured(req.googleKey);
  if (hasGemini) {
    models.push({ id: 'gemini', label: 'Gemini Flash', provider: 'google', free: true, active: defaultModel === 'gemini', description: 'Free tier available' });
  }

  // Groq — free tier (fastest)
  const hasGroq = isConfigured(req.groqKey);
  if (hasGroq) {
    models.push({ id: 'groq',          label: 'Llama 3.3 70B (Groq)',        provider: 'groq',       free: true, active: defaultModel === 'groq',          description: 'Free: 14,400 req/day — Fastest' });
    models.push({ id: 'groq:llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (Groq)', provider: 'groq', free: true, active: false, description: 'Free: Ultra-fast responses' });
  }

  // OpenRouter — free models
  const hasOpenRouter = isConfigured(req.openrouterKey);
  if (hasOpenRouter) {
    models.push({ id: 'openrouter', label: 'Llama 3.1 8B (OpenRouter)', provider: 'openrouter', free: true, active: defaultModel === 'openrouter', description: 'Free tier available' });
  }

  // Mistral — free tier
  const hasMistral = isConfigured(req.mistralKey);
  if (hasMistral) {
    models.push({ id: 'mistral', label: 'Mistral Small', provider: 'mistral', free: true, active: defaultModel === 'mistral', description: 'Free tier: 1 req/sec' });
  }

  // Anthropic Claude — paid
  const hasClaude = isConfigured(req.anthropicKey);
  if (hasClaude) {
    models.push({ id: 'claude', label: 'Claude Opus 5.5', provider: 'anthropic', free: false, active: defaultModel === 'claude', description: 'Paid — Best quality' });
  }

  // Image models
  const imageModels = [];
  const hasStability = isConfigured(req.stabilityKey);
  if (hasStability) imageModels.push({ id: 'stability-sdxl', label: 'Stable Diffusion XL', provider: 'stability', free: false });
  const hasOpenAI = isConfigured(req.openaiKey);
  if (hasOpenAI)    imageModels.push({ id: 'gpt-image-1',     label: 'GPT Image (OpenAI)',  provider: 'openai',    free: false });
  if (hasGemini)    imageModels.push({ id: 'gemini-image',    label: 'Gemini Image',        provider: 'google',    free: false, description: 'Uses your Google key — needs billing enabled' });

  // Video models
  const videoModels = [];
  const hasLuma   = isConfigured(req.lumaKey);
  if (hasLuma)   videoModels.push({ id: 'luma',   label: 'Luma Dream Machine', provider: 'luma',   free: false });
  const hasRunway = isConfigured(req.runwayKey);
  if (hasRunway) videoModels.push({ id: 'runway', label: 'Runway Gen-3',        provider: 'runway', free: false });

  res.json({ text: models, image: imageModels, video: videoModels });
});

// ── Indian Holidays ───────────────────────────────────────────────────────────

router.get('/holidays', (req, res) => {
  const { month, upcoming } = req.query;
  if (upcoming) {
    return res.json(indianHolidays.getUpcomingHolidays(parseInt(upcoming) || 14));
  }
  if (month) {
    return res.json(indianHolidays.getHolidaysForMonth(month));
  }
  // Default: return today's holidays + upcoming 7 days
  res.json({
    today:    indianHolidays.getTodayHolidays(),
    upcoming: indianHolidays.getUpcomingHolidays(7),
    all:      indianHolidays.all(),
  });
});

// ── Post Now ──────────────────────────────────────────────────────────────────

router.post('/post/now', canPublish, async (req, res) => {
  const { content, platforms, image_url } = req.body;

  if (!content) return res.status(400).json({ error: 'content is required' });
  if (!platforms || !platforms.length) return res.status(400).json({ error: 'platforms array is required' });
  const unavailable = checkPlatforms(platforms);
  if (unavailable) return res.status(400).json({ error: unavailable });

  const results = [];

  for (const platform of platforms) {
    try {
      const tokenData = await socialRepo.getByPlatform(req.workspaceId, platform);
      if (!tokenData?.access_token || tokenData.auth_error) {
        results.push({ platform, success: false, error: tokenData ? `${platform} needs signing in again. Click Connect in Settings → Connected accounts.` : `${platform} is not connected` });
        continue;
      }

      await ensureFresh(knexInstance, tokenData);
      const result = await postToPlatform(platform, tokenData, content, image_url);
      results.push(result);
    } catch (err) {
      console.error(`[API] Post error on ${platform}:`, err.message);
      results.push({ platform, success: false, error: err.message });
    }
  }

  // Save to workspace-scoped post history. Analytics are no longer faked here —
  // real metrics must come from the platform APIs.
  const postId = await postsRepo.save(req.workspaceId, req.session.userId, {
    content, platforms, image_url, results,
    status: results.some(r => r.success) ? 'published' : 'failed',
  });

  res.json({ results, post_id: postId });
});

// ── Schedule Post ─────────────────────────────────────────────────────────────

router.post('/post/schedule', canPublish, async (req, res) => {
  const { content, platforms, scheduled_at, image_url, repeat } = req.body;

  if (!content) return res.status(400).json({ error: 'content is required' });
  if (!platforms?.length) return res.status(400).json({ error: 'platforms array is required' });
  const unavailable = checkPlatforms(platforms);
  if (unavailable) return res.status(400).json({ error: unavailable });
  if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required (ISO 8601 or Unix timestamp)' });

  const ts = typeof scheduled_at === 'number'
    ? scheduled_at
    : Math.floor(new Date(scheduled_at).getTime() / 1000);

  if (isNaN(ts) || ts < Math.floor(Date.now() / 1000)) {
    return res.status(400).json({ error: 'scheduled_at must be a future date/time' });
  }

  try {
    // Repeating: { every: 'daily'|'weekly'|'monthly', count: n } or { every, until: 'YYYY-MM-DD' }
    if (repeat && repeat.every && repeat.every !== 'none') {
      const { occurrences } = require('../services/recurrence');
      const r = occurrences(new Date(ts * 1000), { every: repeat.every, count: repeat.until ? undefined : repeat.count, until: repeat.until });
      if (r.error) return res.status(400).json({ error: r.error });
      const seriesId = await scheduledRepo.saveSeries(req.workspaceId, req.session.userId, { content, platforms, image_url }, r.dates, repeat.every);
      return res.json({
        success: true, series_id: seriesId, count: r.dates.length, every: repeat.every,
        scheduled_at: r.dates[0].toISOString(), last_at: r.dates[r.dates.length - 1].toISOString(),
      });
    }
    const id = await scheduledRepo.save(req.workspaceId, req.session.userId, { content, platforms, image_url, scheduled_at: ts });
    res.json({ success: true, id, scheduled_at: new Date(ts * 1000).toISOString() });
  } catch (err) {
    console.error('[API] Schedule error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Get Scheduled Posts ───────────────────────────────────────────────────────

router.get('/posts/scheduled', async (req, res) => {
  try {
    const posts = await scheduledRepo.listPending(req.workspaceId);
    res.json(posts);
  } catch (err) {
    console.error('[API] Get scheduled error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/posts/scheduled/failed', async (req, res) => {
  try {
    res.json(await scheduledRepo.listRecentFailed(req.workspaceId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Retry a failed scheduled post: back to pending, due in one minute
router.post('/posts/scheduled/:id/retry', canPublish, async (req, res) => {
  try {
    const n = await scheduledRepo.retry(req.workspaceId, parseInt(req.params.id), Math.floor(Date.now() / 1000) + 60);
    if (!n) return res.status(404).json({ error: 'Failed post not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop a repeating schedule: removes its posts that haven't gone out yet
router.delete('/posts/series/:seriesId', requirePermission('content.publish'), async (req, res) => {
  try {
    const removed = await scheduledRepo.stopSeries(req.workspaceId, String(req.params.seriesId));
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/posts/scheduled/:id', async (req, res) => {
  try {
    await scheduledRepo.remove(req.workspaceId, parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    console.error('[API] Delete scheduled error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Get Post History ──────────────────────────────────────────────────────────

router.get('/posts/history', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  try {
    res.json(await postsRepo.history(req.workspaceId, limit));
  } catch (err) {
    console.error('[API] Post history error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── AI History ────────────────────────────────────────────────────────────────

router.get('/history', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  try {
    res.json(await historyRepo.list(req.workspaceId, limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get('/analytics', async (req, res) => {
  try {
    const [summary, recent] = await Promise.all([
      analyticsRepo.summary(req.workspaceId),
      analyticsRepo.list(req.workspaceId).then(r => r.slice(0, 20)),
    ]);
    res.json({ summary, recent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch the latest numbers from the platforms now (also done once a day)
router.post('/analytics/refresh', async (req, res) => {
  try {
    const r = await require('../services/insights').refresh(knexInstance, { workspaceId: req.workspaceId });
    res.json({ ...r, checked_at: Math.floor(Date.now() / 1000) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Best times to post, from this workspace's own results
router.get('/analytics/best-times', async (req, res) => {
  try { res.json(await require('../services/insights').bestTimes(knexInstance, req.workspaceId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Monthly client report (HTML page with "Save as PDF")
router.get('/reports/monthly', async (req, res) => {
  try {
    const reports = require('../services/reports');
    const data = await reports.monthlyData(knexInstance, req.workspaceId, String(req.query.month || ''));
    const best = await require('../services/insights').bestTimes(knexInstance, req.workspaceId).catch(() => null);
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
    res.type('html').send(reports.renderHtml(data, { bestTimes: best }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Local Folder ──────────────────────────────────────────────────────────────

router.get('/local/files', (req, res) => {
  const folder = process.env.CONTENT_FOLDER;
  if (!folder || !fs.existsSync(folder)) {
    return res.status(404).json({ error: 'CONTENT_FOLDER not found: ' + folder });
  }

  try {
    const items = fs.readdirSync(folder);
    const files = items
      .filter(name => {
        const ext = path.extname(name).toLowerCase();
        return ['.txt', '.md', '.jpg', '.jpeg', '.png', '.csv', '.json'].includes(ext);
      })
      .map(name => {
        const filePath = path.join(folder, name);
        const stat = fs.statSync(filePath);
        return {
          name,
          path: filePath,
          ext: path.extname(name).toLowerCase(),
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      });

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/local/read', (req, res) => {
  const folder = process.env.CONTENT_FOLDER;
  const filePath = path.join(folder, req.query.file);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
    return res.json({ name: req.query.file, type: 'image', path: filePath });
  }

  const content = fs.readFileSync(filePath, 'utf8');
  res.json({ content, name: req.query.file, type: 'text' });
});

// ── CSV Bulk Import ───────────────────────────────────────────────────────────

router.post('/local/import-csv', canPublish, async (req, res) => {
  const csvPath = path.join(process.env.CONTENT_FOLDER || '.', req.query.file || 'schedule.csv');

  if (!fs.existsSync(csvPath)) {
    return res.status(404).json({ error: `CSV not found: ${csvPath}` });
  }

  const lines = fs.readFileSync(csvPath, 'utf8').split('\n').slice(1); // skip header
  let imported = 0;
  const errors = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // Handle quoted CSV values
    const cols = parseCSVLine(line);
    const [content, platformsRaw, scheduled_at, image_url] = cols;

    if (!content || !scheduled_at) continue;

    const platforms = platformsRaw ? platformsRaw.split(/[;,]/).map(p => p.trim()).filter(Boolean) : ['linkedin'];
    const ts = Math.floor(new Date(scheduled_at).getTime() / 1000);

    if (isNaN(ts)) {
      errors.push(`Invalid date: ${scheduled_at}`);
      continue;
    }

    try {
      await scheduledRepo.save(req.workspaceId, req.session.userId, { content, platforms, image_url: image_url || null, scheduled_at: ts });
      imported++;
    } catch (err) {
      errors.push(`Row failed: ${err.message}`);
    }
  }

  res.json({ success: true, imported, errors });
});

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

module.exports = router;
