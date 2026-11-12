// services/brand.js is the one place the app reads a workspace's brand from.
global.__brand = {};
jest.mock('../repos/brandKitRepo', () => () => ({ get: async () => global.__brand }));
jest.mock('../services/knex', () => ({}));
const brand = require('../services/brand');

afterEach(() => { global.__brand = {}; });

describe('brand profile', () => {
  test('fills colours and font with defaults when the kit is empty', async () => {
    const p = await brand.profile(1);
    expect(p).toMatchObject({ company_name: '', primary_color: '#7c3aed', secondary_color: '#3b82f6', accent_color: '#06b6d4', font_name: 'Inter', configured: false });
  });

  test('uses saved values and marks the kit configured', async () => {
    global.__brand = { company_name: 'Chai Point', primary_color: '#0a7', font_name: 'Poppins', logo_url: 'media:4' };
    const p = await brand.profile(1);
    expect(p).toMatchObject({ company_name: 'Chai Point', primary_color: '#0a7', font_name: 'Poppins', logo_url: 'media:4', configured: true });
  });

  test('falls back to Inter for an unknown font', async () => {
    global.__brand = { company_name: 'X', font_name: 'Comic Sans' };
    expect((await brand.profile(1)).font_name).toBe('Inter');
  });
});

describe('brand context (AI copy)', () => {
  test('keeps the exact lines prompts depend on', async () => {
    global.__brand = { company_name: 'Sweet Crumbs', brand_voice: 'warm and cheerful' };
    const text = await brand.context(1);
    expect(text).toContain('Brand name: Sweet Crumbs');
    expect(text).toContain('Brand voice: warm and cheerful');
    expect(text).toContain('do not invent');
    expect(text).toContain('no Markdown');
  });

  test('no BRAND block when nothing is set, but the rules stay', async () => {
    const text = await brand.context(1);
    expect(text).not.toContain('BRAND:');
    expect(text).toContain('do not invent');
  });
});

describe('image prompt style', () => {
  test('empty when the brand kit is not set up', async () => {
    expect(brand.imagePromptStyle(await brand.profile(1))).toBe('');
  });

  test('includes the palette and name, and forbids text/logos, once configured', async () => {
    global.__brand = { company_name: 'Chai Point', primary_color: '#0a7', secondary_color: '#048', accent_color: '#fc0' };
    const s = brand.imagePromptStyle(await brand.profile(1));
    expect(s).toContain('#0a7');
    expect(s).toContain('Chai Point');
    expect(s.toLowerCase()).toContain('do not add');
  });
});
