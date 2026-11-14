// Unit and API integration tests for AI Chat Knowledge Base
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const knowledgeBase = require('../services/knowledgeBase');
const chatbot = require('../services/leadPipeline/chatbot');
const aiHelper = require('../services/aiHelper');

describe('AI Chat Knowledge Base', () => {
  let knex, app, workspaceId, userId = 1;

  beforeAll(async () => {
    jest.spyOn(require('../services/entitlements'), 'canPublish').mockResolvedValue(true);
    jest.spyOn(aiHelper, 'aiGenerate').mockImplementation(async (prompt) => {
      if (prompt.includes('valid JSON array of objects')) {
        return {
          text: JSON.stringify([
            { category: 'Pricing', question: 'What is the cost?', answer: 'Rates start at 10 INR.', tags: ['pricing', 'cost'] },
            { category: 'General', question: 'Where are you?', answer: 'We are in Pune.', tags: ['location', 'address'] },
            { category: 'Support', question: 'How to contact?', answer: 'Call our support desk.', tags: ['support', 'contact'] },
          ]),
          model: 'mock-ai-test',
        };
      }
      return { text: 'Thank you for your question! We are happy to help you with our services.', model: 'mock-ai-test' };
    });
    knex = makeTestKnex();
    await knex.migrate.latest();

    // Create org and workspace
    const [org] = await knex('organizations').insert({ name: 'Urban Society Corp', owner_user_id: userId }).returning('id');
    const [ws] = await knex('workspaces').insert({
      org_id: org?.id ?? org,
      name: 'Urban Society',
      slug: 'urban-society',
    }).returning('id');
    workspaceId = ws?.id ?? ws;

    // Create lead config with webchat token
    const repo = require('../repos/leadPipelineRepo')(knex);
    await repo.getOrCreateConfig(workspaceId);

    // Express app setup for API tests
    app = express();
    app.use(express.json());
    // Mock tenancy and permission middleware
    app.use((req, res, next) => {
      req.workspaceId = workspaceId;
      req.session = { userId };
      next();
    });
    const requirePermission = () => (req, res, next) => next();
    app.use('/api/knowledge-base', require('../routes/knowledgeBase')(knex, requirePermission));
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await knex.destroy();
  });

  test('getKnowledgeBase returns default structure with starter FAQs', async () => {
    const kb = await knowledgeBase.getKnowledgeBase(knex, workspaceId);
    expect(kb).toBeDefined();
    expect(kb.persona).toBeDefined();
    expect(kb.persona.tone).toBe('friendly');
    expect(Array.isArray(kb.faqs)).toBe(true);
    expect(kb.faqs.length).toBeGreaterThan(0);
    expect(kb.stats.total_faqs).toBe(kb.faqs.length);
    expect(kb.compiled_knowledge).toContain('FREQUENTLY ASKED QUESTIONS');
  });

  test('compileKnowledge formats facts and active FAQs accurately', () => {
    const compiled = knowledgeBase.compileKnowledge({
      persona: { name: 'Bot' },
      facts: {
        business_summary: 'Premium bakery in Pune',
        pricing_plans: 'Cakes start at 499 INR',
      },
      faqs: [
        { category: 'Pricing', question: 'How much?', answer: '499 INR', enabled: true },
        { category: 'Secret', question: 'Hidden?', answer: 'No', enabled: false },
      ],
      raw_text: 'Eggless options available',
    });

    expect(compiled).toContain('Premium bakery in Pune');
    expect(compiled).toContain('Cakes start at 499 INR');
    expect(compiled).toContain('Q: How much?');
    expect(compiled).toContain('A: 499 INR');
    expect(compiled).not.toContain('Hidden?');
    expect(compiled).toContain('Eggless options available');
  });

  test('saveKnowledgeBase persists to db and syncs with whatsapp_bot_settings', async () => {
    const payload = {
      persona: {
        name: 'Urban Support Pro',
        tone: 'professional',
        response_length: 'concise',
        strictness: 'strict',
        custom_instructions: 'Greet politely with Namaste.',
      },
      facts: {
        business_summary: 'Urban Society provides society management software.',
        pricing_plans: 'Starts at 10 INR per flat per month.',
        hours_locations: 'Mon-Sat 9am to 6pm, Pune.',
      },
      faqs: [
        {
          id: 'faq_test_1',
          category: 'Pricing',
          question: 'What is the monthly maintenance cost?',
          answer: 'It is 10 INR per flat per month.',
          tags: ['maintenance', 'cost', 'flat'],
          enabled: true,
        },
      ],
      raw_text: '24/7 security gate passes are included.',
    };

    const saved = await knowledgeBase.saveKnowledgeBase(knex, workspaceId, userId, payload);
    expect(saved.persona.name).toBe('Urban Support Pro');
    expect(saved.persona.tone).toBe('professional');
    expect(saved.facts.pricing_plans).toBe('Starts at 10 INR per flat per month.');
    expect(saved.faqs.length).toBe(1);

    // Verify sync to whatsapp_bot_settings
    const botRow = await knex('whatsapp_bot_settings').where({ workspace_id: workspaceId }).first();
    expect(botRow).toBeDefined();
    const botCfg = JSON.parse(botRow.config_json);
    expect(botCfg.knowledge).toContain('Urban Society provides society management software.');
    expect(botCfg.knowledge).toContain('10 INR per flat per month');
    expect(botCfg.fallback.mode).toBe('ai');
  });

  test('simulateChat matches FAQs and returns AI response and metrics', async () => {
    const res = await knowledgeBase.simulateChat(knex, workspaceId, userId, {
      message: 'What is the monthly maintenance cost?',
      visitorName: 'Rahul',
    });

    expect(res).toBeDefined();
    expect(res.reply).toBeTruthy();
    expect(res.matched_sources.length).toBeGreaterThan(0);
    expect(res.latency_ms).toBeGreaterThanOrEqual(0);
    expect(res.persona_name).toBe('Urban Support Pro');
  });

  test('aiGenerateFaqs generates structured FAQs', async () => {
    const faqs = await knowledgeBase.aiGenerateFaqs(knex, workspaceId, userId, {
      topic: 'Society Visitor Management',
      count: 3,
    });

    expect(Array.isArray(faqs)).toBe(true);
    expect(faqs.length).toBe(3);
    expect(faqs[0].question).toBeTruthy();
    expect(faqs[0].answer).toBeTruthy();
  });

  // ── API Endpoint Tests ───────────────────────────────────────────────────

  test('API GET /api/knowledge-base returns active knowledge base', async () => {
    const res = await request(app).get('/api/knowledge-base');
    expect(res.status).toBe(200);
    expect(res.body.persona.name).toBe('Urban Support Pro');
    expect(res.body.stats.total_faqs).toBe(1);
    expect(res.body.channels).toBeDefined();
  });

  test('API POST /api/knowledge-base saves and responds with updated data', async () => {
    const res = await request(app).post('/api/knowledge-base').send({
      persona: { name: 'Updated Assistant', tone: 'friendly' },
      facts: { business_summary: 'Updated business summary.' },
      faqs: [
        { category: 'General', question: 'How do I register?', answer: 'Download the app.', enabled: true },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.persona.name).toBe('Updated Assistant');
    expect(res.body.faqs.length).toBe(1);
  });

  test('API POST /api/knowledge-base/simulate executes interactive preview', async () => {
    const res = await request(app).post('/api/knowledge-base/simulate').send({
      message: 'How do I register?',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reply).toBeTruthy();
    expect(Array.isArray(res.body.matched_sources)).toBe(true);
  });

  test('API POST /api/knowledge-base/import adds imported FAQs', async () => {
    const res = await request(app).post('/api/knowledge-base/import').send({
      append: true,
      faqs: [
        { category: 'Billing', question: 'Can I pay via UPI?', answer: 'Yes, UPI is supported.' },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.imported_count).toBe(1);
    expect(res.body.faqs.length).toBe(2);
  });

  test('API GET /api/knowledge-base/export exports as JSON and CSV', async () => {
    const resJson = await request(app).get('/api/knowledge-base/export?format=json');
    expect(resJson.status).toBe(200);
    expect(resJson.headers['content-type']).toContain('application/json');
    expect(resJson.body.faqs.length).toBe(2);

    const resCsv = await request(app).get('/api/knowledge-base/export?format=csv');
    expect(resCsv.status).toBe(200);
    expect(resCsv.headers['content-type']).toContain('text/csv');
    expect(resCsv.text).toContain('Category,Question,Answer,Tags,Enabled');
    expect(resCsv.text).toContain('Can I pay via UPI?');
  });
});
