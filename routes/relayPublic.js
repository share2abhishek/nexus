// The public side of client approval links (hosted edition): the page a client opens, and
// the two calls it makes. No login: the link itself (an unguessable id, with the decryption
// key after "#" that never reaches the server) is the access. See services/localRelay.js.
const express = require('express');
const path = require('path');
const { rateLimit, byIp } = require('../middleware/rateLimit');
const relay = require('../services/localRelay');

module.exports = (knex) => {
  const router = express.Router();
  const readLimit = rateLimit({ name: 'relay-read', windowMs: 15 * 60_000, max: 300, key: byIp });
  const answerLimit = rateLimit({ name: 'relay-answer', windowMs: 15 * 60_000, max: 30, key: byIp });

  // The page the client opens
  router.get('/a/:id', (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: https:; media-src 'self' data: https:; style-src 'self' 'unsafe-inline'");
    res.sendFile(path.join(__dirname, '..', 'public', 'relay', 'approve.html'));
  });

  // The page reads the post (still encrypted)
  router.get('/v1/approvals/:id', readLimit, async (req, res) => {
    try {
      const a = await relay.read(knex, req.params.id);
      if (!a) return res.status(404).json({ error: 'This link has expired or was withdrawn.' });
      res.set('Cache-Control', 'no-store');
      res.json(a);
    } catch (err) { res.status(500).json({ error: 'Something went wrong. Try again.' }); }
  });

  // The client answers (approve / ask for changes), encrypted too. One answer per link.
  router.post('/v1/approvals/:id/response', answerLimit, express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const ok = await relay.respond(knex, req.params.id, req.body?.response);
      if (!ok) return res.status(409).json({ error: 'This post was already answered, or the link has expired.' });
      res.json({ ok: true });
    } catch (err) { res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong. Try again.' }); }
  });

  return router;
};
