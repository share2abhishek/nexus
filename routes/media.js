const express = require('express');
const router = express.Router();
const axios = require('axios');
const knexInstance = require('../services/knex');
const historyRepo  = require('../repos/historyRepo')(knexInstance);
const { aiGenerate, aiJSON, aiArgsFromReq } = require('../services/aiHelper');

// The user's own AI keys / Ollama / chosen model (not just the shared .env key)
function ai(req) { return aiArgsFromReq(req); }

// ── AI Image Generation ───────────────────────────────────────────────────────
// Supports: Stability AI (STABILITY_API_KEY) or Google Imagen (GOOGLE_AI_KEY)

router.post('/generate-image', async (req, res) => {
  const { prompt, style = 'photorealistic', width = 1024, height = 1024, negative_prompt, preferred_provider } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  // The user's own keys first (Settings → AI), then the shared .env ones
  const stabilityKey = req.stabilityKey;
  const openaiKey    = req.openaiKey;
  const googleKey    = req.googleKey;

  // If the user picked a provider in the UI, use only that one
  const only = preferred_provider || null;
  if (only && only !== 'stability') req.body._skip_stability = true;

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
      historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `Image: ${prompt}`, response: `[Stability AI image generated]`, type: 'image_generation', model: 'stable-diffusion-xl' }).catch(() => {});
      return res.json({ success: true, provider: 'stability', image_base64: imageBase64, format: 'png' });
    }

    // ── OpenAI image model ────────────────────────────────────────────────
    // gpt-image-1 by default (DALL-E 2/3 are retired); override with OPENAI_IMAGE_MODEL.
    // No silent fallback to another model — that used to hide the real error.
    if (openaiKey && (!only || only === 'openai')) {
      const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
      const r = await axios.post(
        'https://api.openai.com/v1/images/generations',
        { model, prompt: `${prompt}. Art style: ${style}.`, n: 1, size: '1024x1024' },
        { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 }
      );
      const img = r.data.data[0];
      historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `Image: ${prompt}`, response: `[${model} image]`, type: 'image_generation', model }).catch(() => {});
      return img.b64_json
        ? res.json({ success: true, provider: model, image_base64: img.b64_json, format: 'png' })
        : res.json({ success: true, provider: model, image_url: img.url, format: 'url' });
    }

    // ── Google Gemini image model (uses the same key as Gemini text) ──────
    if (googleKey && (!only || only === 'google')) {
      const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
      try {
        const r = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          { contents: [{ parts: [{ text: `${prompt}. Art style: ${style}.` }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } },
          { params: { key: googleKey }, timeout: 120000 }
        );
        const part = (r.data.candidates?.[0]?.content?.parts || []).find(p => p.inlineData);
        if (!part) return res.status(502).json({ error: 'Gemini did not return an image — try rephrasing the prompt.' });
        historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `Image: ${prompt}`, response: `[${model} image]`, type: 'image_generation', model }).catch(() => {});
        return res.json({ success: true, provider: model, image_base64: part.inlineData.data, format: 'png' });
      } catch (err) {
        if (err.response?.status === 429) {
          return res.status(402).json({ error: 'Gemini image generation is not included in your Google key’s free quota. Enable billing at aistudio.google.com, or add a Stability/OpenAI key in Settings → AI.' });
        }
        throw err;
      }
    }

    return res.status(400).json({
      error: 'No image generator set up. Add a Stability AI or OpenAI key in Settings → AI (or use a Google key with billing enabled).',
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

  const runwayKey = req.runwayKey;
  const lumaKey   = req.lumaKey;

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
      historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `Video: ${prompt}`, response: `job:${jobId}`, type: 'video_generation', model: 'luma' }).catch(() => {});
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
      historyRepo.save(req.workspaceId, req.session?.userId, { prompt: `Video: ${prompt}`, response: `job:${jobId}`, type: 'video_generation', model: 'runway-gen3' }).catch(() => {});
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
        headers: { Authorization: `Bearer ${req.lumaKey}` },
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
        headers: { Authorization: `Bearer ${req.runwayKey}`, 'X-Runway-Version': '2024-11-06' },
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

  const stabilityKey = req.stabilityKey;
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
  const stabilityKey = req.stabilityKey;
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
    const { data } = await aiJSON(prompt, ai(req).apiKey, 1024, ai(req).options, ai(req).model);
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
    const { data } = await aiJSON(systemPrompt, ai(req).apiKey, 1024, ai(req).options, ai(req).model);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
