// Fast knowledge-base answers: instant FAQ replies, smaller AI prompts, caching,
// and (above all) that one business never sees another business's answers.
const { makeTestKnex } = require('./helpers/db');
// Code under test also reaches the app's shared connection (services/knex): point it at the same test database
const mockKnex = makeTestKnex();
jest.mock('../services/knex', () => mockKnex);
const kbr = require('../services/kbRetrieval');
const knowledgeBase = require('../services/knowledgeBase');
const chatbot = require('../services/leadPipeline/chatbot');
const aiHelper = require('../services/aiHelper');

const faq = (question, answer, extra = {}) => ({ question, answer, enabled: true, tags: [], ...extra });

describe('kbRetrieval (unit)', () => {
  test('bestFaq: a close question matches, an unrelated one does not', () => {
    const faqs = [faq('What are your opening hours?', 'We open 9 to 6.'), faq('How much does delivery cost?', 'Delivery is free.')];
    expect(kbr.bestFaq(faqs, 'what are your opening hours').answer).toBe('We open 9 to 6.');
    expect(kbr.bestFaq(faqs, 'Please tell me the delivery cost?').answer).toBe('Delivery is free.');
    expect(kbr.bestFaq(faqs, 'do you sell laptops')).toBeNull();
    // a vague one-word message is left for the AI
    expect(kbr.bestFaq(faqs, 'hours')).toBeNull();
    expect(kbr.bestFaq(faqs, '')).toBeNull();
  });

  test('bestFaq ignores disabled-style empty lists', () => {
    expect(kbr.bestFaq([], 'opening hours')).toBeNull();
    expect(kbr.bestFaq(undefined, 'opening hours')).toBeNull();
  });

  test('selectContext: keeps everything when small, picks the related parts when large', () => {
    const small = [{ title: 'A', text: 'Alpha text' }, { title: 'B', text: 'Beta text' }];
    expect(kbr.selectContext(small, 'anything')).toBe('Alpha text\n\nBeta text');

    const filler = 'x'.repeat(900);
    const big = [
      { title: 'Overview', text: 'Overview: we sell tea.', core: true },
      { title: 'Pricing', text: `Pricing: tea costs 50 rupees. ${filler}` },
      { title: 'Hours', text: `Hours: open 9 to 6. ${filler}` },
      { title: 'Delivery', text: `Delivery: free over 500. ${filler}` },
      { title: 'Returns', text: `Returns: 7 days. ${filler}` },
    ];
    const out = kbr.selectContext(big, 'what is the pricing of tea', 2000);
    expect(out).toContain('tea costs 50 rupees');
    expect(out).not.toContain('open 9 to 6');
    expect(out.length).toBeLessThanOrEqual(2000);
  });

  test('answer cache: same question reused, different business or notes never shared', () => {
    kbr._reset();
    const a = kbr.answerKey(1, 'v1', 'facts', 'What is the price?');
    kbr.setCachedAnswer(a, 'Business 1 answer');
    expect(kbr.getCachedAnswer(kbr.answerKey(1, 'v1', 'facts', 'what is the price'))).toBe('Business 1 answer');
    expect(kbr.getCachedAnswer(kbr.answerKey('1', 'v1', 'facts', 'what is the price'))).toBe('Business 1 answer');
    expect(kbr.getCachedAnswer(kbr.answerKey(2, 'v1', 'facts', 'what is the price'))).toBeNull();
    expect(kbr.getCachedAnswer(kbr.answerKey(1, 'v2', 'facts', 'what is the price'))).toBeNull();
    expect(kbr.getCachedAnswer(kbr.answerKey(1, 'v1', 'other facts', 'what is the price'))).toBeNull();
    // no business id → never cached
    expect(kbr.answerKey(null, 'v1', 'facts', 'hello there')).toBeNull();
  });
});

describe('splitNotes (organise pasted notes into sections)', () => {
  test('splits at headings and keeps the text under each', () => {
    const text = [
      'Welcome to our project, a calm place to live.',
      '',
      'Flooring-',
      'Living, Dining, Drawing Room → 800 × 1600 mm Vitrified',
      'Master Bedroom → Wooden Flooring',
      '',
      'Doors-',
      'Door Type → Wooden Door with Wooden Frame',
      'Lock → Mortise Lock',
      '',
      'WINDOWS',
      'Window Type → 3 Track Aluminium / UPVC Sliding Window',
    ].join('\n');
    const s = knowledgeBase.splitNotes(text);
    expect(s.map(x => x.title)).toEqual(['Overview', 'Flooring', 'Doors', 'WINDOWS']);
    expect(s[1].content).toContain('Master Bedroom → Wooden Flooring');
    expect(s[2].content).not.toContain('Flooring');
  });

  test('text without headings is cut at blank lines into pieces', () => {
    const para = 'Sentence about the product. '.repeat(30).trim(); // ~840 chars
    const s = knowledgeBase.splitNotes([para, para, para].join('\n\n'));
    expect(s.length).toBeGreaterThan(1);
    expect(s.every(x => x.title && x.content)).toBe(true);
  });

  test('empty text gives nothing; very long sections and counts are capped', () => {
    expect(knowledgeBase.splitNotes('   ')).toEqual([]);
    const long = knowledgeBase.splitNotes('Big:\n' + 'word '.repeat(3000));
    expect(long.length).toBeGreaterThan(1);
    expect(long.every(x => x.content.length <= 5000)).toBe(true);
    const many = knowledgeBase.splitNotes(Array.from({ length: 80 }, (_, i) => `Heading ${i}:\nSome content for section number ${i}.`).join('\n'));
    expect(many.length).toBeLessThanOrEqual(50);
  });
});

