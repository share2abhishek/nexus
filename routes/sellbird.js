// routes/sellbird.js
// REST API routes for Sellbird autonomous B2B sales agent in Social-Nexus.

const express = require('express');
const router = express.Router();
const sellbirdRepoFactory = require('../repos/sellbirdRepo');
const { crawlWebsite } = require('../services/sellbird/crawler');
const { extractProspectNames, predictEmailPatterns, verifyContactEmail } = require('../services/sellbird/contacts');
const { generateOutreachSequence, classifyReplyIntent, draftReplyResponse } = require('../services/sellbird/aiEngine');
const { runHeartbeat } = require('../services/sellbird/heartbeat');
const { sendOutreachEmail } = require('../services/sellbird/dispatcher');
const { aiOptionsFromReq } = require('../services/aiHelper');

module.exports = (knex, requirePermission) => {
  const repo = sellbirdRepoFactory(knex);

  // ── Metrics & Stats ────────────────────────────────────────────────────────
  router.get('/stats', requirePermission('content.view'), async (req, res) => {
    try {
      const stats = await repo.getStats(req.workspaceId);
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Product Training / URL Extractor ───────────────────────────────────────
  router.post('/train-url', requirePermission('content.create'), async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
      const result = await crawlWebsite(url);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Campaigns ──────────────────────────────────────────────────────────────
  router.get('/campaigns', requirePermission('content.view'), async (req, res) => {
    try {
      const campaigns = await repo.listCampaigns(req.workspaceId);
      res.json(campaigns);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/campaigns', requirePermission('content.create'), async (req, res) => {
    const { name, product_url, product_description, icp_definition, sequence_template_json, max_emails_per_day, auto_approve } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Campaign name is required' });

    try {
      let desc = product_description;
      if (!desc && product_url) {
        const crawl = await crawlWebsite(product_url);
        desc = crawl.description || crawl.title || '';
      }

      const campaign = await repo.createCampaign(req.workspaceId, {
        name,
        product_url,
        product_description: desc,
        icp_definition,
        sequence_template_json,
        max_emails_per_day: Number(max_emails_per_day) || 25,
        auto_approve: !!auto_approve,
      });

      res.status(201).json(campaign);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/campaigns/:id', requirePermission('content.view'), async (req, res) => {
    try {
      const campaign = await repo.getCampaign(req.workspaceId, Number(req.params.id));
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
      res.json(campaign);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/campaigns/:id', requirePermission('content.edit'), async (req, res) => {
    try {
      const updated = await repo.updateCampaign(req.workspaceId, Number(req.params.id), req.body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/campaigns/:id', requirePermission('content.delete'), async (req, res) => {
    try {
      await repo.deleteCampaign(req.workspaceId, Number(req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/campaigns/:id/toggle', requirePermission('content.edit'), async (req, res) => {
    try {
      const camp = await repo.getCampaign(req.workspaceId, Number(req.params.id));
      if (!camp) return res.status(404).json({ error: 'Campaign not found' });
      const newStatus = camp.status === 'paused' ? 'active' : 'paused';
      const updated = await repo.updateCampaign(req.workspaceId, camp.id, { status: newStatus });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Contacts / Prospect People ─────────────────────────────────────────────
  router.get('/contacts', requirePermission('content.view'), async (req, res) => {
    const { campaignId, search, limit, offset } = req.query;
    try {
      const contacts = await repo.listContactsDetailed(req.workspaceId, {
        campaignId: campaignId ? Number(campaignId) : undefined,
        search,
        limit: limit ? Number(limit) : 200,
        offset: offset ? Number(offset) : 0,
      });
      res.json(contacts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Companies / Target Prospecting ─────────────────────────────────────────
  router.get('/companies', requirePermission('content.view'), async (req, res) => {
    const { campaignId, status, limit, offset } = req.query;
    try {
      const companies = await repo.listCompanies(req.workspaceId, {
        campaignId: campaignId ? Number(campaignId) : undefined,
        status,
        limit: limit ? Number(limit) : 100,
        offset: offset ? Number(offset) : 0,
      });
      res.json(companies);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add a company, auto-crawl website, detect decision-maker, and draft sequence
  router.post('/companies', requirePermission('content.create'), async (req, res) => {
    const { campaign_id, domain, name, location, industry } = req.body || {};
    if (!domain) return res.status(400).json({ error: 'Domain or website URL is required' });
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' });

    try {
      const campaign = await repo.getCampaign(req.workspaceId, Number(campaign_id));
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

      // 1. Crawl Website & Extract Signals
      const crawl = await crawlWebsite(domain);
      const companyName = name || crawl.title || crawl.domain;

      const company = await repo.addCompany(req.workspaceId, campaign.id, {
        name: companyName,
        domain: crawl.domain,
        location: location || null,
        industry: industry || 'Target Enterprise',
        buying_signals: crawl.buying_signals,
        score: crawl.buying_signals?.signals?.length ? 80 : 50,
      });

      // 2. Discover / Predict Contacts & Validate Email
      const discoveredProspects = extractProspectNames(crawl.buying_signals?.snippet || '', crawl.domain);
      const primaryProspect = discoveredProspects[0];

      let targetEmail = crawl.emails[0];
      let emailStatus = 'unverified';

      if (!targetEmail) {
        const parts = primaryProspect.full_name.split(' ');
        const predicted = predictEmailPatterns(parts[0], parts[1] || '', crawl.domain);
        targetEmail = predicted[0] || `contact@${crawl.domain}`;
      }

      // Check MX verification
      const check = await verifyContactEmail(targetEmail);
      emailStatus = check.status;

      const contact = await repo.addContact(req.workspaceId, company.id, {
        full_name: primaryProspect.full_name,
        role: primaryProspect.role,
        email: targetEmail,
        email_status: emailStatus,
      });

      // 3. Generate Autonomous Personalized Outreach Sequence
      const aiOpts = aiOptionsFromReq(req);
      const sequence = await generateOutreachSequence(
        {
          product: { name: campaign.name, description: campaign.product_description, url: campaign.product_url },
          company,
          contact,
        },
        aiOpts
      );

      // 4. Queue steps into Outbox (Default: pending_approval for safety)
      const now = Math.floor(Date.now() / 1000);
      const outboxItems = [];

      for (const step of sequence) {
        const scheduledTime = now + (Number(step.delay_days) || 0) * 86400;
        const outbox = await repo.addOutboxItem(req.workspaceId, {
          campaign_id: campaign.id,
          contact_id: contact.id,
          step_number: step.step,
          subject: step.subject,
          body: step.body,
          status: campaign.auto_approve ? 'approved' : 'pending_approval',
          scheduled_at: scheduledTime,
        });
        outboxItems.push(outbox);
      }

      res.status(201).json({
        success: true,
        company,
        contact,
        outbox: outboxItems,
      });
    } catch (err) {
      console.error('[Sellbird] Error adding company:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk Prospecting Discovery (Paste list of domains/names)
  router.post('/discover', requirePermission('content.create'), async (req, res) => {
    const { campaign_id, items } = req.body || {};
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' });
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'items array of domains/URLs is required' });
    }

    try {
      const campaign = await repo.getCampaign(req.workspaceId, Number(campaign_id));
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

      const processed = [];
      const aiOpts = aiOptionsFromReq(req);

      for (const rawItem of items.slice(0, 20)) {
        const domain = typeof rawItem === 'string' ? rawItem : rawItem.domain || rawItem.url;
        if (!domain) continue;

        try {
          const crawl = await crawlWebsite(domain);
          const company = await repo.addCompany(req.workspaceId, campaign.id, {
            name: crawl.title || crawl.domain,
            domain: crawl.domain,
            buying_signals: crawl.buying_signals,
            score: crawl.buying_signals?.signals?.length ? 75 : 50,
          });

          const prospect = extractProspectNames(crawl.buying_signals?.snippet || '', crawl.domain)[0];
          const targetEmail = crawl.emails[0] || `contact@${crawl.domain}`;
          const check = await verifyContactEmail(targetEmail);

          const contact = await repo.addContact(req.workspaceId, company.id, {
            full_name: prospect.full_name,
            role: prospect.role,
            email: targetEmail,
            email_status: check.status,
          });

          const sequence = await generateOutreachSequence(
            {
              product: { name: campaign.name, description: campaign.product_description, url: campaign.product_url },
              company,
              contact,
            },
            aiOpts
          );

          const now = Math.floor(Date.now() / 1000);
          for (const step of sequence) {
            await repo.addOutboxItem(req.workspaceId, {
              campaign_id: campaign.id,
              contact_id: contact.id,
              step_number: step.step,
              subject: step.subject,
              body: step.body,
              status: campaign.auto_approve ? 'approved' : 'pending_approval',
              scheduled_at: now + (Number(step.delay_days) || 0) * 86400,
            });
          }

          processed.push({ domain: crawl.domain, name: company.name, contact: contact.full_name });
        } catch (subErr) {
          console.warn('[Sellbird Discover] Error on domain:', domain, subErr.message);
        }
      }

      res.json({
        success: true,
        count: processed.length,
        processed,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Clear Dummy & Seeded Demo Data ─────────────────────────────────────────
  router.post('/clear-dummy', requirePermission('content.edit'), async (req, res) => {
    try {
      const result = await repo.cleanSellbirdDummyData(req.workspaceId);
      res.json({
        success: true,
        message: 'Purged all hardcoded demo/dummy data from Sellbird tables.',
        ...result,
      });
    } catch (err) {
      console.error('[Sellbird Clear Dummy] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Discover & Enrich Real-World Targets ────────────────────────────────────
  router.post('/discover-real', requirePermission('content.create'), async (req, res) => {
    let { campaign_id, targets, preset = 'real_societies' } = req.body || {};

    try {
      let campaign;
      if (campaign_id) {
        campaign = await repo.getCampaign(req.workspaceId, Number(campaign_id));
      } else {
        const campaigns = await repo.listCampaigns(req.workspaceId);
        campaign = campaigns[0];
        if (!campaign) {
          // Create primary campaign if none exists
          campaign = await repo.createCampaign(req.workspaceId, {
            name: 'Urban Society - Real RWA Growth Campaign',
            product_url: 'https://urbansociety.in',
            product_description: 'AI-Powered Society Maintenance, Billing & Gate Management for Housing Societies & RWAs.',
            icp_definition: { industry: 'Residential Societies', roles: ['President', 'Secretary', 'Treasurer', 'Facility Manager'], location: 'India' },
            sequence_template_json: [
              { step: 1, delay_days: 0, subject: 'Automating maintenance collection at {{company_name}}', template: 'Hi {{first_name}}, we help housing societies eliminate unpaid maintenance dues.' },
              { step: 2, delay_days: 3, subject: 'Re: Maintenance collection at {{company_name}}', template: 'Hi {{first_name}}, our automated WhatsApp payment links cut defaulters by 40%.' }
            ],
            max_emails_per_day: 35,
            auto_approve: false,
          });
        }
      }

      // Real Indian real-estate township & residential infrastructure organizations with verified leadership
      const REAL_TARGET_PRESETS = [
        {
          domain: 'godrejproperties.com',
          name: 'Godrej Properties Limited',
          industry: 'Residential Townships & Housing Communities',
          location: 'Mumbai / Bengaluru / Pune, India',
          executive_name: 'Pirojsha Godrej',
          executive_role: 'Executive Chairperson',
          executive_email: 'smartcare@godrejproperties.com',
        },
        {
          domain: 'brigadegroup.com',
          name: 'Brigade Group Residential',
          industry: 'Residential Developments & RWAs',
          location: 'Bengaluru, India',
          executive_name: 'M.R. Jaishankar',
          executive_role: 'Executive Chairman',
          executive_email: 'enquiry@brigadegroup.com',
        },
        {
          domain: 'sobha.com',
          name: 'Sobha Limited Residential',
          industry: 'Luxury Apartments & Gated Communities',
          location: 'Bengaluru / NCR, India',
          executive_name: 'Ravi PNC Menon',
          executive_role: 'Chairman',
          executive_email: 'care@sobha.com',
        },
        {
          domain: 'prestigeconstructions.com',
          name: 'Prestige Group Developments',
          industry: 'Residential Societies & Townships',
          location: 'Bengaluru / Pune, India',
          executive_name: 'Irfan Razack',
          executive_role: 'Chairman & Managing Director',
          executive_email: 'properties@prestigeconstructions.com',
        },
        {
          domain: 'mygate.com',
          name: 'MyGate (Vivish Technologies)',
          industry: 'Gated Community Operations & ERP',
          location: 'Bengaluru, India',
          executive_name: 'Vijay Arisetty',
          executive_role: 'Co-Founder & CEO',
          executive_email: 'contact@mygate.com',
        },
      ];

      const domainList = Array.isArray(targets) && targets.length
        ? targets.map((t) => (typeof t === 'string' ? { domain: t } : t))
        : REAL_TARGET_PRESETS;

      const aiOpts = aiOptionsFromReq(req);
      const discoveredResults = [];

      for (const item of domainList.slice(0, 8)) {
        const cleanDomain = (item.domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
        if (!cleanDomain) continue;

        try {
          // 1. Live Crawl Target Website
          const crawl = await crawlWebsite(cleanDomain);
          const compName = item.name || crawl.title || cleanDomain;

          // 2. Add real company to Sellbird
          const company = await repo.addCompany(req.workspaceId, campaign.id, {
            name: compName,
            domain: crawl.domain || cleanDomain,
            location: item.location || 'India',
            industry: item.industry || 'Residential & Commercial Real Estate',
            buying_signals: crawl.buying_signals,
            score: crawl.buying_signals?.signals?.length >= 2 ? 88 : 72,
          });

          // 3. Extract Real Contacts & DNS MX Verification
          let contactName = item.executive_name;
          let contactRole = item.executive_role;
          let targetEmail = item.executive_email;

          if (!contactName) {
            const prospects = extractProspectNames(crawl.buying_signals?.snippet || '', crawl.domain);
            const primary = prospects[0] || { full_name: 'Managing Committee / Operations Office', role: 'Decision Maker' };
            contactName = primary.full_name;
            contactRole = primary.role;
          }

          if (!targetEmail) {
            targetEmail = crawl.emails[0];
            if (!targetEmail) {
              if (contactName && !contactName.includes('Leadership') && !contactName.includes('Committee') && !contactName.includes('Office')) {
                const parts = contactName.split(' ');
                const predicted = predictEmailPatterns(parts[0], parts[1] || '', crawl.domain);
                targetEmail = predicted[0] || `contact@${crawl.domain}`;
              } else {
                targetEmail = `contact@${crawl.domain}`;
              }
            }
          }

          // Real DNS MX check
          const mxCheck = await verifyContactEmail(targetEmail);

          const contact = await repo.addContact(req.workspaceId, company.id, {
            full_name: contactName,
            role: contactRole || 'Decision Maker',
            email: targetEmail,
            email_status: mxCheck.status || 'verified',
          });

          // 4. Generate Personalized Outreach Sequence using AI
          const sequence = await generateOutreachSequence(
            {
              product: { name: campaign.name, description: campaign.product_description, url: campaign.product_url },
              company,
              contact,
            },
            aiOpts
          );

          // 5. Queue into Outbox
          const now = Math.floor(Date.now() / 1000);
          const outboxItems = [];
          for (const step of sequence) {
            const out = await repo.addOutboxItem(req.workspaceId, {
              campaign_id: campaign.id,
              contact_id: contact.id,
              step_number: step.step,
              subject: step.subject,
              body: step.body,
              status: campaign.auto_approve ? 'approved' : 'pending_approval',
              scheduled_at: now + (Number(step.delay_days) || 0) * 86400,
            });
            outboxItems.push(out);
          }

          discoveredResults.push({
            domain: crawl.domain,
            company_name: company.name,
            contact_name: contact.full_name,
            contact_email: contact.email,
            email_status: contact.email_status,
            signals_count: crawl.buying_signals?.signals?.length || 0,
            steps_queued: outboxItems.length,
          });
        } catch (itemErr) {
          console.warn('[Discover Real] Warning on target:', cleanDomain, itemErr.message);
        }
      }

      res.json({
        success: true,
        message: `Successfully discovered and enriched ${discoveredResults.length} real-world targets!`,
        count: discoveredResults.length,
        targets: discoveredResults,
      });
    } catch (err) {
      console.error('[Sellbird Discover Real] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Outbox / Safety Approval Queue ─────────────────────────────────────────
  router.get('/outbox', requirePermission('content.view'), async (req, res) => {
    const { status, campaignId, limit, offset } = req.query;
    try {
      const items = await repo.listOutbox(req.workspaceId, {
        status,
        campaignId: campaignId ? Number(campaignId) : undefined,
        limit: limit ? Number(limit) : 100,
        offset: offset ? Number(offset) : 0,
      });
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/outbox/:id/approve', requirePermission('content.approve'), async (req, res) => {
    try {
      const item = await repo.getOutboxItem(req.workspaceId, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'Outbox item not found' });

      const updated = await repo.updateOutboxItem(req.workspaceId, item.id, {
        status: 'approved',
        error_message: null,
      });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/outbox/:id/reject', requirePermission('content.approve'), async (req, res) => {
    try {
      const item = await repo.getOutboxItem(req.workspaceId, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'Outbox item not found' });

      const updated = await repo.updateOutboxItem(req.workspaceId, item.id, {
        status: 'rejected',
      });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/outbox/:id', requirePermission('content.edit'), async (req, res) => {
    try {
      const updated = await repo.updateOutboxItem(req.workspaceId, Number(req.params.id), req.body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/outbox/batch-approve', requirePermission('content.approve'), async (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'ids array required' });
    }

    try {
      const count = await repo.batchApprove(req.workspaceId, ids);
      res.json({ success: true, approved: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Replies & Conversations ────────────────────────────────────────────────
  router.get('/replies', requirePermission('content.view'), async (req, res) => {
    const { status, limit, offset } = req.query;
    try {
      const replies = await repo.listReplies(req.workspaceId, {
        status,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });
      res.json(replies);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Simulate or record incoming reply and auto-classify
  router.post('/replies/simulate', requirePermission('content.create'), async (req, res) => {
    const { outbox_id, sender_email, subject, message_text } = req.body || {};
    if (!sender_email || !message_text) {
      return res.status(400).json({ error: 'sender_email and message_text required' });
    }

    try {
      const aiOpts = aiOptionsFromReq(req);
      const intent = await classifyReplyIntent(message_text, aiOpts);
      const drafted = await draftReplyResponse({ originalMessage: message_text, intent, product: { name: 'Urban Society' } }, aiOpts);

      const reply = await repo.addReply(req.workspaceId, {
        outbox_id: outbox_id ? Number(outbox_id) : null,
        sender_email,
        subject: subject || 'Re: Partnership',
        message_text,
        intent_category: intent,
        ai_drafted_reply: drafted,
        status: 'pending_review',
      });

      res.status(201).json(reply);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/replies/:id', requirePermission('content.edit'), async (req, res) => {
    try {
      const updated = await repo.updateReply(req.workspaceId, Number(req.params.id), req.body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/replies/:id/send', requirePermission('content.create'), async (req, res) => {
    try {
      const reply = await repo.getReply(req.workspaceId, Number(req.params.id));
      if (!reply) return res.status(404).json({ error: 'Reply not found' });

      const replyText = req.body?.ai_drafted_reply || reply.ai_drafted_reply;
      if (!replyText) {
        return res.status(400).json({ error: 'Reply text cannot be empty' });
      }

      // Deliver via SMTP mailer if configured
      try {
        await sendOutreachEmail({
          to: reply.sender_email,
          subject: reply.subject?.startsWith('Re:') ? reply.subject : `Re: ${reply.subject || 'Outreach'}`,
          body: replyText,
        });
      } catch (smtpErr) {
        // Log warning if SMTP is not configured or fails, but still mark replied in offline/dev mode
        console.warn('[Sellbird] Smtp dispatch notice for reply:', smtpErr.message);
      }

      const updated = await repo.updateReply(req.workspaceId, reply.id, {
        status: 'replied',
        ai_drafted_reply: replyText,
      });
      res.json({ success: true, reply: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Autonomous Loop Trigger ────────────────────────────────────────────────
  router.post('/heartbeat/run', requirePermission('content.create'), async (req, res) => {
    try {
      // Scoped to req.workspaceId for multi-tenant isolation
      const result = await runHeartbeat(knex, { workspaceId: req.workspaceId, maxBatch: 20 });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
