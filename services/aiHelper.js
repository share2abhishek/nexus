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
    options: {
      num_predict: Math.min(maxTokens, 1024),
      num_ctx: parseInt(process.env.OLLAMA_NUM_CTX) || 4096,   // default 131K OOMs on 16GB; 4K is plenty for posts
    },
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

  // Some accounts have no access to the main model (404): try Groq's smaller models before giving up
  const models = [...new Set([opts.model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', ...(opts.model ? [] : ['llama-3.1-8b-instant', 'openai/gpt-oss-20b'])])];
  let res, model, lastErr;
  for (model of models) {
    try {
      res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: Math.min(maxTokens, 4096),
        temperature: 0.7,
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: maxTokens > 2500 ? 90000 : 30000,
      });
      break;
    } catch (err) {
      lastErr = err;
      const st = err.response?.status;
      if (st !== 404 && st !== 400) throw err;
      lastErr.message = err.response?.data?.error?.message || err.message;
    }
  }
  if (!res) throw lastErr;

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

// ── OpenAI (ChatGPT / GPT-4o-mini / GPT-4o) ──────────────────────────────────
// Sign up at https://platform.openai.com/api-keys
// Recommended default model: gpt-4o-mini (fast, cheap, high quality)

async function openaiGenerate(prompt, maxTokens = 1024, opts = {}) {
  const apiKey = opts.apiKey;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const model = opts.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const res = await axios.post('https://api.openai.com/v1/chat/completions', {
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
  return { text, model: `openai:${model}` };
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
    return 'API key rejected — check it in Settings → AI';
  }
  return (apiMsg || err.message || 'unknown error')
    .replace(/^\[[^\]]+\]:\s*Error fetching from \S+:\s*/, '') // Google SDK prefix + URL
    .split('\n')[0].slice(0, 160);
}

// ── Cool-down for an AI that is not answering ────────────────────────────────
// When a cloud AI times out or is overloaded, asking it again straight away just waits
// through the same timeout. For a while it is skipped, so the next provider (or the plain
// template, for outreach emails) is used at once. A rejected key is not "not answering": it
// is reported as before. Only the last characters of the key are used to tell keys apart.
const COOL_MS = Number(process.env.AI_COOLDOWN_MS) || 90_000;
const cooling = new Map(); // "provider:key-tail" -> time (ms) it may be tried again
const coolId = (provider, key) => `${provider}:${String(key || '').slice(-6)}`;
function isCooling(provider, key) {
  const until = cooling.get(coolId(provider, key));
  if (!until) return false;
  if (until <= Date.now()) { cooling.delete(coolId(provider, key)); return false; }
  return true;
}
function coolDown(provider, key, ms = COOL_MS) { cooling.set(coolId(provider, key), Date.now() + ms); }
// Timeouts, aborts, overload and server errors cool a provider down; bad requests and keys do not
function isNotAnswering(err) {
  const status = Number(err?.status || err?.response?.status || (err?.message || '').match(/\[(\d{3})/)?.[1]) || 0;
  if ([400, 401, 403, 404].includes(status)) return false;
  return true;
}
function _resetCooldowns() { cooling.clear(); }

// ── Google Gemini ─────────────────────────────────────────────────────────────
// `gemini-flash-latest` is Google's maintained alias, so the app doesn't break each
// time a pinned version (like gemini-1.5-flash) is retired. Override with GEMINI_MODEL.

// The main model can be overloaded (503) or hang for minutes; the lite alias is
// almost always available, so it is the automatic backup (each tried for 10s).
// Long answers (many posts at once) need longer than a short reply: 10s for short, 90s for long
async function geminiGenerate(prompt, apiKey, maxTokens = 1024) {
  const timeout = maxTokens > 2500 ? 90000 : 10000;
  const primary = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const candidates = [...new Set([primary, 'gemini-flash-lite-latest'])];
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastErr;
  for (const modelId of candidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId }, { apiVersion: 'v1beta', timeout });
      const result = await model.generateContent(prompt);
      return { text: result.response.text(), model: `gemini:${modelId}` };
    } catch (err) {
      lastErr = err;
      const status = err.status || err.response?.status || (err.message || '').match(/\[(\d{3})/)?.[1];
      // A rejected key will fail on every model: stop
      if (String(status) === '401' || String(status) === '403' || /API_KEY_INVALID|API key not valid/.test(err.message || '')) throw err;
      console.warn(`[AI] Gemini ${modelId} failed (${shortReason(err)}) — ${modelId === candidates[candidates.length - 1] ? 'no more models' : 'trying the next one'}`);
    }
  }
  throw lastErr;
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
  const googleKey     = apiKey || options.googleKey;
  const anthropicKey  = options.anthropicKey;
  const groqKey       = options.groqKey;
  const openrouterKey = options.openrouterKey;
  const mistralKey    = options.mistralKey;
  const openaiKey     = options.openaiKey;
  const defaultModel  = options.defaultTextModel;
  const ollamaEnabled = (options.ollamaEnabled !== undefined) ? options.ollamaEnabled : require('./edition').ollamaDefault();
  const ollamaModel   = options.ollamaModel            || process.env.OLLAMA_MODEL    || 'llama3.2';
  // Hosted edition: only the operator's own Ollama (OLLAMA_BASE_URL), never an address a customer typed
  const ollamaBaseUrl = (require('./edition').isServer() ? null : options.ollamaBaseUrl) || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  // Calls on Radixile's shared keys are counted: over the limit, this throws a readable error
  if (typeof options.beforeCall === 'function') await options.beforeCall();

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
        return await geminiGenerate(prompt, googleKey, maxTokens);
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
      // OpenAI variants
      if (modelOverride === 'openai' || modelOverride.startsWith('openai:')) {
        const oModel = modelOverride.startsWith('openai:') ? modelOverride.replace('openai:', '') : undefined;
        return await openaiGenerate(prompt, maxTokens, { apiKey: openaiKey, model: oModel });
      }
    } catch (err) {
      if (/not configured/.test(err.message)) throw err;
      const label = { ollama: 'Ollama', gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openrouter: 'OpenRouter', mistral: 'Mistral', openai: 'OpenAI' }[provider] || provider;
      const reason = provider === 'ollama' && /ECONNREFUSED|connect/i.test(err.message)
        ? 'not running on this computer (install it from https://ollama.com and open the app)'
        : shortReason(err);
      throw new Error(`${label}: ${reason}`);
    }
  }

  // ── Preferred default model from user settings ──────────────────────────────
  // If the user picked a specific default cloud model in Settings → AI (e.g. Groq or Gemini),
  // try it first before falling through to local Ollama.
  if (defaultModel && defaultModel !== 'ollama') {
    try {
      if (defaultModel === 'groq' && groqKey && groqKey.length > 8) {
        return await groqGenerate(prompt, maxTokens, { apiKey: groqKey });
      }
      if (defaultModel === 'gemini' && googleKey && googleKey.length > 8 && !googleKey.includes('your-key-here')) {
        return await geminiGenerate(prompt, googleKey, maxTokens);
      }
      if (defaultModel === 'openai' && openaiKey && openaiKey.length > 8) {
        return await openaiGenerate(prompt, maxTokens, { apiKey: openaiKey });
      }
      if (defaultModel === 'claude' && anthropicKey && anthropicKey.length > 10) {
        return await claudeGenerate(prompt, anthropicKey, maxTokens);
      }
      if (defaultModel === 'openrouter' && openrouterKey && openrouterKey.length > 8) {
        return await openRouterGenerate(prompt, maxTokens, { apiKey: openrouterKey });
      }
      if (defaultModel === 'mistral' && mistralKey && mistralKey.length > 8) {
        return await mistralGenerate(prompt, maxTokens, { apiKey: mistralKey });
      }
    } catch (err) {
      console.warn(`[AI] Preferred model (${defaultModel}) failed:`, err.message, '— continuing fallback chain');
    }
  }

  // ── Auto-fallback Priority Chain ─────────────────────────────────────────────
  // Each provider that is configured but fails records why, so the final error can
  // tell the user what actually went wrong instead of "no provider".
  const failures = [];

  // 1. Ollama — local, fully free, private.
  // If a cloud key is configured, the person has set up a cloud AI on purpose, so
  // Ollama only goes first when they explicitly chose it (Settings → AI → default
  // model = Ollama and Local AI switched on); otherwise it is the last resort.
  const hasCloudKey = [googleKey, groqKey, openaiKey, openrouterKey, mistralKey, anthropicKey]
    .some(k => k && k.length > 8 && !k.includes('your-key-here'));
  const ollamaFirst = !hasCloudKey || (defaultModel === 'ollama' && options.ollamaEnabled === true);
  const tryOllama = async () => {
    if (!ollamaEnabled) return null;
    const running = await isOllamaRunning({ base: ollamaBaseUrl, model: ollamaModel });
    const ready = running && await isOllamaRunning({ base: ollamaBaseUrl, model: ollamaModel, requireModel: true });
    if (ready) {
      try {
        console.log(`[AI] Using Ollama (${ollamaModel}) [queue: ${_ollamaQueue.length}]`);
        return await withOllamaQueue(() => ollamaGenerate(prompt, maxTokens, { model: ollamaModel, base: ollamaBaseUrl }));
      } catch (err) {
        console.warn('[AI] Ollama failed:', err.message);
        failures.push(`Ollama: ${shortReason(err)}`);
      }
    } else if (running) {
      failures.push(`Ollama: the model "${ollamaModel}" is not downloaded yet (Settings → Local AI → Pull model)`);
    } else {
      console.warn('[AI] Ollama not reachable');
      failures.push('Ollama: not running on this computer (install it from https://ollama.com and open the app)');
    }
    return null;
  };
  if (ollamaFirst) {
    const r = await tryOllama();
    if (r) return r;
  }

  // 2. Google Gemini — free tier (1M tokens/month)
  if (googleKey && !googleKey.includes('your-key-here') && googleKey.length > 8) {
    if (isCooling('gemini', googleKey)) {
      failures.push('Gemini: skipped for a minute because it was not answering');
    } else {
      try {
        console.log('[AI] Using Google Gemini');
        return await geminiGenerate(prompt, googleKey, maxTokens);
      } catch (err) {
        console.warn('[AI] Gemini failed:', err.message, '— trying next...');
        failures.push(`Gemini: ${shortReason(err)}`);
        if (isNotAnswering(err)) coolDown('gemini', googleKey);
      }
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

  // 4. OpenAI — fast and reliable
  if (openaiKey && openaiKey.length > 8) {
    try {
      console.log('[AI] Using OpenAI (gpt-4o-mini)');
      return await openaiGenerate(prompt, maxTokens, { apiKey: openaiKey });
    } catch (err) {
      console.warn('[AI] OpenAI failed:', err.message, '— trying next...');
      failures.push(`OpenAI: ${shortReason(err)}`);
    }
  }

  // 5. OpenRouter — free model tier
  if (openrouterKey && openrouterKey.length > 8) {
    try {
      console.log('[AI] Using OpenRouter (llama-3.1-8b-instruct:free)');
      return await openRouterGenerate(prompt, maxTokens, { apiKey: openrouterKey });
    } catch (err) {
      console.warn('[AI] OpenRouter failed:', err.message, '— trying next...');
      failures.push(`OpenRouter: ${shortReason(err)}`);
    }
  }

  // 6. Mistral — free tier
  if (mistralKey && mistralKey.length > 8) {
    try {
      console.log('[AI] Using Mistral (mistral-small-latest)');
      return await mistralGenerate(prompt, maxTokens, { apiKey: mistralKey });
    } catch (err) {
      console.warn('[AI] Mistral failed:', err.message, '— trying next...');
      failures.push(`Mistral: ${shortReason(err)}`);
    }
  }

  // 7. Anthropic Claude — paid fallback
  if (anthropicKey && anthropicKey.length > 10) {
    console.log('[AI] Using Anthropic Claude');
    try {
      return await claudeGenerate(prompt, anthropicKey, maxTokens);
    } catch (err) {
      console.warn('[AI] Claude failed:', err.message);
      failures.push(`Claude: ${shortReason(err)}`);
    }
  }

  // Cloud AI is set up but failed (or has no key): local Ollama is the last resort
  if (!ollamaFirst) {
    const r = await tryOllama();
    if (r) return r;
  }

  const cloudFailed = failures.filter(f => !f.startsWith('Ollama'));
  if (cloudFailed.length) {
    throw new Error(
      'All configured AI providers failed:\n' + failures.map(f => `• ${f}`).join('\n') +
      '\nTry again in a minute, or add another free provider in Settings → AI.'
    );
  }

  // Server edition: no local AI; keys come from the person or their business
  if (require('./edition').isServer()) {
    throw new Error('AI isn’t set up for your business yet. Go to Settings → AI and paste a free Google Gemini or Groq key (an owner or manager can share one with the whole team).');
  }
  throw new Error(
    'No AI provider available. Options:\n' +
    '1. Start Ollama (free, local): https://ollama.com\n' +
    '2. Add GROQ_API_KEY (free): https://console.groq.com\n' +
    '3. Add GOOGLE_AI_KEY (free): https://aistudio.google.com\n' +
    'Go to Settings → AI to configure.'
  );
}

// AI options for the logged-in user, as set by middleware/auth.js injectUserKeys:
// their own keys, Ollama settings and (optionally) the model picked in the UI.
function aiOptionsFromReq(req) {
  return {
    googleKey: req.googleKey, anthropicKey: req.anthropicKey,
    groqKey: req.groqKey, openrouterKey: req.openrouterKey, mistralKey: req.mistralKey,
    openaiKey: req.openaiKey, defaultTextModel: req.defaultTextModel,
    ollamaEnabled: req.ollamaEnabled, ollamaModel: req.ollamaModel, ollamaBaseUrl: req.ollamaUrl,
    beforeCall: req.aiGuard,
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

// The list an AI answered with, whichever way it wrapped it: a bare JSON array, an array inside
// a code fence or commentary, an object holding an array ({"companies":[…]}), or a list cut off
// part-way (its complete entries are kept). Returns an array, or null if there is none.
function extractJsonList(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryParse(t);
  if (v === undefined) { const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) v = tryParse(fence[1].trim()); }
  if (v === undefined) { const a = t.indexOf('['); const b = t.lastIndexOf(']'); if (a >= 0 && b > a) v = tryParse(t.slice(a, b + 1)); }
  if (v === undefined) { const a = t.indexOf('{'); const b = t.lastIndexOf('}'); if (a >= 0 && b > a) v = tryParse(t.slice(a, b + 1)); }
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const arr = Object.values(v).find(Array.isArray);
    if (arr) return arr;
    return [v]; // a single company on its own
  }
  // cut off before the closing bracket: keep every complete {…} entry
  const items = (t.match(/\{[^{}]*\}/g) || []).map(tryParse).filter((x) => x && typeof x === 'object');
  return items.length ? items : null;
}

// Like aiJSON, for an answer that is a list
async function aiList(prompt, apiKey, maxTokens = 1024, options = {}, modelOverride = null) {
  const result = await aiGenerate(prompt, apiKey, maxTokens, modelOverride, options);
  return { data: extractJsonList(result.text) || [], model: result.model, raw: result.text };
}

module.exports = { aiGenerate, aiJSON, aiList, extractJsonList, isCooling, coolDown, _resetCooldowns, aiOptionsFromReq, aiArgsFromReq, isOllamaRunning, groqGenerate, openRouterGenerate, mistralGenerate, openaiGenerate };