describe('kbRetrieval with the bot (two businesses)', () => {
  let knex, ws1, ws2, gen;
  const cfg = () => chatbot.normalizeConfig(chatbot.DEFAULT_CONFIG);

  beforeAll(async () => {
    jest.spyOn(require('../services/entitlements'), 'canPublish').mockResolvedValue(true);
    gen = jest.spyOn(aiHelper, 'aiGenerate').mockImplementation(async (prompt) => ({ text: 'AI says hello', model: 'mock' }));
    knex = mockKnex;
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'Tenant Corp', owner_user_id: 1 }).returning('id');
    const orgId = org?.id ?? org;
    const mk = async (slug) => { const [w] = await knex('workspaces').insert({ org_id: orgId, name: slug, slug }).returning('id'); return w?.id ?? w; };
    ws1 = await mk('tenant-one');
    ws2 = await mk('tenant-two');

    await knowledgeBase.saveKnowledgeBase(knex, ws1, 1, {
      faqs: [faq('What are your opening hours?', 'ONE: we open 9 to 6.')],
      facts: { pricing_plans: 'ONE pricing: 100 rupees.' },
    });
    await knowledgeBase.saveKnowledgeBase(knex, ws2, 1, {
      faqs: [faq('What are your opening hours?', 'TWO: we open 10 to 8.')],
      facts: { pricing_plans: 'TWO pricing: 900 rupees.' },
    });
  });
  beforeEach(() => { kbr._reset(); gen.mockClear(); require('../services/aiQuota')._reset(); });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });

  test('a saved FAQ is answered instantly with no AI call, from the right business', async () => {
    const a1 = await chatbot.aiAnswer(knex, ws1, 1, cfg(), { text: 'what are your opening hours', name: 'A', business: 'One' });
    const a2 = await chatbot.aiAnswer(knex, ws2, 1, cfg(), { text: 'what are your opening hours', name: 'B', business: 'Two' });
    expect(a1).toBe('ONE: we open 9 to 6.');
    expect(a2).toBe('TWO: we open 10 to 8.');
    expect(gen).not.toHaveBeenCalled();
  });

  test('the AI prompt only contains the asking business’s notes', async () => {
    await chatbot.aiAnswer(knex, ws1, 1, cfg(), { text: 'tell me about pricing please', name: 'A', business: 'One' });
    await chatbot.aiAnswer(knex, ws2, 1, cfg(), { text: 'tell me about pricing please', name: 'B', business: 'Two' });
    expect(gen).toHaveBeenCalledTimes(2); // same words, different businesses: not shared
    const [p1, p2] = gen.mock.calls.map(c => c[0]);
    expect(p1).toContain('ONE pricing');
    expect(p1).not.toContain('TWO');
    expect(p2).toContain('TWO pricing');
    expect(p2).not.toContain('ONE');
  });

  test('a repeated question is answered from the cache, and a save clears it', async () => {
    const msg = { text: 'tell me about pricing please', name: 'A', business: 'One' };
    expect(await chatbot.aiAnswer(knex, ws1, 1, cfg(), msg)).toBe('AI says hello');
    expect(await chatbot.aiAnswer(knex, ws1, 1, cfg(), msg)).toBe('AI says hello');
    expect(gen).toHaveBeenCalledTimes(1);

    await knowledgeBase.saveKnowledgeBase(knex, ws1, 1, { faqs: [], facts: { pricing_plans: 'ONE pricing: 150 rupees.' } });
    await chatbot.aiAnswer(knex, ws1, 1, cfg(), msg);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(gen.mock.calls[1][0]).toContain('150 rupees');
  });

  test('saving one business leaves the other business’s cached notes alone', async () => {
    await chatbot.aiAnswer(knex, ws2, 1, cfg(), { text: 'tell me about pricing please', name: 'B', business: 'Two' });
    expect(gen).toHaveBeenCalledTimes(1);
    kbr.invalidate(ws1);
    await chatbot.aiAnswer(knex, ws2, 1, cfg(), { text: 'tell me about pricing please', name: 'B', business: 'Two' });
    expect(gen).toHaveBeenCalledTimes(1); // still cached for business two
  });
});
