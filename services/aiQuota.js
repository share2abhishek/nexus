// Limits on AI use, so one account (or one visitor on a public chat) can't run up a
// bill on someone else's key or burn Radixile's shared quota.
//   - platform AI: a business using Radixile's keys gets PLATFORM_AI_DAILY_LIMIT calls a day
//     (default 100) and PLATFORM_AI_PER_MINUTE a minute (default 20);
//   - bot replies: a business's auto-reply bot answers at most BOT_AI_DAILY_LIMIT messages
//     a day with AI (default 500), whoever's key it is; the rest get the plain reply.
// Counted in memory per process (resets on restart): a speed bump against abuse, not billing.
const buckets = new Map(); // `${kind}:${id}:${window}` -> count

const num = (name, d) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : d; };
const day = () => Math.floor(Date.now() / 86400000);
const minute = () => Math.floor(Date.now() / 60000);

function bump(key, limit) {
  const n = (buckets.get(key) || 0) + 1;
  buckets.set(key, n);
  if (buckets.size > 20000) for (const k of buckets.keys()) { if (buckets.size <= 10000) break; buckets.delete(k); }
  return n <= limit;
}

function quotaError(message) {
  const e = new Error(message);
  e.status = 429;
  e.code = 'AI_QUOTA';
  return e;
}

// One AI call on Radixile's keys for this business
function consumePlatform(workspaceId) {
  const id = workspaceId || 'none';
  if (!bump(`pm:${id}:${minute()}`, num('PLATFORM_AI_PER_MINUTE', 20))) {
    throw quotaError('You’re using AI very quickly. Wait a minute and try again, or add your own AI key in Settings → AI.');
  }
  if (!bump(`pd:${id}:${day()}`, num('PLATFORM_AI_DAILY_LIMIT', 100))) {
    throw quotaError('You’ve used today’s included AI. It resets tomorrow, or add your own free AI key in Settings → AI to keep going now.');
  }
}

// One AI answer by the auto-reply bot (WhatsApp / website chat). Returns false when over the limit.
function consumeBot(workspaceId) {
  return bump(`bd:${workspaceId}:${day()}`, num('BOT_AI_DAILY_LIMIT', 500));
}

function _reset() { buckets.clear(); }

module.exports = { consumePlatform, consumeBot, _reset };
