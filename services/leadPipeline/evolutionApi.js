// services/leadPipeline/evolutionApi.js
// Client service for Evolution API v2 (https://github.com/evolution-foundation/evolution-api)
// Enables WhatsApp Web / Baileys multi-device pairing, QR-code connect, 0-ban risk direct messaging,
// and automated webhook ingestion alongside Meta Official Cloud API.

const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 10000;

function cleanPhoneNumber(phone) {
  if (!phone) return '';
  let clean = String(phone).replace(/[^0-9]/g, '');
  if (clean.length === 10) clean = '91' + clean;
  return clean;
}

/**
 * Format standard Evolution API headers
 */
function getHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['apikey'] = apiKey;
  }
  return headers;
}

/**
 * Normalize Evolution API URL (remove trailing slashes)
 */
function cleanUrl(url) {
  if (!url) return 'http://localhost:8080';
  return url.replace(/\/+$/, '');
}

/**
 * Create or connect an Evolution API instance
 * @param {Object} params
 * @param {string} params.apiUrl - e.g. http://localhost:8080
 * @param {string} params.apiKey - Global or instance API key
 * @param {string} params.instanceName - e.g. social-nexus
 * @param {string} [params.webhookUrl] - Inbound webhook endpoint
 */
async function createOrConnectInstance({ apiUrl, apiKey, instanceName = 'social-nexus', webhookUrl }) {
  const baseUrl = cleanUrl(apiUrl);
  const endpointCreate = `${baseUrl}/instance/create`;

  try {
    const payload = {
      instanceName,
      token: apiKey || 'nexus_whatsapp_token',
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    };

    const res = await axios.post(endpointCreate, payload, {
      headers: getHeaders(apiKey),
      timeout: DEFAULT_TIMEOUT_MS,
    });

    // If webhookUrl provided, configure it automatically
    if (webhookUrl) {
      await setWebhook({ apiUrl, apiKey, instanceName, webhookUrl }).catch((wErr) => {
        console.warn('[Evolution API] Webhook registration note:', wErr.message);
      });
    }

    return {
      success: true,
      action: 'created',
      instance: res.data?.instance || res.data,
      qrcode: res.data?.qrcode?.base64 || res.data?.base64 || null,
      pairing_code: res.data?.qrcode?.code || null,
    };
  } catch (err) {
    const status = err.response?.status;
    const errMessage = err.response?.data?.message || err.response?.data?.response?.message || err.message;

    // 403 or already exists -> Fetch current connect status & QR
    if (status === 403 || status === 400 || (typeof errMessage === 'string' && errMessage.toLowerCase().includes('already in use'))) {
      const connectRes = await fetchQrCode({ apiUrl, apiKey, instanceName });
      return {
        success: true,
        action: 'connected_existing',
        instance: { instanceName },
        ...connectRes,
      };
    }

    return {
      success: false,
      error: `Evolution API connection error: ${errMessage}`,
      setup_hint: 'Make sure your Evolution API instance is running (e.g. docker run -p 8080:8080 atendai/evolution-api:v2.1.1) and API key matches.',
    };
  }
}

/**
 * Fetch QR Code or connection state for an existing instance
 */
async function fetchQrCode({ apiUrl, apiKey, instanceName = 'social-nexus' }) {
  const baseUrl = cleanUrl(apiUrl);
  const endpoint = `${baseUrl}/instance/connect/${instanceName}`;

  try {
    const res = await axios.get(endpoint, {
      headers: getHeaders(apiKey),
      timeout: DEFAULT_TIMEOUT_MS,
    });

    const data = res.data || {};
    const base64 = data.base64 || data.qrcode?.base64 || null;
    const code = data.code || data.pairingCode || null;
    const isConnected = data.instance?.state === 'open' || data.state === 'open';

    return {
      success: true,
      connected: isConnected,
      state: isConnected ? 'open' : (data.state || 'connecting'),
      qrcode: base64,
      pairing_code: code,
      display_number: data.instance?.ownerJid ? data.instance.ownerJid.split('@')[0] : null,
    };
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    return {
      success: false,
      connected: false,
      state: 'disconnected',
      error: errMsg,
    };
  }
}

/**
 * Check connection status of instance
 */
async function getConnectionState({ apiUrl, apiKey, instanceName = 'social-nexus' }) {
  const baseUrl = cleanUrl(apiUrl);
  const endpoint = `${baseUrl}/instance/connectionState/${instanceName}`;

  try {
    const res = await axios.get(endpoint, {
      headers: getHeaders(apiKey),
      timeout: 5000,
    });

    const state = res.data?.instance?.state || res.data?.state || 'close';
    return {
      success: true,
      state, // 'open' | 'connecting' | 'close'
      connected: state === 'open',
    };
  } catch (err) {
    return {
      success: false,
      state: 'disconnected',
      connected: false,
      error: err.response?.data?.message || err.message,
    };
  }
}

/**
 * Send outbound WhatsApp message via Evolution API
 */
