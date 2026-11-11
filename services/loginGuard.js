// Slows down password guessing: after 5 wrong tries for an email, sign-in for that
// email pauses for 1 minute, then 2, 4… up to 15 minutes. A correct password
// clears it. Kept in memory (resets when the app restarts), which is enough on a PC.
const FREE_TRIES = 5;
const MAX_WAIT = 15 * 60 * 1000;
const tries = new Map(); // key -> { fails, until }

const key = (email) => String(email || '').trim().toLowerCase();

// null when allowed, or a message saying how long to wait
function check(email) {
  const t = tries.get(key(email));
  if (!t || !t.until || t.until <= Date.now()) return null;
  const mins = Math.ceil((t.until - Date.now()) / 60000);
  return `Too many wrong tries. Wait ${mins} minute${mins === 1 ? '' : 's'} and try again (or use your recovery code).`;
}

function failed(email) {
  const k = key(email);
  const t = tries.get(k) || { fails: 0, until: 0 };
  t.fails++;
  if (t.fails >= FREE_TRIES) t.until = Date.now() + Math.min(MAX_WAIT, 60000 * 2 ** (t.fails - FREE_TRIES));
  tries.set(k, t);
  if (tries.size > 10000) tries.delete(tries.keys().next().value); // bounded
}

function succeeded(email) { tries.delete(key(email)); }

module.exports = { check, failed, succeeded, _reset: () => tries.clear() };
