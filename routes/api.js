const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../services/database');
const { postToPlatform } = require('../services/social');
const { aiGenerate } = require('../services/aiHelper');
const knexInstance = require('../services/knex');
const postsRepo = require('../repos/postsRepo')(knexInstance);
const scheduledRepo = require('../repos/scheduledRepo')(knexInstance);
const socialRepo = require('../repos/socialAccountsRepo')(knexInstance);

// ── AI Generate ───────────────────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const { prompt, max_tokens = 1024, type = 'social_post', tone, platforms: targetPlatforms, model: modelOverride } = req.body;

  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const apiKey = req.headers['x-api-key'] || req.googleKey || process.env.GOOGLE_AI_KEY;

  try {
    const systemPrompt = buildSystemPrompt(type, tone, targetPlatforms);
    const fullPrompt   = `${systemPrompt}\n\nUser request: ${prompt}`;

    const { text: responseText, model: modelName } = await aiGenerate(
      fullPrompt,
      apiKey,
      max_tokens,
      modelOverride,
      {
        googleKey: req.googleKey,
        anthropicKey: req.anthropicKey,
        ollamaEnabled: req.ollamaEnabled,
        ollamaModel: req.ollamaModel,
        ollamaBaseUrl: req.ollamaUrl
      }
    );

    db.saveHistory({ prompt, response: responseText, type, model: modelName, tokens_used: null });
    res.json({ content: responseText, model: modelName, tokens: { total: null } });

  } catch (err) {
    console.error('[API] Generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


function buildSystemPrompt(type, tone, platforms) {
  const toneMap = {
    professional: 'authoritative, formal, and trustworthy',
    casual: 'friendly, conversational, and approachable',
    witty: 'clever, humorous, and engaging',
    inspirational: 'motivating, uplifting, and thought-provoking',
    educational: 'informative, clear, and instructive',
  };

  const toneStr = toneMap[tone] || 'engaging and authentic';
  const platformStr = platforms?.length ? `optimized for ${platforms.join(', ')}` : 'suitable for all social platforms';

  return `You are NEXUS, an expert social media content creator. 
Generate ${platformStr} content that is ${toneStr}.
Keep posts concise and impactful. Include relevant emojis where appropriate.
If writing for LinkedIn, be professional. For Instagram/Pinterest, be visual and descriptive. 
For Twitter, keep it under 280 characters. For Facebook, aim for engagement.
Only output the post content itself — no explanations or meta-commentary.`;
}

// ── Available Models ─────────────────────────────────────────────────────────

// Returns true only if key exists, is non-empty, and not a placeholder
function isConfigured(key) {
  return !!(key && key.length > 8 && !key.includes('your-key-here') && !key.includes('your-'));
}

router.get('/models', async (req, res) => {
  const models = [];
  const defaultModel = req.defaultTextModel || process.env.DEFAULT_TEXT_MODEL || 'ollama';

  const ollamaEnabled = req.ollamaEnabled !== undefined ? req.ollamaEnabled : (process.env.OLLAMA_ENABLED === 'true');
  const ollamaModel = req.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2';
  const ollamaBaseUrl = req.ollamaUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  // Ollama — only if running
  try {
    const axios = require('axios');
    const r = await axios.get(`${ollamaBaseUrl}/api/tags`, { timeout: 2000 });
    (r.data.models || []).forEach(m => {
      const isDefault = defaultModel === 'ollama' || defaultModel.startsWith('ollama:') || defaultModel === `ollama:${m.name}`;
      const isActive = isDefault && (ollamaModel === m.name.split(':')[0] || ollamaModel === m.name);
      models.push({ id: `ollama:${m.name}`, label: m.name, provider: 'ollama', size: m.size, active: isActive });
    });
  } catch {}

  // Cloud text models — only if key is configured
  const hasGemini = isConfigured(req.googleKey) || isConfigured(process.env.GOOGLE_AI_KEY);
  if (hasGemini) {
    models.push({ id: 'gemini', label: 'Gemini 1.5 Flash', provider: 'google', active: defaultModel === 'gemini' });
  }

  const hasClaude = isConfigured(req.anthropicKey) || isConfigured(process.env.ANTHROPIC_API_KEY);
  if (hasClaude) {
    models.push({ id: 'claude', label: 'Claude Opus', provider: 'anthropic', active: defaultModel === 'claude' });
  }

  // Image models — only if key is configured
  const imageModels = [];
  const hasStability = isConfigured(req.stabilityKey) || isConfigured(process.env.STABILITY_API_KEY);
  if (hasStability) imageModels.push({ id: 'stability-sdxl', label: 'Stable Diffusion XL', provider: 'stability' });
  const hasOpenAI = isConfigured(req.openaiKey) || isConfigured(process.env.OPENAI_API_KEY);
  if (hasOpenAI)    imageModels.push({ id: 'dall-e-3',        label: 'DALL-E 3',            provider: 'openai' });

  // Video models — only if key is configured
  const videoModels = [];
  const hasLuma = isConfigured(req.lumaKey) || isConfigured(process.env.LUMA_API_KEY);
  if (hasLuma)   videoModels.push({ id: 'luma',   label: 'Luma Dream Machine', provider: 'luma' });
  const hasRunway = isConfigured(req.runwayKey) || isConfigured(process.env.RUNWAY_API_KEY);
  if (hasRunway) videoModels.push({ id: 'runway', label: 'Runway Gen-3',        provider: 'runway' });

  res.json({ text: models, image: imageModels, video: videoModels });
});

// ── Post Now ──────────────────────────────────────────────────────────────────

router.post('/post/now', async (req, res) => {
  const { content, platforms, image_url } = req.body;

  if (!content) return res.status(400).json({ error: 'content is required' });
  if (!platforms || !platforms.length) return res.status(400).json({ error: 'platforms array is required' });

  const results = [];

  for (const platform of platforms) {
    try {
      const tokenData = await socialRepo.getByPlatform(req.workspaceId, platform);
      if (!tokenData) {
        results.push({ platform, success: false, error: `${platform} is not connected` });
        continue;
      }

      const result = await postToPlatform(platform, tokenData, content, image_url);
      results.push(result);

      // Record analytics stub
      db.saveAnalytics({
        platform,
        likes: 0, comments: 0, shares: 0,
        impressions: Math.floor(Math.random() * 300) + 20,
        clicks: Math.floor(Math.random() * 20),
      });
    } catch (err) {
      console.error(`[API] Post error on ${platform}:`, err.message);
      results.push({ platform, success: false, error: err.message });
    }
  }

  // Save to workspace-scoped post history
  const postId = await postsRepo.save(req.workspaceId, req.session.userId, {
    content, platforms, image_url, results, status: 'published',
  });

  // Update analytics with post_id
  results.forEach(r => {
    if (r.success) {
      db.saveAnalytics({ post_id: postId, platform: r.platform, impressions: Math.floor(Math.random() * 300) + 20 });
    }
  });

  res.json({ results, post_id: postId });
});

// ── Schedule Post ─────────────────────────────────────────────────────────────

router.post('/post/schedule', async (req, res) => {
  const { content, platforms, scheduled_at, image_url } = req.body;

  if (!content) return res.status(400).json({ error: 'content is required' });
  if (!platforms?.length) return res.status(400).json({ error: 'platforms array is required' });
  if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required (ISO 8601 or Unix timestamp)' });

  const ts = typeof scheduled_at === 'number'
    ? scheduled_at
    : Math.floor(new Date(scheduled_at).getTime() / 1000);

  if (isNaN(ts) || ts < Math.floor(Date.now() / 1000)) {
    return res.status(400).json({ error: 'scheduled_at must be a future date/time' });
  }

  try {
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

router.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(db.getHistory(limit));
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get('/analytics', (req, res) => {
  const summary = db.getAnalyticsSummary();
  const recent = db.getAnalytics().slice(0, 20);
  res.json({ summary, recent });
});

// ─── Simulate Analytics (for demo) ───────────────────────────────────────────

router.post('/analytics/simulate', async (req, res) => {
  const platforms = ['linkedin', 'facebook', 'instagram', 'pinterest', 'twitter'];
  const posts = await postsRepo.history(req.workspaceId, 10);

  for (const post of posts) {
    for (const platform of post.platforms) {
      db.saveAnalytics({
        post_id: post.id,
        platform,
        likes: Math.floor(Math.random() * 200),
        comments: Math.floor(Math.random() * 50),
        shares: Math.floor(Math.random() * 80),
        impressions: Math.floor(Math.random() * 5000) + 100,
        clicks: Math.floor(Math.random() * 200),
      });
    }
  }

  res.json({ success: true, message: 'Analytics data simulated' });
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

router.post('/local/import-csv', async (req, res) => {
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
