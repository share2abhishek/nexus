// Endpoints the voice gateway calls back (signed with VOICE_GATEWAY_SECRET; services/voice/sign.js).
// Public on the route inventory (under /api/webhooks): the signature is the check, as for Meta's webhooks.
const express = require('express');
const { verify } = require('../services/voice/sign');
const calls = require('../services/voice/calls');

module.exports = (knex) => {
  const router = express.Router();
  const signed = (req, res, next) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : (req.rawBody || Buffer.from(''));
    if (!verify(raw, req.get('X-Voice-Signature'), process.env.VOICE_GATEWAY_SECRET)) return res.status(401).json({ error: 'bad signature' });
    return next();
  };

  router.post('/events', signed, async (req, res) => {
    const out = await calls.onGatewayEvent(knex, req.body || {});
    res.status(out.status).json(out.body);
  });

  router.post('/recording/:callId', express.raw({ type: () => true, limit: '60mb' }), signed, async (req, res) => {
    const out = await calls.saveRecording(knex, req.params.callId, req.body, req.get('Content-Type'));
    res.status(out.status).json(out.body);
  });

  return router;
};
