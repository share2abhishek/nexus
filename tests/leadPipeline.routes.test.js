// tests/leadPipeline.routes.test.js
// Express Route Integration Tests for Lead Pipeline WhatsApp Dual Engine & Meta OBA endpoints:
// - POST /api/lead-pipeline/whatsapp/send (template parameters, body variables)
// - POST /api/lead-pipeline/whatsapp/broadcast (template body variables interpolation)
// - GET /api/lead-pipeline/whatsapp/templates (live template sync from Graph API v21.0)
// - POST /api/lead-pipeline/meta/register-pin & POST /api/lead-pipeline/whatsapp/register-pin (6-digit PIN)
// - GET /api/lead-pipeline/meta/verification-status & GET /api/lead-pipeline/whatsapp/verification-audit (OBA Green Tick status)

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const leadPipelineRepoFactory = require('../repos/leadPipelineRepo');
const whatsappCloud = require('../services/leadPipeline/whatsappCloud');

jest.mock('axios');

describe('Lead Pipeline WhatsApp & Meta OBA Express Route Endpoints', () => {
  let knex;
  let repo;
  let app;
  let workspaceId;
  let orgId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();

    const [org] = await knex('organizations')
      .insert({ name: 'WhatsApp Route Test Org', owner_user_id: 1 })
      .returning('id');
    orgId = org?.id ?? org;

    const [ws] = await knex('workspaces')
      .insert({ org_id: orgId, name: 'WhatsApp Route Workspace', slug: 'wa-route-test' })
      .returning('id');
    workspaceId = ws?.id ?? ws;

    repo = leadPipelineRepoFactory(knex);

    // Seed configuration with permanent token and real default IDs
    await repo.getOrCreateConfig(workspaceId);
    await repo.updateConfig(workspaceId, {
      whatsapp_access_token: 'EAAG_test_permanent_token_123',
      whatsapp_phone_number_id: whatsappCloud.DEFAULT_PHONE_NUMBER_ID, // '1368551949674659'
      whatsapp_business_account_id: whatsappCloud.DEFAULT_WABA_ID, // '2475742706580340'
    });

    const requirePermission = () => (req, res, next) => next();

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.workspaceId = workspaceId;
      req.role = 'owner';
      req.user = { id: 1, name: 'Test Architect' };
      next();
    });
    app.use('/api/lead-pipeline', require('../routes/leadPipeline')(knex, requirePermission));
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    whatsappCloud.clearTemplateCache(whatsappCloud.DEFAULT_WABA_ID);
  });

  // ── 1. POST /api/lead-pipeline/whatsapp/send ────────────────────────────────
  describe('POST /api/lead-pipeline/whatsapp/send', () => {
    test('sends template message with body variables', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.ROUTE_TEST_001' }],
        },
      });

      const res = await request(app)
        .post('/api/lead-pipeline/whatsapp/send')
        .send({
          to: '919637000102',
          template_name: 'maintenance_invoice_ready',
          language_code: 'en_US',
          template_params: ['Anil Deshmukh', '₹3,200'],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result.message_id).toBe('wamid.ROUTE_TEST_001');

      // Verify Graph API v21.0 payload
      expect(axios.post).toHaveBeenCalledWith(
        `https://graph.facebook.com/v21.0/${whatsappCloud.DEFAULT_PHONE_NUMBER_ID}/messages`,
        expect.objectContaining({
          type: 'template',
          template: expect.objectContaining({
            name: 'maintenance_invoice_ready',
            language: { code: 'en_US' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'Anil Deshmukh' },
                  { type: 'text', text: '₹3,200' },
                ],
              },
            ],
          }),
        }),
        expect.any(Object)
      );
    });
  });

  // ── 2. POST /api/lead-pipeline/whatsapp/broadcast ───────────────────────────
  describe('POST /api/lead-pipeline/whatsapp/broadcast', () => {
    test('interpolates contact body variables for template broadcast', async () => {
      axios.post
        .mockResolvedValueOnce({
          status: 200,
          data: { messages: [{ id: 'wamid.BC_01' }] },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: { messages: [{ id: 'wamid.BC_02' }] },
        });

      const res = await request(app)
        .post('/api/lead-pipeline/whatsapp/broadcast')
        .send({
          contacts: [
            { name: 'Dr. Rajesh Sharma', phone: '919822001122', society: 'Palm Meadows' },
            { name: 'Sunil Kulkarni', phone: '919833445566', society: 'Greenfield Heights' },
          ],
          template_name: 'society_demo_outreach',
          language_code: 'en_US',
          template_params: ['{{name}}', '{{society}}'],
          delay_ms: 0,
        });

      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(2);
      expect(res.body.failed).toBe(0);

      // Verify first contact call
      expect(axios.post).toHaveBeenNthCalledWith(
        1,
        `https://graph.facebook.com/v21.0/${whatsappCloud.DEFAULT_PHONE_NUMBER_ID}/messages`,
        expect.objectContaining({
          template: expect.objectContaining({
            name: 'society_demo_outreach',
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'Dr. Rajesh Sharma' },
                  { type: 'text', text: 'Palm Meadows' },
                ],
              },
            ],
          }),
        }),
        expect.any(Object)
      );

      // Verify second contact call
      expect(axios.post).toHaveBeenNthCalledWith(
        2,
        `https://graph.facebook.com/v21.0/${whatsappCloud.DEFAULT_PHONE_NUMBER_ID}/messages`,
        expect.objectContaining({
          template: expect.objectContaining({
            name: 'society_demo_outreach',
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'Sunil Kulkarni' },
                  { type: 'text', text: 'Greenfield Heights' },
                ],
              },
            ],
          }),
        }),
        expect.any(Object)
      );
    });
  });

  // ── 3. GET /api/lead-pipeline/whatsapp/templates ────────────────────────────
  describe('GET /api/lead-pipeline/whatsapp/templates', () => {
    test('returns live synchronized approved templates from Graph API v21.0', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          data: [
            {
              id: 't_001',
              name: 'rwa_committee_connect',
              status: 'APPROVED',
              category: 'UTILITY',
              language: 'en_US',
              components: [
                { type: 'BODY', text: 'Hello {{1}}, how can Urban Society assist {{2}} today?' },
              ],
            },
          ],
        },
      });

      const res = await request(app).get('/api/lead-pipeline/whatsapp/templates');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.templates).toHaveLength(1);
      expect(res.body.templates[0].name).toBe('rwa_committee_connect');
      expect(res.body.templates[0].has_variables).toBe(true);
      expect(res.body.templates[0].variable_count).toBe(2);
    });
  });

  // ── 4. POST /meta/register-pin & POST /whatsapp/register-pin ────────────────
  describe('POST /api/lead-pipeline/meta/register-pin & alias', () => {
    test('registers 6-digit PIN and updates config flag', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { success: true },
      });

      const res = await request(app)
        .post('/api/lead-pipeline/meta/register-pin')
        .send({ pin: '963700' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(axios.post).toHaveBeenCalledWith(
        `https://graph.facebook.com/v21.0/${whatsappCloud.DEFAULT_PHONE_NUMBER_ID}/register`,
        { messaging_product: 'whatsapp', pin: '963700' },
        expect.any(Object)
      );

      // Verify config updated in repo
      const updatedCfg = await repo.getOrCreateConfig(workspaceId);
      expect(updatedCfg.meta_two_step_pin_set).toBe(1);
    });

    test('alias POST /api/lead-pipeline/whatsapp/register-pin functions identically', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { success: true },
      });

      const res = await request(app)
        .post('/api/lead-pipeline/whatsapp/register-pin')
        .send({ pin: '654321' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── 5. GET /meta/verification-status & GET /whatsapp/verification-audit ─────
  describe('GET /api/lead-pipeline/meta/verification-status & alias', () => {
    test('returns official business account audit with Green Tick status', async () => {
      axios.get
        .mockResolvedValueOnce({
          status: 200,
          data: {
            verified_name: 'Urban Society',
            display_phone_number: '+91 96370 00102',
            quality_rating: 'GREEN',
            name_status: 'APPROVED',
            code_verification_status: 'VERIFIED',
            is_official_business_account: true,
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: whatsappCloud.DEFAULT_WABA_ID,
            business_verification_status: 'verified',
          },
        });

      const res = await request(app).get('/api/lead-pipeline/meta/verification-status');

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.is_oba).toBe(true);
      expect(res.body.checklist.oba_badge_status).toBe('VERIFIED_OFFICIAL_BUSINESS_ACCOUNT');
      expect(res.body.checklist.two_step_verification).toBe('COMPLETED');
      expect(res.body.checklist.business_legal_verification).toBe('VERIFIED');
    });

    test('alias GET /api/lead-pipeline/whatsapp/verification-audit works identically', async () => {
      axios.get
        .mockResolvedValueOnce({
          status: 200,
          data: {
            verified_name: 'Urban Society',
            display_phone_number: '+91 96370 00102',
            quality_rating: 'GREEN',
            name_status: 'APPROVED',
            code_verification_status: 'VERIFIED',
            is_official_business_account: false,
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: whatsappCloud.DEFAULT_WABA_ID,
            business_verification_status: 'verified',
          },
        });

      const res = await request(app).get('/api/lead-pipeline/whatsapp/verification-audit');

      expect(res.status).toBe(200);
      expect(res.body.is_oba).toBe(false);
      expect(res.body.checklist.oba_badge_status).toBe('SUBMISSION_READY');
    });
  });
});
