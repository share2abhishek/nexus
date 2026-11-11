// Create Post AI: /api/assist (Improve / Shorter / Hashtags on unsaved text)
// and /api/generate with single:true (one post for all chosen platforms).
const request = require('supertest');
const express = require('express');

jest.mock('../services/knex', () => jest.fn());
jest.mock('../services/license', () => ({ status: () => ({ state: 'active', can_publish: true, limits: {} }) }));
jest.mock('../services/social', () => ({ postToPlatform: jest.fn() }));
global.__brand = {};
jest.mock('../repos/brandKitRepo', () => () => ({ get: async () => global.__brand }));
jest.mock('../repos/historyRepo', () => () => ({ save: async () => {} }));
jest.mock('../services/aiHelper', () => ({ aiGenerate: jest.fn() }));
const { aiGenerate } = require('../services/aiHelper');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: 1 };
    req.workspaceId = 1;
    req.role = 'manager';
    req.googleKey = 'user-key';
    req.ollamaEnabled = false;
    next();
  });
  app.use('/api', require('../routes/api'));
  return app;
}

describe('/api/assist', () => {
  const app = makeApp();
  beforeEach(() => aiGenerate.mockReset());

  test('rewrites text and strips Markdown from the answer', async () => {
    aiGenerate.mockResolvedValue({ text: '**Big** sale today', model: 'gemini-flash' });
    const res = await request(app).post('/api/assist').send({ action: 'rewrite', text: 'sale today', platform: 'linkedin' });
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Big sale today');
    expect(res.body.source).toBe('gemini');
    const [prompt, key, , model, options] = aiGenerate.mock.calls[0];
    expect(prompt).toContain('sale today');
    expect(prompt).toContain('linkedin');
    expect(key).toBe('user-key');
    expect(model).toBeNull();
    expect(options.googleKey).toBe('user-key');
  });

  test('passes the chosen model through', async () => {
    aiGenerate.mockResolvedValue({ text: '#a #b', model: 'ollama:llama3.2' });
    const res = await request(app).post('/api/assist').send({ action: 'hashtags', text: 'hi', model: 'ollama:llama3.2' });
    expect(res.status).toBe(200);
    expect(aiGenerate.mock.calls[0][3]).toBe('ollama:llama3.2');
  });

  test('rejects unknown actions, empty and oversized text without calling the AI', async () => {
    expect((await request(app).post('/api/assist').send({ action: 'platform_variants', text: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/assist').send({ action: 'rewrite', text: '   ' })).status).toBe(400);
    expect((await request(app).post('/api/assist').send({ action: 'rewrite', text: { a: 1 } })).status).toBe(400);
    expect((await request(app).post('/api/assist').send({ action: 'rewrite', text: 'x'.repeat(10001) })).status).toBe(400);
    expect(aiGenerate).not.toHaveBeenCalled();
  });

  test('AI failure returns 502 with the reason', async () => {
    aiGenerate.mockRejectedValue(new Error('No AI configured'));
    const res = await request(app).post('/api/assist').send({ action: 'shorten', text: 'long text' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('No AI configured');
  });
});

describe('/api/generate single:true', () => {
  const app = makeApp();
  beforeEach(() => aiGenerate.mockReset());

  test('writes one post for several platforms (no per-platform split)', async () => {
    aiGenerate.mockResolvedValue({ text: 'One post for everyone', model: 'gemini-flash' });
    const res = await request(app).post('/api/generate')
      .send({ prompt: 'cake offer', platforms: ['linkedin', 'facebook'], single: true });
    expect(res.status).toBe(200);
    expect(res.body.variants).toBeNull();
    expect(res.body.content).toBe('One post for everyone');
    expect(aiGenerate.mock.calls[0][0]).toContain('Write ONE post');
    expect(aiGenerate.mock.calls[0][0]).not.toContain('=== linkedin ===');
  });

  test('with no platform chosen, still asks for exactly one post', async () => {
    aiGenerate.mockResolvedValue({ text: 'One post', model: 'ollama:llama3.2' });
    await request(app).post('/api/generate').send({ prompt: 'chai launch', platforms: [], single: true });
    expect(aiGenerate.mock.calls[0][0]).toContain('Write exactly ONE post');
    expect(aiGenerate.mock.calls[0][0]).toContain('no platform names');
  });

  test('without single, several platforms still get one post each', async () => {
    aiGenerate.mockResolvedValue({ text: '=== linkedin ===\nA\n=== facebook ===\nB', model: 'gemini-flash' });
    const res = await request(app).post('/api/generate')
      .send({ prompt: 'cake offer', platforms: ['linkedin', 'facebook'] });
    expect(res.body.variants).toEqual({ linkedin: 'A', facebook: 'B' });
  });
});

describe('Brand Kit and limits in AI prompts', () => {
  const app = makeApp();
  beforeEach(() => { aiGenerate.mockReset(); global.__brand = { company_name: 'Sweet Crumbs', brand_voice: 'warm and cheerful' }; });
  afterAll(() => { global.__brand = {}; });

  test('Improve uses the brand voice and the no-invented-facts rule', async () => {
    aiGenerate.mockResolvedValue({ text: 'Better', model: 'ollama:llama3.2' });
    await request(app).post('/api/assist').send({ action: 'rewrite', text: 'cakes' });
    const prompt = aiGenerate.mock.calls[0][0];
    expect(prompt).toContain('Brand name: Sweet Crumbs');
    expect(prompt).toContain('do not invent');
  });

  test('hashtags get only the post, not the brand instructions', async () => {
    aiGenerate.mockResolvedValue({ text: '#cake', model: 'ollama:llama3.2' });
    await request(app).post('/api/assist').send({ action: 'hashtags', text: 'cakes' });
    expect(aiGenerate.mock.calls[0][0]).not.toContain('Sweet Crumbs');
  });

  test('one post for Twitter + LinkedIn is asked to stay under 280 characters', async () => {
    aiGenerate.mockResolvedValue({ text: 'Short', model: 'gemini-flash' });
    await request(app).post('/api/generate').send({ prompt: 'x', platforms: ['linkedin', 'twitter'], single: true });
    expect(aiGenerate.mock.calls[0][0]).toContain('under 280 characters');
    expect(aiGenerate.mock.calls[0][0]).toContain('Brand name: Sweet Crumbs');
  });
});
