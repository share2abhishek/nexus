// One path for every incoming WhatsApp message, whichever way it arrives
// (Meta's WhatsApp Cloud API or WhatsApp Web through Evolution API):
// find or add the contact, save the message, score it (if turned on), then let
// the auto-replies answer.

const crypto = require('crypto');
const leadPipelineRepoFactory = require('../../repos/leadPipelineRepo');
const whatsappCloud = require('./whatsappCloud');
const evolutionApi = require('./evolutionApi');
const chatbot = require('./chatbot');
const { forwardToN8n, buildEvent, replyFrom } = require('./n8nForwarder');

// Send a plain text WhatsApp message with the workspace's chosen engine
async function sendText(config, phone, text) {
  const to = String(phone || '').replace(/[^0-9]/g, '');
  if ((config.delivery_engine || 'cloud_api') === 'evolution') {
    return evolutionApi.sendTextMessage({
      apiUrl: config.evolution_api_url, apiKey: config.evolution_api_key,
      instanceName: config.evolution_instance_name || 'social-nexus', number: to, text,
    });
  }
  const token = config.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !config.whatsapp_phone_number_id) {
    return { success: false, error: 'WhatsApp isn’t connected yet (WhatsApp → Setup).' };
  }
  return whatsappCloud.sendWhatsAppMessage({ phoneNumberId: config.whatsapp_phone_number_id, accessToken: token, to, text });
}

// Messages from one person are handled one at a time, in order: several arriving
// together must not each think they're the first (duplicate contacts, double
// welcomes, or the hourly reply limit being skipped).
const queues = new Map();
function handleInboundWhatsApp(knex, args) {
  const key = `${args.config?.workspace_id}:${String(args.phone || '').replace(/[^0-9]/g, '')}`;
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => processInbound(knex, args));
  queues.set(key, run);
  run.finally(() => { if (queues.get(key) === run) queues.delete(key); }).catch(() => {});
  return run;
}

async function processInbound(knex, { config, phone, name, text, source }) {
  const repo = leadPipelineRepoFactory(knex);
  const workspaceId = config.workspace_id;
  const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
  if (!cleanPhone || !text) return null;
  const senderName = name || 'WhatsApp contact';

  let lead = await repo.findLeadByPhone(workspaceId, cleanPhone);
  if (!lead) {
    lead = await repo.addLeadEvent(workspaceId, {
      full_name: senderName,
      phone_number: '+' + cleanPhone,
      form_id: source === 'evolution' ? 'evolution_whatsapp_inbound' : 'whatsapp_cloud_inbound',
      intent_summary: `Wrote to you on WhatsApp: "${String(text).slice(0, 80)}"`,
      status: 'new',
      lead_score: 50,
    });
  }

  await repo.addLeadMessage(workspaceId, lead.id, {
    sender_type: 'lead', sender_name: senderName, message_text: text, channel: 'whatsapp',
  });

  // Your n8n workflow (if an address is saved) gets every message as an event
  const n8nUrl = config.n8n_webhook_url;
  const event = (extra) => buildEvent('whatsapp.message_received', workspaceId, {
    contact: { lead_id: lead.id, name: senderName, phone: '+' + cleanPhone },
    message: { text, source: source || 'cloud_api' },
    ...extra,
  });

  // Auto-replies first (customers expect an answer in seconds), scoring after
  let bot = null;
  try {
    bot = await chatbot.handleInbound(knex, {
      workspaceId, lead, text, name: senderName,
      send: (reply) => sendText(config, cleanPhone, reply),
      // "Let your n8n workflow answer": it responds {"reply": "…"} to send on WhatsApp
      askN8n: n8nUrl ? async () => {
        const r = await forwardToN8n(n8nUrl, event({ reply_wanted: true, how_to_reply: 'Respond with JSON {"reply": "your text"} to answer on WhatsApp.' }));
        if (!r.success) throw new Error(r.error || 'n8n did not answer');
        return replyFrom(r);
      } : null,
    });
  } catch (err) {
    console.warn('[WhatsApp] Auto-reply failed:', err.message);
  }

  // Everyone else just gets told what happened (the bot's reply, a hand-over, STOP…)
  if (n8nUrl && !bot?.n8nAsked) {
    forwardToN8n(n8nUrl, event({
      reply_wanted: false,
      bot: { replied: bot?.sent || [], reason: bot?.reason || null, action: bot?.action || null },
    })).catch(() => {});
  }

  if (config.auto_qualify_ai) {
    try {
      const { qualifyLead } = require('./leadQualifier');
      const q = await qualifyLead({ full_name: senderName, phone_number: cleanPhone, custom_answers: { 'WhatsApp message': text } }, { workspaceId });
      if (q && (q.suggested_reply || q.suggestedReply)) {
        await repo.updateLeadEvent(workspaceId, lead.id, {
          lead_score: q.score || q.leadScore || lead.lead_score,
          intent_summary: q.intent_summary || q.intentSummary || lead.intent_summary,
          suggested_reply: q.suggested_reply || q.suggestedReply,
        });
      }
    } catch (err) {
      console.warn('[WhatsApp] Lead scoring note:', err.message);
    }
  }

  return { lead, bot };
}

