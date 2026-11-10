// One path for every incoming WhatsApp message, whichever way it arrives
// (Meta's WhatsApp Cloud API or WhatsApp Web through Evolution API):
// find or add the contact, save the message, score it (if turned on), then let
// the auto-replies answer.

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
      const q = await qualifyLead({ full_name: senderName, phone_number: cleanPhone, custom_answers: { 'WhatsApp message': text } }, {});
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

module.exports = { handleInboundWhatsApp, sendText };
