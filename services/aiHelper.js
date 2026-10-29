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

// ── Ollama (local Llama — free, private) ──────────────────────────────────────

async function ollamaGenerate(prompt, maxTokens = 1024, opts = {}) {
  const base  = opts.base  || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = opts.model || process.env.OLLAMA_MODEL    || 'llama3.2';

  const res = await axios.post(`${base}/api/chat`, {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    keep_alive: '30m',
    options: { num_predict: Math.min(maxTokens, 1024) },
  }, { timeout: 180000 });

  return { text: res.data.message?.content || res.data.response || '', model: `ollama:${model}` };
}

async function isOllamaRunning(opts = {}) {
  try {
    const base = opts.base || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const res = await axios.get(`${base}/api/tags`, { timeout: 3000 });
    const model = opts.model || process.env.OLLAMA_MODEL || 'llama3.2';
    const models = res.data.models || [];
    const available = models.some(m => m.name === model || m.name.startsWith(model.split(':')[0]));
    if (!available) {
      console.warn(`[Ollama] Running but model "${model}" not found. Available: ${models.map(m => m.name).join(', ')}`);
    }
    return opts.requireModel ? available : true;
  } catch {
    return false;
  }
}

// ── Groq (free tier — fastest cloud inference) ────────────────────────────────
// Sign up free at https://console.groq.com → API Keys
// Free: 14,400 req/day, 6,000 tok/min on llama-3.3-70b

async function groqGenerate(prompt, maxTokens = 1024, opts = {}) {
  const apiKey = opts.apiKey;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const model = opts.model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: Math.min(maxTokens, 4096),
    temperature: 0.7,
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  const text = res.data.choices?.[0]?.message?.content || '';
  return { text, model: `groq:${model}` };
}

// ── OpenRouter (free models via unified API) ───────────────────────────────────
// Sign up free at https://openrouter.ai → API Keys
// Free models: meta-llama/llama-3.1-8b-instruct:free, etc.

async function openRouterGenerate(prompt, maxTokens = 1024, opts = {}) {
  const apiKey = opts.apiKey;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

  const model = opts.model || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free';

  const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: Math.min(maxTokens, 4096),
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://radixile.com',
      'X-Title': 'Social-Nexus Marketing Platform',
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  const text = res.data.choices?.[0]?.message?.content || '';
  return { text, model: `openrouter:${model}` };
}

// ── Mistral AI (free tier) ────────────────────────────────────────────────────
// Sign up free at https://console.mistral.ai → API Keys
// Free: 1 req/sec, mistral-small-latest

async function mistralGenerate(prompt, maxTokens = 1024, opts = {}) {
  const apiKey = opts.apiKey;
  if (!apiKey) throw new Error('MISTRAL_API_KEY not configured');

  const model = opts.model || process.env.MISTRAL_MODEL || 'mistral-small-latest';

  const res = await axios.post('https://api.mistral.ai/v1/chat/completions', {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: Math.min(maxTokens, 4096),
    temperature: 0.7,
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  const text = res.data.choices?.[0]?.message?.content || '';
  return { text, model: `mistral:${model}` };
}

// Retry once on "busy" errors (429 rate limit / 503 overloaded), which are usually
// momentary on free tiers. Anything else fails straight away.
async function withBusyRetry(fn, delayMs = 2000) {
  try {
    return await fn();
  } catch (err) {
    const status = err.status || err.response?.status;
    const busy = status === 429 || status === 503 || /\[(429|503)/.test(err.message || '');
    if (!busy) throw err;
    await new Promise(r => setTimeout(r, delayMs));
    return fn();
  }
}

// Short, user-readable reason for a provider failure (drops long SDK URLs).
function shortReason(err) {
  const status = err.status || err.response?.status || (err.message || '').match(/\[(\d{3})/)?.[1];
  const apiMsg = err.response?.data?.error?.message;
  if (String(status) === '503') return 'busy right now (503) — try again in a minute';
  if (String(status) === '429') return 'rate limit reached (429)';
  if (err.name === 'AbortError' || /aborted|timeout|ETIMEDOUT/i.test(err.message || '')) return 'no reply within 30 seconds (timed out)';
  if (String(status) === '401' || String(status) === '403' || /API_KEY_INVALID|API key not valid/.test(err.message || '')) {
    return 'API key rejected — check it in Settings → My API Keys';
  }
  return (apiMsg || err.message || 'unknown error')
    .replace(/^\[[^\]]+\]:\s*Error fetching from \S+:\s*/, '') // Google SDK prefix + URL
    .split('\n')[0].slice(0, 160);
}

// ── Google Gemini ─────────────────────────────────────────────────────────────
// `gemini-flash-latest` is Google's maintained alias, so the app doesn't break each
// time a pinned version (like gemini-1.5-flash) is retired. Override with GEMINI_MODEL.

async function geminiGenerate(prompt, apiKey) {
  const modelId = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelId }, { apiVersion: 'v1beta', timeout: 30000 });
  const result = await withBusyRetry(() => model.generateContent(prompt));
  return { text: result.response.text(), model: `gemini:${modelId}` };
}

// ── Anthropic Claude ──────────────────────────────────────────────────────────
// Current Claude models always think, so the response starts with a thinking block:
// read the text blocks rather than content[0]. max_tokens covers thinking + answer,
// hence the floor. Override the model with ANTHROPIC_MODEL.

async function claudeGenerate(prompt, apiKey, maxTokens = 1024) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, timeout: 120000 });
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    max_tokens: Math.max(maxTokens, 8000),
    output_config: { effort: 'low' }, // short marketing copy doesn't need deep reasoning
    messages: [{ role: 'user', content: prompt }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { text, model: msg.model };
}

