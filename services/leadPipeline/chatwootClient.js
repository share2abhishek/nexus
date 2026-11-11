// services/leadPipeline/chatwootClient.js
// Integrates incoming Meta leads and Messenger messages with Chatwoot CRM & Shared Inbox.

const axios = require('axios');

function makeClient(config) {
  const { chatwoot_url, chatwoot_api_token, chatwoot_account_id } = config;
  if (!chatwoot_url || !chatwoot_api_token || !chatwoot_account_id) {
    return null;
  }

  const baseURL = chatwoot_url.replace(/\/+$/, '');
  return {
    baseURL,
    accountId: Number(chatwoot_account_id),
    client: axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        api_access_token: chatwoot_api_token.trim(),
        'Content-Type': 'application/json',
      },
    }),
  };
}

/**
 * Verifies Chatwoot connectivity and credentials.
 */
async function testChatwootConnection(config) {
  const c = makeClient(config);
  if (!c) {
    return { success: false, error: 'Chatwoot URL, API token, and Account ID are all required.' };
  }

  try {
    const res = await c.client.get(`/api/v1/accounts/${c.accountId}`);
    return {
      success: true,
      account_name: res.data?.name || `Account #${c.accountId}`,
      status: 'connected',
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    return { success: false, error: `Chatwoot connection failed: ${msg}` };
  }
}

/**
 * Creates or finds a contact in Chatwoot for an incoming lead.
 */
async function syncContactToChatwoot(config, lead) {
  const c = makeClient(config);
  if (!c) return { skipped: true, reason: 'Chatwoot not configured' };

  try {
    const contactPayload = {
      name: lead.full_name || 'Meta Ad Lead',
      email: lead.email || undefined,
      phone_number: lead.phone_number || undefined,
      custom_attributes: {
        source: 'Meta Lead Ad',
        lead_score: lead.lead_score || 50,
        form_id: lead.form_id || '',
        ad_id: lead.ad_id || '',
      },
    };

    const res = await c.client.post(`/api/v1/accounts/${c.accountId}/contacts`, contactPayload);
    const contactId = res.data?.payload?.contact?.id || res.data?.id;

    // If inbox_id is configured, create conversation
    let conversationId = null;
    if (contactId && config.chatwoot_inbox_id) {
      const convPayload = {
        inbox_id: Number(config.chatwoot_inbox_id),
        contact_id: contactId,
        message: {
          content: `🎯 New Meta Ad Lead Ingested!\nName: ${lead.full_name || 'N/A'}\nPhone: ${lead.phone_number || 'N/A'}\nEmail: ${lead.email || 'N/A'}\nAI Qualification: ${lead.intent_summary || 'Interested in offer.'}\nSuggested Reply: "${lead.suggested_reply || 'Follow up promptly.'}"`,
        },
      };

      const convRes = await c.client.post(`/api/v1/accounts/${c.accountId}/conversations`, convPayload);
      conversationId = convRes.data?.id || null;
    }

    return {
      success: true,
      contact_id: contactId,
      conversation_id: conversationId,
    };
  } catch (err) {
    console.error('[Chatwoot] Error syncing contact:', err.message);
    return {
      success: false,
      error: err.response?.data ? JSON.stringify(err.response.data) : err.message,
    };
  }
}

module.exports = {
  testChatwootConnection,
  syncContactToChatwoot,
};
