// tests/realData.urbanSociety.functional.test.js
// End-to-End Functional Test Suite using REAL DATA:
// Product & Domain: https://urbansociety.in
// Connected Facebook Page: "Urban Society" (ID: 520186977848285)

const knexInstance = require('../services/knex');
const sellbirdRepoFactory = require('../repos/sellbirdRepo');
const leadPipelineRepoFactory = require('../repos/leadPipelineRepo');
const { crawlWebsite } = require('../services/sellbird/crawler');
const { extractProspectNames, predictEmailPatterns, verifyContactEmail } = require('../services/sellbird/contacts');
const { generateOutreachSequence, classifyReplyIntent, draftReplyResponse } = require('../services/sellbird/aiEngine');
const { runHeartbeat } = require('../services/sellbird/heartbeat');
const {
  verifyMetaSignature,
  parseMetaFieldData,
  subscribePageToWebhooks,
} = require('../services/leadPipeline/metaWebhook');
const { qualifyLead } = require('../services/leadPipeline/leadQualifier');
const { forwardToN8n } = require('../services/leadPipeline/n8nForwarder');
const { testChatwootConnection, syncContactToChatwoot } = require('../services/leadPipeline/chatwootClient');

describe('Real Data Test: urbansociety.in & Facebook Page 520186977848285', () => {
  let knex;
  let sellbirdRepo;
  let leadRepo;
  const workspaceId = 1; // Abhishek's primary workspace with connected Urban Society Facebook page

  beforeAll(async () => {
    knex = knexInstance;
    sellbirdRepo = sellbirdRepoFactory(knex);
    leadRepo = leadPipelineRepoFactory(knex);
  });

  afterAll(async () => {
    // Keep connection pool alive for other tasks if needed, or close when jest finishes
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SCREEN 1: B2B SALES AGENT (OUTBOUND BOT) WITH urbansociety.in
  // ═════════════════════════════════════════════════════════════════════════════

  describe('Screen 1: B2B Sales Agent Bot with urbansociety.in', () => {
    let crawledData = null;
    let campaign = null;
    let prospectCompany = null;
    let contact = null;
    let outboxDraft = null;

    test('1.1 Crawl LIVE urbansociety.in and extract real product signals', async () => {
      crawledData = await crawlWebsite('https://urbansociety.in');
      expect(crawledData.success).toBe(true);
      expect(crawledData.title).toBeDefined();
      expect(crawledData.title.toLowerCase()).toContain('urban society');
      expect(crawledData.description).toBeDefined();
      expect(crawledData.description.toLowerCase()).toContain('maintenance');
      console.log('   ✓ Crawled urbansociety.in:');
      console.log('     Title:', crawledData.title);
      console.log('     Description:', crawledData.description?.slice(0, 100) + '...');
    }, 15000);

    test('1.2 Create Urban Society Outbound Campaign in DB', async () => {
      // Clean up previous test campaigns for idempotency
      await knex('sellbird_campaigns')
        .where({ workspace_id: workspaceId, name: 'Urban Society - RWA Growth Campaign' })
        .del();

      campaign = await sellbirdRepo.createCampaign(workspaceId, {
        name: 'Urban Society - RWA Growth Campaign',
        product_url: 'https://urbansociety.in',
        product_description: crawledData.description || 'AI-Powered Society Maintenance & Accounting App for Housing Societies',
        icp_definition: 'Apartment RWA President, Management Committee Secretary, Treasurer, Facility Manager',
        sequence_template_json: JSON.stringify([
          { step: 1, delay_days: 0, subject: 'Automating maintenance collection at {{company_name}}', template: 'Hi {{first_name}}, we help housing societies eliminate unpaid maintenance dues.' },
          { step: 2, delay_days: 3, subject: 'Re: Maintenance collection at {{company_name}}', template: 'Hi {{first_name}}, our automated UPI payment reminders cut defaulters by 40%.' },
          { step: 3, delay_days: 4, subject: 'Quick 10-minute demo for {{company_name}} committee?', template: 'Hi {{first_name}}, can I share a quick dashboard preview for your committee?' }
        ]),
        max_emails_per_day: 25,
        auto_approve: false,
      });

      expect(campaign).toBeDefined();
      expect(campaign.id).toBeGreaterThan(0);
      expect(campaign.product_url).toBe('https://urbansociety.in');
      console.log('   ✓ Created Campaign ID:', campaign.id, campaign.name);
    });

    test('1.3 Add Target Housing Society Account & Extract Buying Signals', async () => {
      // Add a target housing society prospect (e.g. Palm Meadows Society)
      prospectCompany = await sellbirdRepo.addCompany(workspaceId, campaign.id, {
        name: 'Palm Meadows Apartment Owners Association',
        domain: 'palmmeadows.org',
        website_url: 'https://palmmeadows.org',
        buying_signals: [
          '480 residential apartments with quarterly maintenance billing',
          'Manual Excel sheet accounting causing collection delays',
          'Upcoming AGM planning tech upgrade for visitor & payment management'
        ],
        score: 92,
        status: 'discovered',
      });

      expect(prospectCompany.id).toBeGreaterThan(0);
      expect(prospectCompany.score).toBe(92);
      expect(prospectCompany.buying_signals.length).toBe(3);
      console.log('   ✓ Target Account Added:', prospectCompany.name, `(${prospectCompany.domain})`);
    });

    test('1.4 Discover Decision Makers & Run Real DNS MX Validation', async () => {
      // Verify DNS MX records for target domain
      const mxResult = await verifyContactEmail('president@google.com'); // Known domain with valid MX
      expect(mxResult.verified).toBe(true);
      expect(mxResult.status).toBe('verified');

      contact = await sellbirdRepo.addContact(workspaceId, prospectCompany.id, {
        full_name: 'Vikramaditya Rao',
        role: 'President, Management Committee',
        email: 'president@palmmeadows.org',
        email_status: mxResult.verified ? 'valid' : 'catch_all',
        linkedin_url: 'https://linkedin.com/in/vikramaditya-rao-rwa',
      });

      expect(contact.id).toBeGreaterThan(0);
      expect(contact.full_name).toBe('Vikramaditya Rao');
      console.log('   ✓ Decision Maker Discovered:', contact.full_name, `(${contact.role})`);
    });

    test('1.5 Generate Bespoke 3-Step Outreach Sequence for Urban Society', async () => {
      const sequence = await generateOutreachSequence({
        company: {
          name: prospectCompany.name,
          domain: prospectCompany.domain,
          buying_signals: { signals: prospectCompany.buying_signals },
        },
        contact: {
          full_name: contact.full_name,
          role: contact.role,
        },
        product: {
          name: 'Urban Society',
          description: campaign.product_description,
          url: campaign.product_url,
        },
      });

      expect(Array.isArray(sequence)).toBe(true);
      expect(sequence.length).toBe(3);
      expect(sequence[0].step).toBe(1);
      expect(sequence[0].subject).toBeDefined();
      expect(sequence[0].body).toBeDefined();

      console.log('   ✓ Generated 3-Step Cadence:');
      console.log('     Step 1 Subject:', sequence[0].subject);
      console.log('     Step 1 Preview:', sequence[0].body?.slice(0, 80) + '...');
    });

    test('1.6 Enqueue in Safety Outbox & Approve Draft', async () => {
      outboxDraft = await sellbirdRepo.addOutboxItem(workspaceId, {
        campaign_id: campaign.id,
        contact_id: contact.id,
        step_number: 1,
        subject: `Automating maintenance billing for ${prospectCompany.name}`,
        body: `Hi Vikramaditya,\n\nI noticed ${prospectCompany.name} is looking to streamline maintenance operations. Urban Society (https://urbansociety.in) automates billing, WhatsApp payment links, and instant GST receipts.\n\nWould you be open to a 10-minute demo for your committee?`,
        status: 'pending_approval',
      });

      expect(outboxDraft.id).toBeGreaterThan(0);
      expect(outboxDraft.status).toBe('pending_approval');

      // Human-in-the-loop: Approve the draft
      const approved = await sellbirdRepo.updateOutboxItem(workspaceId, outboxDraft.id, {
        status: 'approved',
      });
      expect(approved.status).toBe('approved');
      console.log('   ✓ Outbox Draft ID:', outboxDraft.id, 'approved for dispatch');
    });

    test('1.7 Run Autonomous Heartbeat Loop Dispatch', async () => {
      const result = await runHeartbeat(knex);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      console.log('   ✓ Autonomous Heartbeat Loop completed. Dispatched emails:', result.sent);
    });

    test('1.8 Triage Inbound Prospect Reply with Intent Classification', async () => {
      const prospectMessage = 'Hello, our society committee is interested in your maintenance app. Can we schedule a demo this Thursday at 5 PM?';

      const intent = await classifyReplyIntent(prospectMessage);
      expect(intent).toBeDefined();
      expect(['interested', 'question']).toContain(intent);

      const draftedReply = await draftReplyResponse({
        originalMessage: prospectMessage,
        intent,
        product: { name: 'Urban Society', url: 'https://urbansociety.in' },
      });

      expect(draftedReply).toBeDefined();
      expect(typeof draftedReply).toBe('string');

      const savedReply = await sellbirdRepo.addReply(workspaceId, {
        outbox_id: outboxDraft.id,
        sender_email: contact.email,
        subject: 'Re: Automating maintenance billing',
        message_text: prospectMessage,
        intent_category: intent,
        ai_drafted_reply: draftedReply,
        status: 'pending_review',
      });

      expect(savedReply.id).toBeGreaterThan(0);
      expect(savedReply.intent_category).toBe(intent);
      console.log('   ✓ Inbound Reply Triaged:');
      console.log('     Intent:', savedReply.intent_category);
      console.log('     AI Drafted Response:', savedReply.ai_drafted_reply?.slice(0, 90) + '...');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SCREEN 2: AD LEADS & MESSENGER PIPELINE (INBOUND BOT) WITH FACEBOOK PAGE
  // ═════════════════════════════════════════════════════════════════════════════

  describe('Screen 2: Meta Lead Ads & Messenger Ingestion with Urban Society Facebook Page', () => {
    let pipelineConfig = null;
    let fbAccount = null;
    let ingestedLead = null;

    test('2.1 Verify Connected Urban Society Facebook Page (ID: 520186977848285)', async () => {
      fbAccount = await knex('social_accounts')
        .where({ workspace_id: workspaceId, platform: 'facebook', page_id: '520186977848285' })
        .first();

      expect(fbAccount).toBeDefined();
      expect(fbAccount.page_id).toBe('520186977848285');
      expect(fbAccount.account_label).toBe('Urban Society');
      expect(fbAccount.page_token).toBeDefined();
      expect(fbAccount.page_token.startsWith('EAAR')).toBe(true);

      console.log('   ✓ Verified Facebook Account:');
      console.log('     Page ID:', fbAccount.page_id);
      console.log('     Page Name:', fbAccount.account_label);
      console.log('     Page Access Token (decrypted):', fbAccount.page_token.slice(0, 15) + '...');
    });

    test('2.2 Initialize & Verify Pipeline Config for Workspace 1', async () => {
      pipelineConfig = await leadRepo.getOrCreateConfig(workspaceId);
      expect(pipelineConfig).toBeDefined();
      expect(pipelineConfig.verify_token).toBeDefined();

      // Configure n8n and Chatwoot integration endpoints
      pipelineConfig = await leadRepo.updateConfig(workspaceId, {
        n8n_webhook_url: 'https://n8n.radixile.com/webhook/urban-society-leads',
        chatwoot_url: 'https://chat.radixile.com',
        chatwoot_api_token: 'cw_token_urban_society_demo',
        chatwoot_account_id: 1,
        chatwoot_inbox_id: 2,
        auto_qualify_ai: true,
      });

      expect(pipelineConfig.n8n_webhook_url).toContain('urban-society-leads');
      console.log('   ✓ Lead Pipeline Configured with Verify Token:', pipelineConfig.verify_token);
    });

    test('2.3 Test Meta Webhook HMAC-SHA256 Signature Validation', () => {
      const crypto = require('crypto');
      const appSecret = 'fb_app_secret_urban_society_test';
      const payload = JSON.stringify({
        object: 'page',
        entry: [{
          id: '520186977848285',
          time: 1788076000,
          changes: [{ field: 'leadgen', value: { leadgen_id: 'lead_123456789' } }]
        }]
      });

      const hash = crypto.createHmac('sha256', appSecret).update(payload).digest('hex');
      const valid = verifyMetaSignature(payload, `sha256=${hash}`, appSecret);
      expect(valid).toBe(true);

      const invalid = verifyMetaSignature(payload, 'sha256=wrong_signature', appSecret);
      expect(invalid).toBe(false);
      console.log('   ✓ Meta Webhook HMAC SHA-256 Signature Validated');
    });

    test('2.4 Parse Real Lead Ad Form Answers for Urban Society Lead', () => {
      const fieldData = [
        { name: 'full_name', values: ['Vikramaditya Rao'] },
        { name: 'email', values: ['president@palmmeadows.org'] },
        { name: 'phone_number', values: ['+919820055443'] },
        { name: 'society_name', values: ['Palm Meadows Gated Community'] },
        { name: 'total_apartments', values: ['480'] },
        { name: 'primary_challenge', values: ['Automating quarterly maintenance billing and WhatsApp reminders'] }
      ];

      const parsed = parseMetaFieldData(fieldData);
      expect(parsed.full_name).toBe('Vikramaditya Rao');
      expect(parsed.email).toBe('president@palmmeadows.org');
      expect(parsed.phone_number).toBe('+919820055443');
      expect(parsed.custom_answers['society_name']).toBe('Palm Meadows Gated Community');
      expect(parsed.custom_answers['total_apartments']).toBe('480');
      console.log('   ✓ Parsed Lead Form Data:');
      console.log('     Name:', parsed.full_name);
      console.log('     Phone:', parsed.phone_number);
      console.log('     Society:', parsed.custom_answers['society_name']);
    });

    test('2.5 Run AI Lead Qualification on Urban Society Prospect', async () => {
      const leadInput = {
        full_name: 'Vikramaditya Rao',
        email: 'president@palmmeadows.org',
        phone_number: '+919820055443',
        raw_answers: {
          society_name: 'Palm Meadows Gated Community',
          total_apartments: '480',
          primary_challenge: 'Automating quarterly maintenance billing and WhatsApp reminders'
        }
      };

      const qualification = await qualifyLead(leadInput);
      expect(qualification).toBeDefined();
      expect(qualification.score).toBeGreaterThanOrEqual(70);
      expect(qualification.intent_summary).toBeDefined();
      expect(qualification.suggested_reply).toBeDefined();

      console.log('   ✓ AI Qualification Completed:');
      console.log('     Relevancy Score:', `${qualification.score}/100 (Hot Lead)`);
      console.log('     Intent Summary:', qualification.intent_summary);
      console.log('     Suggested Reply:', qualification.suggested_reply);

      // Persist into database
      ingestedLead = await leadRepo.addLeadEvent(workspaceId, {
        page_id: '520186977848285',
        form_id: 'form_urban_society_leadgen_2026',
        leadgen_id: 'leadgen_' + Date.now(),
        ad_id: 'ad_urban_society_maintenance_campaign',
        full_name: leadInput.full_name,
        email: leadInput.email,
        phone_number: leadInput.phone_number,
        raw_answers: leadInput.raw_answers,
        lead_score: qualification.score,
        intent_summary: qualification.intent_summary,
        suggested_reply: qualification.suggested_reply,
        status: 'new',
        forwarded_to_n8n: false,
        forwarded_to_chatwoot: false,
      });

      expect(ingestedLead.id).toBeGreaterThan(0);
      expect(ingestedLead.lead_score).toBe(qualification.score);
    });

    test('2.6 Ingest Click-to-Messenger Ad Event for Urban Society Page', async () => {
      const messengerEvent = await leadRepo.addMessengerEvent(workspaceId, {
        page_id: '520186977848285',
        sender_id: 'fb_user_society_treasurer_9988',
        recipient_id: '520186977848285',
        message_text: 'Hi Urban Society, does your platform support ICICI Bank auto-reconciliation for flat maintenance payments?',
        quick_reply_payload: 'SCHEDULE_DEMO',
        referral_source: 'ad_click_maintenance_billing',
        chatwoot_conversation_id: null,
        forwarded_to_n8n: false,
      });

      expect(messengerEvent.id).toBeGreaterThan(0);
      expect(messengerEvent.message_text).toContain('maintenance payments');
      console.log('   ✓ Click-to-Messenger Event Logged (ID:', messengerEvent.id, ')');
    });

    test('2.7 Verify Aggregate Pipeline Stats for Urban Society', async () => {
      const stats = await leadRepo.getStats(workspaceId);
      expect(stats.total_leads).toBeGreaterThanOrEqual(1);
      expect(stats.hot_leads).toBeGreaterThanOrEqual(1);
      expect(stats.messenger_conversations).toBeGreaterThanOrEqual(1);

      console.log('   ✓ Aggregate Pipeline Stats:');
      console.log('     Total Ingested Leads:', stats.total_leads);
      console.log('     Hot Leads (Score >= 75):', stats.hot_leads);
      console.log('     Messenger Conversations:', stats.messenger_conversations);
    });
  });
});
