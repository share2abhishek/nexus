// routes/webhooks.js
// Public Webhook receiver for official Meta Graph API webhooks (leadgen and messages).

const express = require('express');
const router = express.Router();
const leadPipelineRepoFactory = require('../repos/leadPipelineRepo');
const { fetchMetaLeadDetails, verifyMetaSignature } = require('../services/leadPipeline/metaWebhook');
const { handleInboundWhatsApp } = require('../services/leadPipeline/inbound');
const { qualifyLead } = require('../services/leadPipeline/leadQualifier');
const { forwardToN8n } = require('../services/leadPipeline/n8nForwarder');
const { syncContactToChatwoot } = require('../services/leadPipeline/chatwootClient');

module.exports = (knex) => {
  const repo = leadPipelineRepoFactory(knex);

  // ── Meta Webhook Verification Handshake (GET) ─────────────────────────────
  // Meta sends: hub.mode=subscribe, hub.challenge=..., hub.verify_token=...
  router.get('/meta', async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token) {
      const config = await repo.getConfigByVerifyToken(token);
      if (config) {
        console.log(`[Meta Webhook] Verification handshake successful for Workspace #${config.workspace_id}`);
        return res.status(200).send(challenge);
      }
      console.warn(`[Meta Webhook] Handshake rejected: unrecognized verify_token "${token}"`);
      return res.status(403).send('Verification token mismatch');
    }

    res.status(400).send('Invalid webhook verification request');
  });

  // ── Meta Webhook Ingestion (POST) ──────────────────────────────────────────
  router.post('/meta', express.json(), async (req, res) => {
    // Only Meta may post here: check its signature with the app secret (when one
    // is saved). Without this, anyone who knows the address could add fake chats.
    // The secret saved in WhatsApp → Setup is enforced. The Facebook login app's
    // secret may belong to a different Meta app than the one sending WhatsApp
    // messages, so a mismatch with it is only logged (refusing would silently
    // drop every customer message).
    const saved = [...new Set(await knex('meta_lead_configs').whereNotNull('app_secret').pluck('app_secret').catch(() => []))].filter(Boolean);
    const sig = req.get('X-Hub-Signature-256');
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    if (saved.length) {
      if (!saved.some(sec => verifyMetaSignature(raw, sig, sec))) {
        console.warn('[Meta Webhook] Ignored a request with a missing or wrong signature');
        return res.status(401).send('Invalid signature');
      }
    } else if (process.env.FACEBOOK_APP_SECRET && !verifyMetaSignature(raw, sig, process.env.FACEBOOK_APP_SECRET)) {
      console.warn('[Meta Webhook] Signature didn’t match the Facebook app secret. Add the App secret of the app that sends webhooks in WhatsApp → Setup to refuse unsigned requests.');
    }

    // Immediately acknowledge Meta with 200 OK so Meta doesn't retry or drop webhook
    res.status(200).send('EVENT_RECEIVED');

    const body = req.body;
    if (!body || !Array.isArray(body.entry)) {
      return;
    }

    // ── Meta WhatsApp Cloud API Inbound Ingestion ─────────────────────────────
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        const wabaId = String(entry.id);
        const config =
          (await knex('meta_lead_configs').where({ whatsapp_business_account_id: wabaId }).first()) ||
          (await knex('meta_lead_configs').first());
        if (!config) continue;

        for (const change of entry.changes || []) {
          if (change.field !== 'messages' || !change.value) continue;
          const contacts = change.value.contacts || [];
          for (const msg of change.value.messages || []) {
            const contact = contacts.find((c) => c.wa_id === msg.from) || {};
            const text = msg.type === 'text' ? msg.text?.body
              : msg.type === 'button' ? msg.button?.text
              : msg.type === 'interactive' ? (msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title)
              : '';
            try {
              await handleInboundWhatsApp(knex, { config, phone: msg.from, name: contact.profile?.name, text: text || '', source: 'cloud_api' });
            } catch (err) {
              console.error('[Meta WhatsApp Webhook] Could not save a message:', err.message);
            }
          }
        }
      }
      return;
    }

    if (body.object !== 'page') {
      return;
    }

    for (const entry of body.entry) {
      const pageId = String(entry.id);

      // Locate configuration by Page ID or fallback to primary config
      let config = await repo.getConfigByPageId(pageId);
      if (!config) {
        // Check if there is a social account with this page_id to find workspace
        const account = await knex('social_accounts').where({ page_id: pageId, platform: 'facebook' }).first();
        if (account?.workspace_id) {
          config = await repo.getOrCreateConfig(account.workspace_id);
          // Link page_id to config for future fast lookups
          await repo.updateConfig(account.workspace_id, { page_id: pageId });
        }
      }

      if (!config) {
        console.warn(`[Meta Webhook] No workspace configuration mapped to Facebook Page #${pageId}`);
        continue;
      }

      const workspaceId = config.workspace_id;

      // ── Process LeadGen Changes ───────────────────────────────────────────
      for (const change of entry.changes || []) {
        if (change.field === 'leadgen' && change.value) {
          const val = change.value;
          const leadgenId = val.leadgen_id;

          try {
            // Retrieve Page Access Token from connected social account
            const account = await knex('social_accounts')
              .where({ workspace_id: workspaceId, platform: 'facebook' })
              .orderBy('id', 'desc')
              .first();

            const pageToken = account?.page_token || account?.access_token;
            if (!pageToken) {
              console.error(`[Meta Webhook] Cannot fetch lead #${leadgenId}: no Facebook token for Workspace #${workspaceId}`);
              continue;
            }

            // 1. Fetch full user answers from Meta Graph API
            const leadDetails = await fetchMetaLeadDetails(leadgenId, pageToken);

            // 2. Run AI Qualification
            const qualification = await qualifyLead(leadDetails, { workspaceId });

            // 3. Save to database
            const leadRecord = await repo.addLeadEvent(workspaceId, {
              leadgen_id: leadDetails.leadgen_id,
              form_id: leadDetails.form_id || val.form_id,
              page_id: leadDetails.page_id || pageId,
              ad_id: leadDetails.ad_id || val.ad_id,
              adgroup_id: leadDetails.adgroup_id || val.adgroup_id,
              campaign_id: leadDetails.campaign_id,
              full_name: leadDetails.full_name,
              email: leadDetails.email,
              phone_number: leadDetails.phone_number,
              raw_answers_json: leadDetails.custom_answers,
              lead_score: qualification.score,
              intent_summary: qualification.intent_summary,
              suggested_reply: qualification.suggested_reply,
            });

            console.log(`[Meta Lead Ingestion] Lead #${leadRecord.id} saved for Workspace #${workspaceId} (${leadRecord.full_name}) - Score: ${qualification.score}/100`);

            // 4. Forward to n8n workflow if configured
            if (config.n8n_webhook_url) {
              const n8nRes = await forwardToN8n(config.n8n_webhook_url, {
                event: 'lead.created',
                lead_id: leadRecord.id,
                leadgen_id: leadDetails.leadgen_id,
                workspace_id: workspaceId,
                page_id: pageId,
                full_name: leadDetails.full_name,
                email: leadDetails.email,
                phone_number: leadDetails.phone_number,
                custom_answers: leadDetails.custom_answers,
                lead_score: qualification.score,
                intent_summary: qualification.intent_summary,
                suggested_reply: qualification.suggested_reply,
                created_at: leadRecord.created_at,
              });

              if (n8nRes.success) {
                await repo.updateLeadEvent(workspaceId, leadRecord.id, { forwarded_to_n8n: 1 });
              }
            }

            // 5. Sync to Chatwoot CRM / Inbox if configured
            if (config.chatwoot_url && config.chatwoot_api_token) {
              const cwRes = await syncContactToChatwoot(config, leadRecord);
              if (cwRes.success) {
                await repo.updateLeadEvent(workspaceId, leadRecord.id, { forwarded_to_chatwoot: 1 });
              }
            }
          } catch (err) {
            console.error(`[Meta Webhook] Error processing leadgen #${leadgenId}:`, err.message);
          }
        }
      }

      // ── Process Click-to-Messenger Messages ────────────────────────────────
      for (const msg of entry.messaging || []) {
        if (msg.message && msg.sender?.id) {
          const senderId = msg.sender.id;
          const text = msg.message.text || '';

          try {
            await repo.addMessengerEvent(workspaceId, {
              page_id: pageId,
              sender_id: senderId,
              message_id: msg.message.mid,
              message_text: text,
              is_within_24h_window: true,
            });

            console.log(`[Meta Messenger] Ingested message from ${senderId} on Page ${pageId}`);
          } catch (err) {
            console.error(`[Meta Webhook] Error logging messenger event:`, err.message);
          }
        }
      }
    }
  });

  // ── WhatsApp Web (Evolution API) Inbound ──────────────────────────────────
  // Evolution calls this from outside the app (no sign-in), so the address has
  // the workspace's random verify token in it instead.
  router.post('/evolution/:token', express.json({ limit: '2mb' }), async (req, res) => {
    const config = await repo.getConfigByVerifyToken(String(req.params.token || '')).catch(() => null);
    if (!config) return res.status(404).json({ error: 'Unknown address' });
    res.status(200).json({ status: 'received' });
    try {
      const body = req.body || {};
      if ((body.event || body.type) !== 'messages.upsert' || !body.data) return;
      const key = body.data.key || {};
      if (key.fromMe || !key.remoteJid || /@g.us$/.test(key.remoteJid)) return; // own messages and groups
      const m = body.data.message || {};
      const text = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption
        || m.buttonsResponseMessage?.selectedDisplayText || m.listResponseMessage?.title || '';
      await handleInboundWhatsApp(knex, { config, phone: key.remoteJid.split('@')[0], name: body.data.pushName, text, source: 'evolution' });
    } catch (err) {
      console.warn('[Evolution Webhook] Could not save a message:', err.message);
    }
  });

  return router;
};
