// routes/sellbird.js
// REST API routes for Sellbird autonomous B2B sales agent in Social-Nexus.

const express = require('express');
const sellbirdRepoFactory = require('../repos/sellbirdRepo');
const { crawlWebsite } = require('../services/sellbird/crawler');
const { extractProspectNames, predictEmailPatterns, verifyContactEmail } = require('../services/sellbird/contacts');
const { generateOutreachSequence, classifyReplyIntent, draftReplyResponse } = require('../services/sellbird/aiEngine');
const { runHeartbeat } = require('../services/sellbird/heartbeat');
const { sendOutreachEmail } = require('../services/sellbird/dispatcher');
const { aiOptionsFromReq } = require('../services/aiHelper');

module.exports = (knex, requirePermission) => {
  const router = express.Router();
  const repo = sellbirdRepoFactory(knex);

  // What the emails say about the sender: the business name from Brand kit and
  // what the campaign offers (the campaign's name was used as the product name before)
  async function productFor(workspaceId, campaign) {
    const brand = await knex('brand_kit').where({ workspace_id: workspaceId }).first('company_name').catch(() => null);
    return { name: brand?.company_name || '', description: campaign.product_description || '', url: campaign.product_url || '' };
  }

  // Who to email at a company. An address found on their website is used as is;
  // otherwise it is a guess and marked "guessed" (it used to be marked "verified"
  // when only the domain had a mail server).
  async function pickContact(crawl, hint = {}) {
    let name = hint.executive_name;
    let role = hint.executive_role;
    if (!name) {
      const p = extractProspectNames(crawl.buying_signals?.snippet || '', crawl.domain)[0];
      name = p.full_name;
      role = p.role;
    }
    const sameDomain = (crawl.emails || []).filter((e) => e.endsWith('@' + crawl.domain) || e.endsWith('.' + crawl.domain));
    let email = hint.executive_email || sameDomain[0] || (crawl.emails || [])[0];
    let guessed = false;
    if (!email) {
      guessed = true;
      const realName = name && !/leadership|committee|office|decision maker/i.test(name);
      const parts = realName ? name.split(/\s+/) : [];
      email = (realName && predictEmailPatterns(parts[0], parts[1] || '', crawl.domain)[0]) || `contact@${crawl.domain}`;
    }
    const check = await verifyContactEmail(email);
    const email_status = check.status === 'invalid' ? 'invalid' : guessed ? 'guessed' : 'verified';
    return { full_name: name, role: role || 'Decision maker', email, email_status };
  }

  // Add one company: open its website, pick who to email, write the emails.
  async function addCompanyWithEmails(req, campaign, target) {
    const crawl = await crawlWebsite(target.domain);
    if (!crawl.success) {
      const why = /private|local/i.test(crawl.description || '') ? 'it’s a private or local address' : 'the website didn’t open';
      const err = new Error(`Couldn’t add ${crawl.domain || target.domain}: ${why}. Check the address and try again.`);
      err.status = 400;
      throw err;
    }
    const company = await repo.addCompany(req.workspaceId, campaign.id, {
      // 'Acme Interiors — office fit-outs in Pune' → 'Acme Interiors'
      name: target.name || (String(crawl.title || '').split(/\s+[|–—:-]\s+/).find((p) => p.trim() && !/^(home|welcome|homepage)$/i.test(p.trim())) || '').trim().slice(0, 120) || crawl.domain,
      domain: crawl.domain,
      location: target.location || null,
      industry: target.industry || null,
      buying_signals: crawl.buying_signals,
      score: crawl.buying_signals?.signals?.length >= 2 ? 80 : crawl.buying_signals?.signals?.length ? 65 : 50,
    });
    const contact = await repo.addContact(req.workspaceId, company.id, await pickContact(crawl, target));
    const sequence = await generateOutreachSequence({ product: await productFor(req.workspaceId, campaign), company, contact }, aiOptionsFromReq(req));
    const now = Math.floor(Date.now() / 1000);
    const outbox = [];
    for (const step of sequence) {
      outbox.push(await repo.addOutboxItem(req.workspaceId, {
        campaign_id: campaign.id,
        contact_id: contact.id,
        step_number: step.step,
        subject: step.subject,
        body: step.body,
        status: campaign.auto_approve ? 'approved' : 'pending_approval',
        scheduled_at: now + (Number(step.delay_days) || 0) * 86400,
      }));
    }
    return { company, contact, outbox };
  }


  // ── Metrics & Stats ────────────────────────────────────────────────────────
  router.get('/stats', requirePermission('content.view'), async (req, res) => {
    try {
      const stats = await repo.getStats(req.workspaceId);
      const { getSmtpConfig, isPaused } = require('../services/sellbird/dispatcher');
      const smtp = getSmtpConfig();
      const now = Math.floor(Date.now() / 1000);
      const todayStart = now - (now % 86400);
      const camps = await knex('sellbird_campaigns').where({ workspace_id: req.workspaceId });
      const active = camps.filter(c => c.status !== 'paused');
      const count = async (q) => Number((await q.count('id as c').first())?.c || 0);
      const sentToday = await count(knex('sellbird_outbox').where({ workspace_id: req.workspaceId, status: 'sent' }).where('sent_at', '>=', todayStart));
      const failed = await count(knex('sellbird_outbox').where({ workspace_id: req.workspaceId, status: 'failed' }));
      res.json({
        ...stats,
        active_campaigns: active.length,
        sent_today: sentToday,
        daily_cap: active.reduce((n, c) => n + (Number(c.max_emails_per_day) || 25), 0),
        failed,
        reply_rate: stats.sent_outreach ? Math.round((stats.total_replies / stats.sent_outreach) * 1000) / 10 : 0,
        paused: await isPaused(knex, req.workspaceId),
        licensed: await require('../services/entitlements').canPublish(req.workspaceId),
        // Emails always go from the address in Settings → Email sending
        sender: smtp ? { email: smtp.from, name: smtp.fromName || '' } : null,
      });
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
        max_emails_per_day: Math.min(200, Math.max(1, Number(max_emails_per_day) || 25)),
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

  router.post('/sending/pause', requirePermission('content.edit'), async (req, res) => {
    const { setPaused } = require('../services/sellbird/dispatcher');
    await setPaused(knex, req.workspaceId, !!req.body?.paused);
    res.json({ paused: !!req.body?.paused });
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

  // Add a company: open its website, pick who to email, write the emails
  router.post('/companies', requirePermission('content.create'), async (req, res) => {
    const { campaign_id, domain, name, location, industry } = req.body || {};
    if (!domain) return res.status(400).json({ error: 'Type the company’s website address.' });
    if (!campaign_id) return res.status(400).json({ error: 'Pick a campaign first.' });
    try {
      const campaign = await repo.getCampaign(req.workspaceId, Number(campaign_id));
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
      const out = await addCompanyWithEmails(req, campaign, { domain, name, location, industry });
      res.status(201).json({ success: true, ...out });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error('[Sales outreach] Error adding company:', err);
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
      const skipped = [];
      for (const rawItem of items.slice(0, 20)) {
        const domain = typeof rawItem === 'string' ? rawItem : rawItem.domain || rawItem.url;
        if (!domain) continue;
        try {
          const { company, contact } = await addCompanyWithEmails(req, campaign, { domain });
          processed.push({ domain: company.domain, name: company.name, contact: contact.full_name, email_status: contact.email_status });
        } catch (subErr) {
          skipped.push({ domain, reason: subErr.message });
        }
      }

      res.json({
        success: true,
        count: processed.length,
        processed,
        skipped,
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
    let { campaign_id, targets } = req.body || {};
    // Only companies the user chose. (A built-in list of real executives at real
    // companies used to be added for everyone — and could then be emailed.)
    if (!Array.isArray(targets) || !targets.length) {
      return res.status(400).json({ error: 'Type the website addresses of the companies you want to look up (one per line).' });
    }

    try {
      let campaign;
      if (campaign_id) {
        campaign = await repo.getCampaign(req.workspaceId, Number(campaign_id));
      } else {
        const campaigns = await repo.listCampaigns(req.workspaceId);
        campaign = campaigns[0];
        if (!campaign) {
          campaign = await repo.createCampaign(req.workspaceId, {
            name: 'My first campaign',
            product_url: '',
            product_description: '',
            max_emails_per_day: 25,
            auto_approve: false,
          });
        }
      }
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
      const domainList = targets.map((t) => (typeof t === 'string' ? { domain: t } : t));

      const discoveredResults = [];
      const skipped = [];
      for (const item of domainList.slice(0, 8)) {
        const cleanDomain = (item.domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
        if (!cleanDomain) continue;
        try {
          const { company, contact, outbox } = await addCompanyWithEmails(req, campaign, { ...item, domain: cleanDomain });
          discoveredResults.push({
            domain: company.domain,
            company_name: company.name,
            contact_name: contact.full_name,
            contact_email: contact.email,
            email_status: contact.email_status,
            signals_count: company.buying_signals?.signals?.length || 0,
            steps_queued: outbox.length,
          });
        } catch (itemErr) {
          skipped.push({ domain: cleanDomain, reason: itemErr.message });
        }
      }

      res.json({
        success: true,
        message: `Added ${discoveredResults.length} compan${discoveredResults.length === 1 ? 'y' : 'ies'}${skipped.length ? `; ${skipped.length} couldn’t be added` : ''}.`,
        count: discoveredResults.length,
        targets: discoveredResults,
        skipped,
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
      if (!['pending_approval', 'failed'].includes(item.status)) {
        return res.status(400).json({ error: item.status === 'sent' || item.status === 'sending' ? 'This email has already gone out.' : item.status === 'approved' ? 'Already approved.' : 'This email was cancelled and can’t be sent.' });
      }
      const { findPlaceholder } = require('../services/sellbird/dispatcher');
      const unfilled = findPlaceholder(item.subject, item.body);
      if (unfilled) return res.status(400).json({ error: `Fill in “${unfilled}” before approving.` });

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
      if (['sent', 'sending'].includes(item.status)) return res.status(400).json({ error: 'This email has already gone out.' });

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
      const item = await repo.getOutboxItem(req.workspaceId, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'Not found' });
      if (['sent', 'sending'].includes(item.status)) return res.status(400).json({ error: 'This email has already gone out.' });
      const { subject, body, scheduled_at } = req.body || {};
      const updated = await repo.updateOutboxItem(req.workspaceId, item.id, { subject, body, scheduled_at });
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
      // The answer knows what the campaign that emailed them offers
      const fromContact = await knex('sellbird_contacts as c').join('sellbird_companies as comp', 'c.company_id', 'comp.id')
        .where('c.workspace_id', req.workspaceId).whereRaw('LOWER(c.email) = ?', [String(sender_email).toLowerCase().trim()])
        .orderBy('c.id', 'desc').first('comp.campaign_id');
      const campaign = fromContact ? await repo.getCampaign(req.workspaceId, fromContact.campaign_id) : null;
      const product = campaign ? await productFor(req.workspaceId, campaign) : await productFor(req.workspaceId, {});
      const drafted = await draftReplyResponse({ originalMessage: message_text, intent, product }, aiOpts);

      // Their follow-ups waiting in the outbox won't go out now
      const contactIds = await knex('sellbird_contacts').where({ workspace_id: req.workspaceId })
        .whereRaw('LOWER(email) = ?', [String(sender_email).toLowerCase().trim()]).pluck('id');
      if (contactIds.length) {
        await knex('sellbird_outbox').where({ workspace_id: req.workspaceId }).whereIn('contact_id', contactIds)
          .whereIn('status', ['pending_approval', 'approved'])
          .update({ status: 'rejected', error_message: 'Not sent: they replied.', updated_at: Math.floor(Date.now() / 1000) });
        const companyIds = await knex('sellbird_contacts').whereIn('id', contactIds).pluck('company_id');
        await knex('sellbird_companies').where({ workspace_id: req.workspaceId }).whereIn('id', companyIds).update({ status: 'replied', updated_at: Math.floor(Date.now() / 1000) });
      }

      const reply = await repo.addReply(req.workspaceId, {
        outbox_id: outbox_id ? Number(outbox_id) : null,
        sender_email,
        subject: subject || '',
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
      const { ai_drafted_reply, status, intent_category } = req.body || {};
      const patch = {};
      if (typeof ai_drafted_reply === 'string') patch.ai_drafted_reply = ai_drafted_reply;
      if (['pending_review', 'dismissed'].includes(status)) patch.status = status;
      if (['interested', 'question', 'objection', 'not_interested', 'unsubscribe'].includes(intent_category)) patch.intent_category = intent_category;
      const updated = await repo.updateReply(req.workspaceId, Number(req.params.id), patch);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/replies/:id/send', requirePermission('content.create'), async (req, res) => {
    try {
      const reply = await repo.getReply(req.workspaceId, Number(req.params.id));
      if (!reply) return res.status(404).json({ error: 'Reply not found' });
      if (reply.status === 'replied') return res.status(400).json({ error: 'You already answered this reply.' });

      const replyText = req.body?.ai_drafted_reply || reply.ai_drafted_reply;
      if (!replyText) {
        return res.status(400).json({ error: 'Reply text cannot be empty' });
      }

      // Only marked "replied" if the email really went out
      try {
        await sendOutreachEmail({
          to: reply.sender_email,
          subject: await (async () => {
            // their subject, or else the subject of our email they answered
            let subj = reply.subject;
            if (!subj) {
              const sent = await knex('sellbird_outbox as o').join('sellbird_contacts as c', 'o.contact_id', 'c.id')
                .where('o.workspace_id', req.workspaceId).where('o.status', 'sent')
                .whereRaw('LOWER(c.email) = ?', [String(reply.sender_email).toLowerCase().trim()])
                .orderBy('o.sent_at', 'desc').first('o.subject');
              subj = sent?.subject || 'Your message';
            }
            return /^re:/i.test(subj) ? subj : `Re: ${subj}`;
          })(),
          body: replyText,
        });
      } catch (smtpErr) {
        return res.status(400).json({ error: `Your answer wasn’t sent: ${smtpErr.message}` });
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
      let licensed = false;
      try { licensed = await require('../services/entitlements').canPublish(req.workspaceId); } catch {}
      if (!licensed) return res.status(402).json({ error: 'Sending needs an active licence. Go to Settings → Licence to activate.', code: 'LICENSE_REQUIRED' });
      // Scoped to req.workspaceId for multi-tenant isolation
      const result = await runHeartbeat(knex, { workspaceId: req.workspaceId, maxBatch: 20 });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
