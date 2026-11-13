// tests/whatsappCloud.test.js
// Automated Unit & Integration Tests for Meta WhatsApp Business Cloud API v21.0:
// 1. Meta WhatsApp Error #132001 Resolution ("Template name does not exist in the translation")
// 2. Component Parameters & Body Variables ({{1}}, {{2}})
// 3. Template Language Codes (en_US, en, hi, mr, gu, ta, te, etc.)
// 4. No built-in Phone Number ID / WABA ID: each business uses its own
// 5. 2-Step Verification PIN Registration (POST /{phone-number-id}/register with 6-digit PIN)
// 6. Official Business Account (OBA / Green Tick) Verification Status Audit

const axios = require('axios');
const whatsappCloud = require('../services/leadPipeline/whatsappCloud');

jest.mock('axios');

describe('Meta WhatsApp Cloud API & Template Architecture', () => {
  const MOCK_TOKEN = 'EAAG_mock_permanent_token_xyz_12345';
  const MOCK_PHONE_ID = '111122223333444';
  const MOCK_WABA_ID = '555566667777888';

  beforeEach(() => {
    jest.clearAllMocks();
    whatsappCloud.clearTemplateCache(MOCK_WABA_ID);
  });

  // ── 1. Default Phone Profile & WABA Constants ──────────────────────────────
  describe('1. Default Identifiers & Graph API Target', () => {
    test('verifies real phone profile ID and WABA ID constants', () => {
      // No other business's number or account is built in
      expect(whatsappCloud.DEFAULT_PHONE_NUMBER_ID).toBe('');
      expect(whatsappCloud.DEFAULT_WABA_ID).toBe('');
      expect(whatsappCloud.DEFAULT_TEST_RECIPIENT).toBe('');
      expect(whatsappCloud.GRAPH_API_VERSION).toBe('v21.0');
      expect(whatsappCloud.GRAPH_BASE_URL).toBe('https://graph.facebook.com/v21.0');
    });

    test('normalizes template language codes accurately', () => {
      expect(whatsappCloud.normalizeLanguageCode('en_US')).toBe('en_US');
      expect(whatsappCloud.normalizeLanguageCode('en-US')).toBe('en_US');
      expect(whatsappCloud.normalizeLanguageCode('en')).toBe('en');
      expect(whatsappCloud.normalizeLanguageCode('hi-IN')).toBe('hi');
      expect(whatsappCloud.normalizeLanguageCode('mr-IN')).toBe('mr');
      expect(whatsappCloud.normalizeLanguageCode('gu-IN')).toBe('gu');
      expect(whatsappCloud.normalizeLanguageCode('ta-IN')).toBe('ta');
      expect(whatsappCloud.normalizeLanguageCode('te-IN')).toBe('te');
      expect(whatsappCloud.normalizeLanguageCode(null)).toBe('en_US');
    });
  });

  // ── 2. Component Parameters & Body Variables ───────────────────────────────
  describe('2. Template Component Parameters & Body Variables ({{1}}, {{2}})', () => {
    test('formatComponentParameters converts primitive values to Meta parameter objects', () => {
      const params = ['Dr. Rajesh Sharma', 'Palm Meadows'];
      const formatted = whatsappCloud.formatComponentParameters(params);

      expect(formatted).toEqual([
        { type: 'text', text: 'Dr. Rajesh Sharma' },
        { type: 'text', text: 'Palm Meadows' },
      ]);
    });

    test('formatComponentParameters handles indexed objects { 1: val, 2: val }', () => {
      const params = { '2': '450 Units', '1': 'Sunil Kulkarni' };
      const formatted = whatsappCloud.formatComponentParameters(params);

      // Must be sorted in numeric placeholder order: 1, 2
      expect(formatted).toEqual([
        { type: 'text', text: 'Sunil Kulkarni' },
        { type: 'text', text: '450 Units' },
      ]);
    });

    test('buildTemplateComponents generates body component for {{1}}, {{2}} variables', () => {
      const components = whatsappCloud.buildTemplateComponents({
        templateParams: ['Sunil Kulkarni', 'Greenfield Heights'],
      });

      expect(components).toEqual([
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Sunil Kulkarni' },
            { type: 'text', text: 'Greenfield Heights' },
          ],
        },
      ]);
    });

    test('buildTemplateComponents supports structured { header, body } parameters', () => {
      const components = whatsappCloud.buildTemplateComponents({
        templateParams: {
          header: ['Monthly Maintenance Due'],
          body: ['Flat 402', '₹4,500.00'],
        },
      });

      expect(components).toEqual([
        {
          type: 'header',
          parameters: [{ type: 'text', text: 'Monthly Maintenance Due' }],
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Flat 402' },
            { type: 'text', text: '₹4,500.00' },
          ],
        },
      ]);
    });

    test('sendWhatsAppMessage dispatches body variables to Graph API v21.0', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          messaging_product: 'whatsapp',
          contacts: [{ input: '919637000102', wa_id: '919637000102' }],
          messages: [{ id: 'wamid.HBgLM...==' }],
        },
      });

      const res = await whatsappCloud.sendWhatsAppMessage({
        phoneNumberId: MOCK_PHONE_ID,
        wabaId: MOCK_WABA_ID,
        accessToken: MOCK_TOKEN,
        to: '919637000102',
        templateName: 'society_billing_reminder',
        languageCode: 'en_US',
        templateParams: ['Vikramaditya', 'Palm Meadows'],
      });

      expect(res.success).toBe(true);
      expect(res.mode).toBe('cloud_api');
      expect(res.message_id).toBe('wamid.HBgLM...==');

      expect(axios.post).toHaveBeenCalledWith(
        `https://graph.facebook.com/v21.0/${MOCK_PHONE_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '919637000102',
          type: 'template',
          template: {
            name: 'society_billing_reminder',
            language: { code: 'en_US' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'Vikramaditya' },
                  { type: 'text', text: 'Palm Meadows' },
                ],
              },
            ],
          },
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_TOKEN}`,
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    test('sendWhatsAppMessage forces en_US and omits components for hello_world', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.HELLO123' }],
        },
      });

      const res = await whatsappCloud.sendWhatsAppMessage({
        phoneNumberId: MOCK_PHONE_ID,
        wabaId: MOCK_WABA_ID,
        accessToken: MOCK_TOKEN,
        to: '919637000102',
        templateName: 'hello_world',
        languageCode: 'en', // User mistakenly selected generic 'en'
        templateParams: ['ignored'],
      });

      expect(res.success).toBe(true);
      expect(axios.post).toHaveBeenCalledWith(
        `https://graph.facebook.com/v21.0/${MOCK_PHONE_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '919637000102',
          type: 'template',
          template: {
            name: 'hello_world',
            language: { code: 'en_US' },
          },
        },
        expect.any(Object)
      );
    });
  });

  // ── 3. Resolution of Meta Error #132001 ─────────────────────────────────────
  describe('3. Resolution of Meta WhatsApp Error #132001 ("Template name does not exist in the translation")', () => {
    test('auto-heals #132001 by falling back from en_US to en when template was approved in en', async () => {
      // First attempt with en_US fails with error 132001
      axios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            error: {
              message: '(#132001) Template name does not exist in the translation',
              type: 'OAuthException',
              code: 132001,
              error_subcode: 2388044,
            },
          },
        },
      });

      // Second attempt with fallback 'en' succeeds!
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.AUTO_HEALED_EN' }],
        },
      });

      const res = await whatsappCloud.sendWhatsAppMessage({
        phoneNumberId: MOCK_PHONE_ID,
        wabaId: MOCK_WABA_ID,
        accessToken: MOCK_TOKEN,
        to: '919637000102',
        templateName: 'urban_society_welcome',
        languageCode: 'en_US',
        templateParams: ['Sunil Kulkarni'],
      });

      expect(res.success).toBe(true);
      expect(res.auto_healed_132001).toBe(true);
      expect(res.original_language).toBe('en_US');
      expect(res.resolved_language).toBe('en');
      expect(res.message_id).toBe('wamid.AUTO_HEALED_EN');
    });

    test('auto-heals #132001 using live template synchronization from Graph API v21.0', async () => {
      // First dispatch attempt with 'hi' fails with #132001
      axios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            error: {
              message: '(#132001) Template name does not exist in the translation',
              type: 'OAuthException',
              code: 132001,
            },
          },
        },
      });

      // Live template sync GET call returns the template is actually registered as 'mr' (Marathi)
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          data: [
            {
              id: 't_999',
              name: 'marathi_welcome',
              status: 'APPROVED',
              language: 'mr',
              components: [{ type: 'BODY', text: 'नमस्कार {{1}}' }],
            },
          ],
        },
      });

      // Retry dispatch using live-synced language 'mr' succeeds!
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.SYNC_HEALED_MR' }],
        },
      });

      const res = await whatsappCloud.sendWhatsAppMessage({
        phoneNumberId: MOCK_PHONE_ID,
        wabaId: MOCK_WABA_ID,
        accessToken: MOCK_TOKEN,
        to: '919637000102',
        templateName: 'marathi_welcome',
        languageCode: 'hi',
        templateParams: ['अभिष्ट'],
      });

      expect(res.success).toBe(true);
      expect(res.auto_healed_132001).toBe(true);
      expect(res.resolved_language).toBe('mr');
      expect(res.message_id).toBe('wamid.SYNC_HEALED_MR');
    });

    test('preemptively adopts approved language from template cache to avoid #132001', async () => {
      // Seed template cache with 'hi' approved template
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          data: [
            {
              id: 't_123',
              name: 'society_announcement',
              status: 'APPROVED',
              language: 'hi',
              components: [{ type: 'BODY', text: 'नमस्ते {{1}}' }],
            },
          ],
        },
      });
      await whatsappCloud.getMessageTemplates(MOCK_WABA_ID, MOCK_TOKEN);

      // Now dispatch: user asked for en_US, but cache has 'hi'
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          messages: [{ id: 'wamid.PREEMPTIVE_HI' }],
        },
      });

      const res = await whatsappCloud.sendWhatsAppMessage({
        phoneNumberId: MOCK_PHONE_ID,
        wabaId: MOCK_WABA_ID,
        accessToken: MOCK_TOKEN,
        to: '919637000102',
        templateName: 'society_announcement',
        languageCode: 'en_US',
        templateParams: ['रमेश'],
      });

      expect(res.success).toBe(true);
      expect(res.language).toBe('hi'); // Preemptively adapted to 'hi'
      expect(res.message_id).toBe('wamid.PREEMPTIVE_HI');
    });

    test('gracefully generates fallback WhatsApp Web bridge if all translation fallbacks fail', async () => {
      // Dispatch fails with error 132001
      axios.post.mockRejectedValue({
        response: {
          status: 400,
          data: {
            error: {
              message: '(#132001) Template name does not exist in the translation',
              code: 132001,
            },
          },
        },
      });

      // Live sync returns no matching templates
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: { data: [] },
      });

      const res = await whatsappCloud.sendWhatsAppMessage({
        phoneNumberId: MOCK_PHONE_ID,
        wabaId: MOCK_WABA_ID,
        accessToken: MOCK_TOKEN,
        to: '919637000102',
        templateName: 'completely_nonexistent_template',
        languageCode: 'en_US',
      });

      expect(res.success).toBe(false);
      expect(res.mode).toBe('fallback_bridge');
      expect(res.error_code).toBe(132001);
      expect(res.translation_error).toBe(true);
      expect(res.bridge_url).toContain('https://wa.me/919637000102');
    });
  });

  // ── 3b. Resolution of Meta Error #132000 (Parameter Count Mismatch) ───────────
  describe('3b. Resolution of Meta WhatsApp Error #132000 ("Number of parameters does not match")', () => {
    test('autoFillTemplateComponents populates positional parameters from template example schema', () => {
      const tmpl = {
        name: 'transaction_message',
        language: 'en',
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'Account Update:' },
          {
            type: 'BODY',
            text: 'Society: {{1}}\nTxn: {{2}}\nAmount: Rs. {{3}}',
            example: { body_text: [['Namrata Gloria', '173121', '4950.00']] },
          },
        ],
      };
      const comps = whatsappCloud.autoFillTemplateComponents(tmpl, {});
      expect(comps).toHaveLength(1);
      expect(comps[0].type).toBe('body');
      expect(comps[0].parameters).toHaveLength(3);
      expect(comps[0].parameters[0].text).toBe('Namrata Gloria');
      expect(comps[0].parameters[1].text).toBe('173121');
      expect(comps[0].parameters[2].text).toBe('4950.00');
    });

    test('auto-heals #132000 by auto-resolving parameters from live template schema', async () => {
      // First call fails with #132000
      axios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            error: {
              message: '(#132000) Number of parameters does not match the expected number of params',
              code: 132000,
            },
          },
        },
      });

      // Live template fetch returns the template definition with examples
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          data: [
            {
              id: '1414451677531294',
              name: 'transaction_message',
              status: 'APPROVED',
              language: 'en',
              components: [
                {
                  type: 'BODY',
                  text: 'Society: {{1}}\nTxn: {{2}}',
                  example: { body_text: [['Namrata Gloria', '173121']] },
                },
              ],
            },
          ],
        },
      });

      // Second post succeeds with auto-filled parameters!
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.AUTO_HEALED_132000' }],
        },
      });

      const res = await whatsappCloud.sendWhatsAppMessage({
        phoneNumberId: MOCK_PHONE_ID,
        wabaId: MOCK_WABA_ID,
        accessToken: MOCK_TOKEN,
        to: '918149498945',
        templateName: 'transaction_message',
        languageCode: 'en',
      });

      expect(res.success).toBe(true);
      expect(res.auto_healed_132000).toBe(true);
      expect(res.message_id).toBe('wamid.AUTO_HEALED_132000');
    });
  });

  // ── 4. Live Template Synchronization (getMessageTemplates) ─────────────────
  describe('4. Live Template Synchronization (getMessageTemplates)', () => {
    test('fetches and enriches approved templates from Graph API v21.0', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          data: [
            {
              id: 'tmpl_101',
              name: 'demo_scheduled',
              status: 'APPROVED',
              category: 'UTILITY',
              language: 'en_US',
              components: [
                { type: 'HEADER', text: 'Urban Society Demo' },
                { type: 'BODY', text: 'Hi {{1}}, your demo for {{2}} is confirmed.' },
                { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Confirm' }] },
              ],
            },
          ],
        },
      });

      const res = await whatsappCloud.getMessageTemplates(MOCK_WABA_ID, MOCK_TOKEN);
      expect(res.success).toBe(true);
      expect(res.count).toBe(1);

      const t = res.templates[0];
      expect(t.name).toBe('demo_scheduled');
      expect(t.status).toBe('APPROVED');
      expect(t.language).toBe('en_US');
      expect(t.has_variables).toBe(true);
      expect(t.variable_count).toBe(2);
      expect(t.variable_placeholders).toEqual(['{{1}}', '{{2}}']);
      expect(t.header_text).toBe('Urban Society Demo');
    });

    test('returns cached templates without extra API call within TTL', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          data: [{ id: 'tmpl_cached', name: 'cached_test', status: 'APPROVED', language: 'en' }],
        },
      });

      const res1 = await whatsappCloud.getMessageTemplates(MOCK_WABA_ID, MOCK_TOKEN);
      expect(res1.success).toBe(true);
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Second call should return cached
      const res2 = await whatsappCloud.getMessageTemplates(MOCK_WABA_ID, MOCK_TOKEN);
      expect(res2.success).toBe(true);
      expect(res2.cached).toBe(true);
      expect(axios.get).toHaveBeenCalledTimes(1);
    });
  });

  // ── 5. Step 6: 2-Step PIN Registration (POST /register) ────────────────────
  describe('5. Step 6: 2-Step Verification PIN Registration', () => {
    test('registers 6-digit PIN via POST /{phone-number-id}/register', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { success: true },
      });

      const res = await whatsappCloud.registerTwoStepPin(MOCK_PHONE_ID, MOCK_TOKEN, '963700');

      expect(res.success).toBe(true);
      expect(res.phone_number_id).toBe(MOCK_PHONE_ID);
      expect(axios.post).toHaveBeenCalledWith(
        `https://graph.facebook.com/v21.0/${MOCK_PHONE_ID}/register`,
        {
          messaging_product: 'whatsapp',
          pin: '963700',
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_TOKEN}`,
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    test('validates PIN is strictly 6 numeric digits', async () => {
      expect((await whatsappCloud.registerTwoStepPin(MOCK_PHONE_ID, MOCK_TOKEN, '12345')).success).toBe(false);
      expect((await whatsappCloud.registerTwoStepPin(MOCK_PHONE_ID, MOCK_TOKEN, '1234567')).success).toBe(false);
      expect((await whatsappCloud.registerTwoStepPin(MOCK_PHONE_ID, MOCK_TOKEN, 'abcdef')).success).toBe(false);
      expect((await whatsappCloud.registerTwoStepPin(MOCK_PHONE_ID, MOCK_TOKEN, '')).success).toBe(false);
      expect((await whatsappCloud.registerTwoStepPin(MOCK_PHONE_ID, null, '123456')).success).toBe(false);
    });

    test('captures and formats Meta Graph API registration errors', async () => {
      axios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            error: {
              message: 'Invalid parameter: pin must be numeric',
              code: 100,
              error_subcode: 2388001,
            },
          },
        },
      });

      const res = await whatsappCloud.registerTwoStepPin(MOCK_PHONE_ID, MOCK_TOKEN, '999999');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid parameter: pin must be numeric');
      expect(res.error_code).toBe(100);
    });
  });

  // ── 6. Step 7: Official Business Account (OBA) Audit ───────────────────────
  describe('6. Official Business Account (OBA / Blue/Green Tick) Verification Status Audit', () => {
    test('reports verified OBA status when is_official_business_account is true', async () => {
      axios.get
        // Phone profile call
        .mockResolvedValueOnce({
          status: 200,
          data: {
            verified_name: 'Urban Society',
            display_phone_number: '+91 96370 00102',
            quality_rating: 'GREEN',
            name_status: 'APPROVED',
            code_verification_status: 'VERIFIED',
            messaging_limit_tier: 'TIER_10K',
            is_official_business_account: true,
            account_mode: 'LIVE',
          },
        })
        // WABA profile call
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: MOCK_WABA_ID,
            name: 'Urban Society Business',
            account_review_status: 'APPROVED',
            business_verification_status: 'verified',
          },
        });

      const audit = await whatsappCloud.getVerificationAudit(MOCK_PHONE_ID, MOCK_WABA_ID, MOCK_TOKEN);

      expect(audit.configured).toBe(true);
      expect(audit.phone_id).toBe(MOCK_PHONE_ID);
      expect(audit.waba_id).toBe(MOCK_WABA_ID);
      expect(audit.is_oba).toBe(true);
      expect(audit.oba_badge_status).toBe('VERIFIED');
      expect(audit.checklist.two_step_verification).toBe('COMPLETED');
      expect(audit.checklist.business_legal_verification).toBe('VERIFIED');
      expect(audit.checklist.oba_badge_status).toBe('VERIFIED_OFFICIAL_BUSINESS_ACCOUNT');
    });

    test('reports submission ready when business legal verified but badge pending', async () => {
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
            id: MOCK_WABA_ID,
            business_verification_status: 'verified',
          },
        });

      const audit = await whatsappCloud.getVerificationAudit(MOCK_PHONE_ID, MOCK_WABA_ID, MOCK_TOKEN);

      expect(audit.is_oba).toBe(false);
      expect(audit.checklist.business_legal_verification).toBe('VERIFIED');
      expect(audit.checklist.two_step_verification).toBe('COMPLETED');
      expect(audit.checklist.oba_badge_status).toBe('SUBMISSION_READY');
    });

    test('returns configured: false when access token is missing', async () => {
      const audit = await whatsappCloud.getVerificationAudit(MOCK_PHONE_ID, MOCK_WABA_ID, null);
      expect(audit.configured).toBe(false);
      expect(audit.error).toBe('Access Token not provided');
    });
  });
});
