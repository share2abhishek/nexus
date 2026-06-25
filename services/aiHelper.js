const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

// ── Simple concurrency limiter for Ollama ─────────────────────────────────────
let _ollamaRunning = 0;
const _ollamaQueue = [];
const OLLAMA_MAX_CONCURRENT = 2;

function withOllamaQueue(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      _ollamaRunning++;
      fn().then(r => { _ollamaRunning--; _drainQueue(); resolve(r); })
          .catch(e => { _ollamaRunning--; _drainQueue(); reject(e); });
    };
    if (_ollamaRunning < OLLAMA_MAX_CONCURRENT) run();
    else _ollamaQueue.push(run);
  });
}

function _drainQueue() {
  if (_ollamaQueue.length && _ollamaRunning < OLLAMA_MAX_CONCURRENT) {
    _ollamaQueue.shift()();
  }
}

// ── Ollama (local Llama) ───────────────────────────────────────────────────────

async function ollamaGenerate(prompt, maxTokens = 1024, opts = {}) {
  const base  = opts.base  || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = opts.model || process.env.OLLAMA_MODEL    || 'llama3.2';

  const res = await axios.post(`${base}/api/chat`, {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    options: { num_predict: maxTokens },
  }, { timeout: 120000 });

  return { text: res.data.message?.content || res.data.response || '', model: `ollama:${model}` };
}

async function isOllamaRunning(opts = {}) {
  try {
    const base = opts.base || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const res = await axios.get(`${base}/api/tags`, { timeout: 3000 });
    // Also verify the configured model is downloaded
    const model = opts.model || process.env.OLLAMA_MODEL || 'llama3.2';
    const models = res.data.models || [];
    const available = models.some(m => m.name === model || m.name.startsWith(model.split(':')[0]));
    if (!available) {
      console.warn(`[Ollama] Running but model "${model}" not found. Available: ${models.map(m => m.name).join(', ')}`);
    }
    return true; // running, even if model not ready yet
  } catch {
    return false;
  }
}

async function aiGenerate(prompt, apiKey, maxTokens = 1024, modelOverride = null, options = {}) {
  // Re-read env/options each call so UI/user changes take effect without restart
  const googleKey = apiKey || options.googleKey || process.env.GOOGLE_AI_KEY;
  const anthropicKey = options.anthropicKey || process.env.ANTHROPIC_API_KEY;
  const ollamaEnabled = (options.ollamaEnabled !== undefined) ? options.ollamaEnabled : (process.env.OLLAMA_ENABLED === 'true');
  const ollamaModel = options.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2';
  const ollamaBaseUrl = options.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  // ── Explicit model override from UI ─────────────────────────────────────
  if (modelOverride) {
    if (modelOverride.startsWith('ollama:')) {
      const targetOllamaModel = modelOverride.replace('ollama:', '');
      return await ollamaGenerate(prompt, maxTokens, { model: targetOllamaModel, base: ollamaBaseUrl });
    }
    if (modelOverride === 'gemini') {
      if (!googleKey || googleKey.includes('your-key-here')) {
        throw new Error('Google Gemini API key not configured.');
      }
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(googleKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }, { apiVersion: 'v1beta' });
      const result = await model.generateContent(prompt);
      return { text: result.response.text(), model: 'gemini-1.5-flash' };
    }
    if (modelOverride === 'claude') {
      if (!anthropicKey || anthropicKey.includes('your-key-here')) {
        throw new Error('Anthropic API key not configured.');
      }
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: anthropicKey });
      const msg = await client.messages.create({ model: 'claude-opus-4-5', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
      return { text: msg.content[0].text, model: msg.model };
    }
  }

  // ── Priority 1: Ollama (local, free) ─────────────────────────────────────
  if (ollamaEnabled) {
    const running = await isOllamaRunning({ base: ollamaBaseUrl, model: ollamaModel });
    if (running) {
      console.log(`[AI] Using Ollama (${ollamaModel}) [queue: ${_ollamaQueue.length}]`);
      return withOllamaQueue(() => ollamaGenerate(prompt, maxTokens, { model: ollamaModel, base: ollamaBaseUrl }));
    }
    console.warn('[AI] Ollama enabled but not reachable at', ollamaBaseUrl);
    console.warn('[AI] Start Ollama: open Ollama app or run "ollama serve" in terminal');
    console.warn('[AI] Falling back to cloud AI...');
  }

  // ── Priority 2: Google Gemini ─────────────────────────────────────────────
  if (googleKey && !googleKey.includes('your-key-here')) {
    const genAI = new GoogleGenerativeAI(googleKey);
    // Use v1beta — v1 does not support gemini-1.5-flash
    const model = genAI.getGenerativeModel(
      { model: 'gemini-1.5-flash' },
      { apiVersion: 'v1beta' }
    );
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return { text: response.text(), model: 'gemini-1.5-flash' };
  }

  // ── Priority 3: Anthropic Claude ──────────────────────────────────────────
  if (anthropicKey && anthropicKey.length > 10) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: anthropicKey });
    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return { text: message.content[0].text, model: message.model };
  }

  throw new Error('No AI available. Enable Ollama in Settings or add GOOGLE_AI_KEY to .env');
}

async function aiJSON(prompt, apiKey, maxTokens = 1024) {
  const result = await aiGenerate(prompt, apiKey, maxTokens);
  const match = result.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI returned an unexpected format — try again');
  return { data: JSON.parse(match[0]), model: result.model, raw: result.text };
}

module.exports = { aiGenerate, aiJSON, isOllamaRunning };
