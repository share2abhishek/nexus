const { aiGenerate } = require('./aiHelper');

const PROMPTS = {
  generate: ({ text, platform }) =>
    `Write a ${platform || 'social media'} post based on this brief:\n\n${text}\n\n` +
    `Return only the finished post text, with no preamble or explanation.`,

  rewrite: ({ text, platform }) =>
    `Rewrite the following ${platform || 'social media'} post in a clearer, more engaging tone, ` +
    `keeping the same meaning:\n\n${text}\n\nReturn only the rewritten post text, with no preamble.`,

  shorten: ({ text, platform }) =>
    `Shorten the following ${platform || 'social media'} post so it fits typical platform character limits ` +
    `while keeping its key message:\n\n${text}\n\nReturn only the shortened post text, with no preamble.`,

  // Worded plainly with an example reply: small local models (llama3.2) refused
  // the older "Suggest hashtags…" wording for posts that mention an offer.
  hashtags: ({ text, platform }) =>
    `You help small businesses with their social media.\n` +
    `Pick 5 to 8 hashtags that fit the ${platform || 'social media'} post between the lines. ` +
    `The current year is ${new Date().getFullYear()}; use it in any year-specific hashtag.\n---\n${text}\n---\n` +
    `Reply with the hashtags only, on one line, separated by spaces. Example reply: #yoga #wellness #bangalore`,

  platform_variants: ({ text }) =>
    `Adapt the following post into variants for Twitter, LinkedIn, and Instagram, each respecting that ` +
    `platform's tone and length conventions:\n\n${text}\n\n` +
    `Return each variant labeled with its platform name on its own line.`,
};

const ACTIONS = Object.keys(PROMPTS);

function sourceFromModel(model) {
  for (const p of ['ollama', 'gemini', 'groq', 'openrouter', 'mistral']) {
    if (model.startsWith(p)) return p;
  }
  return 'claude';
}

// `model` is an optional per-request override (e.g. "ollama:llama3.2", "groq");
// `options` carries the user's keys / Ollama settings from injectUserKeys.
// `context`: optional extra instructions (Brand Kit + rules from services/brandContext)
async function assist({ action, text, platform, apiKey, model: modelOverride = null, options = {}, context = '' }) {
  const buildPrompt = PROMPTS[action];
  if (!buildPrompt) throw new Error(`Unknown AI Assist action: ${action}`);

  const prompt = context ? `${context}\n\n${buildPrompt({ text, platform })}` : buildPrompt({ text, platform });
  const { text: resultText, model } = await aiGenerate(prompt, apiKey, 1024, modelOverride, options);
  return { text: resultText, model, source: sourceFromModel(model) };
}

module.exports = { assist, ACTIONS };
