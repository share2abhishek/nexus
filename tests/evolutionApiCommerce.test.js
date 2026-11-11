// tests/evolutionApiCommerce.test.js
// Automated End-to-End Test Suite for Evolution API v2 Integration & WhatsApp In-Chat Commerce.
// Covers:
// 1. Evolution API v2 service (instance connect, QR code, connection state, direct template-free text dispatch, fallback bridge)
// 2. Webhook handler (POST /api/lead-pipeline/webhook/evolution for messages.upsert)
// 3. In-Chat UPI & WhatsApp Payments (sendPaymentLinkMessage, POST /api/lead-pipeline/whatsapp/send-payment, NPCI UPI intent schema)
// 4. Bulk Contacts Import (POST /api/lead-pipeline/whatsapp/import-contacts, 0 per-contact charges)
// 5. 6-Team Seats Live Chat Assignment (POST /api/lead-pipeline/whatsapp/assign-agent, conversations list)

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const evolutionApi = require('../services/leadPipeline/evolutionApi');
const leadPipelineRepoFactory = require('../repos/leadPipelineRepo');

jest.mock('axios');

function buildTestApp(knex, workspaceId) {
  const app = express();
  app.use(express.json());
  const passThroughPerm = () => (req, _res, next) => {
    req.workspaceId = workspaceId;
    req.user = { id: 1, name: 'Abhishek Gautam' };
    next();
  };
  const leadPipelineRouter = require('../routes/leadPipeline')(knex, passThroughPerm);
  app.use('/api/lead-pipeline', leadPipelineRouter);
  return app;
}

