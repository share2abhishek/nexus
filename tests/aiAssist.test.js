jest.mock('../services/aiHelper', () => ({ aiGenerate: jest.fn() }));
const { aiGenerate } = require('../services/aiHelper');
const aiAssist = require('../services/aiAssist');

describe('aiAssist.assist', () => {
  beforeEach(() => {
    aiGenerate.mockReset();
  });

  test('builds a "generate" prompt that includes the brief and platform, derives source "ollama"', async () => {
    aiGenerate.mockResolvedValue({ text: 'Generated post copy', model: 'ollama:llama3.2' });

    const result = await aiAssist.assist({ action: 'generate', text: 'announce our product launch', platform: 'linkedin', apiKey: 'gkey' });

    expect(aiGenerate).toHaveBeenCalledTimes(1);
    const [prompt, apiKey] = aiGenerate.mock.calls[0];
    expect(prompt).toEqual(expect.stringContaining('linkedin'));
    expect(prompt).toEqual(expect.stringContaining('announce our product launch'));
    expect(apiKey).toBe('gkey');
    expect(result).toEqual({ text: 'Generated post copy', model: 'ollama:llama3.2', source: 'ollama' });
  });

  test('derives source "gemini" from a gemini model string', async () => {
    aiGenerate.mockResolvedValue({ text: 'Rewritten copy', model: 'gemini-1.5-flash' });
    const result = await aiAssist.assist({ action: 'rewrite', text: 'original draft text', platform: 'twitter', apiKey: 'gkey' });
    expect(result.source).toBe('gemini');
  });

  test('derives source "claude" from any other model string', async () => {
    aiGenerate.mockResolvedValue({ text: 'Shortened copy', model: 'claude-3-5-sonnet-20241022' });
    const result = await aiAssist.assist({ action: 'shorten', text: 'a much longer post body to trim down', platform: 'twitter', apiKey: 'gkey' });
    expect(result.source).toBe('claude');
  });

  test('"shorten" prompt mentions character limits, "hashtags" prompt asks for hashtags', async () => {
    aiGenerate.mockResolvedValue({ text: 'short', model: 'gemini-1.5-flash' });
    await aiAssist.assist({ action: 'shorten', text: 'long post body', platform: 'twitter', apiKey: 'gkey' });
    expect(aiGenerate.mock.calls[0][0].toLowerCase()).toEqual(expect.stringContaining('character limit'));

    aiGenerate.mockClear();
    aiGenerate.mockResolvedValue({ text: '#launch #product', model: 'gemini-1.5-flash' });
    await aiAssist.assist({ action: 'hashtags', text: 'launching our new product', platform: 'instagram', apiKey: 'gkey' });
    expect(aiGenerate.mock.calls[0][0].toLowerCase()).toEqual(expect.stringContaining('hashtag'));
  });

  test('"platform_variants" prompt asks for multiple platform adaptations without requiring a platform', async () => {
    aiGenerate.mockResolvedValue({ text: 'Twitter: ...\nLinkedIn: ...\nInstagram: ...', model: 'gemini-1.5-flash' });
    const result = await aiAssist.assist({ action: 'platform_variants', text: 'one post to adapt for everywhere', apiKey: 'gkey' });
    expect(aiGenerate.mock.calls[0][0].toLowerCase()).toEqual(expect.stringContaining('variant'));
    expect(result.source).toBe('gemini');
  });

  test('rejects an unknown action without calling aiGenerate', async () => {
    await expect(aiAssist.assist({ action: 'translate', text: 'x', apiKey: 'gkey' }))
      .rejects.toThrow('Unknown AI Assist action: translate');
    expect(aiGenerate).not.toHaveBeenCalled();
  });

  test('exports the list of supported actions', () => {
    expect(aiAssist.ACTIONS).toEqual(['generate', 'rewrite', 'shorten', 'hashtags', 'platform_variants']);
  });
});
