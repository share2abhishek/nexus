// Auto mode: a configured cloud key beats local Ollama (it used to be the other way
// round, so a saved Gemini key was ignored while Ollama was installed).
jest.mock('axios', () => ({
  get: jest.fn(async () => ({ data: { models: [{ name: 'llama3.2:latest' }] } })),
  post: jest.fn(async () => ({ data: { message: { content: 'from ollama' } } })),
}));
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent: async () => ({ response: { text: () => 'from gemini' } }) }),
  })),
}));

const { aiGenerate } = require('../services/aiHelper');

describe('aiGenerate provider order', () => {
  test('uses Gemini, not Ollama, when a Gemini key is saved', async () => {
    const r = await aiGenerate('hi', 'AIza-LONG-ENOUGH-KEY', 50, null, { ollamaEnabled: true });
    expect(r.text).toBe('from gemini');
    expect(r.model).toMatch(/^gemini:/);
  });

  test('uses Ollama when no cloud key is saved', async () => {
    const r = await aiGenerate('hi', undefined, 50, null, { ollamaEnabled: true });
    expect(r.model).toMatch(/^ollama:/);
  });

  test('uses Ollama first when the person explicitly chose it', async () => {
    const r = await aiGenerate('hi', 'AIza-LONG-ENOUGH-KEY', 50, null, { ollamaEnabled: true, defaultTextModel: 'ollama' });
    expect(r.model).toMatch(/^ollama:/);
  });
});