// ── Master AI Generate (auto-fallback chain) ──────────────────────────────────

async function aiGenerate(prompt, apiKey, maxTokens = 1024, modelOverride = null, options = {}) {
  // Re-read env/options each call so UI/user changes take effect without restart
  // Keys come from the caller (the user's own, plus shared ones for admins — see
  // middleware/auth.js injectUserKeys). Nothing here reads keys from .env.
  const googleKey    = apiKey || options.googleKey;
  const anthropicKey = options.anthropicKey;
  const groqKey      = options.groqKey;
  const openrouterKey = options.openrouterKey;
  const mistralKey   = options.mistralKey;
  const ollamaEnabled = (options.ollamaEnabled !== undefined) ? options.ollamaEnabled : (process.env.OLLAMA_ENABLED !== 'false');
  const ollamaModel  = options.ollamaModel             || process.env.OLLAMA_MODEL    || 'llama3.2';
  const ollamaBaseUrl = options.ollamaBaseUrl          || process.env.OLLAMA_BASE_URL  || 'http://localhost:11434';

  // ── Explicit model override from UI ─────────────────────────────────────────
  // The user picked this provider, so no fallback — but report failures readably.
  if (modelOverride) {
    const provider = modelOverride.split(':')[0];
    try {
      // Ollama variants
      if (modelOverride.startsWith('ollama:')) {
        const targetModel = modelOverride.replace('ollama:', '');
        return await withOllamaQueue(() => ollamaGenerate(prompt, maxTokens, { model: targetModel, base: ollamaBaseUrl }));
      }
      // Gemini
      if (modelOverride === 'gemini' || modelOverride.startsWith('gemini:')) {
        if (!googleKey || googleKey.includes('your-key-here')) throw new Error('Google Gemini API key not configured.');
        return await geminiGenerate(prompt, googleKey);
      }
      // Claude
      if (modelOverride === 'claude') {
        if (!anthropicKey || anthropicKey.includes('your-key-here')) throw new Error('Anthropic API key not configured.');
        return await claudeGenerate(prompt, anthropicKey, maxTokens);
      }
      // Groq variants
      if (modelOverride === 'groq' || modelOverride.startsWith('groq:')) {
        const groqModel = modelOverride.startsWith('groq:') ? modelOverride.replace('groq:', '') : undefined;
        return await groqGenerate(prompt, maxTokens, { apiKey: groqKey, model: groqModel });
      }
      // OpenRouter variants
      if (modelOverride === 'openrouter' || modelOverride.startsWith('openrouter:')) {
        const orModel = modelOverride.startsWith('openrouter:') ? modelOverride.replace('openrouter:', '') : undefined;
        return await openRouterGenerate(prompt, maxTokens, { apiKey: openrouterKey, model: orModel });
      }
      // Mistral variants
      if (modelOverride === 'mistral' || modelOverride.startsWith('mistral:')) {
        const mModel = modelOverride.startsWith('mistral:') ? modelOverride.replace('mistral:', '') : undefined;
        return await mistralGenerate(prompt, maxTokens, { apiKey: mistralKey, model: mModel });
      }
    } catch (err) {
      if (/not configured/.test(err.message)) throw err;
      const label = { ollama: 'Ollama', gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openrouter: 'OpenRouter', mistral: 'Mistral' }[provider] || provider;
      const reason = provider === 'ollama' && /ECONNREFUSED|connect/i.test(err.message)
        ? 'not running on this computer (install it from https://ollama.com and open the app)'
        : shortReason(err);
      throw new Error(`${label}: ${reason}`);
    }
  }

  // ── Auto-fallback Priority Chain ─────────────────────────────────────────────
  // Each provider that is configured but fails records why, so the final error can
  // tell the user what actually went wrong instead of "no provider".
  const failures = [];

  // 1. Ollama — local, fully free, private
  if (ollamaEnabled) {
    const running = await isOllamaRunning({ base: ollamaBaseUrl, model: ollamaModel });
    const ready = running && await isOllamaRunning({ base: ollamaBaseUrl, model: ollamaModel, requireModel: true });
    if (ready) {
      try {
        console.log(`[AI] Using Ollama (${ollamaModel}) [queue: ${_ollamaQueue.length}]`);
        return await withOllamaQueue(() => ollamaGenerate(prompt, maxTokens, { model: ollamaModel, base: ollamaBaseUrl }));
      } catch (err) {
        console.warn('[AI] Ollama failed:', err.message, '— trying cloud AI');
        failures.push(`Ollama: ${shortReason(err)}`);
      }
    } else if (running) {
      failures.push(`Ollama: the model "${ollamaModel}" is not downloaded yet (Settings → Local AI → Pull model)`);
    } else {
      console.warn('[AI] Ollama not reachable — falling back to cloud AI');
      failures.push('Ollama: not running on this computer (install it from https://ollama.com and open the app)');
    }
  }

  // 2. Google Gemini — free tier (1M tokens/month)
  if (googleKey && !googleKey.includes('your-key-here') && googleKey.length > 8) {
    try {
      console.log('[AI] Using Google Gemini');
      return await geminiGenerate(prompt, googleKey);
    } catch (err) {
      console.warn('[AI] Gemini failed:', err.message, '— trying next...');
      failures.push(`Gemini: ${shortReason(err)}`);
    }
  }

  // 3. Groq — free tier, fastest cloud inference
  if (groqKey && groqKey.length > 8) {
    try {
      console.log('[AI] Using Groq (llama-3.3-70b-versatile)');
      return await groqGenerate(prompt, maxTokens, { apiKey: groqKey });
    } catch (err) {
      console.warn('[AI] Groq failed:', err.message, '— trying next...');
      failures.push(`Groq: ${shortReason(err)}`);
    }
  }

  // 4. OpenRouter — free model tier
  if (openrouterKey && openrouterKey.length > 8) {
    try {
      console.log('[AI] Using OpenRouter (llama-3.1-8b-instruct:free)');
      return await openRouterGenerate(prompt, maxTokens, { apiKey: openrouterKey });
    } catch (err) {
      console.warn('[AI] OpenRouter failed:', err.message, '— trying next...');
      failures.push(`OpenRouter: ${shortReason(err)}`);
    }
  }

  // 5. Mistral — free tier
  if (mistralKey && mistralKey.length > 8) {
    try {
      console.log('[AI] Using Mistral (mistral-small-latest)');
      return await mistralGenerate(prompt, maxTokens, { apiKey: mistralKey });
    } catch (err) {
      console.warn('[AI] Mistral failed:', err.message, '— trying next...');
      failures.push(`Mistral: ${shortReason(err)}`);
    }
  }

  // 6. Anthropic Claude — paid fallback
  if (anthropicKey && anthropicKey.length > 10) {
    console.log('[AI] Using Anthropic Claude');
    try {
      return await claudeGenerate(prompt, anthropicKey, maxTokens);
    } catch (err) {
      console.warn('[AI] Claude failed:', err.message);
      failures.push(`Claude: ${shortReason(err)}`);
    }
  }

  const cloudFailed = failures.filter(f => !f.startsWith('Ollama'));
  if (cloudFailed.length) {
    throw new Error(
      'All configured AI providers failed:\n' + failures.map(f => `• ${f}`).join('\n') +
      '\nTry again in a minute, or add another free provider in Settings → My API Keys.'
    );
  }

  throw new Error(
    'No AI provider available. Options:\n' +
    '1. Start Ollama (free, local): https://ollama.com\n' +
    '2. Add GROQ_API_KEY (free): https://console.groq.com\n' +
    '3. Add GOOGLE_AI_KEY (free): https://aistudio.google.com\n' +
    'Go to Settings → My API Keys to configure.'
  );
}

