// tests/sellbird.test.js
// Comprehensive test suite for Sellbird autonomous B2B sales agent in Social-Nexus.

const { makeTestKnex } = require('./helpers/db');
const sellbirdRepoFactory = require('../repos/sellbirdRepo');
const { crawlWebsite, isPrivateOrLocalHost } = require('../services/sellbird/crawler');
const { extractProspectNames, predictEmailPatterns, verifyMxRecord, verifyContactEmail } = require('../services/sellbird/contacts');
const { generateOutreachSequence, classifyReplyIntent, draftReplyResponse } = require('../services/sellbird/aiEngine');
const { processDueOutbox } = require('../services/sellbird/dispatcher');

// A configured mail server for these tests (nothing really leaves the machine)
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async () => ({ messageId: 'test-message' }) }) }));
Object.assign(process.env, { SMTP_HOST: 'smtp.test.example', SMTP_USER: 'sales@test.example', SMTP_PASS: 'x', SMTP_FROM: 'sales@test.example' });

async function makeWorkspace(knex, name, slug) {
  const orgRows = await knex('organizations').insert({ name: `${name} Org`, owner_user_id: 1 }).returning('id');
  const orgId = orgRows[0]?.id ?? orgRows[0];
  const wsRows = await knex('workspaces').insert({ org_id: orgId, name, slug }).returning('id');
  return wsRows[0]?.id ?? wsRows[0];
}

