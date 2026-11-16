// A small in-memory rate limiter (fixed window per key). No extra dependency.
// One process only: that is how the app runs today (desktop, and a single hosted
// instance). Behind several instances, replace the Map with a shared store (Redis).
//
//   const limit = rateLimit({ windowMs: 60_000, max: 30, key: byIp, message: '...' });
//   app.post('/x', limit, handler);
const buckets = new Map(); // `${name}:${key}` -> { start, count }
let sweeper = null;

function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (now - b.start > b.windowMs) buckets.delete(k);
  }, 60_000);
  sweeper.unref?.();
}

const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';
const byIp = (req) => clientIp(req);
const byUserOrIp = (req) => (req.session?.userId ? `u${req.session.userId}` : clientIp(req));

let counter = 0;
function rateLimit({ windowMs = 60_000, max = 60, key = byIp, message = 'Too many requests. Please wait a moment and try again.', name = `rl${counter++}` } = {}) {
  startSweeper();
  return function limit(req, res, next) {
    const k = `${name}:${key(req)}`;
    const now = Date.now();
    let b = buckets.get(k);
    if (!b || now - b.start >= windowMs) { b = { start: now, count: 0, windowMs }; buckets.set(k, b); }
    b.count++;
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: message, code: 'RATE_LIMITED' });
    }
    next();
  };
}

function _reset() { buckets.clear(); }

module.exports = { rateLimit, byIp, byUserOrIp, clientIp, _reset };
