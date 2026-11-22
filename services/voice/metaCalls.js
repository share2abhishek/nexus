// WhatsApp Cloud API Calling: the one endpoint POST /{phone-number-id}/calls with an action
// (pre_accept, accept, reject, terminate). docs/platform/VOICE-AGENTS.md 2.2; Meta's user-initiated calls guide.
const GRAPH = process.env.META_GRAPH_URL || 'https://graph.facebook.com/v21.0';

let override = null; // tests: setClient(fn)

async function action({ phoneNumberId, token }, body) {
  if (override) return override({ phoneNumberId, body });
  if (!phoneNumberId || !token) throw new Error('WhatsApp number or token missing');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/calls`, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success !== true) throw new Error(`Meta calls ${body.action} failed (${res.status}): ${data.error?.message || 'no success flag'}`);
    return data;
  } finally { clearTimeout(timer); }
}

const preAccept = (cfg, callId, sdp) => action(cfg, { call_id: callId, action: 'pre_accept', session: { sdp_type: 'answer', sdp } });
const accept = (cfg, callId, sdp, opaque) => action(cfg, { call_id: callId, action: 'accept', session: { sdp_type: 'answer', sdp }, ...(opaque && { biz_opaque_callback_data: String(opaque).slice(0, 512) }) });
const reject = (cfg, callId) => action(cfg, { call_id: callId, action: 'reject' });
const terminate = (cfg, callId) => action(cfg, { call_id: callId, action: 'terminate' });

module.exports = { preAccept, accept, reject, terminate, setClient: (fn) => { override = fn; } };
