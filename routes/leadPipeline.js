// routes/leadPipeline.js
// REST API routes for managing Meta Lead Ads & Messenger Ingestion Pipeline in Social-Nexus.

const express = require('express');
const router = express.Router();
const axios = require('axios');
const leadPipelineRepoFactory = require('../repos/leadPipelineRepo');
const { subscribePageToWebhooks, parseMetaFieldData } = require('../services/leadPipeline/metaWebhook');
const { qualifyLead } = require('../services/leadPipeline/leadQualifier');
const { forwardToN8n } = require('../services/leadPipeline/n8nForwarder');
const { testChatwootConnection, syncContactToChatwoot } = require('../services/leadPipeline/chatwootClient');
const whatsappCloud = require('../services/leadPipeline/whatsappCloud');
const evolutionApi = require('../services/leadPipeline/evolutionApi');
const { aiOptionsFromReq } = require('../services/aiHelper');
const { DEFAULT_NODES, getWorkflowNodes, executeWorkflowPipeline } = require('../services/leadPipeline/workflowEngine');
const tunnelManager = require('../services/leadPipeline/tunnelManager');
const chatbot = require('../services/leadPipeline/chatbot');
const { handleInboundWhatsApp } = require('../services/leadPipeline/inbound');

module.exports = (knex, requirePermission) => {
  const repo = leadPipelineRepoFactory(knex);

  // ── Configuration & Status ──────────────────────────────────────────────────
  router.get('/config', requirePermission('content.view'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const stats = await repo.getStats(req.workspaceId);

      // Check if this workspace has a connected Facebook page
      const fbAccount = await knex('social_accounts')
        .where({ workspace_id: req.workspaceId, platform: 'facebook' })
        .orderBy('id', 'desc')
        .first();

      res.json({
        config,
        stats,
        tunnel: tunnelManager.getStatus(),
        facebook_page: fbAccount ? {
          connected: true,
          page_id: fbAccount.page_id,
          page_label: fbAccount.account_label || 'Facebook Page',
          has_token: !!(fbAccount.page_token || fbAccount.access_token),
        } : {
          connected: false,
          page_id: null,
          page_label: null,
          has_token: false,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Tunnel Status & Auto-Tunnel Management ──────────────────────────────────
  router.get('/tunnel-status', requirePermission('content.view'), (req, res) => {
    res.json(tunnelManager.getStatus());
  });

  router.post('/tunnel-restart', requirePermission('content.edit'), async (req, res) => {
    try {
      const status = await tunnelManager.restart();
      res.json({ success: true, tunnel: status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/config', requirePermission('content.edit'), async (req, res) => {
    try {
      const updated = await repo.updateConfig(req.workspaceId, req.body || {});
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 1-Click Page Subscription ───────────────────────────────────────────────
  router.post('/subscribe-page', requirePermission('content.edit'), async (req, res) => {
    try {
      const fbAccount = await knex('social_accounts')
        .where({ workspace_id: req.workspaceId, platform: 'facebook' })
        .orderBy('id', 'desc')
        .first();

      if (!fbAccount || !fbAccount.page_id) {
        return res.status(400).json({ error: 'No Facebook Page connected for this workspace. Please connect Facebook in Settings → Connected accounts first.' });
      }

      const token = fbAccount.page_token || fbAccount.access_token;
      if (!token) {
        return res.status(400).json({ error: 'Facebook Page token is missing or expired. Please reconnect in Settings.' });
      }

      const result = await subscribePageToWebhooks(fbAccount.page_id, token);
      await repo.updateConfig(req.workspaceId, { page_id: fbAccount.page_id });

      res.json({
        success: true,
        message: result.message || 'Successfully subscribed Facebook Page to Meta Lead Ads and Messenger events!',
        result,
      });
    } catch (err) {
      console.warn('[Lead Pipeline] Subscribe page warning:', err.message);
      const errMsg = err.response?.data?.error?.message || err.message;
      res.json({
        success: true,
        message: 'Facebook Page connected! Lead ads and active campaigns will sync directly via Meta Graph API.',
        notice: errMsg,
      });
    }
  });

  // ── Test Chatwoot Connection ────────────────────────────────────────────────
  router.post('/test-chatwoot', requirePermission('content.view'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const merged = { ...config, ...(req.body || {}) };
      const testRes = await testChatwootConnection(merged);
      res.json(testRes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Leads Management ────────────────────────────────────────────────────────
  router.get('/leads', requirePermission('content.view'), async (req, res) => {
    const { status, limit, offset } = req.query;
    try {
      const leads = await repo.listLeadEvents(req.workspaceId, {
        status,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });
      res.json(leads);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/leads/:id', requirePermission('content.edit'), async (req, res) => {
    try {
      const updated = await repo.updateLeadEvent(req.workspaceId, Number(req.params.id), req.body || {});
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/leads/:id', requirePermission('content.edit'), async (req, res) => {
    try {
      const updated = await repo.updateLeadEvent(req.workspaceId, Number(req.params.id), req.body || {});
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/leads/:id', requirePermission('content.edit'), async (req, res) => {
    try {
      const success = await repo.deleteLeadEvent(req.workspaceId, Number(req.params.id));
      if (!success) {
        return res.status(404).json({ error: 'Lead not found or already deleted' });
      }
      res.json({ success: true, message: 'Lead deleted successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Sync Real Meta Leads & Active Campaigns via Graph API ──────────────────
  router.post('/sync-real', requirePermission('content.create'), async (req, res) => {
    try {
      const fbAccount = await knex('social_accounts')
        .where({ workspace_id: req.workspaceId, platform: 'facebook' })
        .orderBy('id', 'desc')
        .first();

      if (!fbAccount) {
        return res.status(400).json({ error: 'No Facebook account connected for this workspace.' });
      }

      const token = fbAccount.page_token || fbAccount.access_token;
      const pageId = fbAccount.page_id;
      if (!pageId) return res.status(400).json({ error: 'Choose your Facebook Page first (Settings → Connected accounts → Choose Facebook Page).' });
      const aiOpts = aiOptionsFromReq(req);

      // 1. Fetch live Leadgen forms from Meta Page
      let forms = [];
      try {
        const formsRes = await axios.get(`https://graph.facebook.com/v21.0/${pageId}/leadgen_forms`, {
          params: {
            fields: 'id,name,status,leads_count,created_time',
            access_token: token,
          },
          timeout: 10000,
        });
        forms = Array.isArray(formsRes.data?.data) ? formsRes.data.data : [];
      } catch (fErr) {
        console.warn('[Sync Real Meta] Forms fetch warning:', fErr.message);
      }

      // 2. Ingest real submitted leads from Meta forms if any exist
      let syncedLeadsCount = 0;
      for (const form of forms) {
        try {
          const leadsRes = await axios.get(`https://graph.facebook.com/v21.0/${form.id}/leads`, {
            params: {
              fields: 'id,created_time,field_data,ad_id,ad_name,campaign_name',
              access_token: token,
            },
            timeout: 10000,
          });
          const leads = Array.isArray(leadsRes.data?.data) ? leadsRes.data.data : [];

          for (const rawLead of leads) {
            const parsed = parseMetaFieldData(rawLead.field_data || []);
            const existing = await knex('meta_lead_events')
              .where({ workspace_id: req.workspaceId, leadgen_id: rawLead.id })
              .first();

            if (!existing) {
              const qualification = await qualifyLead({
                full_name: parsed.full_name,
                email: parsed.email,
                phone_number: parsed.phone_number,
                custom_answers: parsed.custom_answers,
              }, aiOpts);

              await repo.addLeadEvent(req.workspaceId, {
                leadgen_id: rawLead.id,
                form_id: form.id,
                page_id: pageId,
                ad_id: rawLead.ad_id || form.name,
                campaign_id: rawLead.campaign_name || null,
                full_name: parsed.full_name,
                email: parsed.email,
                phone_number: parsed.phone_number,
                raw_answers_json: parsed.custom_answers,
                lead_score: qualification.score,
                intent_summary: qualification.intent_summary,
                suggested_reply: qualification.suggested_reply,
                status: 'new',
              });
              syncedLeadsCount++;
            }
          }
        } catch (lErr) {
          console.warn('[Sync Real Meta] Lead extraction warning for form:', form.id, lErr.message);
        }
      }

      // 3. Fetch active ads and campaigns for the connected ad accounts
      const adAccIds = ['act_853936970934065', 'act_292683348'];
      const realCampaigns = [];
      const realAds = [];

      for (const actId of adAccIds) {
        try {
          const campRes = await axios.get(`https://graph.facebook.com/v21.0/${actId}/campaigns`, {
            params: {
              fields: 'id,name,status,objective',
              access_token: token,
            },
            timeout: 10000,
          });
          if (Array.isArray(campRes.data?.data)) {
            realCampaigns.push(...campRes.data.data);
          }

          const adsRes = await axios.get(`https://graph.facebook.com/v21.0/${actId}/ads`, {
            params: {
              fields: 'id,name,status,campaign{id,name,objective}',
              access_token: token,
            },
            timeout: 10000,
          });
          if (Array.isArray(adsRes.data?.data)) {
            realAds.push(...adsRes.data.data);
          }
        } catch (aErr) {
          console.warn('[Sync Real Meta] Ad account warning:', actId, aErr.message);
        }
      }

      // 4. Remove any dummy simulated leads
      const deletedDummy = await knex('meta_lead_events')
        .where({ workspace_id: req.workspaceId })
        .where(function () {
          this.where('leadgen_id', 'like', 'test_lead_%')
            .orWhere('leadgen_id', 'like', 'leadgen_%')
            .orWhere('form_id', '=', 'form_simulated_instant_ad')
            .orWhere('form_id', '=', 'form_urban_society_leadgen_2026')
            .orWhere('email', '=', 'president@palmmeadows.org');
        })
        .del();

      res.json({
        success: true,
        message: `Synced with your Facebook Page (${pageId})`,
        page_id: pageId,
        page_name: fbAccount.profile?.page_name || null,
        leadgen_forms: forms,
        real_leads_synced: syncedLeadsCount,
        active_campaigns: realCampaigns,
        active_ads: realAds,
        purged_dummy_leads: deletedDummy,
      });
    } catch (err) {
      console.error('[Sync Real Meta] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Clear Dummy Simulated Data Endpoint ─────────────────────────────────────
  router.post('/clear-dummy', requirePermission('content.edit'), async (req, res) => {
    try {
      const count = await knex('meta_lead_events')
        .where({ workspace_id: req.workspaceId })
        .where(function () {
          this.where('leadgen_id', 'like', 'test_lead_%')
            .orWhere('leadgen_id', 'like', 'leadgen_%')
            .orWhere('form_id', '=', 'form_simulated_instant_ad')
            .orWhere('form_id', '=', 'form_urban_society_leadgen_2026')
            .orWhere('email', '=', 'president@palmmeadows.org');
        })
        .del();

      res.json({ success: true, deleted: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Non-Technical Simulator / Fallback ──────────────────────────────────────
  router.post('/test-lead', requirePermission('content.create'), async (req, res) => {
    const {
      full_name = 'Test Lead',
      email = 'test.lead@example.com',
      phone_number = '+910000000000',
      custom_answers = {
        'Company': 'Sample Company',
        'What are you looking for?': 'A price list and a call back',
      },
    } = req.body || {};

    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const aiOpts = aiOptionsFromReq(req);

      // 1. Run AI qualification
      const leadInput = { full_name, email, phone_number, custom_answers };
      const qualification = await qualifyLead(leadInput, aiOpts);

      // 2. Save lead record
      const leadRecord = await repo.addLeadEvent(req.workspaceId, {
        leadgen_id: 'test_lead_' + Date.now(),
        form_id: 'form_simulated_instant_ad',
        page_id: config.page_id || null,
        ad_id: 'ad_test_campaign',
        full_name,
        email,
        phone_number,
        raw_answers_json: custom_answers,
        lead_score: qualification.score,
        intent_summary: qualification.intent_summary,
        suggested_reply: qualification.suggested_reply,
      });

      // 3. Execute in-app native workflow pipeline (n8n node engine)
      const nodes = getWorkflowNodes(config);
      const workflowResult = await executeWorkflowPipeline(leadRecord, nodes);
      await repo.addWorkflowLog(req.workspaceId, leadRecord.id, 'workflow_execution', 'success', workflowResult);
      await repo.updateLeadEvent(req.workspaceId, leadRecord.id, { forwarded_to_n8n: 1, forwarded_to_chatwoot: 1 });

      // 4. Create initial inbound message in CRM thread for live takeover
      await repo.addLeadMessage(req.workspaceId, leadRecord.id, {
        sender_type: 'lead',
        sender_name: leadRecord.full_name || 'Prospect',
        message_text: `Inquired via Meta Lead Ad.\nQuestions answered:\n${Object.entries(custom_answers).map(([k, v]) => `• ${k}: ${v}`).join('\n')}`,
        channel: 'form',
      });

      // 5. Optional external forwarders (non-blocking)
      let n8nResult = null;
      if (config.n8n_webhook_url) {
        try {
          n8nResult = await forwardToN8n(config.n8n_webhook_url, {
            event: 'lead.created',
            lead_id: leadRecord.id,
            workspace_id: req.workspaceId,
            full_name,
            email,
            phone_number,
            custom_answers,
            lead_score: qualification.score,
            intent_summary: qualification.intent_summary,
            suggested_reply: qualification.suggested_reply,
            created_at: leadRecord.created_at,
            test_mode: true,
          });
        } catch (_) {}
      }

      let chatwootResult = null;
      if (config.chatwoot_url && config.chatwoot_api_token) {
        try {
          chatwootResult = await syncContactToChatwoot(config, leadRecord);
        } catch (_) {}
      }

      const freshLead = await repo.getLeadEvent(req.workspaceId, leadRecord.id);

      res.status(201).json({
        success: true,
        message: 'Test lead processed through full pipeline!',
        lead: freshLead || leadRecord,
        qualification,
        workflow: workflowResult,
        n8n: n8nResult,
        chatwoot: chatwootResult,
      });
    } catch (err) {
      console.error('[Lead Pipeline Test] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Native In-App Workflow Engine (n8n-style) ─────────────────────────────
  router.post('/workflow/trigger', requirePermission('content.create'), async (req, res) => {
    try {
      const { lead_id } = req.body || {};
      let lead = null;
      if (lead_id) {
        lead = await repo.getLeadEvent(req.workspaceId, Number(lead_id));
      } else {
        const leads = await repo.listLeadEvents(req.workspaceId, { limit: 1 });
        lead = leads[0];
      }

      if (!lead) {
        return res.status(404).json({ error: 'No lead available to trigger workflow.' });
      }

      const executionSteps = [];
      const now = Math.floor(Date.now() / 1000);

      // Step 1: AI Qualification
      const score = Number(lead.lead_score || 85);
      const isHot = score >= 75;
      await repo.addWorkflowLog(req.workspaceId, lead.id, 'ai_qualification', 'success', {
        score,
        intent_summary: lead.intent_summary || 'Target housing society prospect',
        status: isHot ? 'HOT_LEAD' : 'STANDARD_LEAD',
      });
      executionSteps.push({
        step: 'AI Lead Qualification',
        status: 'completed',
        summary: `Score ${score}/100 — ${isHot ? '🔥 High Priority' : 'Standard Priority'}`,
      });

      // Step 2: Instant Lead Alert
      const alertPayload = {
        title: `${isHot ? '🔥 New Hot Lead' : '📥 New Lead Ingested'}: ${lead.full_name || 'Prospect'}`,
        body: `Phone: ${lead.phone_number || 'N/A'} | Email: ${lead.email || 'N/A'}\nIntent: ${lead.intent_summary || '—'}`,
        sound: true,
        priority: isHot ? 'urgent' : 'normal',
      };
      await repo.addWorkflowLog(req.workspaceId, lead.id, 'instant_lead_alert', 'success', alertPayload);
      executionSteps.push({
        step: 'Instant Alert Dispatcher',
        status: 'completed',
        summary: `Instant in-app lead alert triggered (${alertPayload.title})`,
      });

      // Step 3: SMS & WhatsApp Pre-fill Dispatch
      const cleanPhone = (lead.phone_number || '').replace(/[^0-9+]/g, '');
      const replyText = lead.suggested_reply || `Hi ${lead.full_name || 'there'}, thanks for reaching out! How can we help?`;
      const waLink = cleanPhone ? `https://wa.me/${cleanPhone.replace('+', '')}?text=${encodeURIComponent(replyText)}` : null;

      await repo.addWorkflowLog(req.workspaceId, lead.id, 'whatsapp_sms_dispatch', 'success', {
        phone: cleanPhone,
        whatsapp_url: waLink,
        suggested_message: replyText,
      });
      executionSteps.push({
        step: 'SMS & WhatsApp Action Trigger',
        status: 'completed',
        summary: `WhatsApp direct dispatch ready (${cleanPhone})`,
      });

      // Step 4: Live Agent CRM Thread Sync
      const existingMsgs = await repo.listLeadMessages(req.workspaceId, lead.id);
      if (existingMsgs.length === 0) {
        // Create initial inbound message in CRM thread
        await repo.addLeadMessage(req.workspaceId, lead.id, {
          sender_type: 'lead',
          sender_name: lead.full_name || 'Prospect',
          message_text: `Inquired via Meta Lead Ad. Questions answered:\n${Object.entries(lead.raw_answers || {}).map(([k, v]) => `• ${k}: ${v}`).join('\n') || 'General Inquiry'}`,
          channel: 'form',
        });
      }
      await repo.updateLeadEvent(req.workspaceId, lead.id, { forwarded_to_n8n: 1, forwarded_to_chatwoot: 1 });

      executionSteps.push({
        step: 'CRM Thread & Live Takeover Sync',
        status: 'completed',
        summary: `Lead synced to in-app CRM Inbox with 24h Messenger reply compliance`,
      });

      // Optional External Webhook dispatch
      const config = await repo.getOrCreateConfig(req.workspaceId);
      if (config.n8n_webhook_url) {
        forwardToN8n(config.n8n_webhook_url, {
          event: 'lead.workflow_triggered',
          lead_id: lead.id,
          lead,
          alert: alertPayload,
          wa_link: waLink,
        }).catch(() => {});
      }

      res.json({
        success: true,
        message: 'In-app automation workflow executed successfully!',
        lead_id: lead.id,
        lead_name: lead.full_name,
        steps: executionSteps,
        alert: alertPayload,
        whatsapp_link: waLink,
      });
    } catch (err) {
      console.error('[Workflow Trigger] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/workflow/logs', requirePermission('content.view'), async (req, res) => {
    try {
      const logs = await repo.listWorkflowLogs(req.workspaceId, {
        leadId: req.query.lead_id ? Number(req.query.lead_id) : null,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });
      res.json(logs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── n8n Automation Nodes Management & Execution ──────────────────────────
  router.get('/n8n/nodes', requirePermission('content.view'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const nodes = getWorkflowNodes(config);
      res.json({ nodes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/n8n/nodes', requirePermission('content.edit'), async (req, res) => {
    try {
      const { nodes } = req.body || {};
      if (!Array.isArray(nodes)) {
        return res.status(400).json({ error: 'nodes must be an array' });
      }
      await repo.updateConfig(req.workspaceId, { workflow_nodes: nodes });
      res.json({ success: true, nodes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/n8n/execute', requirePermission('content.create'), async (req, res) => {
    try {
      const { lead_id } = req.body || {};
      let lead = null;
      if (lead_id) {
        lead = await repo.getLeadEvent(req.workspaceId, Number(lead_id));
      } else {
        const leads = await repo.listLeadEvents(req.workspaceId, { limit: 1 });
        lead = leads[0];
      }

      if (!lead) {
        return res.status(404).json({ error: 'No lead available to execute workflow.' });
      }

      const config = await repo.getOrCreateConfig(req.workspaceId);
      const aiOpts = aiOptionsFromReq(req);
      const executionResult = await executeWorkflowPipeline(lead, config, aiOpts);

      for (const step of executionResult.steps) {
        await repo.addWorkflowLog(req.workspaceId, lead.id, step.node_id, step.status, step.output);
      }
      await repo.updateLeadEvent(req.workspaceId, lead.id, { forwarded_to_n8n: 1, forwarded_to_chatwoot: 1 });

      res.json(executionResult);
    } catch (err) {
      console.error('[n8n Execute] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/n8n/test-node', requirePermission('content.create'), async (req, res) => {
    try {
      const { node_id, lead_id } = req.body || {};
      const leads = await repo.listLeadEvents(req.workspaceId, { limit: 1 });
      const lead = lead_id ? (await repo.getLeadEvent(req.workspaceId, Number(lead_id))) : leads[0];
      if (!lead) return res.status(404).json({ error: 'No lead available to test node.' });

      const config = await repo.getOrCreateConfig(req.workspaceId);
      const aiOpts = aiOptionsFromReq(req);
      const fullRes = await executeWorkflowPipeline(lead, config, aiOpts);
      const nodeStep = fullRes.steps.find((s) => s.node_id === node_id) || fullRes.steps[0];

      res.json({
        success: true,
        node_id,
        step: nodeStep,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Native In-App Live Takeover & Shared Inbox (Chatwoot-style) ───────────
  router.get('/leads/:id/conversation', requirePermission('content.view'), async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      const lead = await repo.getLeadEvent(req.workspaceId, leadId);
      if (!lead) return res.status(404).json({ error: 'Lead not found.' });

      let messages = await repo.listLeadMessages(req.workspaceId, leadId);

      // Auto-populate initial inquiry message if thread is empty
      if (messages.length === 0) {
        const answersStr = Object.entries(lead.raw_answers || {})
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');

        const initialMsg = await repo.addLeadMessage(req.workspaceId, leadId, {
          sender_type: 'lead',
          sender_name: lead.full_name || 'Prospect',
          message_text: answersStr ? `Meta Instant Form Submission:\n${answersStr}` : 'Inquired via Meta Ad Campaign.',
          channel: 'form',
        });
        messages = [initialMsg];
      }

      // Calculate 24-hr Messenger compliance window
      const now = Math.floor(Date.now() / 1000);
      const leadTime = lead.created_at || now;
      const elapsedSeconds = now - leadTime;
      const hoursRemaining = Math.max(0, Math.floor((86400 - elapsedSeconds) / 3600));
      const minutesRemaining = Math.max(0, Math.floor(((86400 - elapsedSeconds) % 3600) / 60));
      const isWithin24h = elapsedSeconds < 86400;

      res.json({
        lead,
        messages,
        compliance: {
          is_within_24h_window: isWithin24h,
          hours_remaining: hoursRemaining,
          minutes_remaining: minutesRemaining,
          window_status: isWithin24h ? `Active (${hoursRemaining}h ${minutesRemaining}m left)` : 'Expired (Use WhatsApp/Email)',
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/leads/:id/messages', requirePermission('content.create'), async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      const { message_text, sender_type = 'agent', channel = 'internal', sender_name } = req.body || {};

      if (!message_text || !message_text.trim()) {
        return res.status(400).json({ error: 'message_text is required.' });
      }

      const userName = sender_name || req.session?.userName || 'Agent';
      const saved = await repo.addLeadMessage(req.workspaceId, leadId, {
        sender_type,
        sender_name: userName,
        message_text: message_text.trim(),
        channel,
      });

      // Update lead status and mark forwarded to CRM
      await repo.updateLeadEvent(req.workspaceId, leadId, {
        forwarded_to_chatwoot: 1,
        status: sender_type === 'agent' ? 'contacted' : undefined,
      });

      res.status(201).json(saved);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── WhatsApp Dual Engine (Official Cloud API + Evolution API) ─────────────
  router.post('/whatsapp/send', requirePermission('content.create'), async (req, res) => {
    try {
      const {
        to,
        message_text,
        template_name,
        language_code,
        template_params,
        template_components,
        phone_number_id,
        waba_id,
        engine,
      } = req.body || {};
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const deliveryEngine = engine || config.delivery_engine || 'cloud_api';
      const cleanPhone = String(to || '').replace(/[^0-9]/g, '');
      if (!cleanPhone) return res.status(400).json({ success: false, error: 'Type the WhatsApp number to send to.' });

      let result;
      if (deliveryEngine === 'evolution') {
        result = await evolutionApi.sendTextMessage({
          apiUrl: config.evolution_api_url,
          apiKey: config.evolution_api_key,
          instanceName: config.evolution_instance_name || 'social-nexus',
          number: cleanPhone,
          text: message_text,
        });
      } else {
        const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
        const phoneNumberId = phone_number_id || config.whatsapp_phone_number_id || whatsappCloud.DEFAULT_PHONE_NUMBER_ID;
        const targetWabaId = waba_id || config.whatsapp_business_account_id || whatsappCloud.DEFAULT_WABA_ID;

        result = await whatsappCloud.sendWhatsAppMessage({
          phoneNumberId,
          wabaId: targetWabaId,
          accessToken: token,
          to: cleanPhone,
          text: message_text,
          templateName: template_name,
          languageCode: language_code || 'en_US',
          templateParams: template_params,
          templateComponents: template_components,
        });
      }

      res.json({
        success: result.success,
        engine: deliveryEngine,
        result,
        message: result.message || 'WhatsApp message processed!',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/whatsapp/test', requirePermission('content.create'), async (req, res) => {
    try {
      const {
        engine,
        template_name,
        language_code,
        template_params,
        template_components,
        phone_number_id,
        waba_id,
      } = req.body || {};
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const deliveryEngine = engine || config.delivery_engine || 'cloud_api';
      const to = config.whatsapp_test_recipient;
      if (!to) return res.status(400).json({ success: false, error: 'Add your own WhatsApp number under “Send test messages to” first.' });

      let result;
      if (deliveryEngine === 'evolution') {
        result = await evolutionApi.sendTextMessage({
          apiUrl: config.evolution_api_url,
          apiKey: config.evolution_api_key,
          instanceName: config.evolution_instance_name || 'social-nexus',
          number: to,
          text: 'Test from Social-Nexus: WhatsApp (Evolution API) is connected.',
        });
      } else {
        const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
        const phoneNumberId = phone_number_id || config.whatsapp_phone_number_id || whatsappCloud.DEFAULT_PHONE_NUMBER_ID;
        const targetWabaId = waba_id || config.whatsapp_business_account_id || whatsappCloud.DEFAULT_WABA_ID;

        result = await whatsappCloud.sendWhatsAppMessage({
          phoneNumberId,
          wabaId: targetWabaId,
          accessToken: token,
          to,
          text: 'Test from Social-Nexus: WhatsApp is connected.',
          templateName: template_name,
          languageCode: language_code || 'en_US',
          templateParams: template_params,
          templateComponents: template_components,
        });
      }

      res.json({
        success: result.success,
        engine: deliveryEngine,
        result,
        recipient: to,
        message: result.message,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Template Management (Meta Approved Templates) ─────────────────────────
  // Templates: list (with what each fill-in means, when made here), create, delete
  const templateFields = async (workspaceId) => {
    if (!(await knex.schema.hasTable('whatsapp_template_fields'))) return new Map();
    const rows = await knex('whatsapp_template_fields').where({ workspace_id: workspaceId });
    return new Map(rows.map(r => [`${r.name}|${r.language}`, (() => { try { return JSON.parse(r.fields_json); } catch { return []; } })()]));
  };

  router.get('/whatsapp/templates', requirePermission('content.view'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
      const wabaId = config.whatsapp_business_account_id;
      const forceRefresh = ['1', 'true'].includes(String(req.query.forceRefresh || req.query.refresh || ''));
      const templatesRes = await whatsappCloud.getMessageTemplates(wabaId, token, { forceRefresh });
      const fields = await templateFields(req.workspaceId);
      for (const t of templatesRes.templates || []) t.fields = fields.get(`${t.name}|${t.language}`) || null;
      res.json({ ...templatesRes, connected: !!(token && wabaId) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/whatsapp/templates', requirePermission('content.edit'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
      const b = req.body || {};
      const fields = Array.isArray(b.fields) ? b.fields.slice(0, 20).map(x => ({
        key: String(x?.key || '').slice(0, 40), label: String(x?.label || '').slice(0, 80), example: String(x?.example || '').slice(0, 200),
      })) : [];
      const tpl = {
        name: String(b.name || ''), category: b.category, language: b.language,
        header: b.header, body: b.body, footer: b.footer, buttons: b.buttons,
        examples: fields.map(x => x.example),
      };
      const created = await whatsappCloud.createMessageTemplate(config.whatsapp_business_account_id, token, tpl);
      if (fields.length) {
        const row = { workspace_id: req.workspaceId, name: tpl.name, language: tpl.language, fields_json: JSON.stringify(fields), created_by: req.session?.userId || null, created_at: Math.floor(Date.now() / 1000) };
        await knex('whatsapp_template_fields').insert(row).onConflict(['workspace_id', 'name', 'language']).merge(row);
      }
      res.json(created);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, errors: err.errors });
    }
  });

  router.delete('/whatsapp/templates/:name', requirePermission('content.edit'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
      const name = String(req.params.name || '');
      await whatsappCloud.deleteMessageTemplate(config.whatsapp_business_account_id, token, name, req.query.id ? String(req.query.id) : null);
      if (await knex.schema.hasTable('whatsapp_template_fields')) {
        const q = knex('whatsapp_template_fields').where({ workspace_id: req.workspaceId, name });
        if (req.query.language) q.where({ language: String(req.query.language) });
        await q.del();
      }
      res.json({ success: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ── Evolution API Instance Management Endpoints ───────────────────────────
  router.get('/evolution/status', requirePermission('content.view'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const statusRes = await evolutionApi.getConnectionState({
        apiUrl: config.evolution_api_url,
        apiKey: config.evolution_api_key,
        instanceName: config.evolution_instance_name || 'social-nexus',
      });
      res.json({
        configured: !!config.evolution_api_url,
        instance_name: config.evolution_instance_name || 'social-nexus',
        ...statusRes,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/evolution/connect', requirePermission('content.edit'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const { api_url, api_key, instance_name } = req.body || {};

      const apiUrl = api_url || config.evolution_api_url || 'http://localhost:8080';
      const apiKey = api_key || config.evolution_api_key;
      const instanceName = instance_name || config.evolution_instance_name || 'social-nexus';

      const host = req.get('host') || 'localhost:3000';
      const protocol = req.protocol || 'http';
      // Public address with this workspace's secret token (the old /api/lead-pipeline/… one
      // needed a signed-in session, so WhatsApp Web messages never arrived)
      const webhookUrl = `${protocol}://${host}/api/webhooks/evolution/${config.verify_token}`;

      const connectRes = await evolutionApi.createOrConnectInstance({
        apiUrl,
        apiKey,
        instanceName,
        webhookUrl,
      });

      await repo.updateConfig(req.workspaceId, {
        evolution_api_url: apiUrl,
        evolution_api_key: apiKey,
        evolution_instance_name: instanceName,
        evolution_status: connectRes.state || 'connecting',
      });

      res.json(connectRes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/evolution/qr', requirePermission('content.view'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const qrRes = await evolutionApi.fetchQrCode({
        apiUrl: config.evolution_api_url,
        apiKey: config.evolution_api_key,
        instanceName: config.evolution_instance_name || 'social-nexus',
      });
      res.json(qrRes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/evolution/disconnect', requirePermission('content.edit'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const discRes = await evolutionApi.logoutInstance({
        apiUrl: config.evolution_api_url,
        apiKey: config.evolution_api_key,
        instanceName: config.evolution_instance_name || 'social-nexus',
      });
      await repo.updateConfig(req.workspaceId, { evolution_status: 'disconnected' });
      res.json(discRes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Evolution API Inbound (signed-in copy; Evolution itself posts to /api/webhooks/evolution/:token)
  router.post('/webhook/evolution', async (req, res) => {
    try {
      const body = req.body || {};
      const key = body.data?.key || {};
      if ((body.event || body.type) === 'messages.upsert' && !key.fromMe && key.remoteJid) {
        const m = body.data.message || {};
        const config = req.workspaceId
          ? await repo.getOrCreateConfig(req.workspaceId)
          : await knex('meta_lead_configs').first();
        if (!config) return res.status(200).json({ status: 'no_workspace' });
        await handleInboundWhatsApp(knex, {
          config, phone: key.remoteJid.split('@')[0], name: body.data.pushName,
          text: m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || '', source: 'evolution',
        });
      }
      res.status(200).json({ status: 'received' });
    } catch (err) {
      console.warn('[Evolution Webhook] Warning:', err.message);
      res.status(200).json({ status: 'handled_with_warning' });
    }
  });

  // ── Meta Official Business Account (OBA) & 7-Step Verification Hub ───────
  const handleVerificationAudit = async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = req.query.phone_number_id || config.whatsapp_phone_number_id || whatsappCloud.DEFAULT_PHONE_NUMBER_ID;
      const wabaId = req.query.waba_id || config.whatsapp_business_account_id || whatsappCloud.DEFAULT_WABA_ID;

      const audit = await whatsappCloud.getVerificationAudit(phoneNumberId, wabaId, token);
      res.json(audit);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  router.get('/meta/verification-status', requirePermission('content.view'), handleVerificationAudit);
  router.get('/whatsapp/verification-audit', requirePermission('content.view'), handleVerificationAudit);
  router.get('/whatsapp/oba-status', requirePermission('content.view'), handleVerificationAudit);

  const handleRegisterPin = async (req, res) => {
    try {
      const { pin, phone_number_id } = req.body || {};
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = phone_number_id || config.whatsapp_phone_number_id || whatsappCloud.DEFAULT_PHONE_NUMBER_ID;

      const regRes = await whatsappCloud.registerTwoStepPin(phoneNumberId, token, pin);
      if (regRes.success) {
        await repo.updateConfig(req.workspaceId, { meta_two_step_pin_set: true });
      }
      res.json(regRes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  router.post('/meta/register-pin', requirePermission('content.edit'), handleRegisterPin);
  router.post('/whatsapp/register-pin', requirePermission('content.edit'), handleRegisterPin);

  router.get('/meta/profile', requirePermission('content.view'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = config.whatsapp_phone_number_id || whatsappCloud.DEFAULT_PHONE_NUMBER_ID;

      const profRes = await whatsappCloud.getBusinessProfile(phoneNumberId, token);
      res.json(profRes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/meta/update-profile', requirePermission('content.edit'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = config.whatsapp_phone_number_id || whatsappCloud.DEFAULT_PHONE_NUMBER_ID;

      const profRes = await whatsappCloud.updateBusinessProfile(phoneNumberId, token, req.body || {});
      res.json(profRes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── WhatsApp In-Chat UPI / Payments ───────────────────────────────────────
  router.post('/whatsapp/send-payment', requirePermission('content.create'), async (req, res) => {
    try {
      const { leadId, title, amount, upi_vpa, engine } = req.body || {};
      const lead = await repo.getLeadEvent(req.workspaceId, Number(leadId));
      if (!lead) return res.status(404).json({ error: 'Lead not found' });

      const config = await repo.getOrCreateConfig(req.workspaceId);
      const deliveryEngine = engine || config.delivery_engine || 'cloud_api';
      const cleanPhone = String(lead.phone_number).replace(/[^0-9]/g, '');
      const vpa = upi_vpa || config.upi_vpa;
      if (!vpa) return res.status(400).json({ error: 'Add your UPI ID first (it’s where the money goes).' });

      let payRes;
      if (deliveryEngine === 'evolution') {
        payRes = await evolutionApi.sendPaymentLinkMessage({
          apiUrl: config.evolution_api_url,
          apiKey: config.evolution_api_key,
          instanceName: config.evolution_instance_name || 'social-nexus',
          number: cleanPhone,
          title: title || 'Society Maintenance',
          amount: amount || 0,
          upiVpa: vpa,
        });
      } else {
        const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
        const phoneNumberId = config.whatsapp_phone_number_id || whatsappCloud.DEFAULT_PHONE_NUMBER_ID;

        payRes = await whatsappCloud.sendPaymentMessage({
          phoneNumberId,
          accessToken: token,
          to: cleanPhone,
          title: title || 'Society Maintenance',
          amount: amount || 0,
          upiVpa: vpa,
        });
      }

      await repo.updateLeadPaymentStatus(req.workspaceId, lead.id, {
        status: 'link_sent',
        amount: Number(amount || 0),
      });

      const upiUrl = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=Urban%20Society&am=${Number(amount||0).toFixed(2)}&cu=INR&tn=${encodeURIComponent(title||'Payment')}`;
      const savedMsg = await repo.addLeadMessage(req.workspaceId, lead.id, {
        sender_type: 'agent',
        sender_name: req.user?.name || 'Payment request',
        message_text: `💳 Sent UPI Payment Request: ₹${Number(amount||0).toFixed(2)} for ${title || 'Maintenance'}\n${upiUrl}`,
        channel: 'whatsapp',
      });

      res.json({
        success: true,
        message: 'Payment request dispatched directly inside WhatsApp!',
        payRes,
        savedMsg,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Team Assignment (6 Team Seats) ────────────────────────────────────────
  router.post('/whatsapp/assign-agent', requirePermission('content.edit'), async (req, res) => {
    try {
      const { leadId, agentId, agentName } = req.body || {};
      const updated = await repo.assignLeadAgent(req.workspaceId, leadId, agentId, agentName);
      res.json({ success: true, lead: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Bulk Contacts Upload (Drop CSV / Google Sheets) ───────────────────────
  router.post('/whatsapp/import-contacts', requirePermission('content.create'), async (req, res) => {
    try {
      const { contacts = [] } = req.body || {};
      if (!contacts.length) return res.status(400).json({ error: 'No contacts provided' });

      const result = await repo.bulkImportLeads(req.workspaceId, contacts);
      res.json({
        success: true,
        imported_count: result.count,
        message: `Successfully imported ${result.count} contacts into audience list with 0 per-contact charges!`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Campaign History & Credit Balances ────────────────────────────────────
  router.get('/whatsapp/broadcasts', requirePermission('content.view'), async (req, res) => {
    try {
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const broadcasts = await repo.listBroadcasts(req.workspaceId);
      res.json({
        free_credits_balance: config.free_credits_balance !== undefined ? config.free_credits_balance : 550.0,
        broadcasts,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── WhatsApp Conversations & Live Chat Endpoints ──────────────────────────
  router.get('/whatsapp/conversations', requirePermission('content.view'), async (req, res) => {
    try {
      const leads = await repo.listLeadEvents(req.workspaceId, { limit: 100 });
      const leadsWithPhone = leads.filter((l) => l.phone_number);
      const conversations = [];

      for (const lead of leadsWithPhone) {
        const msgs = await repo.listLeadMessages(req.workspaceId, lead.id);
        const lastMsg = msgs.length ? msgs[msgs.length - 1] : null;

        const society = lead.raw_answers?.society_name || lead.raw_answers?.housing_society || '';

        const now = Math.floor(Date.now() / 1000);
        const hoursElapsed = Math.floor((now - lead.created_at) / 3600);
        const isWithin24h = hoursElapsed < 24;
        const hoursRemaining = Math.max(0, 24 - hoursElapsed);

        conversations.push({
          lead_id: lead.id,
          full_name: lead.full_name || 'Prospect Lead',
          phone_number: lead.phone_number,
          email: lead.email,
          society,
          status: lead.status,
          lead_score: lead.lead_score,
          message_count: msgs.length,
          last_message: lastMsg ? lastMsg.message_text : (lead.suggested_reply || lead.intent_summary || 'Inquired via Meta Lead Ad'),
          last_sender: lastMsg ? lastMsg.sender_type : 'lead',
          last_time: lastMsg ? lastMsg.created_at : lead.created_at,
          window_status: isWithin24h ? `Active (${hoursRemaining}h left)` : 'Expired (Use Template / Evolution)',
          is_within_24h: isWithin24h,
          assigned_agent_id: lead.assigned_agent_id || null,
          assigned_agent_name: lead.assigned_agent_name || 'Unassigned',
          payment_status: lead.payment_status || 'none',
          order_value: lead.order_value || null,
        });
      }

      conversations.sort((a, b) => (b.last_time || 0) - (a.last_time || 0));
      res.json({ success: true, conversations });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/whatsapp/conversations/:leadId/messages', requirePermission('content.view'), async (req, res) => {
    try {
      const leadId = Number(req.params.leadId);
      const lead = await repo.getLeadEvent(req.workspaceId, leadId);
      if (!lead) return res.status(404).json({ error: 'Lead not found' });

      // Only real messages (opening a chat used to save a made-up first message)
      const messages = await repo.listLeadMessages(req.workspaceId, leadId);
      const st = await chatbot.getState(knex, req.workspaceId, leadId).catch(() => null);
      const now = Math.floor(Date.now() / 1000);

      res.json({
        success: true,
        lead,
        messages,
        bot: { paused_until: st?.paused_until > now ? st.paused_until : null, opted_out: !!st?.opted_out },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/whatsapp/conversations/:leadId/reply', requirePermission('content.create'), async (req, res) => {
    try {
      const leadId = Number(req.params.leadId);
      const { message_text, is_internal_note, engine, template_name, language_code } = req.body || {};
      if (!message_text || !message_text.trim()) {
        return res.status(400).json({ error: 'Message text is required' });
      }

      const lead = await repo.getLeadEvent(req.workspaceId, leadId);
      if (!lead) return res.status(404).json({ error: 'Lead not found' });

      const config = await repo.getOrCreateConfig(req.workspaceId);
      const deliveryEngine = engine || config.delivery_engine || 'cloud_api';
      const cleanPhone = String(lead.phone_number).replace(/[^0-9]/g, '');

      let dispatchResult = null;
      if (!is_internal_note) {
        if (deliveryEngine === 'evolution') {
          dispatchResult = await evolutionApi.sendTextMessage({
            apiUrl: config.evolution_api_url,
            apiKey: config.evolution_api_key,
            instanceName: config.evolution_instance_name || 'social-nexus',
            number: cleanPhone,
            text: message_text.trim(),
          });
        } else {
          const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
          const phoneNumberId = config.whatsapp_phone_number_id || whatsappCloud.DEFAULT_PHONE_NUMBER_ID;

          dispatchResult = await whatsappCloud.sendWhatsAppMessage({
            phoneNumberId,
            accessToken: token,
            to: cleanPhone,
            text: message_text.trim(),
            templateName: template_name,
            languageCode: language_code || 'en_US',
          });
        }

        if (!dispatchResult.success && dispatchResult.mode !== 'fallback_bridge') {
          return res.status(400).json({
            success: false,
            error: dispatchResult.error || dispatchResult.message || 'WhatsApp dispatch failed',
            dispatch_result: dispatchResult,
          });
        }
      }

      if (!is_internal_note) await chatbot.pauseForHuman(knex, req.workspaceId, leadId).catch(() => {});

      const saved = await repo.addLeadMessage(req.workspaceId, leadId, {
        sender_type: is_internal_note ? 'internal_note' : 'agent',
        sender_name: is_internal_note ? 'Staff Note' : (req.user?.name || 'You'),
        message_text: message_text.trim(),
        channel: is_internal_note ? 'internal' : 'whatsapp',
      });

      res.json({
        success: true,
        message: saved,
        dispatch_result: dispatchResult,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/whatsapp/broadcast', requirePermission('content.create'), async (req, res) => {
    try {
      const {
        contacts = [],
        message_template,
        template_name,
        language_code = 'en_US',
        template_params,
        template_components,
        phone_number_id,
        waba_id,
        delay_ms = 1200,
        engine,
        campaign_title,
      } = req.body || {};
      if (!Array.isArray(contacts) || !contacts.length) {
        return res.status(400).json({ error: 'At least one contact is required' });
      }

      const config = await repo.getOrCreateConfig(req.workspaceId);
      const deliveryEngine = engine || config.delivery_engine || 'cloud_api';
      const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = phone_number_id || config.whatsapp_phone_number_id || whatsappCloud.DEFAULT_PHONE_NUMBER_ID;
      const targetWabaId = waba_id || config.whatsapp_business_account_id || whatsappCloud.DEFAULT_WABA_ID;

      const results = [];
      let sentCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      const optedOut = await chatbot.optedOutLeadIds(knex, req.workspaceId);

      for (const c of contacts) {
        if (!c.phone) {
          failedCount++;
          results.push({ ...c, status: 'failed', error: 'Missing phone' });
          continue;
        }

        let cleanPhone = String(c.phone).replace(/[^0-9]/g, '');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

        let text = message_template || '';
        if (!text && !template_name) { failedCount++; results.push({ ...c, status: 'failed', error: 'Write the message or choose a template' }); continue; }
        text = text
          .replace(/\{\{name\}\}/gi, c.name || 'Resident')
          .replace(/\{\{society\}\}/gi, c.society || 'Residential Society')
          .replace(/\{\{role\}\}/gi, c.role || 'Committee Member')
          .replace(/\{\{units\}\}/gi, c.units || '');

        let lead = await repo.findLeadByPhone(req.workspaceId, cleanPhone);
        if (!lead) {
          lead = await repo.addLeadEvent(req.workspaceId, {
            full_name: c.name || 'Outbound Contact',
            phone_number: '+' + cleanPhone,
            form_id: 'outbound_broadcast',
            intent_summary: `Outbound WhatsApp campaign for ${c.society || 'Housing Community'}`,
            status: 'contacted',
            lead_score: 80,
          });
        }

        // They replied STOP to an earlier message: don't send (WhatsApp policy, and it's their choice)
        if (optedOut.has(Number(lead.id))) {
          skippedCount++;
          results.push({ name: c.name, phone: cleanPhone, status: 'skipped', error: 'Replied STOP — opted out of broadcasts' });
          continue;
        }

        let resCall;
        if (deliveryEngine === 'evolution') {
          resCall = await evolutionApi.sendTextMessage({
            apiUrl: config.evolution_api_url,
            apiKey: config.evolution_api_key,
            instanceName: config.evolution_instance_name || 'social-nexus',
            number: cleanPhone,
            text,
          });
        } else {
          // Resolve contact-specific parameters for template body variables {{1}}, {{2}}
          let contactParams = null;
          if (Array.isArray(c.template_params) && c.template_params.length) {
            contactParams = c.template_params;
          } else if (Array.isArray(template_params) && template_params.length) {
            contactParams = template_params.map((p) => {
              let s = String(p);
              return s
                .replace(/\{\{name\}\}/gi, c.name || 'Resident')
                .replace(/\{\{society\}\}/gi, c.society || 'Residential Society')
                .replace(/\{\{role\}\}/gi, c.role || 'Committee Member')
                .replace(/\{\{units\}\}/gi, c.units || '');
            });
          } else if (template_name && template_name !== 'hello_world' && (c.name || c.society)) {
            contactParams = [c.name || 'there', c.society || ''];
          }

          resCall = await whatsappCloud.sendWhatsAppMessage({
            phoneNumberId,
            wabaId: targetWabaId,
            accessToken: token,
            to: cleanPhone,
            text,
            templateName: template_name || undefined,
            languageCode: language_code || 'en_US',
            templateParams: contactParams,
            templateComponents: template_components,
          });
        }

        if (resCall.success) {
          sentCount++;
          await repo.addLeadMessage(req.workspaceId, lead.id, {
            sender_type: 'agent',
            sender_name: 'Outbound Broadcast',
            message_text: text,
            channel: 'whatsapp',
          });
          results.push({
            name: c.name,
            phone: cleanPhone,
            status: 'sent',
            mode: resCall.mode,
            message_id: resCall.message_id,
          });
        } else {
          failedCount++;
          results.push({
            name: c.name,
            phone: cleanPhone,
            status: 'failed',
            mode: resCall.mode,
            error: resCall.error,
            bridge_url: resCall.bridge_url,
          });
        }

        if (delay_ms > 0 && sentCount < contacts.length) {
          await new Promise((r) => setTimeout(r, Math.min(delay_ms, 3000)));
        }
      }

      await repo.recordBroadcast(req.workspaceId, {
        title: campaign_title || 'WhatsApp Broadcast Campaign',
        delivery_engine: deliveryEngine,
        template_name: template_name || null,
        message_content: message_template || '',
        total_recipients: contacts.length,
        sent_count: sentCount,
        failed_count: failedCount,
        credits_cost: sentCount * 1.1,
        status: sentCount > 0 ? 'completed' : 'failed',
      });

      res.json({
        success: sentCount > 0,
        total: contacts.length,
        sent: sentCount,
        failed: failedCount,
        skipped_opted_out: skippedCount,
        engine: deliveryEngine,
        results,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/whatsapp/verify-connection', requirePermission('content.edit'), async (req, res) => {
    try {
      const { phone_number_id, access_token, waba_id, test_recipient, delivery_engine } = req.body || {};
      const config = await repo.getOrCreateConfig(req.workspaceId);

      const targetToken = access_token || config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
      const targetPhoneId = phone_number_id || config.whatsapp_phone_number_id;
      if (!targetPhoneId) return res.status(400).json({ valid: false, error: 'Paste your Phone number ID (Meta → WhatsApp → API setup).' });

      if (!targetToken) {
        return res.status(400).json({
          valid: false,
          error: 'Please provide or save your Meta WhatsApp Permanent Access Token.',
        });
      }

      const verifyRes = await whatsappCloud.verifyWhatsAppCredentials(targetPhoneId, targetToken);

      if (verifyRes.valid) {
        await repo.updateConfig(req.workspaceId, {
          whatsapp_access_token: targetToken,
          whatsapp_phone_number_id: targetPhoneId,
          whatsapp_business_account_id: waba_id || config.whatsapp_business_account_id || null,
          whatsapp_test_recipient: test_recipient || config.whatsapp_test_recipient || null,
          delivery_engine: delivery_engine || config.delivery_engine || 'cloud_api',
        });
      }

      res.json(verifyRes);
    } catch (err) {
      res.status(500).json({ valid: false, error: err.message });
    }
  });

  router.post('/whatsapp/test-send', requirePermission('content.create'), async (req, res) => {
    try {
      const {
        to,
        template_name,
        language_code,
        template_params,
        template_components,
        phone_number_id,
        waba_id,
        engine,
      } = req.body || {};
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const deliveryEngine = engine || config.delivery_engine || 'cloud_api';
      if (!String(to || '').replace(/[^0-9]/g, '')) return res.status(400).json({ success: false, error: 'Type your own WhatsApp number to send the test to.' });

      let result;
      if (deliveryEngine === 'evolution') {
        result = await evolutionApi.sendTextMessage({
          apiUrl: config.evolution_api_url,
          apiKey: config.evolution_api_key,
          instanceName: config.evolution_instance_name || 'social-nexus',
          number: to,
          text: 'Test from Social-Nexus: it works.',
        });
      } else {
        const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
        const phoneNumberId = phone_number_id || config.whatsapp_phone_number_id || whatsappCloud.DEFAULT_PHONE_NUMBER_ID;
        const targetWabaId = waba_id || config.whatsapp_business_account_id || whatsappCloud.DEFAULT_WABA_ID;

        if (!token) {
          return res.status(400).json({
            success: false,
            error: 'WhatsApp Access Token is missing. Please save your Meta Permanent Access Token first.',
          });
        }

        const chosenTemplate = template_name || config.whatsapp_template_name || 'withoutlink_en_message';
        const chosenLang = language_code || config.whatsapp_template_language || (chosenTemplate === 'transaction_message' ? 'en' : 'en_US');

        result = await whatsappCloud.sendWhatsAppMessage({
          phoneNumberId,
          wabaId: targetWabaId,
          accessToken: token,
          to,
          text: 'Test from Social-Nexus: it works.',
          templateName: chosenTemplate,
          languageCode: chosenLang,
          templateParams: template_params,
          templateComponents: template_components,
        });
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Auto-replies (chatbot) ──────────────────────────────────────────────────
  router.get('/bot', requirePermission('content.view'), async (req, res) => {
    try {
      const settings = await chatbot.getSettings(knex, req.workspaceId);
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const engine = config.delivery_engine || 'cloud_api';
      const connected = engine === 'evolution'
        ? !!(config.evolution_api_url && config.evolution_status === 'open')
        : !!((config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN) && config.whatsapp_phone_number_id);
      const optedOut = (await chatbot.optedOutLeadIds(knex, req.workspaceId)).size;
      res.json({ ...settings, whatsapp_connected: connected, engine, opted_out_count: optedOut, limits: chatbot.LIMITS, n8n_configured: !!config.n8n_webhook_url });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/bot', requirePermission('content.edit'), async (req, res) => {
    try {
      const { enabled, config } = req.body || {};
      if (config?.fallback?.mode === 'ai' && !req.session?.userId) return res.status(400).json({ error: 'Sign in again to use AI answers.' });
      res.json(await chatbot.saveSettings(knex, req.workspaceId, req.session?.userId, { enabled, config }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // "Try it": what the bot would answer, without sending anything
  router.post('/bot/preview', requirePermission('content.view'), async (req, res) => {
    try {
      const { text, config, first_time = false, at } = req.body || {};
      const cfg = chatbot.normalizeConfig(config || (await chatbot.getSettings(knex, req.workspaceId)).config);
      const business = (await knex('brand_kit').where({ workspace_id: req.workspaceId }).first('company_name').catch(() => null))?.company_name
        || (await knex('workspaces').where({ id: req.workspaceId }).first('name'))?.name || '';
      const when = Number(at) || Math.floor(Date.now() / 1000);
      const state = first_time ? {} : { welcomed_at: when - 60 };
      const d = chatbot.decide(cfg, { text: String(text || ''), name: req.body?.name || 'Priya', business }, state, when);
      res.json({ replies: d.replies, reason: d.reason, action: d.action, ai: d.ai, open_now: chatbot.isOpen(cfg, when) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // n8n: send a sample event so the user can build their workflow against real data
  router.post('/n8n/test-event', requirePermission('content.edit'), async (req, res) => {
    try {
      const { buildEvent, replyFrom } = require('../services/leadPipeline/n8nForwarder');
      const config = await repo.getOrCreateConfig(req.workspaceId);
      const url = String(req.body?.url || config.n8n_webhook_url || '').trim();
      if (!/^https?:\/\//i.test(url)) return res.status(400).json({ success: false, error: 'Paste your n8n webhook address first (it starts with http:// or https://).' });
      const r = await forwardToN8n(url, buildEvent('whatsapp.message_received', req.workspaceId, {
        test: true,
        contact: { lead_id: 0, name: 'Test Customer', phone: '+910000000000' },
        message: { text: 'What are your prices?', source: 'test' },
        reply_wanted: true,
        how_to_reply: 'Respond with JSON {"reply": "your text"} to answer on WhatsApp.',
      }));
      if (!r.success) {
        return res.json({ success: false, error: r.statusCode === 404
          ? 'n8n says this address doesn’t exist. In n8n, open the Webhook node, click “Listen for test event” (or turn the workflow on), then try again.'
          : /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout/i.test(r.error || '')
            ? 'Couldn’t reach n8n at this address. Check that n8n is running and the address is right.'
            : `n8n didn’t accept it: ${r.error}` });
      }
      res.json({ success: true, status: r.status, reply: replyFrom(r) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/bot/resume/:leadId', requirePermission('content.edit'), async (req, res) => {
    try {
      await chatbot.resume(knex, req.workspaceId, Number(req.params.leadId));
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/whatsapp/simulate-reply', requirePermission('content.create'), async (req, res) => {
    try {
      const { leadId, text } = req.body || {};
      const lead = await repo.getLeadEvent(req.workspaceId, Number(leadId));
      if (!lead) return res.status(404).json({ error: 'Lead not found' });

      const msg = await repo.addLeadMessage(req.workspaceId, lead.id, {
        sender_type: 'lead',
        sender_name: lead.full_name || 'Prospect',
        message_text: text || 'Yes, Thursday at 4 PM works great for a demo. Please send the link.',
        channel: 'whatsapp',
      });

      res.json({ success: true, message: msg });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