// ── Website live-chat ─────────────────────────────────────────────────────────
// A message from a visitor on the customer's website (the embeddable widget, or any
// site that POSTs to /webhooks/webchat/:token). Same bot, menu, keywords and
// knowledge base as WhatsApp, but the reply is returned in the HTTP response so the
// widget can show it straight away. A visitor is tracked by a visitor_id the widget
// keeps, so the bot's state (welcome once, hand-over pauses, hourly limit) works.
async function handleInboundWebChat(knex, { config, visitorId, name, text }) {
  const repo = leadPipelineRepoFactory(knex);
  const workspaceId = config.workspace_id;
  const msg = String(text || '').trim().slice(0, 2000);
  if (!msg) return { reply: null };
  const senderName = String(name || 'Website visitor').slice(0, 80);
  const ref = `web:${String(visitorId || crypto.randomBytes(8).toString('hex')).replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 90)}`;

  let lead = await knex('meta_lead_events').where({ workspace_id: workspaceId, leadgen_id: ref }).first();
  if (!lead) {
    lead = await repo.addLeadEvent(workspaceId, {
      full_name: senderName, leadgen_id: ref, form_id: 'webchat_inbound',
      intent_summary: `Website chat: "${msg.slice(0, 80)}"`, status: 'new', lead_score: 50,
    });
  }
  await repo.addLeadMessage(workspaceId, lead.id, {
    sender_type: 'lead', sender_name: senderName, message_text: msg, channel: 'web',
  });

  const captured = [];
  const n8nUrl = config.n8n_webhook_url;
  const event = (extra) => buildEvent('webchat.message_received', workspaceId, {
    contact: { lead_id: lead.id, name: senderName, visitor_id: visitorId || null },
    message: { text: msg, source: 'webchat' },
    ...extra,
  });

  let bot = null;
  try {
    bot = await chatbot.handleInbound(knex, {
      workspaceId, lead, text: msg, name: senderName,
      // Web-chat captures replies instead of sending them over WhatsApp
      send: (reply) => { if (reply) captured.push(reply); return { success: true }; },
      askN8n: n8nUrl ? async () => {
        const r = await forwardToN8n(n8nUrl, event({ reply_wanted: true, how_to_reply: 'Respond with JSON {"reply": "your text"} to answer on the website chat.' }));
        if (!r.success) throw new Error(r.error || 'n8n did not answer');
        return replyFrom(r);
      } : null,
    });
  } catch (err) {
    console.warn('[WebChat] Auto-reply failed:', err.message);
  }

  // Tell an n8n workflow about the message too (unless it was the one that answered)
  if (n8nUrl && !bot?.n8nAsked) {
    forwardToN8n(n8nUrl, event({
      reply_wanted: false,
      bot: { replied: bot?.sent || [], reason: bot?.reason || null, action: bot?.action || null },
    })).catch(() => {});
  }

  return { reply: captured.join('\n\n') || null, lead_id: lead.id, action: bot?.action || null, reason: bot?.reason || null };
}

/**
 * Inbound Call Handler for WhatsApp (Voice or Video calls)
 * Triggered by Evolution API webhook 'call' or Meta calling events.
 */