async function sendTextMessage({ apiUrl, apiKey, instanceName = 'social-nexus', number, text }) {
  const cleanTo = cleanPhoneNumber(number);
  const baseUrl = cleanUrl(apiUrl);
  const endpoint = `${baseUrl}/message/sendText/${instanceName}`;

  if (!cleanTo) {
    return { success: false, error: 'Recipient phone number is required.' };
  }

  try {
    const payload = {
      number: cleanTo,
      text: text || 'Hello!',
      delay: 1200,
      linkPreview: true,
    };

    const res = await axios.post(endpoint, payload, {
      headers: getHeaders(apiKey),
      timeout: DEFAULT_TIMEOUT_MS,
    });

    return {
      success: true,
      mode: 'evolution_api',
      message_id: res.data?.key?.id || res.data?.messageId,
      recipient: cleanTo,
      response: res.data,
      message: `WhatsApp message dispatched via Evolution API to +${cleanTo}!`,
    };
  } catch (err) {
    const errMsg = err.response?.data?.message || err.response?.data?.error || err.message;
    console.warn('[Evolution API] Outbound error:', errMsg);

    // Fallback to 1-click WhatsApp bridge so workflow is NEVER blocked
    const bridgeUrl = `https://wa.me/${cleanTo}?text=${encodeURIComponent(text || 'Hello!')}`;
    return {
      success: false,
      mode: 'fallback_bridge',
      recipient: cleanTo,
      bridge_url: bridgeUrl,
      error: errMsg,
      message: `Evolution API: ${errMsg}. Fallback bridge ready.`,
    };
  }
}

/**
 * Send WhatsApp in-chat UPI Payment Request
 */
async function sendPaymentLinkMessage({ apiUrl, apiKey, instanceName, number, title, amount, upiVpa, payeeName = '' }) {
  if (!upiVpa) return { success: false, error: 'Add your UPI ID first (it’s where the money goes).' };
  const cleanTo = cleanPhoneNumber(number);
  const amtFormatted = Number(amount || 0).toFixed(2);
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=Urban%20Society&am=${amtFormatted}&cu=INR&tn=${encodeURIComponent(title || 'Society Dues')}`;
  
  const paymentMessage = `💳 *${payeeName ? `${payeeName} – ` : ''}Payment request*\n\n` +
    `🏢 *Bill/Service:* ${title || 'Society Maintenance & Amenities'}\n` +
    `💰 *Amount Due:* ₹${amtFormatted}\n` +
    `⚡ *Pay via UPI (GPay, PhonePe, Paytm, BHIM):*\n` +
    `${upiUrl}\n\n` +
    `_Tap link above to pay instantly inside WhatsApp with 0% gateway commission._`;

  return sendTextMessage({
    apiUrl,
    apiKey,
    instanceName,
    number: cleanTo,
    text: paymentMessage,
  });
}

/**
 * Configure inbound Webhook on Evolution API
 */
async function setWebhook({ apiUrl, apiKey, instanceName = 'social-nexus', webhookUrl }) {
  const baseUrl = cleanUrl(apiUrl);
  const endpoint = `${baseUrl}/webhook/set/${instanceName}`;

  const payload = {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: false,
      base64: false,
      events: [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'CONNECTION_UPDATE',
        'CALL',
      ],
    },
  };

  const res = await axios.post(endpoint, payload, {
    headers: getHeaders(apiKey),
    timeout: DEFAULT_TIMEOUT_MS,
  });

  return res.data;
}

/**
 * Configure Instance Settings (e.g. Call rejection and auto-response)
 */
async function configureSettings({ apiUrl, apiKey, instanceName = 'social-nexus', rejectCall = true, msgCall = null }) {
  const baseUrl = cleanUrl(apiUrl);
  const endpoint = `${baseUrl}/settings/set/${instanceName}`;

  const payload = {
    rejectCall: !!rejectCall,
    msgCall: msgCall || 'Hello! We do not take WhatsApp voice calls on this number. An agent has been alerted and will reach out to you shortly.',
    groupsIgnore: false,
    alwaysOnline: true,
    readMessages: true,
  };

  try {
    const res = await axios.post(endpoint, payload, {
      headers: getHeaders(apiKey),
      timeout: DEFAULT_TIMEOUT_MS,
    });
    return { success: true, data: res.data };
  } catch (err) {
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

/**
 * Disconnect/Logout Evolution API instance
 */
async function logoutInstance({ apiUrl, apiKey, instanceName = 'social-nexus' }) {
  const baseUrl = cleanUrl(apiUrl);
  const endpoint = `${baseUrl}/instance/logout/${instanceName}`;

  try {
    const res = await axios.delete(endpoint, {
      headers: getHeaders(apiKey),
      timeout: DEFAULT_TIMEOUT_MS,
    });
    return { success: true, data: res.data };
  } catch (err) {
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

module.exports = {
  createOrConnectInstance,
  fetchQrCode,
  getConnectionState,
  sendTextMessage,
  sendPaymentLinkMessage,
  setWebhook,
  configureSettings,
  logoutInstance,
  cleanPhoneNumber,
};
