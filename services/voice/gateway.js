// Client for the voice gateway (voice-gateway/, Python): it terminates the WhatsApp call audio (WebRTC) and runs the
// turn loop (speech-to-text, AI reply, voice) with the AI providers' APIs. Nexus sends it Meta's SDP offer and the
// assistant's setup; it answers with our SDP. All requests are signed (services/voice/sign.js).
const { sign } = require('./sign');

let override = null; // tests: setGateway({ startSession, endSession })

const url = () => String(process.env.VOICE_GATEWAY_URL || '').replace(/\/+$/, '');
const secret = () => process.env.VOICE_GATEWAY_SECRET || '';
const configured = () => !!(url() && secret().length >= 32);

async function post(path, payload, timeoutMs = 8000) {
  const body = JSON.stringify(payload);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url()}${path}`, { method: 'POST', signal: ctrl.signal, body, headers: { 'Content-Type': 'application/json', 'X-Voice-Signature': sign(body, secret()) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`voice gateway ${path} failed (${res.status}): ${data.error || ''}`);
    return data;
  } finally { clearTimeout(timer); }
}

// session: { callId, sdpOffer, assistant, knowledge, caller, callbackUrl } -> { sdpAnswer }
async function startSession(session) {
  if (override) return override.startSession(session);
  if (!configured()) throw new Error('voice gateway not configured');
  return post('/sessions', session);
}

async function endSession(callId) {
  if (override) return override.endSession(callId);
  if (!configured()) return null;
  return post(`/sessions/${encodeURIComponent(callId)}/end`, {}, 4000).catch(() => null);
}

module.exports = { startSession, endSession, configured, setGateway: (g) => { override = g; } };