describe('Evolution API v2 & WhatsApp In-Chat Commerce Suite', () => {
  let knex;
  let repo;
  let workspaceId;
  let orgId;
  let app;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();

    const [org] = await knex('organizations')
      .insert({ name: 'Urban Society Commerce Org', owner_user_id: 1 })
      .returning('id');
    orgId = org?.id ?? org;

    const [ws] = await knex('workspaces')
      .insert({ org_id: orgId, name: 'Urban Society Production', slug: 'urban-society-prod' })
      .returning('id');
    workspaceId = ws?.id ?? ws;

    repo = leadPipelineRepoFactory(knex);
    app = buildTestApp(knex, workspaceId);

    // Seed configuration with Evolution API settings
    await repo.updateConfig(workspaceId, {
      delivery_engine: 'evolution',
      evolution_api_url: 'http://localhost:8080',
      evolution_api_key: 'nexus_evo_secret_key_2026',
      evolution_instance_name: 'urban-society',
      upi_vpa: 'urbansociety@upi',
      auto_qualify_ai: 1,
    });
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: EVOLUTION API v2 SERVICE & BAILIES MULTI-DEVICE PAIRING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('1. Evolution API v2 Integration & Baileys Connection', () => {
    test('1.1 createOrConnectInstance creates new Baileys instance with QR enabled and registers webhook', async () => {
      axios.post
        .mockResolvedValueOnce({
          status: 201,
          data: {
            instance: { instanceName: 'urban-society', status: 'created' },
            qrcode: { base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...', code: 'PAIR-123-CODE' },
          },
        })
        .mockResolvedValueOnce({ status: 200, data: { success: true } }); // webhook registration

      const res = await evolutionApi.createOrConnectInstance({
        apiUrl: 'http://localhost:8080',
        apiKey: 'test_key',
        instanceName: 'urban-society',
        webhookUrl: 'http://localhost:3000/api/lead-pipeline/webhook/evolution',
      });

      expect(res.success).toBe(true);
      expect(res.action).toBe('created');
      expect(res.qrcode).toContain('data:image/png;base64');
      expect(res.pairing_code).toBe('PAIR-123-CODE');

      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:8080/instance/create',
        expect.objectContaining({
          instanceName: 'urban-society',
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        }),
        expect.objectContaining({
          headers: expect.objectContaining({ apikey: 'test_key' }),
        })
      );
    });

    test('1.2 createOrConnectInstance seamlessly recovers existing instance if already created (400/403/already in use)', async () => {
      // Simulate Evolution API returning "already in use" error
      const err = new Error('Instance already in use');
      err.response = { status: 403, data: { message: 'Instance already in use' } };
      axios.post.mockRejectedValueOnce(err);

      // fetchQrCode response
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          instance: { state: 'open', ownerJid: '919820055443@s.whatsapp.net' },
          base64: 'data:image/png;base64,existingQR...',
        },
      });

      const res = await evolutionApi.createOrConnectInstance({
        apiUrl: 'http://localhost:8080',
        apiKey: 'test_key',
        instanceName: 'urban-society',
      });

      expect(res.success).toBe(true);
      expect(res.action).toBe('connected_existing');
      expect(res.connected).toBe(true);
      expect(res.state).toBe('open');
      expect(res.display_number).toBe('919820055443');
    });

    test('1.3 fetchQrCode retrieves QR base64 and pairing code for unauthenticated instance', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          state: 'connecting',
          base64: 'data:image/png;base64,mockQRcodeImageBytes',
          code: '8877-6655',
        },
      });

      const qr = await evolutionApi.fetchQrCode({
        apiUrl: 'http://localhost:8080',
        apiKey: 'test_key',
        instanceName: 'urban-society',
      });

      expect(qr.success).toBe(true);
      expect(qr.connected).toBe(false);
      expect(qr.state).toBe('connecting');
      expect(qr.qrcode).toBe('data:image/png;base64,mockQRcodeImageBytes');
      expect(qr.pairing_code).toBe('8877-6655');
    });

    test('1.4 getConnectionState queries instance state (open / close / connecting)', async () => {
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: { instance: { state: 'open' } },
      });

      const state = await evolutionApi.getConnectionState({
        apiUrl: 'http://localhost:8080',
        apiKey: 'test_key',
        instanceName: 'urban-society',
      });

      expect(state.success).toBe(true);
      expect(state.connected).toBe(true);
      expect(state.state).toBe('open');
    });

    test('1.5 sendTextMessage sends template-free direct text with zero Meta template constraints and zero ban risk', async () => {
      axios.post.mockResolvedValueOnce({
        status: 201,
        data: {
          key: { id: 'BAILEYS_MSG_998811' },
          message: { conversation: 'Hello from Urban Society!' },
          status: 'PENDING',
        },
      });

      const res = await evolutionApi.sendTextMessage({
        apiUrl: 'http://localhost:8080',
        apiKey: 'test_key',
        instanceName: 'urban-society',
        number: '+919820055443',
        text: 'Hi Vikramaditya! Your society maintenance billing dashboard is ready.',
      });

      expect(res.success).toBe(true);
      expect(res.mode).toBe('evolution_api');
      expect(res.message_id).toBe('BAILEYS_MSG_998811');
      expect(res.recipient).toBe('919820055443');

      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:8080/message/sendText/urban-society',
        expect.objectContaining({
          number: '919820055443',
          text: 'Hi Vikramaditya! Your society maintenance billing dashboard is ready.',
          delay: 1200,
          linkPreview: true,
        }),
        expect.any(Object)
      );
    });

    test('1.6 sendTextMessage provides 1-click fallback bridge if Evolution API is offline so workflow is never blocked', async () => {
      axios.post.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8080'));

      const res = await evolutionApi.sendTextMessage({
        apiUrl: 'http://localhost:8080',
        apiKey: 'test_key',
        instanceName: 'urban-society',
        number: '919811223344',
        text: 'Hello from Urban Society!',
      });

      expect(res.success).toBe(false);
      expect(res.mode).toBe('fallback_bridge');
      expect(res.bridge_url).toContain('https://wa.me/919811223344?text=');
    });

    test('1.7 logoutInstance terminates Baileys multi-device session', async () => {
      axios.delete.mockResolvedValueOnce({
        status: 200,
        data: { success: true, message: 'Instance logged out' },
      });

      const res = await evolutionApi.logoutInstance({
        apiUrl: 'http://localhost:8080',
        apiKey: 'test_key',
        instanceName: 'urban-society',
      });

      expect(res.success).toBe(true);
      expect(axios.delete).toHaveBeenCalledWith(
        'http://localhost:8080/instance/logout/urban-society',
        expect.any(Object)
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: WEBHOOK HANDLER FOR EVOLUTION API (messages.upsert)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('2. Inbound Evolution Webhook Handler (messages.upsert)', () => {
    test('2.1 POST /api/lead-pipeline/webhook/evolution ingests conversation message and creates lead if new', async () => {
      const webhookPayload = {
        event: 'messages.upsert',
        instance: 'urban-society',
        data: {
          key: {
            remoteJid: '919876543210@s.whatsapp.net',
            fromMe: false,
            id: 'INBOUND_MSG_001',
          },
          pushName: 'Col. Rajesh Bakshi',
          message: {
            conversation: 'Hi, we have 380 units in Army Welfare Society. Can you demo your maintenance payment gateway?',
          },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      };

      const res = await request(app)
        .post('/api/lead-pipeline/webhook/evolution')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('received');

      // Verify lead created in DB
      const lead = await repo.findLeadByPhone(workspaceId, '919876543210');
      expect(lead).toBeDefined();
      expect(lead.full_name).toBe('Col. Rajesh Bakshi');
      expect(lead.phone_number).toContain('919876543210');

      // Verify message added to conversation thread
      const messages = await repo.listLeadMessages(workspaceId, lead.id);
      expect(messages.length).toBeGreaterThanOrEqual(1);
      const inboundMsg = messages.find((m) => m.sender_type === 'lead');
      expect(inboundMsg).toBeDefined();
      expect(inboundMsg.message_text).toContain('380 units in Army Welfare Society');
      expect(inboundMsg.channel).toBe('whatsapp');
    });

    test('2.2 POST /api/lead-pipeline/webhook/evolution handles extendedTextMessage and appends to existing thread', async () => {
      const webhookPayload = {
        event: 'messages.upsert',
        data: {
          key: {
            remoteJid: '919876543210@s.whatsapp.net',
            fromMe: false,
            id: 'INBOUND_MSG_002',
          },
          pushName: 'Col. Rajesh Bakshi',
          message: {
            extendedTextMessage: {
              text: 'Thursday at 3 PM works best for our managing committee.',
            },
          },
        },
      };

      const res = await request(app)
        .post('/api/lead-pipeline/webhook/evolution')
        .send(webhookPayload);

      expect(res.status).toBe(200);

      const lead = await repo.findLeadByPhone(workspaceId, '919876543210');
      const messages = await repo.listLeadMessages(workspaceId, lead.id);
      expect(messages.some((m) => m.message_text.includes('Thursday at 3 PM'))).toBe(true);
    });

    test('2.3 POST /api/lead-pipeline/webhook/evolution ignores outbound messages (fromMe: true)', async () => {
      const webhookPayload = {
        event: 'messages.upsert',
        data: {
          key: {
            remoteJid: '919876543210@s.whatsapp.net',
            fromMe: true, // outbound sent by ourselves
            id: 'OUTBOUND_MSG_001',
          },
          message: { conversation: 'Self message' },
        },
      };

      const res = await request(app)
        .post('/api/lead-pipeline/webhook/evolution')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('received');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: IN-CHAT UPI & WHATSAPP PAYMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('3. In-Chat UPI & WhatsApp Payments', () => {
    test('3.1 sendPaymentLinkMessage formats NPCI compliant UPI intent URI for GPay, PhonePe, Paytm', async () => {
      axios.post.mockResolvedValueOnce({
        status: 201,
        data: { key: { id: 'UPI_DISPATCH_101' }, status: 'SENT' },
      });

      const res = await evolutionApi.sendPaymentLinkMessage({
        apiUrl: 'http://localhost:8080',
        apiKey: 'test_key',
        instanceName: 'urban-society',
        number: '+919820055443',
        title: 'Q1 Society Maintenance Dues',
        amount: 4500,
        upiVpa: 'urbansociety@upi',
      });

      expect(res.success).toBe(true);

      // Verify the dispatched payload text contained the exact NPCI URI specification
      const dispatchedCall = axios.post.mock.calls[0];
      const dispatchedText = dispatchedCall[1].text;

      expect(dispatchedText).toContain('upi://pay?');
      expect(dispatchedText).toContain('pa=urbansociety%40upi');
      expect(dispatchedText).toContain('pn=Urban%20Society');
      expect(dispatchedText).toContain('am=4500.00');
      expect(dispatchedText).toContain('cu=INR');
      expect(dispatchedText).toContain('tn=Q1%20Society%20Maintenance%20Dues');
      expect(dispatchedText).toContain('GPay, PhonePe, Paytm');
    });

    test('3.2 POST /api/lead-pipeline/whatsapp/send-payment updates lead payment status and logs thread message', async () => {
      // Create a test lead
      const lead = await repo.addLeadEvent(workspaceId, {
        full_name: 'Suresh Nambiar',
        phone_number: '+919820011999',
        form_id: 'test_payment_lead',
        lead_score: 90,
      });

      axios.post.mockResolvedValueOnce({
        status: 201,
        data: { key: { id: 'UPI_MSG_002' }, status: 'SENT' },
      });

      const res = await request(app)
        .post('/api/lead-pipeline/whatsapp/send-payment')
        .send({
          leadId: lead.id,
          title: 'Annual Clubhouse Membership & Maintenance',
          amount: 8500,
          upi_vpa: 'urbansociety@icici',
          engine: 'evolution',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Payment request dispatched');

      // Verify database updates
      const updatedLead = await repo.getLeadEvent(workspaceId, lead.id);
      expect(updatedLead.payment_status).toBe('link_sent');
      expect(updatedLead.order_value).toBe(8500);

      // Verify message logged into thread
      const messages = await repo.listLeadMessages(workspaceId, lead.id);
      const paymentMsg = messages.find((m) => m.message_text.includes('UPI Payment Request'));
      expect(paymentMsg).toBeDefined();
      expect(paymentMsg.message_text).toContain('₹8500.00');
      expect(paymentMsg.message_text).toContain('upi://pay?');
      expect(paymentMsg.sender_type).toBe('agent');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: BULK CONTACTS IMPORT (UNLIMITED CONTACTS, 0 CHARGES)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('4. Bulk Contacts Upload (Unlimited Contacts with 0 Per-Contact Charges)', () => {
    test('4.1 POST /api/lead-pipeline/whatsapp/import-contacts imports audience with 0 storage charges', async () => {
      const contactsToImport = [
        {
          name: 'Nitin Gadgil',
          phone: '+919822114455',
          society: 'Magnolia Enclave',
          notes: 'Chairman of 300 units society',
          tags: ['rwa_chairman', 'high_ticket'],
        },
        {
          name: 'Sunita Deshmukh',
          phone: '+919822223344',
          society: 'Parijat Heights',
          notes: 'Treasurer managing maintenance billing',
          tags: ['treasurer', 'billing_issue'],
        },
        {
          name: 'Gaurav Kulkarni',
          phone: '+919823334455',
          society: 'Shantivan Residency',
          notes: 'Secretary looking for accounting app',
          tags: ['secretary'],
        },
      ];

      const res = await request(app)
        .post('/api/lead-pipeline/whatsapp/import-contacts')
        .send({ contacts: contactsToImport });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.imported_count).toBe(3);
      expect(res.body.message).toContain('0 per-contact charges');

      // Verify contacts exist in database
      const importedLead = await repo.findLeadByPhone(workspaceId, '919822114455');
      expect(importedLead).toBeDefined();
      expect(importedLead.full_name).toBe('Nitin Gadgil');
      expect(importedLead.channel_source).toBe('csv_upload');
    });

    test('4.2 POST /api/lead-pipeline/whatsapp/import-contacts validates empty payload', async () => {
      const res = await request(app)
        .post('/api/lead-pipeline/whatsapp/import-contacts')
        .send({ contacts: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No contacts provided');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: 6-TEAM SEATS MULTI-AGENT ASSIGNMENT IN LIVE CHAT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('5. 6-Team Seats Multi-Agent Assignment in Live Chat', () => {
    let testLead;

    beforeAll(async () => {
      testLead = await repo.addLeadEvent(workspaceId, {
        full_name: 'Brigadier Mohan Joshi',
        phone_number: '+919820033221',
        form_id: 'team_assignment_test',
        lead_score: 95,
      });
    });

    test('5.1 Assign lead to Seat 1: Abhishek Gautam (Admin)', async () => {
      const res = await request(app)
        .post('/api/lead-pipeline/whatsapp/assign-agent')
        .send({
          leadId: testLead.id,
          agentId: 1,
          agentName: 'Abhishek Gautam',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.lead.assigned_agent_id).toBe(1);
      expect(res.body.lead.assigned_agent_name).toBe('Abhishek Gautam');
    });

    test('5.2 Reassign lead across all 6 team seats', async () => {
      const seats = [
        { id: 2, name: 'Priya Gautam' },
        { id: 3, name: 'Rohit Verma' },
        { id: 4, name: 'Sneha Kulkarni' },
        { id: 5, name: 'Amit Saxena' },
        { id: 6, name: 'Neha Deshmukh' },
      ];

      for (const seat of seats) {
        const res = await request(app)
          .post('/api/lead-pipeline/whatsapp/assign-agent')
          .send({
            leadId: testLead.id,
            agentId: seat.id,
            agentName: seat.name,
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.lead.assigned_agent_id).toBe(seat.id);
        expect(res.body.lead.assigned_agent_name).toBe(seat.name);
      }
    });

    test('5.3 GET /api/lead-pipeline/whatsapp/conversations displays assigned_agent_name for live triage', async () => {
      const res = await request(app).get('/api/lead-pipeline/whatsapp/conversations');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.conversations)).toBe(true);

      const conv = res.body.conversations.find((c) => c.lead_id === testLead.id);
      expect(conv).toBeDefined();
      expect(conv.assigned_agent_id).toBe(6);
      expect(conv.assigned_agent_name).toBe('Neha Deshmukh');
    });
  });
});
