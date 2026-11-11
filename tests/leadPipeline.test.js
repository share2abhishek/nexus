// tests/leadPipeline.test.js
// End-to-End Functional & Integration Tests for Pipeline 1:
// Incoming Ad Leads & Click-to-Messenger (Safe & Fully Automated with n8n & Chatwoot)

const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const leadPipelineRepoFactory = require('../repos/leadPipelineRepo');
const {
  verifyMetaSignature,
  parseMetaFieldData,
  fetchMetaLeadDetails,
} = require('../services/leadPipeline/metaWebhook');
const { qualifyLead } = require('../services/leadPipeline/leadQualifier');
const { forwardToN8n } = require('../services/leadPipeline/n8nForwarder');
const { testChatwootConnection, syncContactToChatwoot } = require('../services/leadPipeline/chatwootClient');

jest.mock('axios');

describe('Pipeline 1: Incoming Ad Leads & Messenger Ingestion', () => {
  let knex;
  let repo;
  let workspaceId;
  let orgId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();

    // Setup base organization and workspace
    const [org] = await knex('organizations')
      .insert({ name: 'Lead Pipeline Test Org', owner_user_id: 1 })
      .returning('id');
    orgId = org?.id ?? org;

    const [ws] = await knex('workspaces')
      .insert({ org_id: orgId, name: 'Lead Pipeline Workspace', slug: 'lead-test' })
      .returning('id');
    workspaceId = ws?.id ?? ws;

    repo = leadPipelineRepoFactory(knex);
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
  });

  // ── 1. Meta Webhook Security & Parsing ────────────────────────────────────
  describe('1. Meta Webhook & Signature Verification', () => {
    test('verifyMetaSignature validates matching HMAC-SHA256 signature', () => {
      const crypto = require('crypto');
      const secret = 'my_fb_app_secret_12345';
      const body = JSON.stringify({ object: 'page', entry: [] });
      const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyMetaSignature(body, `sha256=${hmac}`, secret)).toBe(true);
      expect(verifyMetaSignature(body, 'sha256=invalid_hash', secret)).toBe(false);
      expect(verifyMetaSignature(body, null, secret)).toBe(false);
      expect(verifyMetaSignature(body, null, null)).toBe(true); // skips if no secret configured
    });

    test('parseMetaFieldData accurately maps Lead Ad fields', () => {
      const fieldData = [
        { name: 'full_name', values: ['Sunil Kulkarni'] },
        { name: 'email', values: ['sunil@kulkarnigroup.in'] },
        { name: 'phone_number', values: ['+919822001122'] },
        { name: 'apartment_complex', values: ['Greenfield Heights'] },
        { name: 'total_units', values: ['450'] },
      ];

      const parsed = parseMetaFieldData(fieldData);
      expect(parsed.full_name).toBe('Sunil Kulkarni');
      expect(parsed.email).toBe('sunil@kulkarnigroup.in');
      expect(parsed.phone_number).toBe('+919822001122');
      expect(parsed.custom_answers['apartment_complex']).toBe('Greenfield Heights');
      expect(parsed.custom_answers['total_units']).toBe('450');
    });

    test('fetchMetaLeadDetails queries Meta Graph API and returns typed lead', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          id: 'leadgen_123456789',
          created_time: '2026-11-08T10:00:00+0000',
          ad_id: 'ad_999',
          form_id: 'form_888',
          page_id: '520186977848285',
          field_data: [
            { name: 'full_name', values: ['Ananya Sen'] },
            { name: 'email', values: ['ananya@society.org'] },
            { name: 'phone_number', values: ['+919988776655'] },
          ],
        },
      });

      const lead = await fetchMetaLeadDetails('leadgen_123456789', 'EAAX_mock_page_token');
      expect(lead.leadgen_id).toBe('leadgen_123456789');
      expect(lead.full_name).toBe('Ananya Sen');
      expect(lead.email).toBe('ananya@society.org');
      expect(lead.phone_number).toBe('+919988776655');
    });
  });

  // ── 2. AI Lead Qualification ──────────────────────────────────────────────
  describe('2. AI Lead Qualification & Instant Reply', () => {
    test('qualifyLead calculates lead score and drafts reply', async () => {
      const leadInput = {
        full_name: 'Harish Mehta',
        email: 'harish@mehtabuilders.in',
        phone_number: '+919833445566',
        custom_answers: {
          'Community Size': '500+ Flats',
          'Urgency': 'Immediate onboarding needed',
        },
      };

      const result = await qualifyLead(leadInput);
      expect(result.score).toBeGreaterThanOrEqual(60);
      expect(result.intent_summary).toBeDefined();
      expect(result.suggested_reply).toContain('Harish');
    });
  });

  // ── 3. n8n Automation Node Forwarder ──────────────────────────────────────
  describe('3. n8n Automation Forwarder', () => {
    test('forwardToN8n dispatches payload with custom event header', async () => {
      axios.post.mockResolvedValueOnce({ status: 200, data: { ok: true } });

      const res = await forwardToN8n('https://n8n.radixile.com/webhook/meta-leads', {
        event: 'lead.created',
        full_name: 'Harish Mehta',
        phone_number: '+919833445566',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe(200);
      expect(axios.post).toHaveBeenCalledWith(
        'https://n8n.radixile.com/webhook/meta-leads',
        expect.objectContaining({ full_name: 'Harish Mehta' }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Social-Nexus-Event': 'lead.created' }),
        })
      );
    });

    test('forwardToN8n safely skips when URL is null', async () => {
      const res = await forwardToN8n(null, { event: 'lead.created' });
      expect(res.success).toBe(false);
      expect(res.skipped).toBe(true);
    });
  });

  // ── 4. Chatwoot CRM / Inbox Integration ───────────────────────────────────
  describe('4. Chatwoot CRM & Shared Inbox', () => {
    test('testChatwootConnection verifies account connectivity', async () => {
      axios.create.mockReturnValue({
        get: jest.fn().mockResolvedValueOnce({ data: { id: 1, name: 'Urban Society Support' } }),
      });

      const res = await testChatwootConnection({
        chatwoot_url: 'https://app.chatwoot.com',
        chatwoot_api_token: 'valid_token_xyz',
        chatwoot_account_id: 1,
      });

      expect(res.success).toBe(true);
      expect(res.account_name).toBe('Urban Society Support');
    });

    test('syncContactToChatwoot creates contact and conversation in inbox', async () => {
      const mockPost = jest.fn()
        .mockResolvedValueOnce({ data: { id: 101, name: 'Deepak Verma' } }) // contacts
        .mockResolvedValueOnce({ data: { id: 501 } }); // conversation

      axios.create.mockReturnValue({ post: mockPost });

      const config = {
        chatwoot_url: 'https://app.chatwoot.com',
        chatwoot_api_token: 'valid_token_xyz',
        chatwoot_account_id: 1,
        chatwoot_inbox_id: 2,
      };

      const lead = {
        full_name: 'Deepak Verma',
        email: 'deepak@verma.in',
        phone_number: '+919876500000',
        intent_summary: 'Wants automated maintenance billing',
      };

      const res = await syncContactToChatwoot(config, lead);
      expect(res.success).toBe(true);
      expect(res.contact_id).toBe(101);
      expect(res.conversation_id).toBe(501);
    });
  });

  // ── 5. Repository Entity Lifecycle & Stats ────────────────────────────────
  describe('5. Database Repository Lifecycle', () => {
    test('getOrCreateConfig creates default config with verify_token', async () => {
      const cfg = await repo.getOrCreateConfig(workspaceId);
      expect(cfg.workspace_id).toBe(workspaceId);
      expect(cfg.verify_token).toMatch(/^meta_lead_/);
      expect(cfg.auto_qualify_ai).toBe(1);
    });

    test('updateConfig saves n8n and Chatwoot settings', async () => {
      const updated = await repo.updateConfig(workspaceId, {
        n8n_webhook_url: 'https://n8n.radixile.com/webhook/test',
        chatwoot_url: 'https://chatwoot.radixile.com',
        chatwoot_account_id: 5,
        chatwoot_inbox_id: 10,
        page_id: '520186977848285',
      });

      expect(updated.n8n_webhook_url).toBe('https://n8n.radixile.com/webhook/test');
      expect(updated.chatwoot_account_id).toBe(5);
      expect(updated.chatwoot_inbox_id).toBe(10);
      expect(updated.page_id).toBe('520186977848285');
    });

    test('addLeadEvent saves lead with custom answers and score', async () => {
      const lead = await repo.addLeadEvent(workspaceId, {
        leadgen_id: 'leadgen_test_001',
        full_name: 'Pooja Agarwal',
        email: 'pooja@agarwalhomes.com',
        phone_number: '+919811002233',
        raw_answers_json: { 'Flat Count': '120 Units' },
        lead_score: 88,
        intent_summary: 'High-intent residential lead',
        suggested_reply: 'Hi Pooja, lets connect for a quick demo.',
      });

      expect(lead.id).toBeDefined();
      expect(lead.full_name).toBe('Pooja Agarwal');
      expect(lead.lead_score).toBe(88);
      expect(lead.raw_answers['Flat Count']).toBe('120 Units');
      expect(lead.status).toBe('new');
    });

    test('addMessengerEvent records Click-to-Messenger interaction', async () => {
      const msg = await repo.addMessengerEvent(workspaceId, {
        page_id: '520186977848285',
        sender_id: 'psid_user_9988',
        message_id: 'mid.123',
        message_text: 'Hello, what are your pricing plans?',
      });

      expect(msg.id).toBeDefined();
      expect(msg.sender_id).toBe('psid_user_9988');
      expect(msg.message_text).toBe('Hello, what are your pricing plans?');
    });

    test('getStats reports aggregate pipeline counts', async () => {
      const stats = await repo.getStats(workspaceId);
      expect(stats.total_leads).toBeGreaterThanOrEqual(1);
      expect(stats.hot_leads).toBeGreaterThanOrEqual(1);
      expect(stats.messenger_conversations).toBeGreaterThanOrEqual(1);
    });
  });
});