// AI options for the logged-in user, as set by middleware/auth.js injectUserKeys:
// their own keys, Ollama settings and (optionally) the model picked in the UI.
function aiOptionsFromReq(req) {
  return {
    googleKey: req.googleKey, anthropicKey: req.anthropicKey,
    groqKey: req.groqKey, openrouterKey: req.openrouterKey, mistralKey: req.mistralKey,
    ollamaEnabled: req.ollamaEnabled, ollamaModel: req.ollamaModel, ollamaBaseUrl: req.ollamaUrl,
  };
}

// Everything a route needs to call aiGenerate/aiJSON on the user's behalf.
function aiArgsFromReq(req) {
  return {
    apiKey: req.googleKey || undefined,
    options: aiOptionsFromReq(req),
    model: req.body?.model || null,
  };
}

async function aiJSON(prompt, apiKey, maxTokens = 1024, options = {}, modelOverride = null) {
  const result = await aiGenerate(prompt, apiKey, maxTokens, modelOverride, options);
  const match = result.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI returned an unexpected format — try again');
  return { data: JSON.parse(match[0]), model: result.model, raw: result.text };
}

module.exports = { aiGenerate, aiJSON, aiOptionsFromReq, aiArgsFromReq, isOllamaRunning, groqGenerate, openRouterGenerate, mistralGenerate };
