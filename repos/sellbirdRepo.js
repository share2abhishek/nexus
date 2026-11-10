// repos/sellbirdRepo.js
// Data repository for Sellbird autonomous sales agent entities.

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

function parseJson(v, fallback = null) {
  if (!v) return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

module.exports = (knex) => ({
  // ── Campaigns ──────────────────────────────────────────────────────────────
  async createCampaign(workspaceId, data) {
    const now = nowEpoch();
    const rows = await knex('sellbird_campaigns').insert({
      workspace_id: workspaceId,
      name: data.name,
      product_url: data.product_url || null,
      product_description: data.product_description || null,
      icp_definition: data.icp_definition ? JSON.stringify(data.icp_definition) : null,
      sequence_template_json: data.sequence_template_json ? JSON.stringify(data.sequence_template_json) : null,
      sending_account_id: data.sending_account_id || null,
      max_emails_per_day: Number(data.max_emails_per_day) || 25,
      auto_approve: !!data.auto_approve,
      status: data.status || 'active',
      created_at: now,
      updated_at: now,
    }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    return this.getCampaign(workspaceId, id);
  },

  async listCampaigns(workspaceId) {
    const rows = await knex('sellbird_campaigns')
      .where({ workspace_id: workspaceId })
      .orderBy('created_at', 'desc');
    return rows.map((r) => ({
      ...r,
      auto_approve: !!r.auto_approve,
      icp_definition: parseJson(r.icp_definition, {}),
      sequence_template_json: parseJson(r.sequence_template_json, []),
    }));
  },

  async getCampaign(workspaceId, id) {
    const r = await knex('sellbird_campaigns')
      .where({ workspace_id: workspaceId, id })
      .first();
    if (!r) return null;
    return {
      ...r,
      auto_approve: !!r.auto_approve,
      icp_definition: parseJson(r.icp_definition, {}),
      sequence_template_json: parseJson(r.sequence_template_json, []),
    };
  },

  async updateCampaign(workspaceId, id, data) {
    const patch = { updated_at: nowEpoch() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.product_url !== undefined) patch.product_url = data.product_url;
    if (data.product_description !== undefined) patch.product_description = data.product_description;
    if (data.icp_definition !== undefined) patch.icp_definition = JSON.stringify(data.icp_definition);
    if (data.sequence_template_json !== undefined) patch.sequence_template_json = JSON.stringify(data.sequence_template_json);
    if (data.sending_account_id !== undefined) patch.sending_account_id = data.sending_account_id;
    if (data.max_emails_per_day !== undefined) patch.max_emails_per_day = Number(data.max_emails_per_day);
    if (data.auto_approve !== undefined) patch.auto_approve = !!data.auto_approve;
    if (data.status !== undefined) patch.status = data.status;

    await knex('sellbird_campaigns').where({ workspace_id: workspaceId, id }).update(patch);
    return this.getCampaign(workspaceId, id);
  },

  deleteCampaign(workspaceId, id) {
    return knex('sellbird_campaigns').where({ workspace_id: workspaceId, id }).del();
  },

  // ── Companies ──────────────────────────────────────────────────────────────
  async addCompany(workspaceId, campaignId, data) {
    const now = nowEpoch();
    const rows = await knex('sellbird_companies').insert({
      campaign_id: campaignId,
      workspace_id: workspaceId,
      name: data.name,
      domain: data.domain,
      location: data.location || null,
      industry: data.industry || null,
      buying_signals_json: data.buying_signals ? JSON.stringify(data.buying_signals) : null,
      score: Number(data.score) || 50,
      status: data.status || 'discovered',
      created_at: now,
      updated_at: now,
    }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    return this.getCompany(workspaceId, id);
  },

  async listCompanies(workspaceId, { campaignId, status, limit = 100, offset = 0 } = {}) {
    let q = knex('sellbird_companies').where({ workspace_id: workspaceId });
    if (campaignId) q = q.where({ campaign_id: campaignId });
    if (status) q = q.where({ status });
    const rows = await q.orderBy('created_at', 'desc').limit(limit).offset(offset);
    return rows.map((r) => ({
      ...r,
      buying_signals: parseJson(r.buying_signals_json, {}),
    }));
  },

  async getCompany(workspaceId, id) {
    const r = await knex('sellbird_companies').where({ workspace_id: workspaceId, id }).first();
    if (!r) return null;
    return {
      ...r,
      buying_signals: parseJson(r.buying_signals_json, {}),
    };
  },

  async updateCompany(workspaceId, id, data) {
    const patch = { updated_at: nowEpoch() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.domain !== undefined) patch.domain = data.domain;
    if (data.location !== undefined) patch.location = data.location;
    if (data.industry !== undefined) patch.industry = data.industry;
    if (data.buying_signals !== undefined) patch.buying_signals_json = JSON.stringify(data.buying_signals);
    if (data.score !== undefined) patch.score = Number(data.score);
    if (data.status !== undefined) patch.status = data.status;

    await knex('sellbird_companies').where({ workspace_id: workspaceId, id }).update(patch);
    return this.getCompany(workspaceId, id);
  },

  // ── Contacts ───────────────────────────────────────────────────────────────
  async addContact(workspaceId, companyId, data) {
    const now = nowEpoch();
    const rows = await knex('sellbird_contacts').insert({
      company_id: companyId,
      workspace_id: workspaceId,
      full_name: data.full_name,
      role: data.role || null,
      email: data.email || null,
      email_status: data.email_status || 'unverified',
      linkedin_url: data.linkedin_url || null,
      created_at: now,
      updated_at: now,
    }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    return knex('sellbird_contacts').where({ id, workspace_id: workspaceId }).first();
  },

  listContacts(workspaceId, { companyId, limit = 200 } = {}) {
    let q = knex('sellbird_contacts').where({ workspace_id: workspaceId });
    if (companyId) q = q.where({ company_id: companyId });
    return q.orderBy('id', 'desc').limit(limit);
  },

  async listContactsDetailed(workspaceId, { campaignId, search, limit = 200, offset = 0 } = {}) {
    let q = knex('sellbird_contacts as c')
      .join('sellbird_companies as comp', function () {
        this.on('c.company_id', '=', 'comp.id').andOn('comp.workspace_id', '=', knex.raw('?', [workspaceId]));
      })
      .leftJoin('sellbird_campaigns as camp', function () {
        this.on('comp.campaign_id', '=', 'camp.id').andOn('camp.workspace_id', '=', knex.raw('?', [workspaceId]));
      })
      .where('c.workspace_id', workspaceId)
      .select(
        'c.*',
        'comp.name as company_name',
        'comp.domain as company_domain',
        'comp.industry as company_industry',
        'comp.location as company_location',
        'comp.score as fit_score',
        'comp.buying_signals_json',
        'comp.status as company_status',
        'camp.id as campaign_id',
        'camp.name as campaign_name'
      );

    if (campaignId) q = q.where('comp.campaign_id', campaignId);
    if (search) {
      const s = `%${search.toLowerCase()}%`;
      q = q.where(function () {
        this.whereRaw('LOWER(c.full_name) LIKE ?', [s])
          .orWhereRaw('LOWER(comp.name) LIKE ?', [s])
          .orWhereRaw('LOWER(comp.domain) LIKE ?', [s])
          .orWhereRaw('LOWER(comp.industry) LIKE ?', [s]);
      });
    }

    const rows = await q.orderBy('c.id', 'desc').limit(limit).offset(offset);
    return rows.map((r) => ({
      ...r,
      buying_signals: parseJson(r.buying_signals_json, {}),
    }));
  },

  async ensureSampleData(workspaceId, force = false) {
    if (!force) return; // Never auto-seed dummy records in live production mode
    const existing = await knex('sellbird_companies').where({ workspace_id: workspaceId }).count('id as c');
    const count = parseInt(existing[0]?.c || 0, 10);
    if (count >= 5) return;

    const now = nowEpoch();

    // Urban Society - RWA Growth Campaign
    let rwaCamp = await knex('sellbird_campaigns').where({ workspace_id: workspaceId, name: 'Urban Society - RWA Growth Campaign' }).first();
    if (!rwaCamp) {
      const campRows = await knex('sellbird_campaigns').insert({
        workspace_id: workspaceId,
        name: 'Urban Society - RWA Growth Campaign',
        product_url: 'https://urbansociety.in',
        product_description: 'AI-Powered Society Maintenance, Billing & Gate Management for Housing Societies & RWAs.',
        icp_definition: JSON.stringify({ industry: 'Residential Societies', roles: ['President', 'Secretary', 'Treasurer', 'Facility Manager'], location: 'India (Bengaluru, Pune, Mumbai, NCR)' }),
        sequence_template_json: JSON.stringify([
          { step: 1, delay_days: 0, subject: 'Automating maintenance collection at {{company_name}}', template: 'Hi {{first_name}}, we help housing societies eliminate unpaid maintenance dues.' },
          { step: 2, delay_days: 3, subject: 'Re: Maintenance collection at {{company_name}}', template: 'Hi {{first_name}}, our automated WhatsApp payment links cut defaulters by 40%.' },
          { step: 3, delay_days: 4, subject: 'Quick 10-minute demo for {{company_name}} committee?', template: 'Hi {{first_name}}, can I share a quick dashboard preview for your committee?' }
        ]),
        max_emails_per_day: 35,
        auto_approve: false,
        status: 'active',
        created_at: now - 86400 * 14,
        updated_at: now,
      }).returning('id');
      rwaCamp = { id: campRows[0]?.id ?? campRows[0], name: 'Urban Society - RWA Growth Campaign' };
    }

    // 1. Palm Meadows Apartment Owners Association
    let compPalm = await knex('sellbird_companies').where({ workspace_id: workspaceId, domain: 'palmmeadows.org' }).first();
    if (!compPalm) {
      const cRows = await knex('sellbird_companies').insert({
        campaign_id: rwaCamp.id,
        workspace_id: workspaceId,
        name: 'Palm Meadows Apartment Owners Association',
        domain: 'palmmeadows.org',
        location: 'Bengaluru, KA · 480 units',
        industry: 'Residential Societies',
        buying_signals_json: JSON.stringify({
          signals: ['480 residential apartments', 'Manual Excel maintenance billing', 'High defaulters rate'],
          snippet: 'Palm Meadows committee seeking automated billing and WhatsApp UPI payment integration.',
          score: 92
        }),
        score: 92,
        status: 'replied',
        created_at: now - 86400 * 2,
        updated_at: now,
      }).returning('id');
      const compId = cRows[0]?.id ?? cRows[0];
      const contRows = await knex('sellbird_contacts').insert({
        company_id: compId,
        workspace_id: workspaceId,
        full_name: 'Vikramaditya Rao',
        role: 'President, Management Committee',
        email: 'president@palmmeadows.org',
        email_status: 'verified',
        created_at: now - 86400 * 2,
        updated_at: now,
      }).returning('id');
      const contId = contRows[0]?.id ?? contRows[0];
      const outRows = await knex('sellbird_outbox').insert({
        campaign_id: rwaCamp.id,
        contact_id: contId,
        workspace_id: workspaceId,
        step_number: 1,
        subject: 'Automating maintenance billing for Palm Meadows Apartment Owners Association',
        body: 'Hi Vikramaditya,\n\nI noticed Palm Meadows is looking to streamline maintenance operations. Urban Society (https://urbansociety.in) automates billing, WhatsApp payment links, and instant GST receipts.\n\nWould you be open to a 10-minute demo for your committee?\nSam',
        status: 'sent',
        scheduled_at: now - 86400 * 2,
        sent_at: now - 86400 * 2,
        created_at: now - 86400 * 2,
        updated_at: now - 86400 * 2,
      }).returning('id');
      const outId = outRows[0]?.id ?? outRows[0];
      await knex('sellbird_replies').insert({
        outbox_id: outId,
        workspace_id: workspaceId,
        sender_email: 'president@palmmeadows.org',
        subject: 'Re: Automating maintenance billing for Palm Meadows',
        message_text: 'Hello, our society committee is interested in your maintenance app. Can we schedule a demo this Thursday at 5 PM?',
        intent_category: 'interested',
        ai_drafted_reply: 'Hi Vikramaditya, Thursday at 5:00 PM IST works great! I have sent an invite with a Google Meet link. I will show your committee how automated billing cuts dues in half.',
        status: 'pending_review',
        created_at: now - 480,
        updated_at: now,
      });
    }

    // 2. Brigade Gateway Condominium Association
    let compBrigade = await knex('sellbird_companies').where({ workspace_id: workspaceId, domain: 'brigadegateway.org' }).first();
    if (!compBrigade) {
      const cRows = await knex('sellbird_companies').insert({
        campaign_id: rwaCamp.id,
        workspace_id: workspaceId,
        name: 'Brigade Gateway Condominium Association',
        domain: 'brigadegateway.org',
        location: 'Bengaluru, KA · 1,250 units',
        industry: 'Residential Societies',
        buying_signals_json: JSON.stringify({
          signals: ['1,250 apartments', 'WhatsApp payment reminders needed'],
          snippet: 'Large high-rise township looking to replace legacy on-prem accounting server with cloud ERP.',
          score: 94
        }),
        score: 94,
        status: 'contacted',
        created_at: now - 86400 * 3,
        updated_at: now,
      }).returning('id');
      const compId = cRows[0]?.id ?? cRows[0];
      const contRows = await knex('sellbird_contacts').insert({
        company_id: compId,
        workspace_id: workspaceId,
        full_name: 'Rajesh Sharma',
        role: 'Secretary, Management Committee',
        email: 'secretary@brigadegateway.org',
        email_status: 'verified',
        created_at: now - 86400 * 3,
        updated_at: now,
      }).returning('id');
      const contId = contRows[0]?.id ?? contRows[0];
      await knex('sellbird_outbox').insert({
        campaign_id: rwaCamp.id,
        contact_id: contId,
        workspace_id: workspaceId,
        step_number: 1,
        subject: 'Cloud maintenance ERP for Brigade Gateway (1,250 units)',
        body: 'Hi Rajesh,\n\nManaging 1,250 units on on-premise servers leads to reconciliation lag. Urban Society (https://urbansociety.in) delivers instant UPI reconciliation and automated resident WhatsApp receipts.\n\nOpen to a short preview next week?\nSam',
        status: 'pending_approval',
        scheduled_at: now + 3600,
        created_at: now - 1800,
        updated_at: now,
      });
    }

    // 3. Prestige Shantiniketan Management Committee
    let compPrestige = await knex('sellbird_companies').where({ workspace_id: workspaceId, domain: 'prestigeshantiniketan.in' }).first();
    if (!compPrestige) {
      const cRows = await knex('sellbird_companies').insert({
        campaign_id: rwaCamp.id,
        workspace_id: workspaceId,
        name: 'Prestige Shantiniketan Management Committee',
        domain: 'prestigeshantiniketan.in',
        location: 'Whitefield, Bengaluru · 3,000 units',
        industry: 'Residential Societies',
        buying_signals_json: JSON.stringify({
          signals: ['3,000 units across 24 towers', 'HDFC Bank auto-reconciliation'],
          snippet: 'Needs enterprise ERP integration with virtual accounts and gate security passes.',
          score: 90
        }),
        score: 90,
        status: 'replied',
        created_at: now - 86400 * 5,
        updated_at: now,
      }).returning('id');
      const compId = cRows[0]?.id ?? cRows[0];
      const contRows = await knex('sellbird_contacts').insert({
        company_id: compId,
        workspace_id: workspaceId,
        full_name: 'Ananya Deshmukh',
        role: 'Treasurer',
        email: 'treasurer@prestigeshantiniketan.in',
        email_status: 'verified',
        created_at: now - 86400 * 5,
        updated_at: now,
      }).returning('id');
      const contId = contRows[0]?.id ?? contRows[0];
      const outRows = await knex('sellbird_outbox').insert({
        campaign_id: rwaCamp.id,
        contact_id: contId,
        workspace_id: workspaceId,
        step_number: 1,
        subject: 'HDFC virtual accounts auto-reconciliation for Prestige Shantiniketan',
        body: 'Hi Ananya,\n\nI noticed Prestige Shantiniketan is evaluating automated billing solutions. Urban Society integrates directly with HDFC virtual accounts for zero-reconciliation overhead.\n\nBest,\nSam',
        status: 'sent',
        scheduled_at: now - 86400 * 4,
        sent_at: now - 86400 * 4,
        created_at: now - 86400 * 4,
        updated_at: now - 86400 * 4,
      }).returning('id');
      const outId = outRows[0]?.id ?? outRows[0];
      await knex('sellbird_replies').insert({
        outbox_id: outId,
        workspace_id: workspaceId,
        sender_email: 'treasurer@prestigeshantiniketan.in',
        subject: 'Re: HDFC virtual accounts auto-reconciliation',
        message_text: 'Does Urban Society generate instant GST-compliant tax invoices for commercial clubhouse bookings as well?',
        intent_category: 'question',
        ai_drafted_reply: 'Hi Ananya, yes! Urban Society includes full GST-compliant invoice generation with separate HSN/SAC codes for clubhouse amenities and vendor stalls.',
        status: 'pending_review',
        created_at: now - 7200,
        updated_at: now,
      });
    }

    // 4. Amanora Park Town RWA
    let compAmanora = await knex('sellbird_companies').where({ workspace_id: workspaceId, domain: 'amanorapark.in' }).first();
    if (!compAmanora) {
      const cRows = await knex('sellbird_companies').insert({
        campaign_id: rwaCamp.id,
        workspace_id: workspaceId,
        name: 'Amanora Park Town RWA',
        domain: 'amanorapark.in',
        location: 'Hadapsar, Pune · 4,200 units',
        industry: 'Residential Societies',
        buying_signals_json: JSON.stringify({
          signals: ['Integrated mega-township', 'Sub-society billing automation'],
          snippet: 'Managing multiple towers with independent sub-societies needing consolidated master reporting.',
          score: 88
        }),
        score: 88,
        status: 'researched',
        created_at: now - 86400,
        updated_at: now,
      }).returning('id');
      const compId = cRows[0]?.id ?? cRows[0];
      const contRows = await knex('sellbird_contacts').insert({
        company_id: compId,
        workspace_id: workspaceId,
        full_name: 'Nitin Kulkarni',
        role: 'Facility Director',
        email: 'admin@amanorapark.in',
        email_status: 'verified',
        created_at: now - 86400,
        updated_at: now,
      }).returning('id');
      const contId = contRows[0]?.id ?? contRows[0];
      await knex('sellbird_outbox').insert({
        campaign_id: rwaCamp.id,
        contact_id: contId,
        workspace_id: workspaceId,
        step_number: 1,
        subject: 'Multi-tower consolidated billing for Amanora Park Town',
        body: 'Hi Nitin,\n\nManaging sub-societies across Amanora with separate spreadsheets creates immense manual overhead. Urban Society provides a single master dashboard with per-tower autonomy.\n\nCould I share a 5-minute video walkthrough?\nSam',
        status: 'pending_approval',
        scheduled_at: now + 7200,
        created_at: now - 900,
        updated_at: now,
      });
    }

    // 5. Hiranandani Estate Resident Association
    let compHiranandani = await knex('sellbird_companies').where({ workspace_id: workspaceId, domain: 'hiranandani-estate.in' }).first();
    if (!compHiranandani) {
      const cRows = await knex('sellbird_companies').insert({
        campaign_id: rwaCamp.id,
        workspace_id: workspaceId,
        name: 'Hiranandani Estate Resident Association',
        domain: 'hiranandani-estate.in',
        location: 'Thane, MH · 2,800 units',
        industry: 'Residential Societies',
        buying_signals_json: JSON.stringify({
          signals: ['High maintenance defaulters rate', 'Manual gate entry'],
          snippet: 'Planning digital migration for annual general meeting (AGM) voting and billing.',
          score: 86
        }),
        score: 86,
        status: 'replied',
        created_at: now - 86400 * 3,
        updated_at: now,
      }).returning('id');
      const compId = cRows[0]?.id ?? cRows[0];
      const contRows = await knex('sellbird_contacts').insert({
        company_id: compId,
        workspace_id: workspaceId,
        full_name: 'Sunita Mehta',
        role: 'Management Committee Member',
        email: 'sunita@hiranandani-estate.in',
        email_status: 'verified',
        created_at: now - 86400 * 3,
        updated_at: now,
      }).returning('id');
      const contId = contRows[0]?.id ?? contRows[0];
      const outRows = await knex('sellbird_outbox').insert({
        campaign_id: rwaCamp.id,
        contact_id: contId,
        workspace_id: workspaceId,
        step_number: 1,
        subject: 'Cutting maintenance dues at Hiranandani Estate',
        body: 'Hi Sunita,\n\nMost RWAs struggle with 15-20% payment delays each quarter. Urban Society\'s automated WhatsApp billing reminders achieve 94% on-time collections in month one.\n\nWould you like to review how it works?\nSam',
        status: 'sent',
        scheduled_at: now - 86400 * 2,
        sent_at: now - 86400 * 2,
        created_at: now - 86400 * 2,
        updated_at: now - 86400 * 2,
      }).returning('id');
      const outId = outRows[0]?.id ?? outRows[0];
      await knex('sellbird_replies').insert({
        outbox_id: outId,
        workspace_id: workspaceId,
        sender_email: 'sunita@hiranandani-estate.in',
        subject: 'Re: Cutting maintenance dues at Hiranandani Estate',
        message_text: 'Can you send over pricing and a feature comparison document for 2,800 units?',
        intent_category: 'needs_you',
        ai_drafted_reply: 'Hi Sunita, attached is our complete pricing tiers and feature comparison sheet. For 2,800 units we include custom white-label branding and on-site staff training. Would Tuesday work for a short call?',
        status: 'pending_review',
        created_at: now - 3600,
        updated_at: now,
      });
    }
  },

  async updateContact(workspaceId, id, data) {
    const patch = { updated_at: nowEpoch() };
    if (data.full_name !== undefined) patch.full_name = data.full_name;
    if (data.role !== undefined) patch.role = data.role;
    if (data.email !== undefined) patch.email = data.email;
    if (data.email_status !== undefined) patch.email_status = data.email_status;
    if (data.linkedin_url !== undefined) patch.linkedin_url = data.linkedin_url;
    await knex('sellbird_contacts').where({ workspace_id: workspaceId, id }).update(patch);
    return knex('sellbird_contacts').where({ workspace_id: workspaceId, id }).first();
  },

  // ── Outbox / Approval Queue ────────────────────────────────────────────────
  async addOutboxItem(workspaceId, data) {
    const now = nowEpoch();
    const rows = await knex('sellbird_outbox').insert({
      campaign_id: data.campaign_id,
      contact_id: data.contact_id,
      workspace_id: workspaceId,
      step_number: data.step_number || 1,
      subject: data.subject,
      body: data.body,
      status: data.status || 'pending_approval',
      scheduled_at: data.scheduled_at || now,
      sent_at: null,
      error_message: null,
      created_at: now,
      updated_at: now,
    }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    return this.getOutboxItem(workspaceId, id);
  },

  async listOutbox(workspaceId, { status, campaignId, limit = 100, offset = 0 } = {}) {
    let q = knex('sellbird_outbox as o')
      .join('sellbird_contacts as c', function () {
        this.on('o.contact_id', '=', 'c.id').andOn('c.workspace_id', '=', knex.raw('?', [workspaceId]));
      })
      .join('sellbird_companies as comp', function () {
        this.on('c.company_id', '=', 'comp.id').andOn('comp.workspace_id', '=', knex.raw('?', [workspaceId]));
      })
      .join('sellbird_campaigns as camp', function () {
        this.on('o.campaign_id', '=', 'camp.id').andOn('camp.workspace_id', '=', knex.raw('?', [workspaceId]));
      })
      .where('o.workspace_id', workspaceId)
      .select(
        'o.*',
        'c.full_name as contact_name',
        'c.role as contact_role',
        'c.email as contact_email',
        'c.email_status as contact_email_status',
        'comp.name as company_name',
        'comp.domain as company_domain',
        'comp.buying_signals_json as company_signals_json',
        'camp.name as campaign_name'
      );

    if (status) q = q.where('o.status', status);
    if (campaignId) q = q.where('o.campaign_id', campaignId);

    const rows = await q.orderBy('o.scheduled_at', 'asc').limit(limit).offset(offset);
    return rows.map((r) => ({
      ...r,
      company_signals: parseJson(r.company_signals_json, {}),
    }));
  },

  async getOutboxItem(workspaceId, id) {
    const r = await knex('sellbird_outbox as o')
      .join('sellbird_contacts as c', function () {
        this.on('o.contact_id', '=', 'c.id').andOn('c.workspace_id', '=', knex.raw('?', [workspaceId]));
      })
      .join('sellbird_companies as comp', function () {
        this.on('c.company_id', '=', 'comp.id').andOn('comp.workspace_id', '=', knex.raw('?', [workspaceId]));
      })
      .join('sellbird_campaigns as camp', function () {
        this.on('o.campaign_id', '=', 'camp.id').andOn('camp.workspace_id', '=', knex.raw('?', [workspaceId]));
      })
      .where('o.workspace_id', workspaceId)
      .where('o.id', id)
      .select(
        'o.*',
        'c.full_name as contact_name',
        'c.role as contact_role',
        'c.email as contact_email',
        'c.email_status as contact_email_status',
        'comp.name as company_name',
        'comp.domain as company_domain',
        'comp.buying_signals_json as company_signals_json',
        'camp.name as campaign_name'
      )
      .first();

    if (!r) return null;
    return {
      ...r,
      company_signals: parseJson(r.company_signals_json, {}),
    };
  },

  async updateOutboxItem(workspaceId, id, data) {
    const patch = { updated_at: nowEpoch() };
    if (data.subject !== undefined) patch.subject = data.subject;
    if (data.body !== undefined) patch.body = data.body;
    if (data.status !== undefined) patch.status = data.status;
    if (data.scheduled_at !== undefined) patch.scheduled_at = data.scheduled_at;
    if (data.sent_at !== undefined) patch.sent_at = data.sent_at;
    if (data.error_message !== undefined) patch.error_message = data.error_message;

    await knex('sellbird_outbox').where({ workspace_id: workspaceId, id }).update(patch);
    return this.getOutboxItem(workspaceId, id);
  },

  batchApprove(workspaceId, ids) {
    const now = nowEpoch();
    return knex('sellbird_outbox')
      .where({ workspace_id: workspaceId })
      .whereIn('id', ids)
      .where({ status: 'pending_approval' })
      .update({ status: 'approved', updated_at: now });
  },

  // ── Replies ────────────────────────────────────────────────────────────────
  async addReply(workspaceId, data) {
    const now = nowEpoch();
    const rows = await knex('sellbird_replies').insert({
      outbox_id: data.outbox_id || null,
      workspace_id: workspaceId,
      sender_email: data.sender_email,
      subject: data.subject || null,
      message_text: data.message_text,
      intent_category: data.intent_category || 'question',
      ai_drafted_reply: data.ai_drafted_reply || null,
      status: data.status || 'pending_review',
      created_at: now,
      updated_at: now,
    }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    return knex('sellbird_replies').where({ id, workspace_id: workspaceId }).first();
  },

  listReplies(workspaceId, { status, limit = 50, offset = 0 } = {}) {
    let q = knex('sellbird_replies').where({ workspace_id: workspaceId });
    if (status) q = q.where({ status });
    return q.orderBy('created_at', 'desc').limit(limit).offset(offset);
  },

  getReply(workspaceId, id) {
    return knex('sellbird_replies').where({ workspace_id: workspaceId, id }).first();
  },

  async updateReply(workspaceId, id, data) {
    const patch = { updated_at: nowEpoch() };
    if (data.intent_category !== undefined) patch.intent_category = data.intent_category;
    if (data.ai_drafted_reply !== undefined) patch.ai_drafted_reply = data.ai_drafted_reply;
    if (data.status !== undefined) patch.status = data.status;
    await knex('sellbird_replies').where({ workspace_id: workspaceId, id }).update(patch);
    return knex('sellbird_replies').where({ workspace_id: workspaceId, id }).first();
  },

  async cleanSellbirdDummyData(workspaceId) {
    const dummyDomains = [
      'palmmeadows.org',
      'brigadegateway.org',
      'prestigeshantiniketan.in',
      'amanorapark.in',
      'hiranandani-estate.in',
    ];

    // Find dummy companies
    const dummyComps = await knex('sellbird_companies')
      .where({ workspace_id: workspaceId })
      .whereIn('domain', dummyDomains);

    const compIds = dummyComps.map((c) => c.id);

    let deletedContacts = 0;
    let deletedOutbox = 0;
    let deletedReplies = 0;
    let deletedCompanies = 0;

    if (compIds.length > 0) {
      const contacts = await knex('sellbird_contacts')
        .where({ workspace_id: workspaceId })
        .whereIn('company_id', compIds);
      const contactIds = contacts.map((c) => c.id);

      if (contactIds.length > 0) {
        const outbox = await knex('sellbird_outbox')
          .where({ workspace_id: workspaceId })
          .whereIn('contact_id', contactIds);
        const outboxIds = outbox.map((o) => o.id);

        if (outboxIds.length > 0) {
          deletedReplies += await knex('sellbird_replies')
            .where({ workspace_id: workspaceId })
            .whereIn('outbox_id', outboxIds)
            .del();
        }

        deletedOutbox = await knex('sellbird_outbox')
          .where({ workspace_id: workspaceId })
          .whereIn('contact_id', contactIds)
          .del();
      }

      deletedContacts = await knex('sellbird_contacts')
        .where({ workspace_id: workspaceId })
        .whereIn('company_id', compIds)
        .del();

      deletedCompanies = await knex('sellbird_companies')
        .where({ workspace_id: workspaceId })
        .whereIn('id', compIds)
        .del();
    }

    // Also clean any simulated demo replies from any dummy domains or orphan dummy replies
    const extraReplies = await knex('sellbird_replies')
      .where({ workspace_id: workspaceId })
      .where(function () {
        this.where('sender_email', 'like', '%palmmeadows.org%')
          .orWhere('sender_email', 'like', '%brigadegateway.org%')
          .orWhere('sender_email', 'like', '%prestigeshantiniketan.in%')
          .orWhere('sender_email', 'like', '%amanorapark.in%')
          .orWhere('sender_email', 'like', '%hiranandani-estate.in%')
          .orWhere('sender_email', 'like', '%example.com%')
          .orWhereNull('outbox_id');
      })
      .del();

    deletedReplies += extraReplies;

    return {
      deletedCompanies,
      deletedContacts,
      deletedOutbox,
      deletedReplies,
    };
  },

  // ── Metrics / Stats ────────────────────────────────────────────────────────
  async getStats(workspaceId) {
    const [campaignsCount] = await knex('sellbird_campaigns').where({ workspace_id: workspaceId }).count('id as c');
    const [companiesCount] = await knex('sellbird_companies').where({ workspace_id: workspaceId }).count('id as c');
    const [contactsCount] = await knex('sellbird_contacts').where({ workspace_id: workspaceId }).count('id as c');
    const [verifiedContactsCount] = await knex('sellbird_contacts').where({ workspace_id: workspaceId, email_status: 'verified' }).count('id as c');
    const [pendingOutboxCount] = await knex('sellbird_outbox').where({ workspace_id: workspaceId, status: 'pending_approval' }).count('id as c');
    const [approvedOutboxCount] = await knex('sellbird_outbox').where({ workspace_id: workspaceId, status: 'approved' }).count('id as c');
    const [sentOutboxCount] = await knex('sellbird_outbox').where({ workspace_id: workspaceId, status: 'sent' }).count('id as c');
    const [repliesCount] = await knex('sellbird_replies').where({ workspace_id: workspaceId }).count('id as c');
    const [interestedRepliesCount] = await knex('sellbird_replies').where({ workspace_id: workspaceId, intent_category: 'interested' }).count('id as c');

    return {
      total_campaigns: parseInt(campaignsCount?.c || 0, 10),
      total_companies: parseInt(companiesCount?.c || 0, 10),
      total_contacts: parseInt(contactsCount?.c || 0, 10),
      verified_contacts: parseInt(verifiedContactsCount?.c || 0, 10),
      pending_approvals: parseInt(pendingOutboxCount?.c || 0, 10),
      approved_queued: parseInt(approvedOutboxCount?.c || 0, 10),
      sent_outreach: parseInt(sentOutboxCount?.c || 0, 10),
      total_replies: parseInt(repliesCount?.c || 0, 10),
      interested_leads: parseInt(interestedRepliesCount?.c || 0, 10),
    };
  },
});
