// services/leadPipeline/n8nForwarder.js
// Dispatches pre-parsed, AI-qualified lead payloads to n8n webhook workflows.

const axios = require('axios');

/**
 * Forwards an enriched lead event to the configured n8n webhook URL.
 */
async function forwardToN8n(n8nWebhookUrl, payload) {
  if (!n8nWebhookUrl || typeof n8nWebhookUrl !== 'string') {
    return { success: false, skipped: true, reason: 'No n8n webhook URL configured' };
  }

  const cleanUrl = n8nWebhookUrl.trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    return { success: false, error: 'Invalid n8n webhook URL scheme' };
  }

  try {
    const response = await axios.post(cleanUrl, payload, {
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
        'X-Social-Nexus-Event': payload.event || 'lead.created',
        'User-Agent': 'Social-Nexus/2.1 (LeadPipeline)',
      },
    });

    return {
      success: true,
      status: response.status,
      data: response.data,
    };
  } catch (err) {
    console.error('[n8n Forwarder] Error delivering webhook to n8n:', err.message);
    return {
      success: false,
      error: err.response?.data ? JSON.stringify(err.response.data) : err.message,
      statusCode: err.response?.status || null,
    };
  }
}

/**
 * One event in the shape every Social-Nexus → n8n call uses, so a workflow can
 * switch on `event` (also sent as the X-Social-Nexus-Event header).
 */
function buildEvent(event, workspaceId, data = {}) {
  return { event, sent_at: new Date().toISOString(), workspace_id: workspaceId, ...data };
}

// The reply text an n8n workflow sent back ({"reply": "…"}, or plain text)
function replyFrom(result) {
  const d = result?.data;
  if (typeof d === 'string') return d.trim() || null;
  if (d && typeof d.reply === 'string') return d.reply.trim() || null;
  if (Array.isArray(d) && typeof d[0]?.reply === 'string') return d[0].reply.trim() || null; // n8n "all items" responses
  return null;
}

module.exports = {
  forwardToN8n,
  buildEvent,
  replyFrom,
};
