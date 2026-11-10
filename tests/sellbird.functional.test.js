// tests/sellbird.functional.test.js
// End-to-End Functional, Integration, and UI Tests for Sellbird Autonomous B2B Sales Agent.

const axios = require('axios');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { makeTestKnex } = require('./helpers/db');
const sellbirdRepoFactory = require('../repos/sellbirdRepo');
const { crawlWebsite, cleanText, extractEmails } = require('../services/sellbird/crawler');
const {
  verifyMxRecord,
  isValidEmailSyntax,
  predictEmailPatterns,
  verifyContactEmail,
  extractProspectNames,
} = require('../services/sellbird/contacts');
const {
  generateOutreachSequence,
  classifyReplyIntent,
  draftReplyResponse,
} = require('../services/sellbird/aiEngine');
const { processDueOutbox } = require('../services/sellbird/dispatcher');
const { runHeartbeat } = require('../services/sellbird/heartbeat');

// Mock axios and dns when testing isolated units
jest.mock('axios');

describe('Sellbird Autonomous Sales Agent — Test Suite', () => {
  let knex;
  let repo;
  let workspaceId;
  let orgId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();

    // Setup base organization and workspace
    const [org] = await knex('organizations')
      .insert({ name: 'Sellbird Test Org', owner_user_id: 1 })
      .returning('id');
    orgId = org?.id ?? org;

    const [ws] = await knex('workspaces')
      .insert({ org_id: orgId, name: 'Sellbird Growth Workspace', slug: 'sellbird-test' })
      .returning('id');
    workspaceId = ws?.id ?? ws;

    repo = sellbirdRepoFactory(knex);
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Database Integrity & Schema Validation
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Database Integrity & Schema', () => {
    const tables = [
      'sellbird_campaigns',
      'sellbird_companies',
      'sellbird_contacts',
      'sellbird_outbox',
      'sellbird_replies',
    ];

    test('all 5 Sellbird tables exist in database', async () => {
      for (const table of tables) {
        const exists = await knex.schema.hasTable(table);
        expect(exists).toBe(true);
      }
    });

    test('foreign keys are defined on all child tables', async () => {
      for (const table of tables) {
        const fks = await knex.raw(`PRAGMA foreign_key_list(${table})`);
        expect(fks.length).toBeGreaterThan(0);
        // All tables link back to workspaces with CASCADE
        const wsFk = fks.find((f) => f.table === 'workspaces' && f.from === 'workspace_id');
        expect(wsFk).toBeDefined();
        expect(wsFk.on_delete).toBe('CASCADE');
      }
    });

    test('query performance indexes exist on all tables', async () => {
      for (const table of tables) {
        const indexes = await knex.raw(`PRAGMA index_list(${table})`);
        expect(indexes.length).toBeGreaterThan(0);
      }
    });

    test('cascading deletes clean up child entities properly', async () => {
      // Create campaign, company, contact, outbox
      const camp = await repo.createCampaign(workspaceId, { name: 'Cascade Test' });
      const comp = await repo.addCompany(workspaceId, camp.id, { name: 'Cascade Corp', domain: 'cascade.test' });
      const contact = await repo.addContact(workspaceId, comp.id, { full_name: 'John Cascade', email: 'john@cascade.test' });
      const outbox = await repo.addOutboxItem(workspaceId, {
        campaign_id: camp.id,
        contact_id: contact.id,
        subject: 'Hello',
        body: 'Body',
      });

      // Verify records exist
      expect(await knex('sellbird_companies').where({ id: comp.id }).first()).toBeDefined();
      expect(await knex('sellbird_contacts').where({ id: contact.id }).first()).toBeDefined();
      expect(await knex('sellbird_outbox').where({ id: outbox.id }).first()).toBeDefined();

      // Delete campaign -> should cascade delete companies, contacts, outbox
      await repo.deleteCampaign(workspaceId, camp.id);

      expect(await knex('sellbird_companies').where({ id: comp.id }).first()).toBeUndefined();
      expect(await knex('sellbird_contacts').where({ id: contact.id }).first()).toBeUndefined();
      expect(await knex('sellbird_outbox').where({ id: outbox.id }).first()).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Crawler & Signal Extraction (crawlWebsite)
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Crawler & Buying Signals Extraction', () => {
    test('crawls mocked HTML and extracts metadata, emails, and buying signals', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Acme Smart Housing Solutions</title>
            <meta name="description" content="All-in-one smart community management and automated gate security" />
          </head>
          <body>
            <h1>Automate Your Apartment Society</h1>
            <h3>Modern Digital Payments with Razorpay Integration</h3>
            <p>Careers: We are hiring engineering talent for our gated community platform.</p>
            <p>Full statutory compliance and GDPR certified operations for resident safety.</p>
            <footer>
              <a href="mailto:contact@acmesmarthousing.com">Contact Us</a>
              <span>Support: info@acmesmarthousing.com</span>
            </footer>
          </body>
        </html>
      `;

      axios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await crawlWebsite('https://acmesmarthousing.com');

      expect(result.success).toBe(true);
      expect(result.domain).toBe('acmesmarthousing.com');
      expect(result.title).toBe('Acme Smart Housing Solutions');
      expect(result.description).toBe('All-in-one smart community management and automated gate security');
      expect(result.emails).toEqual(expect.arrayContaining(['contact@acmesmarthousing.com', 'info@acmesmarthousing.com']));
      expect(result.buying_signals.signals).toEqual(
        expect.arrayContaining([
          'Digital Payments Active',
          'Actively Hiring / Growing',
          'Statutory & Compliance Focused',
          'Residential & Community Management',
        ])
      );
      expect(result.buying_signals.headlines).toContain('Modern Digital Payments with Razorpay Integration');
    });

    test('gracefully handles network failures with fallback payload', async () => {
      axios.get.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND unreachable-domain-99.xyz'));

      const result = await crawlWebsite('https://unreachable-domain-99.xyz');

      expect(result.success).toBe(false);
      expect(result.domain).toBe('unreachable-domain-99.xyz');
      expect(result.emails).toEqual([]);
      expect(result.buying_signals.signals).toContain('Domain Identified');
      expect(result.buying_signals.snippet).toContain('ENOTFOUND');
    });

    test('cleanText and extractEmails sanitize input properly', () => {
      expect(cleanText('<p>Hello&nbsp;&amp;&nbsp;World</p>')).toBe('Hello & World');
      const emails = extractEmails('Write to sales@example.org or ceo@target.co, avoid spam@domain.com');
      expect(emails).toEqual(['sales@example.org', 'ceo@target.co']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Contacts & Deliverability Heuristics
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Contacts, Roles, Email Permutations & MX Verification', () => {
    test('extractProspectNames extracts decision maker using regex heuristic', () => {
      const text = 'Founded in 2021 by Vikram Singhania, Managing Director of Acme Housing. Also joined by Priya Patel, Head of Operations.';
      const prospects = extractProspectNames(text, 'acmehousing.com');
      expect(prospects.length).toBeGreaterThanOrEqual(1);
      expect(prospects[0].full_name).toBe('Vikram Singhania');
      expect(prospects[0].role).toBe('Managing Director');
    });

    test('extractProspectNames falls back to domain leadership when no names found', () => {
      const text = 'Generic product description with no executive team mentioned.';
      const prospects = extractProspectNames(text, 'skylineestates.com');
      expect(prospects).toHaveLength(1);
      expect(prospects[0].full_name).toBe('Skylineestates Leadership');
      expect(prospects[0].role).toBe('Decision Maker');
    });

    test('predictEmailPatterns generates standard B2B email permutations', () => {
      const patterns = predictEmailPatterns('Vikram', 'Sharma', 'acmesociety.in');
      expect(patterns).toEqual([
        'vikram.sharma@acmesociety.in',
        'vikram@acmesociety.in',
        'vsharma@acmesociety.in',
        'vikram_sharma@acmesociety.in',
        'sharma.vikram@acmesociety.in',
      ]);

      const singleNamePatterns = predictEmailPatterns('Vikram', '', 'acmesociety.in');
      expect(singleNamePatterns).toContain('vikram@acmesociety.in');
      expect(singleNamePatterns).toContain('contact@acmesociety.in');
    });

    test('verifyContactEmail validates syntax and checks MX', async () => {
      // 1. Invalid syntax
      const badSyntax = await verifyContactEmail('not-an-email');
      expect(badSyntax.verified).toBe(false);
      expect(badSyntax.status).toBe('invalid');

      // 2. Mock DNS MX resolution success
      const resolveSpy = jest.spyOn(dns, 'resolveMx');
      resolveSpy.mockResolvedValueOnce([{ exchange: 'mail.google.com', priority: 10 }]);

      const validMx = await verifyContactEmail('director@activecompany.com');
      expect(validMx.verified).toBe(true);
      expect(validMx.status).toBe('verified');

      // 3. Mock DNS MX failure (dead domain)
      resolveSpy.mockRejectedValueOnce(new Error('queryMx ENOTFOUND deadcompany.xyz'));

      const deadMx = await verifyContactEmail('info@deadcompany.xyz');
      expect(deadMx.verified).toBe(false);
      expect(deadMx.status).toBe('invalid');

      resolveSpy.mockRestore();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. AI Engine: Sequences, Intent Classifier & Responder
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. AI Outreach Engine & Reply Triage', () => {
    test('generateOutreachSequence generates a high-converting 3-step sequence', async () => {
      const payload = {
        product: { name: 'Urban Society', description: 'Smart society ERP & billing', url: 'https://urbansociety.in' },
        company: {
          name: 'Greenfield Residency',
          domain: 'greenfield.org',
          industry: 'Property Management',
          buying_signals: { signals: ['Digital Payments Active', 'Actively Hiring'] },
        },
        contact: { full_name: 'Anil Kumar', role: 'President' },
      };

      const sequence = await generateOutreachSequence(payload, {});

      expect(Array.isArray(sequence)).toBe(true);
      expect(sequence).toHaveLength(3);

      expect(sequence[0]).toMatchObject({
        step: 1,
        delay_days: 0,
        subject: expect.stringContaining('Greenfield Residency'),
      });
      expect(sequence[0].body).toContain('Hi Anil');
      expect(sequence[1].step).toBe(2);
      expect(sequence[2].step).toBe(3);
    });

    test('classifyReplyIntent accurately categorizes replies', async () => {
      const interested = await classifyReplyIntent('Hi! Yes, we are evaluating society tools this quarter. Can we do a 15-minute demo Thursday?');
      expect(interested).toBe('interested');

      const unsubscribe = await classifyReplyIntent('Please unsubscribe us and remove this email from your mailing list.');
      expect(unsubscribe).toBe('unsubscribe');

      const notInterested = await classifyReplyIntent('No thanks, not interested at this moment.');
      expect(notInterested).toBe('not_interested');

      const question = await classifyReplyIntent('What is your pricing model for societies with 300 flats?');
      expect(question).toBe('question');
    });

    test('draftReplyResponse crafts contextual responses based on intent', async () => {
      const interestedReply = await draftReplyResponse({
        originalMessage: 'Sounds good, let us set up a call.',
        intent: 'interested',
        product: { name: 'Urban Society' },
      });
      expect(interestedReply.toLowerCase()).toMatch(/tomorrow|thursday|walkthrough|time/);

      const unsubReply = await draftReplyResponse({
        originalMessage: 'Unsubscribe',
        intent: 'unsubscribe',
        product: { name: 'Urban Society' },
      });
      expect(unsubReply.toLowerCase()).toContain('removed');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Repository End-to-End Operations
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Sellbird Repository Entity Lifecycle & Stats', () => {
    let testCampaign;
    let testCompany;
    let testContact;
    let testOutbox;

    test('createCampaign creates and reads campaign with JSON fields parsed', async () => {
      testCampaign = await repo.createCampaign(workspaceId, {
        name: 'Society Managers Q4',
        product_url: 'https://urbansociety.in',
        product_description: 'Automated society management software',
        icp_definition: { target_roles: ['Secretary', 'Chairman'], city: 'Mumbai' },
        max_emails_per_day: 30,
        auto_approve: false,
      });

      expect(testCampaign.id).toBeDefined();
      expect(testCampaign.name).toBe('Society Managers Q4');
      expect(testCampaign.icp_definition.target_roles).toContain('Secretary');
      expect(testCampaign.max_emails_per_day).toBe(30);
      expect(Boolean(testCampaign.auto_approve)).toBe(false);
    });

    test('addCompany and addContact store targets correctly', async () => {
      testCompany = await repo.addCompany(workspaceId, testCampaign.id, {
        name: 'Palm Meadows Society',
        domain: 'palmmeadows.org',
        buying_signals: { signals: ['Digital Payments Active'] },
        score: 85,
      });

      expect(testCompany.id).toBeDefined();
      expect(testCompany.domain).toBe('palmmeadows.org');
      expect(testCompany.buying_signals.signals).toContain('Digital Payments Active');

      testContact = await repo.addContact(workspaceId, testCompany.id, {
        full_name: 'Rajesh Mehra',
        role: 'Secretary',
        email: 'rajesh@palmmeadows.org',
        email_status: 'verified',
      });

      expect(testContact.id).toBeDefined();
      expect(testContact.email_status).toBe('verified');
    });

    test('addOutboxItem queues pending_approval item and batchApprove updates it', async () => {
      testOutbox = await repo.addOutboxItem(workspaceId, {
        campaign_id: testCampaign.id,
        contact_id: testContact.id,
        step_number: 1,
        subject: 'Palm Meadows Society & Urban Society',
        body: 'Hi Rajesh, would love to connect.',
        status: 'pending_approval',
      });

      expect(testOutbox.id).toBeDefined();
      expect(testOutbox.status).toBe('pending_approval');
      expect(testOutbox.contact_name).toBe('Rajesh Mehra');
      expect(testOutbox.company_name).toBe('Palm Meadows Society');

      // Batch approve
      const approvedCount = await repo.batchApprove(workspaceId, [testOutbox.id]);
      expect(approvedCount).toBe(1);

      const refreshed = await repo.getOutboxItem(workspaceId, testOutbox.id);
      expect(refreshed.status).toBe('approved');
    });

    test('addReply records inbound prospect reply', async () => {
      const reply = await repo.addReply(workspaceId, {
        outbox_id: testOutbox.id,
        sender_email: 'rajesh@palmmeadows.org',
        subject: 'Re: Palm Meadows Society & Urban Society',
        message_text: 'Sounds interesting. Can you send across a brochure and pricing?',
        intent_category: 'interested',
        ai_drafted_reply: 'Hi Rajesh, absolutely! Here is the overview...',
      });

      expect(reply.id).toBeDefined();
      expect(reply.intent_category).toBe('interested');
      expect(reply.sender_email).toBe('rajesh@palmmeadows.org');
    });

    test('getStats returns accurate aggregate counts for workspace', async () => {
      const stats = await repo.getStats(workspaceId);
      expect(stats.total_campaigns).toBeGreaterThanOrEqual(1);
      expect(stats.total_companies).toBeGreaterThanOrEqual(1);
      expect(stats.total_contacts).toBeGreaterThanOrEqual(1);
      expect(stats.verified_contacts).toBeGreaterThanOrEqual(1);
      expect(stats.total_replies).toBeGreaterThanOrEqual(1);
      expect(stats.interested_leads).toBeGreaterThanOrEqual(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Dispatcher & Autonomous Heartbeat
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Safe Dispatcher, Daily Warmup Cap & Opt-out Suppression', () => {
    let camp;
    let comp;
    let contact;

    beforeEach(async () => {
      camp = await repo.createCampaign(workspaceId, {
        name: 'Dispatch Test Campaign',
        max_emails_per_day: 2, // low daily limit for testing
      });
      comp = await repo.addCompany(workspaceId, camp.id, { name: 'Target A', domain: 'target-a.com' });
      contact = await repo.addContact(workspaceId, comp.id, {
        full_name: 'Target Person',
        email: 'person@target-a.com',
        email_status: 'verified',
      });
    });

    test('dispatcher sends approved due email in mock mode and updates status to sent', async () => {
      const now = Math.floor(Date.now() / 1000);
      const outbox = await repo.addOutboxItem(workspaceId, {
        campaign_id: camp.id,
        contact_id: contact.id,
        subject: 'Test Send',
        body: 'Test Body',
        status: 'approved',
        scheduled_at: now - 10, // due
      });

      const result = await processDueOutbox(knex, repo, 10);
      expect(result.sent).toBeGreaterThanOrEqual(1);

      const refreshed = await repo.getOutboxItem(workspaceId, outbox.id);
      expect(refreshed.status).toBe('sent');
      expect(refreshed.sent_at).toBeGreaterThan(0);

      // Verify company status updated to 'contacted'
      const updatedComp = await repo.getCompany(workspaceId, comp.id);
      expect(updatedComp.status).toBe('contacted');
    });

    test('dispatcher respects daily warmup cap and defers remaining emails to tomorrow', async () => {
      const now = Math.floor(Date.now() / 1000);
      const todayStart = now - (now % 86400);

      // Simulate that 2 emails (the daily cap) were already sent today
      await knex('sellbird_outbox').insert([
        {
          campaign_id: camp.id,
          contact_id: contact.id,
          workspace_id: workspaceId,
          subject: 'Already sent 1',
          body: 'body',
          status: 'sent',
          scheduled_at: todayStart + 100,
          sent_at: todayStart + 100,
          created_at: now,
          updated_at: now,
        },
        {
          campaign_id: camp.id,
          contact_id: contact.id,
          workspace_id: workspaceId,
          subject: 'Already sent 2',
          body: 'body',
          status: 'sent',
          scheduled_at: todayStart + 200,
          sent_at: todayStart + 200,
          created_at: now,
          updated_at: now,
        },
      ]);

      // Add a new approved due email
      const newDue = await repo.addOutboxItem(workspaceId, {
        campaign_id: camp.id,
        contact_id: contact.id,
        subject: 'Due Email Over Cap',
        body: 'body',
        status: 'approved',
        scheduled_at: now - 10,
      });

      // Run dispatcher
      await processDueOutbox(knex, repo, 10);

      const deferred = await repo.getOutboxItem(workspaceId, newDue.id);
      // Item was NOT sent and scheduled_at was pushed forward by ~1 day
      expect(deferred.status).toBe('approved');
      expect(deferred.scheduled_at).toBeGreaterThanOrEqual(now + 86000);
    });

    test('dispatcher suppresses delivery for recipients who previously opted out / unsubscribed', async () => {
      const now = Math.floor(Date.now() / 1000);

      // Record an unsubscribe reply for an opted-out prospect
      const optedOutEmail = 'unsub-user@target-a.com';
      await repo.addReply(workspaceId, {
        sender_email: optedOutEmail,
        message_text: 'Stop emailing me, unsubscribe',
        intent_category: 'unsubscribe',
      });

      const optOutContact = await repo.addContact(workspaceId, comp.id, {
        full_name: 'Unsub User',
        email: optedOutEmail,
        email_status: 'verified',
      });

      const dueItem = await repo.addOutboxItem(workspaceId, {
        campaign_id: camp.id,
        contact_id: optOutContact.id,
        subject: 'Follow up',
        body: 'Should be suppressed',
        status: 'approved',
        scheduled_at: now - 10,
      });

      await processDueOutbox(knex, repo, 10);

      const suppressed = await repo.getOutboxItem(workspaceId, dueItem.id);
      expect(suppressed.status).toBe('rejected');
      expect(suppressed.error_message).toContain('opted out or unsubscribed');
    });

    test('heartbeat executes 1 autonomous cycle and reports metrics', async () => {
      const result = await runHeartbeat(knex, { maxBatch: 10 });
      expect(result.success).toBe(true);
      expect(result.timestamp).toBeGreaterThan(0);
      expect(result).toHaveProperty('sent_count');
      expect(result).toHaveProperty('processed_count');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. UI Integration Tests
  // ───────────────────────────────────────────────────────────────────────────
  describe('7. UI Integration & Action Handlers', () => {
    const rootDir = path.join(__dirname, '..');
    const htmlPath = path.join(rootDir, 'public', 'index.html');
    const jsPath = path.join(rootDir, 'public', 'js', '12-sellbird.js');

    const html = fs.readFileSync(htmlPath, 'utf8');
    const js = fs.readFileSync(jsPath, 'utf8');

    test('all script tags in public/index.html resolve to existing valid files', () => {
      const scriptRegex = /<script[^>]+src=["']([^"']+)["']/g;
      let sMatch;
      const scriptSources = [];
      while ((sMatch = scriptRegex.exec(html)) !== null) {
        scriptSources.push(sMatch[1]);
      }

      expect(scriptSources.length).toBeGreaterThan(0);

      for (const src of scriptSources) {
        let absPath;
        if (src === '/vendor/chart.umd.js') {
          absPath = path.join(rootDir, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
        } else {
          const cleanPath = src.replace(/^\//, '');
          absPath = path.join(rootDir, 'public', cleanPath);
        }

        expect(fs.existsSync(absPath)).toBe(true);
        const code = fs.readFileSync(absPath, 'utf8');
        expect(() => new vm.Script(code, { filename: absPath })).not.toThrow();
      }
    });

    test('all static DOM element IDs referenced in public/js/12-sellbird.js exist in public/index.html', () => {
      const idRegex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
      const uniqueIds = new Set();
      let match;
      while ((match = idRegex.exec(js)) !== null) {
        uniqueIds.add(match[1]);
      }

      const dynamicPrefixes = [
        'outbox-item-',
        'outbox-chk-',
        'outbox-body-',
        'outbox-subj-',
        'reply-card-',
        'reply-text-',
      ];

      for (const id of uniqueIds) {
        if (dynamicPrefixes.some((p) => id.startsWith(p))) continue;
        const existsInHtml = html.includes(`id="${id}"`) || html.includes(`id='${id}'`);
        expect({ id, exists: existsInHtml }).toEqual({ id, exists: true });
      }
    });

    test('all required global action handlers are declared and callable', () => {
      const requiredHandlers = [
        'openSellbirdTab',
        'switchSellbirdTab',
        'loadSellbird',
        'renderSellbirdMetrics',
        'populateSellbirdCampaignDropdowns',
        'onSellbirdCampaignChange',
        'triggerSellbirdHeartbeat',
        'loadOutbox',
        'filterOutboxStatus',
        'onOutboxSearch',
        'toggleOutboxSelection',
        'toggleSelectAllOutbox',
        'batchApproveOutbox',
        'approveOutboxItem',
        'rejectOutboxItem',
        'editOutboxItem',
        'loadCompanies',
        'onExplorerSearch',
        'onExplorerStatusChange',
        'renderCompanies',
        'viewCompanyInOutbox',
        'openAddCompanyModal',
        'openBulkDiscoverModal',
        'closeSellbirdModals',
        'addProspectCompany',
        'submitBulkDiscover',
        'loadCampaigns',
        'renderCampaigns',
        'trainFromProductUrl',
        'createCampaign',
        'deleteCampaign',
        'loadReplies',
        'filterRepliesIntent',
        'renderReplies',
        'sendDraftedReply',
        'openSimulateReplyModal',
        'submitSimulateReply',
      ];

      const sandbox = {
        window: {},
        document: {
          getElementById: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
          querySelectorAll: () => [],
          querySelector: () => null,
          createElement: () => ({ appendChild: () => {}, style: {} }),
        },
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        api: async () => ({}),
        toast: () => {},
        Number,
        String,
        Set,
        Array,
        Object,
        Math,
        encodeURIComponent,
      };
      sandbox.window = sandbox;

      const context = vm.createContext(sandbox);
      vm.runInContext(js, context);

      for (const handler of requiredHandlers) {
        expect(typeof sandbox[handler]).toBe('function');
      }
    });
  });
});
