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

  hashtags: ({ text, platform }) =>
    `Suggest 5-8 relevant hashtags for this ${platform || 'social media'} post:\n\n${text}\n\n` +
    `Return only the hashtags separated by spaces, with no preamble.`,

  platform_variants: ({ text }) =>
    `Adapt the following post into variants for Twitter, LinkedIn, and Instagram, each respecting that ` +
    `platform's tone and length conventions:\n\n${text}\n\n` +
    `Return each variant labeled with its platform name on its own line.`,
};

const ACTIONS = Object.keys(PROMPTS);

function sourceFromModel(model) {
  if (model.startsWith('ollama:')) return 'ollama';
  if (model.startsWith('gemini')) return 'gemini';
  return 'claude';
}

async function assist({ action, text, platform, apiKey }) {
  const buildPrompt = PROMPTS[action];
  if (!buildPrompt) throw new Error(`Unknown AI Assist action: ${action}`);

  const prompt = buildPrompt({ text, platform });
  const { text: resultText, model } = await aiGenerate(prompt, apiKey);
  return { text: resultText, model, source: sourceFromModel(model) };
}

module.exports = { assist, ACTIONS };