describe('Sellbird Autonomous Sales Agent Suite', () => {
  let knex;
  let repo;
  let ws1, ws2;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    repo = sellbirdRepoFactory(knex);
    ws1 = await makeWorkspace(knex, 'Workspace One', 'ws-one');
    ws2 = await makeWorkspace(knex, 'Workspace Two', 'ws-two');
  });

  afterAll(async () => {
    await knex.destroy();
  });

  describe('1. Multi-Tenant Isolation', () => {
    let camp1, camp2;

    test('Campaigns created in workspace 1 are strictly invisible to workspace 2', async () => {
      camp1 = await repo.createCampaign(ws1, {
        name: 'Enterprise Q4 Push',
        product_url: 'https://urbansociety.in',
        max_emails_per_day: 30,
      });
      camp2 = await repo.createCampaign(ws2, {
        name: 'Tenant Two Campaign',
        product_url: 'https://example.com',
        max_emails_per_day: 10,
      });

      expect(camp1.id).toBeDefined();
      expect(camp2.id).toBeDefined();

      const list1 = await repo.listCampaigns(ws1);
      const list2 = await repo.listCampaigns(ws2);

      expect(list1.some((c) => c.id === camp1.id)).toBe(true);
      expect(list1.some((c) => c.id === camp2.id)).toBe(false);

      expect(list2.some((c) => c.id === camp2.id)).toBe(true);
      expect(list2.some((c) => c.id === camp1.id)).toBe(false);

      expect(await repo.getCampaign(ws1, camp2.id)).toBeNull();
      expect(await repo.getCampaign(ws2, camp1.id)).toBeNull();
    });

    test('Companies, Contacts, and Outbox items are strictly isolated by workspaceId', async () => {
      const comp1 = await repo.addCompany(ws1, camp1.id, {
        name: 'Acme Corp',
        domain: 'acme.com',
        score: 85,
      });

      const contact1 = await repo.addContact(ws1, comp1.id, {
        full_name: 'John Doe',
        email: 'john@acme.com',
        email_status: 'verified',
      });

      const outbox1 = await repo.addOutboxItem(ws1, {
        campaign_id: camp1.id,
        contact_id: contact1.id,
        subject: 'Quick question for Acme',
        body: 'Hi John...',
        status: 'pending_approval',
      });

      // Tenant 2 cannot access company, contact, or outbox item of Tenant 1
      expect(await repo.getCompany(ws2, comp1.id)).toBeNull();
      expect(await repo.getOutboxItem(ws2, outbox1.id)).toBeNull();

      const outboxListWs2 = await repo.listOutbox(ws2);
      expect(outboxListWs2.some((o) => o.id === outbox1.id)).toBe(false);

      // Batch approve in Tenant 2 cannot approve Tenant 1's items
      const approvedCount = await repo.batchApprove(ws2, [outbox1.id]);
      expect(approvedCount).toBe(0);

      const stillPending = await repo.getOutboxItem(ws1, outbox1.id);
      expect(stillPending.status).toBe('pending_approval');
    });
  });

  describe('2. Human-in-the-Loop Safety', () => {
    test('Default status is always pending_approval and auto_approve defaults to false', async () => {
      const camp = await repo.createCampaign(ws1, { name: 'Safety Campaign' });
      expect(camp.auto_approve).toBe(false);

      const comp = await repo.addCompany(ws1, camp.id, { name: 'Safety Co', domain: 'safety.io' });
      const contact = await repo.addContact(ws1, comp.id, { full_name: 'Jane Smith', email: 'jane@safety.io' });

      const item = await repo.addOutboxItem(ws1, {
        campaign_id: camp.id,
        contact_id: contact.id,
        subject: 'Safe outreach',
        body: 'Hello Jane',
      });

      expect(item.status).toBe('pending_approval');

      // Dispatcher will NEVER pick up pending_approval items
      const result = await processDueOutbox(knex, repo, { workspaceId: ws1, enableJitter: false });
      expect(result.sent).toBe(0);

      // Now approve item
      await repo.updateOutboxItem(ws1, item.id, { status: 'approved' });
      const approved = await repo.getOutboxItem(ws1, item.id);
      expect(approved.status).toBe('approved');

      // Reject so it doesn't linger in due outbox for subsequent tests
      await repo.updateOutboxItem(ws1, item.id, { status: 'rejected' });
    });
  });

  describe('3. Crawler Resilience & SSRF Protection', () => {
    test('Crawler blocks private and loopback IP hosts', async () => {
      expect(isPrivateOrLocalHost('localhost')).toBe(true);
      expect(isPrivateOrLocalHost('127.0.0.1')).toBe(true);
      expect(isPrivateOrLocalHost('10.0.0.5')).toBe(true);
      expect(isPrivateOrLocalHost('192.168.1.10')).toBe(true);
      expect(isPrivateOrLocalHost('172.20.0.1')).toBe(true);
      expect(isPrivateOrLocalHost('169.254.169.254')).toBe(true);
      expect(isPrivateOrLocalHost('mycorp.local')).toBe(true);

      expect(isPrivateOrLocalHost('google.com')).toBe(false);
      expect(isPrivateOrLocalHost('urbansociety.in')).toBe(false);

      const res = await crawlWebsite('http://127.0.0.1:3000/internal-secrets');
      expect(res.success).toBe(false);
      expect(res.description).toContain('restricted');
    });

    test('Crawler gracefully handles empty or malformed URLs without throwing', async () => {
      const empty = await crawlWebsite('');
      expect(empty.success).toBe(false);

      const malformed = await crawlWebsite('not a valid url');
      expect(malformed.success).toBe(false);
    });
  });

  describe('4. Contacts MX Verification & Pattern Prediction', () => {
    test('predictEmailPatterns generates accurate permutations', () => {
      const patterns = predictEmailPatterns('Elon', 'Musk', 'x.com');
      expect(patterns).toContain('elon.musk@x.com');
      expect(patterns).toContain('elon@x.com');
      expect(patterns).toContain('emusk@x.com');

      const singleName = predictEmailPatterns('Admin', '', 'x.com');
      expect(singleName).toContain('admin@x.com');
    });

    test('extractProspectNames extracts executive roles or defaults safely', () => {
      const snippet = 'Founded in 2020 by Satya Nadella, CEO and Director of the enterprise.';
      const res = extractProspectNames(snippet, 'microsoft.com');
      expect(res.length).toBeGreaterThan(0);
      expect(res[0].role).toBe('CEO');
      expect(res[0].full_name).toBe('Satya Nadella');

      // Safe fallback when domain is missing or text has no matches
      const fallback = extractProspectNames('Nothing here', null);
      expect(fallback[0].role).toBe('Decision Maker');
      expect(fallback[0].full_name).toContain('Leadership');
    });

    test('verifyContactEmail validates syntax and MX without hanging', async () => {
      const badSyntax = await verifyContactEmail('notanemail');
      expect(badSyntax.verified).toBe(false);
      expect(badSyntax.status).toBe('invalid');

      // Invalid domain that does not exist
      const deadDomain = await verifyContactEmail('test@thisshouldnotexist9876543210.com');
      expect(deadDomain.verified).toBe(false);
      expect(deadDomain.status).toBe('invalid');
    });
  });

  describe('5. AI Engine & Fallback', () => {
    test('generateOutreachSequence returns a 3-step sequence even if AI keys are not provided', async () => {
      const seq = await generateOutreachSequence(
        {
          product: { name: 'Urban Society', url: 'https://urbansociety.in' },
          company: { name: 'Acme Resident Club', domain: 'acmeresidents.com', buying_signals: { signals: ['Gated Community'] } },
          contact: { full_name: 'Rajesh Sharma', role: 'Society Chairman' },
        },
        { googleKey: 'invalid-key-test', ollamaEnabled: false }
      );

      expect(Array.isArray(seq)).toBe(true);
      expect(seq.length).toBe(3);
      expect(seq[0].step).toBe(1);
      expect(seq[0].subject).toContain('Acme Resident Club');
      expect(seq[0].body).toContain('Rajesh');
    });

    test('classifyReplyIntent identifies sentiment and opt-out keywords', async () => {
      const unsub = await classifyReplyIntent('Please unsubscribe me and remove from your list.');
      expect(unsub).toBe('unsubscribe');

      const interested = await classifyReplyIntent('This looks great, let us set up a call on Thursday!');
      expect(interested).toBe('interested');

      const objection = await classifyReplyIntent('We already use another vendor for this.');
      expect(objection).toBe('question'); // Offline fallback routes to question/objection
    });

    test('draftReplyResponse creates courteous reply', async () => {
      const reply = await draftReplyResponse({
        originalMessage: 'Please remove our company from this sequence.',
        intent: 'unsubscribe',
        product: { name: 'Urban Society' },
      });
      expect(reply.toLowerCase()).toContain('removed');
    });
  });

  describe('6. Deliverability, Daily Cap & Opt-Out Suppression', () => {
    test('Dispatcher enforces daily sending limit (max_emails_per_day)', async () => {
      const camp = await repo.createCampaign(ws1, { name: 'Capped Campaign', max_emails_per_day: 1 });
      const comp = await repo.addCompany(ws1, camp.id, { name: 'Cap Co', domain: 'cap.co' });
      const c1 = await repo.addContact(ws1, comp.id, { full_name: 'Contact 1', email: 'c1@cap.co', email_status: 'verified' });
      const c2 = await repo.addContact(ws1, comp.id, { full_name: 'Contact 2', email: 'c2@cap.co', email_status: 'verified' });

      const o1 = await repo.addOutboxItem(ws1, { campaign_id: camp.id, contact_id: c1.id, subject: 'S1', body: 'B1', status: 'approved' });
      const o2 = await repo.addOutboxItem(ws1, { campaign_id: camp.id, contact_id: c2.id, subject: 'S2', body: 'B2', status: 'approved' });

      // Run dispatcher
      const res = await processDueOutbox(knex, repo, { workspaceId: ws1, enableJitter: false });
      expect(res.sent).toBe(1); // Only 1 sent due to cap of 1

      // Second email was deferred/scheduled for tomorrow
      const deferred = await repo.getOutboxItem(ws1, o2.id);
      expect(deferred.status).toBe('approved');
      expect(deferred.scheduled_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    test('Dispatcher suppresses and rejects recipients who have opted out', async () => {
      const camp = await repo.createCampaign(ws1, { name: 'Opt Out Campaign', max_emails_per_day: 10 });
      const comp = await repo.addCompany(ws1, camp.id, { name: 'Opt Co', domain: 'opt.com' });
      const contact = await repo.addContact(ws1, comp.id, { full_name: 'Opt Person', email: 'optout@target.com', email_status: 'verified' });

      // Record an unsubscribe reply in this workspace
      await repo.addReply(ws1, {
        sender_email: 'optout@target.com',
        intent_category: 'unsubscribe',
        message_text: 'Unsubscribe me please',
        status: 'dismissed',
      });

      const outbox = await repo.addOutboxItem(ws1, {
        campaign_id: camp.id,
        contact_id: contact.id,
        subject: 'Followup note',
        body: 'Hello again',
        status: 'approved',
      });

      const res = await processDueOutbox(knex, repo, { workspaceId: ws1, enableJitter: false });
      expect(res.sent).toBe(0);

      const suppressedItem = await repo.getOutboxItem(ws1, outbox.id);
      expect(suppressedItem.status).toBe('rejected');
      expect(suppressedItem.error_message).toContain('opted out');
    });
  });
});
