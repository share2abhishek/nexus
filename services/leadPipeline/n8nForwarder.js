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

module.exports = {
  forwardToN8n,
};