async function handleInboundWhatsAppCall(knex, { config, phone, name, isVideo = false, callId = null, source = 'whatsapp_call' }) {
  const repo = leadPipelineRepoFactory(knex);
  const workspaceId = config.workspace_id;
  const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
  if (!cleanPhone) return null;
  const callerName = name || `WhatsApp Caller (+${cleanPhone.slice(-4)})`;
  const callTypeStr = isVideo ? 'Video Call' : 'Voice Call';

  // 1. Locate existing lead or create a new one
  let lead = await repo.findLeadByPhone(workspaceId, cleanPhone);
  const nowSec = Math.floor(Date.now() / 1000);

  // Pick an active agent to route to
  let assignedAgent = lead?.assigned_agent_name;
  if (!assignedAgent) {
    const defaultUser = await knex('memberships')
      .join('users', 'memberships.user_id', 'users.id')
      .where('memberships.workspace_id', workspaceId)
      .select('users.name')
      .first()
      .catch(() => null);
    assignedAgent = defaultUser?.name || 'Support Agent';
  }

  if (!lead) {
    lead = await repo.addLeadEvent(workspaceId, {
      full_name: callerName,
      phone_number: '+' + cleanPhone,
      form_id: 'whatsapp_inbound_call',
      intent_summary: `Placed an inbound WhatsApp ${callTypeStr}`,
      status: 'new',
      pipeline_stage: 'contacted',
      lead_score: 95,
      assigned_agent_name: assignedAgent,
      tag: '📞 Call Inbound',
      source: 'WHATSAPP_CALL',
      suggested_reply: `Hi ${callerName}, we noticed your call! How can we assist you?`,
    });
  } else {
    // Existing lead: elevate score, add tag, and assign agent
    const tags = Array.isArray(lead.tags_json) ? lead.tags_json : [];
    if (!tags.includes('📞 Call Inbound')) tags.push('📞 Call Inbound');
    await repo.updateLeadEvent(workspaceId, lead.id, {
      lead_score: Math.max(Number(lead.lead_score || 0), 95),
      assigned_agent_name: assignedAgent,
      pipeline_stage: (lead.pipeline_stage === 'won' || lead.pipeline_stage === 'lost') ? lead.pipeline_stage : 'contacted',
      tags_json: tags,
    });
  }

  // 2. Add an explicit record in the chat stream
  await repo.addLeadMessage(workspaceId, lead.id, {
    sender_type: 'lead',
    sender_name: callerName,
    message_text: `📞 Inbound WhatsApp ${callTypeStr} (${cleanPhone}) — Missed/Declined`,
    channel: 'whatsapp',
  });

  // 3. Add an urgent CRM follow-up task on the contact
  await repo.addActivity(workspaceId, lead.id, {
    kind: 'task',
    body: `🚨 Call Follow-Up: ${callerName} placed an inbound WhatsApp ${callTypeStr}. Follow up promptly or call back on +${cleanPhone}.`,
    due_at: nowSec + 15 * 60, // Due in 15 mins
  }).catch(() => {});

  // 4. Pause the auto-reply bot so human agent has takeover
  await chatbot.pauseForHuman(knex, workspaceId, lead.id).catch(() => {});

  // 5. Send automated polite WhatsApp acknowledgment message to the caller
  const firstName = (callerName || '').split(' ')[0] || 'there';
  const autoCallReply = `Hi ${firstName}, we noticed you called our WhatsApp line! Our audio lines are currently occupied, but our agent ${assignedAgent} has been notified and will assist you right here or call you back shortly. How can we help you today?`;

  try {
    await sendText(config, cleanPhone, autoCallReply);
    await repo.addLeadMessage(workspaceId, lead.id, {
      sender_type: 'bot',
      sender_name: 'Auto-reply (Call)',
      message_text: autoCallReply,
      channel: 'whatsapp',
    });
  } catch (err) {
    console.warn('[WhatsApp Call Handler] Could not send call-reply text:', err.message);
  }

  // 6. Notify n8n or external workflow if configured
  if (config.n8n_webhook_url) {
    const event = buildEvent('whatsapp.call_received', workspaceId, {
      contact: { lead_id: lead.id, name: callerName, phone: '+' + cleanPhone, assigned_to: assignedAgent },
      call: { type: isVideo ? 'video' : 'voice', call_id: callId, source },
    });
    forwardToN8n(config.n8n_webhook_url, event).catch(() => {});
  }

  return { success: true, lead_id: lead.id, assigned_to: assignedAgent, caller: cleanPhone };
}

module.exports = { handleInboundWhatsApp, handleInboundWebChat, handleInboundWhatsAppCall, sendText };
