const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../services/database');
const { aiGenerate, aiJSON } = require('../services/aiHelper');

function apiKey(req) {
  return req.headers['x-api-key'] || process.env.GOOGLE_AI_KEY;
}

// ── AI Image Generation ───────────────────────────────────────────────────────
// Supports: Stability AI (STABILITY_API_KEY) or Google Imagen (GOOGLE_AI_KEY)

router.post('/generate-image', async (req, res) => {
  const { prompt, style = 'photorealistic', width = 1024, height = 1024, negative_prompt, preferred_provider } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const stabilityKey = process.env.STABILITY_API_KEY;
  const openaiKey    = process.env.OPENAI_API_KEY;

  // Respect user's model selection — swap priority if they chose DALL-E
  if (preferred_provider === 'openai' && openaiKey && stabilityKey) {
    // User chose DALL-E — skip Stability AI and go straight to OpenAI
    req.body._skip_stability = true;
  }

  try {
    // ── Stability AI (preferred unless user chose DALL-E) ─────────────────
    if (stabilityKey && !req.body._skip_stability) {
      const stylePresets = {
        photorealistic: 'photographic', cartoon: 'comic-book', anime: 'anime',
        illustration: 'digital-art', abstract: 'abstract-expressionism',
        '3d': '3d-model', watercolor: 'watercolor', sketch: 'line-art',
      };
      const stylePreset = stylePresets[style] || 'photographic';

      const response = await axios.post(
        'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
        {
          text_prompts: [
            { text: prompt, weight: 1 },
            ...(negative_prompt ? [{ text: negative_prompt, weight: -1 }] : []),
          ],
          cfg_scale: 7,
          height: Math.min(height, 1024),
          width: Math.min(width, 1024),
          steps: 30,
          samples: 1,
          style_preset: stylePreset,
        },
        {
          headers: {
            Authorization: `Bearer ${stabilityKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }
      );

      const imageBase64 = response.data.artifacts[0].base64;
      db.saveHistory({ prompt: `Image: ${prompt}`, response: `[Stability AI image generated]`, type: 'image_generation', model: 'stable-diffusion-xl' });
      return res.json({ success: true, provider: 'stability', image_base64: imageBase64, format: 'png' });
    }

    // ── OpenAI DALL-E (fallback) ──────────────────────────────────────────
    if (openaiKey) {
      // Try DALL-E 3 first, fall back to DALL-E 2 if not available
      // Style is embedded in prompt to avoid API version conflicts
      const styledPrompt = `${prompt}. Art style: ${style}.`;

      let imageUrl, usedModel;
      try {
        // Try DALL-E 3 — minimal params to avoid version conflicts
        const r3 = await axios.post(
          'https://api.openai.com/v1/images/generations',
          { model: 'dall-e-3', prompt: styledPrompt, n: 1, size: '1024x1024' },
          { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' } }
        );
        imageUrl = r3.data.data[0].url;
        usedModel = 'dall-e-3';
      } catch {
        // Fall back to DALL-E 2
        const r2 = await axios.post(
          'https://api.openai.com/v1/images/generations',
          { model: 'dall-e-2', prompt: styledPrompt.substring(0, 1000), n: 1, size: '1024x1024' },
          { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' } }
        );
        imageUrl = r2.data.data[0].url;
        usedModel = 'dall-e-2';
      }
      db.saveHistory({ prompt: `Image: ${prompt}`, response: imageUrl, type: 'image_generation', model: usedModel });
      return res.json({ success: true, provider: usedModel, image_url: imageUrl, format: 'url' });
    }

    return res.status(400).json({
      error: 'No image generation API configured. Add STABILITY_API_KEY or OPENAI_API_KEY to .env',
      setup: {
        stability: 'Get free credits at https://stability.ai — add STABILITY_API_KEY to .env',
        openai: 'Get key at https://platform.openai.com — add OPENAI_API_KEY to .env',
      }
    });

  } catch (err) {
    const detail = err.response?.data?.message || err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: detail });
  }
});

// ── AI Video Generation ───────────────────────────────────────────────────────
// Supports: Runway Gen-3 (RUNWAY_API_KEY), Luma (LUMA_API_KEY)

router.post('/generate-video', async (req, res) => {
  const { prompt, image_url, duration = 4, aspect_ratio = '16:9' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const runwayKey = process.env.RUNWAY_API_KEY;
  const lumaKey   = process.env.LUMA_API_KEY;

  try {
    // ── Luma Dream Machine ────────────────────────────────────────────────
    if (lumaKey) {
      const payload = {
        prompt,
        aspect_ratio,
        ...(image_url ? { keyframes: { frame0: { type: 'image', url: image_url } } } : {}),
      };
      const response = await axios.post('https://api.lumalabs.ai/dream-machine/v1/generations', payload, {
        headers: { Authorization: `Bearer ${lumaKey}`, 'Content-Type': 'application/json' },
      });
      const jobId = response.data.id;
      db.saveHistory({ prompt: `Video: ${prompt}`, response: `job:${jobId}`, type: 'video_generation', model: 'luma' });
      return res.json({ success: true, provider: 'luma', job_id: jobId, status: 'processing',
        poll_url: `/api/media/video-status/luma/${jobId}`,
        message: 'Video generation started. Poll the status URL every 5-10s for completion.' });
    }

    // ── Runway Gen-3 ─────────────────────────────────────────────────────
    if (runwayKey) {
      const payload = {
        promptText: prompt,
        ...(image_url ? { promptImage: image_url } : {}),
        watermark: false,
        duration,
        ratio: aspect_ratio === '16:9' ? '1280:768' : '768:1280',
      };
      const response = await axios.post('https://api.runwayml.com/v1/image_to_video', payload, {
        headers: { Authorization: `Bearer ${runwayKey}`, 'Content-Type': 'application/json', 'X-Runway-Version': '2024-11-06' },
      });
      const jobId = response.data.id;
      db.saveHistory({ prompt: `Video: ${prompt}`, response: `job:${jobId}`, type: 'video_generation', model: 'runway-gen3' });
      return res.json({ success: true, provider: 'runway', job_id: jobId, status: 'processing',
        poll_url: `/api/media/video-status/runway/${jobId}`,
        message: 'Video generation started. Poll the status URL every 10s.' });
    }

    return res.status(400).json({
      error: 'No video generation API configured. Add LUMA_API_KEY or RUNWAY_API_KEY to .env',
      setup: {
        luma: 'Get key at https://lumalabs.ai/dream-machine/api — add LUMA_API_KEY',
        runway: 'Get key at https://runwayml.com/api — add RUNWAY_API_KEY',
      }
    });

  } catch (err) {
    const detail = err.response?.data?.message || err.response?.data?.error || err.message;
    res.status(500).json({ error: detail });
  }
});

// ── Poll Video Job Status ─────────────────────────────────────────────────────

router.get('/video-status/:provider/:jobId', async (req, res) => {
  const { provider, jobId } = req.params;

  try {
    if (provider === 'luma') {
      const response = await axios.get(`https://api.lumalabs.ai/dream-machine/v1/generations/${jobId}`, {
        headers: { Authorization: `Bearer ${process.env.LUMA_API_KEY}` },
      });
      const { state, assets } = response.data;
      return res.json({
        job_id: jobId, status: state,
        video_url: assets?.video || null,
        done: state === 'completed' || state === 'failed',
      });
    }

    if (provider === 'runway') {
      const response = await axios.get(`https://api.runwayml.com/v1/tasks/${jobId}`, {
        headers: { Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`, 'X-Runway-Version': '2024-11-06' },
      });
      const { status, output } = response.data;
      return res.json({
        job_id: jobId, status,
        video_url: output?.[0] || null,
        done: status === 'SUCCEEDED' || status === 'FAILED',
      });
    }

    res.status(400).json({ error: `Unknown provider: ${provider}` });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// ── AI Animation / GIF Generation ────────────────────────────────────────────
// Uses Stability AI animation endpoint (requires STABILITY_API_KEY)

router.post('/generate-animation', async (req, res) => {
  const { image_base64, motion_bucket_id = 127, fps = 7, frames = 14 } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'image_base64 is required. First generate an image, then animate it.' });

  const stabilityKey = process.env.STABILITY_API_KEY;
  if (!stabilityKey) {
    return res.status(400).json({
      error: 'STABILITY_API_KEY required for animation generation.',
      setup: 'Add STABILITY_API_KEY to .env — get free credits at https://stability.ai'
    });
  }

  try {
    const FormData = require('form-data');
    const form = new FormData();

    const buffer = Buffer.from(image_base64, 'base64');
    form.append('image', buffer, { filename: 'image.png', contentType: 'image/png' });
    form.append('seed', '0');
    form.append('cfg_scale', '2.5');
    form.append('motion_bucket_id', motion_bucket_id.toString());

    const initRes = await axios.post(
      'https://api.stability.ai/v2beta/image-to-video',
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${stabilityKey}` } }
    );

    const generationId = initRes.data.id;
    return res.json({
      success: true, provider: 'stability', job_id: generationId, status: 'processing',
      poll_url: `/api/media/animation-status/${generationId}`,
      message: 'Animation started. Poll every 5-10s.',
    });

  } catch (err) {
    const detail = err.response?.data?.message || err.response?.data?.errors?.join(', ') || err.message;
    res.status(500).json({ error: detail });
  }
});

router.get('/animation-status/:jobId', async (req, res) => {
  const stabilityKey = process.env.STABILITY_API_KEY;
  if (!stabilityKey) return res.status(400).json({ error: 'STABILITY_API_KEY not configured' });

  try {
    const response = await axios.get(
      `https://api.stability.ai/v2beta/image-to-video/result/${req.params.jobId}`,
      { headers: { Authorization: `Bearer ${stabilityKey}`, Accept: 'video/*' }, responseType: 'arraybuffer' }
    );

    if (response.status === 200) {
      const videoBase64 = Buffer.from(response.data).toString('base64');
      return res.json({ done: true, status: 'completed', video_base64: videoBase64, format: 'mp4' });
    }

    res.json({ done: false, status: 'processing' });
  } catch (err) {
    if (err.response?.status === 202) return res.json({ done: false, status: 'processing' });
    res.status(500).json({ error: err.message });
  }
});

// ── Generate Caption / Text Post with Media ───────────────────────────────────

router.post('/generate-text-post', async (req, res) => {
  const { image_url, image_description, platform = 'instagram', tone = 'engaging', include_hashtags = true } = req.body;

  const prompt = `Write an engaging ${platform} text post${image_url || image_description ? ` for an image showing: ${image_description || 'the provided image'}` : ''}.

Tone: ${tone}
Platform: ${platform}
Include hashtags: ${include_hashtags}

Return ONLY valid JSON (no markdown):
{
  "caption": "Main post caption optimized for ${platform}",
  "short_caption": "Shorter alternative version",
  "hashtags": "#tag1 #tag2 #tag3",
  "alt_text": "Image alt text for accessibility",
  "cta": "Call-to-action text to add"
}`;

  try {
    const { data } = await aiJSON(prompt, apiKey(req));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI Prompt Enhancer ────────────────────────────────────────────────────────

router.post('/enhance-prompt', async (req, res) => {
  const { prompt: userPrompt, media_type = 'image', style } = req.body;
  if (!userPrompt) return res.status(400).json({ error: 'prompt is required' });

  const systemPrompt = `You are an expert at writing prompts for AI ${media_type} generation.
Enhance this basic prompt into a detailed, effective prompt for AI ${media_type} generation.
Original prompt: "${userPrompt}"
Desired style: ${style || 'photorealistic'}

Return ONLY valid JSON (no markdown):
{
  "enhanced_prompt": "Detailed, optimized prompt for best results",
  "negative_prompt": "What to avoid for better output quality",
  "style_tags": ["tag1", "tag2", "tag3"],
  "tips": "Brief tip for best results with this type of ${media_type}"
}`;

  try {
    const { data } = await aiJSON(systemPrompt, apiKey(req));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
