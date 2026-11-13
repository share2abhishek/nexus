// repos/leadPipelineRepo.js
// Data repository for Meta Lead Ads & Click-to-Messenger Automated Pipeline.

const crypto = require('crypto');

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
  // ── Configuration ──────────────────────────────────────────────────────────
  async getOrCreateConfig(workspaceId) {
    let cfg = await knex('meta_lead_configs').where({ workspace_id: workspaceId }).first();
    if (!cfg) {
      const now = nowEpoch();
      const randomToken = 'meta_lead_' + crypto.randomBytes(16).toString('hex');
      const [newId] = await knex('meta_lead_configs').insert({
        workspace_id: workspaceId,
        verify_token: randomToken,
        webchat_token: 'webchat_' + crypto.randomBytes(16).toString('hex'),
        auto_qualify_ai: 1,
        created_at: now,
        updated_at: now,
      }).returning('id');
      const id = newId?.id ?? newId;
      cfg = await knex('meta_lead_configs').where({ id }).first();
    }
    // Back-fill a web-chat token for configs created before the column existed
    if (cfg && !cfg.webchat_token) {
      const tok = 'webchat_' + crypto.randomBytes(16).toString('hex');
      await knex('meta_lead_configs').where({ id: cfg.id }).update({ webchat_token: tok }).catch(() => {});
      cfg.webchat_token = tok;
    }
    return {
      ...cfg,
      workflow_nodes: parseJson(cfg.workflow_nodes_json, null),
    };
  },

  async updateConfig(workspaceId, data) {
    const now = nowEpoch();
    const patch = { updated_at: now };

    if (data.page_id !== undefined) patch.page_id = data.page_id;
    if (data.verify_token !== undefined) patch.verify_token = data.verify_token;
    const masked = (v) => typeof v === 'string' && v.includes('••');
    if (data.app_secret !== undefined && !masked(data.app_secret)) patch.app_secret = data.app_secret;
    if (data.n8n_webhook_url !== undefined) patch.n8n_webhook_url = data.n8n_webhook_url;
    if (data.chatwoot_url !== undefined) patch.chatwoot_url = data.chatwoot_url;
    if (data.chatwoot_api_token !== undefined && !masked(data.chatwoot_api_token)) patch.chatwoot_api_token = data.chatwoot_api_token;
    if (data.chatwoot_account_id !== undefined) patch.chatwoot_account_id = data.chatwoot_account_id ? Number(data.chatwoot_account_id) : null;
    if (data.chatwoot_inbox_id !== undefined) patch.chatwoot_inbox_id = data.chatwoot_inbox_id ? Number(data.chatwoot_inbox_id) : null;
    if (data.auto_qualify_ai !== undefined) patch.auto_qualify_ai = !!data.auto_qualify_ai ? 1 : 0;
    if (data.instant_notify_email !== undefined) patch.instant_notify_email = data.instant_notify_email;
    if (data.whatsapp_phone_number_id !== undefined) patch.whatsapp_phone_number_id = data.whatsapp_phone_number_id;
    if (data.whatsapp_business_account_id !== undefined) patch.whatsapp_business_account_id = data.whatsapp_business_account_id;
    if (data.whatsapp_test_recipient !== undefined) patch.whatsapp_test_recipient = data.whatsapp_test_recipient;
    if (data.whatsapp_access_token !== undefined && !masked(data.whatsapp_access_token)) patch.whatsapp_access_token = data.whatsapp_access_token;
    if (data.delivery_engine !== undefined) patch.delivery_engine = data.delivery_engine;
    if (data.evolution_api_url !== undefined) patch.evolution_api_url = data.evolution_api_url;
    if (data.evolution_api_key !== undefined && !masked(data.evolution_api_key)) patch.evolution_api_key = data.evolution_api_key;
    if (data.evolution_instance_name !== undefined) patch.evolution_instance_name = data.evolution_instance_name;
    if (data.evolution_status !== undefined) patch.evolution_status = data.evolution_status;
    if (data.meta_two_step_pin_set !== undefined) patch.meta_two_step_pin_set = !!data.meta_two_step_pin_set;
    if (data.meta_registered_phone !== undefined) patch.meta_registered_phone = data.meta_registered_phone;
    if (data.razorpay_key_id !== undefined) patch.razorpay_key_id = data.razorpay_key_id;
    if (data.upi_vpa !== undefined) patch.upi_vpa = data.upi_vpa;
    if (data.free_credits_balance !== undefined) patch.free_credits_balance = Number(data.free_credits_balance);
    if (data.workflow_nodes !== undefined) {
      patch.workflow_nodes_json = typeof data.workflow_nodes === 'string'
        ? data.workflow_nodes
        : JSON.stringify(data.workflow_nodes);
    }

    // Ensure row exists
    await this.getOrCreateConfig(workspaceId);
    await knex('meta_lead_configs').where({ workspace_id: workspaceId }).update(patch);
    const updated = await knex('meta_lead_configs').where({ workspace_id: workspaceId }).first();
    return {
      ...updated,
      workflow_nodes: parseJson(updated.workflow_nodes_json, null),
    };
  },

  async getConfigByVerifyToken(token) {
    if (!token) return null;
    return knex('meta_lead_configs').where({ verify_token: token }).first();
  },

  async getConfigByWebchatToken(token) {
    if (!token) return null;
    return knex('meta_lead_configs').where({ webchat_token: token }).first();
  },

  // New random web-chat token (invalidates any website still using the old one)
  async regenerateWebchatToken(workspaceId) {
    await this.getOrCreateConfig(workspaceId);
    const tok = 'webchat_' + crypto.randomBytes(16).toString('hex');
    await knex('meta_lead_configs').where({ workspace_id: workspaceId }).update({ webchat_token: tok, updated_at: nowEpoch() });
    return tok;
  },

  async getConfigByPageId(pageId) {
    if (!pageId) return null;
    return knex('meta_lead_configs').where({ page_id: String(pageId) }).first();
  },

  // ── Lead Events ────────────────────────────────────────────────────────────
  async addLeadEvent(workspaceId, data) {
    const now = nowEpoch();
    const rows = await knex('meta_lead_events').insert({
      workspace_id: workspaceId,
      leadgen_id: data.leadgen_id || null,
      form_id: data.form_id || null,
      page_id: data.page_id || null,
      ad_id: data.ad_id || null,
      adgroup_id: data.adgroup_id || null,
      campaign_id: data.campaign_id || null,
      full_name: data.full_name || null,
      email: data.email || null,
      phone_number: data.phone_number || null,
      raw_answers_json: data.raw_answers_json ? (typeof data.raw_answers_json === 'string' ? data.raw_answers_json : JSON.stringify(data.raw_answers_json)) : null,
      lead_score: data.lead_score !== undefined ? Number(data.lead_score) : 50,
      intent_summary: data.intent_summary || null,
      suggested_reply: data.suggested_reply || null,
      forwarded_to_n8n: !!data.forwarded_to_n8n ? 1 : 0,
      forwarded_to_chatwoot: !!data.forwarded_to_chatwoot ? 1 : 0,
      status: data.status || 'new',
      ...(data.tags_json !== undefined ? { tags_json: typeof data.tags_json === 'string' ? data.tags_json : JSON.stringify(data.tags_json) } : {}),
      created_at: now,
      updated_at: now,
    }).returning('id');

    const id = rows[0]?.id ?? rows[0];
    return this.getLeadEvent(workspaceId, id);
  },

  async listLeadEvents(workspaceId, { status, limit = 50, offset = 0 } = {}) {
    let q = knex('meta_lead_events').where({ workspace_id: workspaceId });
    if (status && status !== 'all') {
      q = q.where({ status });
    }
    const rows = await q.orderBy('created_at', 'desc').limit(limit).offset(offset);
    return rows.map((r) => ({
      ...r,
      raw_answers: parseJson(r.raw_answers_json, {}),
    }));
  },

  async getLeadEvent(workspaceId, id) {
    const r = await knex('meta_lead_events').where({ workspace_id: workspaceId, id }).first();
    if (!r) return null;
    return {
      ...r,
      raw_answers: parseJson(r.raw_answers_json, {}),
    };
  },

  async findLeadByPhone(workspaceId, phone) {
    if (!phone) return null;
    const clean = String(phone).replace(/[^0-9]/g, '');
    if (!clean) return null;
    const rows = await knex('meta_lead_events')
      .where({ workspace_id: workspaceId })
      .whereNotNull('phone_number');
    const match = rows.find((r) => {
      const c = String(r.phone_number).replace(/[^0-9]/g, '');
      return c === clean || (c.length >= 10 && clean.length >= 10 && (c.slice(-10) === clean.slice(-10)));
    });
    return match ? { ...match, raw_answers: parseJson(match.raw_answers_json, {}) } : null;
  },

  async updateLeadEvent(workspaceId, id, data) {
    const patch = { updated_at: nowEpoch() };
    if (data.status !== undefined) patch.status = data.status;
    if (data.full_name !== undefined) patch.full_name = data.full_name;
    if (data.email !== undefined) patch.email = data.email;
    if (data.phone_number !== undefined) patch.phone_number = data.phone_number;
    if (data.lead_score !== undefined) patch.lead_score = Number(data.lead_score);
    if (data.intent_summary !== undefined) patch.intent_summary = data.intent_summary;
    if (data.suggested_reply !== undefined) patch.suggested_reply = data.suggested_reply;
    if (data.channel_source !== undefined) patch.channel_source = data.channel_source;
    if (data.payment_status !== undefined) patch.payment_status = data.payment_status;
    if (data.assigned_agent_name !== undefined) patch.assigned_agent_name = data.assigned_agent_name;
    // CRM pipeline (Kanban)
    if (data.pipeline_stage !== undefined) patch.pipeline_stage = String(data.pipeline_stage).slice(0, 40);
    if (data.deal_value !== undefined) patch.deal_value = (data.deal_value === null || data.deal_value === '') ? null : Math.max(0, Math.round(Number(data.deal_value)) || 0);
    if (data.expected_close !== undefined) patch.expected_close = data.expected_close ? Number(data.expected_close) : null;
    if (data.tags_json !== undefined) {
      patch.tags_json = typeof data.tags_json === 'string' ? data.tags_json : JSON.stringify(data.tags_json);
    }
    if (data.forwarded_to_n8n !== undefined) patch.forwarded_to_n8n = !!data.forwarded_to_n8n ? 1 : 0;
    if (data.forwarded_to_chatwoot !== undefined) patch.forwarded_to_chatwoot = !!data.forwarded_to_chatwoot ? 1 : 0;

    // Handle society, role, units or raw answers updates
    if (data.raw_answers_json !== undefined) {
      patch.raw_answers_json = typeof data.raw_answers_json === 'string' ? data.raw_answers_json : JSON.stringify(data.raw_answers_json);
    } else if (data.society !== undefined || data.role !== undefined || data.units !== undefined || data.raw_answers !== undefined) {
      const existing = await this.getLeadEvent(workspaceId, id);
      const existingAnswers = existing ? (existing.raw_answers || {}) : {};
      const mergedAnswers = {
        ...existingAnswers,
        ...(data.raw_answers || {}),
      };
      if (data.society !== undefined) mergedAnswers.society = data.society;
      if (data.role !== undefined) mergedAnswers.role = data.role;
      if (data.units !== undefined) mergedAnswers.units = data.units;
      patch.raw_answers_json = JSON.stringify(mergedAnswers);
    }

    await knex('meta_lead_events').where({ workspace_id: workspaceId, id }).update(patch);
    return this.getLeadEvent(workspaceId, id);
  },

  // ── CRM activities (notes & follow-up tasks) ────────────────────────────────
  async addActivity(workspaceId, leadId, { user_id = null, kind = 'note', body = '', due_at = null } = {}) {
    const now = nowEpoch();
    const [row] = await knex('lead_activities').insert({
      workspace_id: workspaceId, lead_event_id: Number(leadId), user_id,
      kind: kind === 'task' ? 'task' : 'note', body: String(body || '').slice(0, 2000),
      due_at: due_at ? Number(due_at) : null, created_at: now,
    }).returning('id');
    return knex('lead_activities').where({ id: row?.id ?? row }).first();
  },
  async listActivities(workspaceId, leadId) {
    return knex('lead_activities').where({ workspace_id: workspaceId, lead_event_id: Number(leadId) })
      .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }]);
  },
  async setActivityDone(workspaceId, id, done) {
    await knex('lead_activities').where({ workspace_id: workspaceId, id: Number(id) }).update({ done_at: done ? nowEpoch() : null });
    return knex('lead_activities').where({ workspace_id: workspaceId, id: Number(id) }).first();
  },
  async deleteActivity(workspaceId, id) {
    return knex('lead_activities').where({ workspace_id: workspaceId, id: Number(id) }).del();
  },
  // Pipeline report: value by stage, win rate, owner leaderboard, task summary
  async pipelineReport(workspaceId) {
    const leads = await knex('meta_lead_events').where({ workspace_id: workspaceId })
      .select('pipeline_stage', 'deal_value', 'assigned_agent_name');
    const stages = {};
    const owners = {};
    let openValue = 0, wonValue = 0, won = 0, lost = 0;
    for (const l of leads) {
      const st = l.pipeline_stage || 'new';
      const v = Number(l.deal_value) || 0;
      const s = stages[st] || (stages[st] = { count: 0, value: 0 });
      s.count++; s.value += v;
      if (st === 'won') { won++; wonValue += v; }
      else if (st === 'lost') { lost++; }
      else { openValue += v; }
      const name = (l.assigned_agent_name || '').trim() || 'Unassigned';
      const ow = owners[name] || (owners[name] = { count: 0, open_value: 0, won_value: 0 });
      ow.count++;
      if (st === 'won') ow.won_value += v; else if (st !== 'lost') ow.open_value += v;
    }
    const closed = won + lost;
    const taskRows = await knex('lead_activities').where({ workspace_id: workspaceId, kind: 'task' }).whereNull('done_at').select('due_at').catch(() => []);
    const now = nowEpoch();
    return {
      total: leads.length,
      open_value: openValue, won_value: wonValue, won, lost,
      win_rate: closed ? Math.round((won / closed) * 100) : 0,
      stages: Object.entries(stages).map(([stage, s]) => ({ stage, ...s })),
      owners: Object.entries(owners).map(([owner, o]) => ({ owner, ...o }))
        .sort((a, b) => (b.open_value + b.won_value) - (a.open_value + a.won_value)),
      tasks: { open: taskRows.length, overdue: taskRows.filter((r) => r.due_at && Number(r.due_at) < now).length },
    };
  },

  // Open-task counts per lead, for list/board badges: { leadId: { open, overdue } }
  async openTaskCounts(workspaceId) {
    const rows = await knex('lead_activities')
      .where({ workspace_id: workspaceId, kind: 'task' }).whereNull('done_at')
      .select('lead_event_id', 'due_at');
    const now = nowEpoch();
    const out = {};
    for (const r of rows) {
      const o = out[r.lead_event_id] || (out[r.lead_event_id] = { open: 0, overdue: 0 });
      o.open++;
      if (r.due_at && Number(r.due_at) < now) o.overdue++;
    }
    return out;
  },

  async deleteLeadEvent(workspaceId, id) {
    await knex('whatsapp_messages').where({ workspace_id: workspaceId, lead_id: id }).delete().catch(() => {});
    await knex('messenger_events').where({ workspace_id: workspaceId, lead_id: id }).delete().catch(() => {});
    const deleted = await knex('meta_lead_events').where({ workspace_id: workspaceId, id }).delete();
    return deleted > 0;
  },

  async updateLeadScoreAndSummary(workspaceId, id, data) {
    return this.updateLeadEvent(workspaceId, id, data);
  },

  // ── Messenger Events ───────────────────────────────────────────────────────
  async addMessengerEvent(workspaceId, data) {
    const now = nowEpoch();
    const rows = await knex('meta_messenger_events').insert({
      workspace_id: workspaceId,
      page_id: data.page_id,
      sender_id: data.sender_id,
      message_id: data.message_id || null,
      message_text: data.message_text || null,
      ai_intent: data.ai_intent || null,
      ai_suggested_reply: data.ai_suggested_reply || null,
      chatwoot_conversation_id: data.chatwoot_conversation_id || null,
      is_within_24h_window: data.is_within_24h_window !== undefined ? (data.is_within_24h_window ? 1 : 0) : 1,
      created_at: now,
    }).returning('id');

    const id = rows[0]?.id ?? rows[0];
    return knex('meta_messenger_events').where({ workspace_id: workspaceId, id }).first();
  },

  listMessengerEvents(workspaceId, { pageId, senderId, limit = 50 } = {}) {
    let q = knex('meta_messenger_events').where({ workspace_id: workspaceId });
    if (pageId) q = q.where({ page_id: pageId });
    if (senderId) q = q.where({ sender_id: senderId });
    return q.orderBy('created_at', 'desc').limit(limit);
  },

  // ── Metrics / Stats ────────────────────────────────────────────────────────
  async getStats(workspaceId) {
    const now = nowEpoch();
    const todayStart = now - (now % 86400);

    const [totalLeadsCount] = await knex('meta_lead_events').where({ workspace_id: workspaceId }).count('id as c');
    const [todayLeadsCount] = await knex('meta_lead_events')
      .where({ workspace_id: workspaceId })
      .where('created_at', '>=', todayStart)
      .count('id as c');
    const [hotLeadsCount] = await knex('meta_lead_events')
      .where({ workspace_id: workspaceId })
      .where('lead_score', '>=', 75)
      .count('id as c');
    const [n8nForwardedCount] = await knex('meta_lead_events')
      .where({ workspace_id: workspaceId, forwarded_to_n8n: 1 })
      .count('id as c');
    const [chatwootForwardedCount] = await knex('meta_lead_events')
      .where({ workspace_id: workspaceId, forwarded_to_chatwoot: 1 })
      .count('id as c');
    const [messengerCount] = await knex('meta_messenger_events')
      .where({ workspace_id: workspaceId })
      .count('id as c');

    return {
      total_leads: parseInt(totalLeadsCount?.c || 0, 10),
      today_leads: parseInt(todayLeadsCount?.c || 0, 10),
      hot_leads: parseInt(hotLeadsCount?.c || 0, 10),
      n8n_forwarded: parseInt(n8nForwardedCount?.c || 0, 10),
      chatwoot_forwarded: parseInt(chatwootForwardedCount?.c || 0, 10),
      messenger_conversations: parseInt(messengerCount?.c || 0, 10),
    };
  },

  // ── Native In-App Workflow Engine (n8n-style) ─────────────────────────────
  async addWorkflowLog(workspaceId, leadId, stepName, status = 'success', details = {}) {
    const now = nowEpoch();
    const rows = await knex('lead_workflow_logs').insert({
      workspace_id: workspaceId,
      lead_id: leadId || null,
      workflow_name: 'instant_lead_alert',
      step_name: stepName,
      status,
      details_json: typeof details === 'string' ? details : JSON.stringify(details),
      created_at: now,
    }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    return knex('lead_workflow_logs').where({ id }).first();
  },

  async listWorkflowLogs(workspaceId, { leadId, limit = 50 } = {}) {
    let q = knex('lead_workflow_logs').where({ workspace_id: workspaceId });
    if (leadId) q = q.where({ lead_id: leadId });
    const rows = await q.orderBy('created_at', 'desc').limit(limit);
    return rows.map((r) => ({
      ...r,
      details: parseJson(r.details_json, {}),
    }));
  },

  // ── Native In-App Live Takeover & Shared Inbox (Chatwoot-style) ───────────
  async addLeadMessage(workspaceId, leadId, data) {
    const now = nowEpoch();
    const rows = await knex('lead_conversation_messages').insert({
      workspace_id: workspaceId,
      lead_id: Number(leadId),
      sender_type: data.sender_type || 'agent',
      sender_name: data.sender_name || 'Agent',
      message_text: data.message_text,
      channel: data.channel || 'internal',
      created_at: now,
    }).returning('id');
    const id = rows[0]?.id ?? rows[0];

    // If message is from agent, mark lead as contacted
    if (data.sender_type === 'agent') {
      await knex('meta_lead_events')
        .where({ workspace_id: workspaceId, id: leadId, status: 'new' })
        .update({ status: 'contacted', updated_at: now });
    }

    return knex('lead_conversation_messages').where({ id }).first();
  },

  async listLeadMessages(workspaceId, leadId) {
    return knex('lead_conversation_messages')
      .where({ workspace_id: workspaceId, lead_id: Number(leadId) })
      .orderBy('created_at', 'asc');
  },

  // ── WhatsApp Marketing Suite & In-Chat Commerce Helpers ────────────────────
  async bulkImportLeads(workspaceId, contacts = []) {
    const now = nowEpoch();
    const createdIds = [];
    for (const c of contacts) {
      const cleanPhone = String(c.phone_number || c.phone || '').replace(/[^0-9+]/g, '');
      if (!cleanPhone) continue;
      if (await this.findLeadByPhone(workspaceId, cleanPhone)) continue; // already a contact

      const [newId] = await knex('meta_lead_events').insert({
        workspace_id: workspaceId,
        full_name: c.name || c.full_name || 'WhatsApp contact',
        phone_number: cleanPhone,
        email: c.email || null,
        lead_score: c.lead_score || 75,
        intent_summary: c.notes || 'Imported from a spreadsheet',
        suggested_reply: c.suggested_reply || `Hi ${c.name || 'there'}, thanks for reaching out!`,
        channel_source: c.channel_source || 'csv_upload',
        status: 'new',
        tags_json: JSON.stringify(c.tags || ['imported']),
        created_at: now,
        updated_at: now,
      }).returning('id');
      createdIds.push(newId?.id ?? newId);
    }
    return { count: createdIds.length, ids: createdIds };
  },

  async assignLeadAgent(workspaceId, leadId, agentId, agentName) {
    const now = nowEpoch();
    await knex('meta_lead_events')
      .where({ workspace_id: workspaceId, id: Number(leadId) })
      .update({
        assigned_agent_id: agentId ? Number(agentId) : null,
        assigned_agent_name: agentName || null,
        updated_at: now,
      });
    return knex('meta_lead_events').where({ id: Number(leadId) }).first();
  },

  async updateLeadPaymentStatus(workspaceId, leadId, { status, amount }) {
    const now = nowEpoch();
    const patch = { payment_status: status, updated_at: now };
    if (amount !== undefined) patch.order_value = Number(amount);
    await knex('meta_lead_events')
      .where({ workspace_id: workspaceId, id: Number(leadId) })
      .update(patch);
    return knex('meta_lead_events').where({ id: Number(leadId) }).first();
  },

  async recordBroadcast(workspaceId, data) {
    const now = nowEpoch();
    const rows = await knex('whatsapp_broadcasts').insert({
      workspace_id: workspaceId,
      title: data.title || 'WhatsApp Campaign',
      delivery_engine: data.delivery_engine || 'cloud_api',
      template_name: data.template_name || null,
      message_content: data.message_content || '',
      total_recipients: Number(data.total_recipients || 0),
      sent_count: Number(data.sent_count || 0),
      failed_count: Number(data.failed_count || 0),
      credits_cost: Number(data.credits_cost || 0),
      status: data.status || 'completed',
      created_at: now,
      updated_at: now,
    }).returning('id');
    const id = rows[0]?.id ?? rows[0];

    // Deduct credits from balance
    if (data.credits_cost && data.credits_cost > 0) {
      await knex('meta_lead_configs')
        .where({ workspace_id: workspaceId })
        .decrement('free_credits_balance', Number(data.credits_cost));
    }

    return knex('whatsapp_broadcasts').where({ id }).first();
  },

  async listBroadcasts(workspaceId) {
    return knex('whatsapp_broadcasts')
      .where({ workspace_id: workspaceId })
      .orderBy('created_at', 'desc')
      .limit(50);
  },
});
