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
    if (data.max_emails_per_day !== undefined) patch.max_emails_per_day = Math.min(500, Math.max(1, Math.round(Number(data.max_emails_per_day)) || 25));
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

  // Delete emails from the outbox. Emails that already went out (or are going out) are never deleted:
  // they are the record of what was sent, and the daily limit counts them. Follow-ups of a deleted
  // email that are still unsent go with it: a follow-up must never be sent without the email before it.
  async deleteOutboxItems(workspaceId, ids = []) {
    const want = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
    const out = { deleted: 0, follow_ups_deleted: 0, kept_sent: 0 };
    if (!want.length) return out;
    const items = await knex('sellbird_outbox').where({ workspace_id: workspaceId }).whereIn('id', want);
    const doomed = new Set();
    for (const it of items) {
      if (['sent', 'sending'].includes(it.status)) { out.kept_sent++; continue; }
      doomed.add(it.id);
      const later = await knex('sellbird_outbox')
        .where({ workspace_id: workspaceId, campaign_id: it.campaign_id, contact_id: it.contact_id })
        .where('step_number', '>', it.step_number || 1)
        .whereNotIn('status', ['sent', 'sending'])
        .select('id');
      for (const l of later) if (!want.includes(l.id)) { doomed.add(l.id); out.follow_ups_deleted++; }
    }
    if (doomed.size) out.deleted = (await knex('sellbird_outbox').where({ workspace_id: workspaceId }).whereIn('id', [...doomed]).del()) - out.follow_ups_deleted;
    return out;
  },

  // ── Attachments of a campaign (files sent with its emails) ────────────────────
  async listAttachments(workspaceId, campaignId) {
    return knex('sellbird_attachments').where({ workspace_id: workspaceId, campaign_id: Number(campaignId) })
      .orderBy('id', 'asc').select('id', 'campaign_id', 'filename', 'content_type', 'size', 'send_with', 'created_at');
  },
  async attachmentUsage(workspaceId, campaignId) {
    const r = await knex('sellbird_attachments').where({ workspace_id: workspaceId, campaign_id: Number(campaignId) })
      .count({ n: '*' }).sum({ bytes: 'size' }).first();
    return { count: Number(r.n) || 0, bytes: Number(r.bytes) || 0 };
  },
  async addAttachment(workspaceId, campaignId, { filename, content_type, size, data, send_with = 'first' }) {
    const [row] = await knex('sellbird_attachments').insert({
      workspace_id: workspaceId, campaign_id: Number(campaignId), filename, content_type, size, data,
      send_with: send_with === 'all' ? 'all' : 'first', created_at: nowEpoch(),
    }).returning('id');
    return knex('sellbird_attachments').where({ id: row?.id ?? row, workspace_id: workspaceId })
      .first('id', 'campaign_id', 'filename', 'content_type', 'size', 'send_with', 'created_at');
  },
  async setAttachmentSendWith(workspaceId, id, sendWith) {
    const n = await knex('sellbird_attachments').where({ id: Number(id), workspace_id: workspaceId }).update({ send_with: sendWith === 'all' ? 'all' : 'first' });
    if (!n) return null;
    return knex('sellbird_attachments').where({ id: Number(id), workspace_id: workspaceId })
      .first('id', 'campaign_id', 'filename', 'content_type', 'size', 'send_with', 'created_at');
  },
  deleteAttachment(workspaceId, id) {
    return knex('sellbird_attachments').where({ id: Number(id), workspace_id: workspaceId }).del();
  },
  // The files to send with one email: the first email of a person gets every file, later ones only
  // the files marked "all emails"
  async attachmentsFor(workspaceId, campaignId, stepNumber) {
    const q = knex('sellbird_attachments').where({ workspace_id: workspaceId, campaign_id: Number(campaignId) }).orderBy('id', 'asc');
    if ((Number(stepNumber) || 1) > 1) q.where({ send_with: 'all' });
    return (await q).map((a) => ({ filename: a.filename, content: Buffer.from(a.data), contentType: a.content_type }));
  },

  // Change a contact's name, role or address (only this business's own contact)
  async updateContact(workspaceId, id, patch = {}) {
    const set = { updated_at: nowEpoch() };
    for (const k of ['full_name', 'role', 'email', 'email_status']) if (patch[k] !== undefined) set[k] = patch[k];
    const n = await knex('sellbird_contacts').where({ id: Number(id), workspace_id: workspaceId }).update(set);
    if (!n) return null;
    return knex('sellbird_contacts').where({ id: Number(id), workspace_id: workspaceId }).first();
  },

  // Delete contacts and their emails (sent ones too). A company left with no contacts goes as well.
  async deleteContacts(workspaceId, ids = []) {
    const want = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
    if (!want.length) return { deleted: 0, removed_companies: 0, removed_emails: 0 };
    const rows = await knex('sellbird_contacts').where({ workspace_id: workspaceId }).whereIn('id', want).select('id', 'company_id');
    if (!rows.length) return { deleted: 0, removed_companies: 0, removed_emails: 0 };
    const cids = rows.map((r) => r.id);
    const removed_emails = await knex('sellbird_outbox').where({ workspace_id: workspaceId }).whereIn('contact_id', cids).del();
    await knex('sellbird_contacts').where({ workspace_id: workspaceId }).whereIn('id', cids).del();
    let removed_companies = 0;
    for (const companyId of new Set(rows.map((r) => r.company_id).filter(Boolean))) {
      const left = Number((await knex('sellbird_contacts').where({ workspace_id: workspaceId, company_id: companyId }).count({ n: '*' }).first()).n) || 0;
      if (!left) removed_companies += await knex('sellbird_companies').where({ id: companyId, workspace_id: workspaceId }).del();
    }
    return { deleted: rows.length, removed_companies, removed_emails };
  },

  // Is this address already one of this business's contacts (in any campaign)?
  async findContactByEmail(workspaceId, email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return null;
    return knex('sellbird_contacts as c')
      .leftJoin('sellbird_companies as co', 'c.company_id', 'co.id')
      .where('c.workspace_id', workspaceId)
      .whereRaw('LOWER(TRIM(c.email)) = ?', [e])
      .orderBy('c.id', 'asc')
      .first('c.id', 'c.email', 'co.name as company_name', 'co.campaign_id');
  },

  // Is this website already a company of this campaign?
  async findCompanyByDomain(workspaceId, campaignId, domain) {
    const d = String(domain || '').trim().toLowerCase().replace(/^www\./, '');
    if (!d) return null;
    return knex('sellbird_companies')
      .where({ workspace_id: workspaceId, campaign_id: campaignId })
      .whereRaw("LOWER(REPLACE(domain, 'www.', '')) = ?", [d])
      .first('id', 'name', 'domain');
  },

  // Remove repeated addresses of this business. For each address the contact that already emailed
  // (or else the oldest) stays. A repeat that never emailed is removed with its unsent emails; a repeat that
  // did email stays (its history is kept) but its unsent emails are cancelled so nobody gets two.
  async removeDuplicateContacts(workspaceId) {
    const all = await knex('sellbird_contacts').where({ workspace_id: workspaceId }).whereNotNull('email').orderBy('id', 'asc');
    const groups = new Map();
    for (const c of all) {
      const k = String(c.email).trim().toLowerCase();
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    const out = { addresses: 0, removed_contacts: 0, cancelled_emails: 0, kept_with_history: 0, removed_companies: 0 };
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      out.addresses++;
      const ids = list.map((c) => c.id);
      const sent = new Set((await knex('sellbird_outbox').where({ workspace_id: workspaceId }).whereIn('contact_id', ids).whereIn('status', ['sent', 'sending']).select('contact_id')).map((r) => r.contact_id));
      const keeper = list.find((c) => sent.has(c.id)) || list[0];
      for (const c of list) {
        if (c.id === keeper.id) continue;
        const unsent = knex('sellbird_outbox').where({ workspace_id: workspaceId, contact_id: c.id }).whereNotIn('status', ['sent', 'sending']);
        if (sent.has(c.id)) {
          out.cancelled_emails += await unsent.clone().whereIn('status', ['pending_approval', 'approved']).update({ status: 'rejected', error_message: 'Not sent: the same address is already in your contacts.', updated_at: nowEpoch() });
          out.kept_with_history++;
          continue;
        }
        out.cancelled_emails += (await unsent.clone().count({ n: '*' }).first()).n | 0;
        await unsent.clone().del();
        await knex('sellbird_contacts').where({ id: c.id, workspace_id: workspaceId }).del();
        out.removed_contacts++;
        const left = (await knex('sellbird_contacts').where({ workspace_id: workspaceId, company_id: c.company_id }).count({ n: '*' }).first()).n | 0;
        if (!left) { out.removed_companies += await knex('sellbird_companies').where({ id: c.company_id, workspace_id: workspaceId }).del(); }
      }
    }
    return out;
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
        'camp.name as campaign_name',
        knex.raw("(SELECT MAX(o.sent_at) FROM sellbird_outbox o WHERE o.contact_id = c.id AND o.status = 'sent') as last_sent_at")
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

  // Each reply with who sent it (if they're a contact) and the email of ours
  // they answered, so the conversation shows what was really sent
  async listReplies(workspaceId, { status, limit = 50, offset = 0 } = {}) {
    let q = knex('sellbird_replies').where({ workspace_id: workspaceId });
    if (status) q = q.where({ status });
    const rows = await q.orderBy('created_at', 'desc').limit(limit).offset(offset);
    for (const r of rows) {
      const c = await knex('sellbird_contacts as c')
        .join('sellbird_companies as comp', 'c.company_id', 'comp.id')
        .leftJoin('sellbird_campaigns as camp', 'comp.campaign_id', 'camp.id')
        .where('c.workspace_id', workspaceId)
        .whereRaw('LOWER(c.email) = ?', [String(r.sender_email || '').toLowerCase().trim()])
        .orderBy('c.id', 'desc')
        .first('c.id as contact_id', 'c.full_name as contact_name', 'c.role as contact_role', 'c.email_status as contact_email_status',
          'comp.name as company_name', 'comp.domain as company_domain', 'comp.location as company_location', 'comp.buying_signals_json', 'camp.name as campaign_name');
      if (!c) continue;
      let signals = [];
      try { signals = JSON.parse(c.buying_signals_json || '{}').signals || []; } catch {}
      delete c.buying_signals_json;
      Object.assign(r, c, { signals });
      r.last_sent = await knex('sellbird_outbox').where({ workspace_id: workspaceId, contact_id: c.contact_id, status: 'sent' })
        .orderBy('sent_at', 'desc').first('subject', 'body', 'sent_at', 'step_number') || null;
    }
    return rows;
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
    const [unansweredCount] = await knex('sellbird_replies').where({ workspace_id: workspaceId, status: 'pending_review' }).count('id as c');
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
      replies_to_answer: parseInt(unansweredCount?.c || 0, 10),
    };
  },
});
