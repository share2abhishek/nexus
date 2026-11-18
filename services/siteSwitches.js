// Website switches the Radixile team can flip in the database (platform_config), no deploy:
//   registration_mode = closed  → nobody can sign up from the website (invited team members still can)
//   show_pricing      = off     → no prices anywhere public (landing page, help chat, help guide)
// Read at most every 30 seconds.
let cached = { at: 0, value: { signup: true, pricing: true } };
const TTL = 30_000;

async function get() {
  if (Date.now() - cached.at < TTL) return cached.value;
  let value = { signup: true, pricing: true };
  try {
    const knex = require('./knex');
    const rows = await knex('platform_config').whereIn('key', ['registration_mode', 'show_pricing']).select('key', 'value');
    const read = (k) => String(rows.find((r) => r.key === k)?.value ?? '').trim().toLowerCase();
    value = {
      signup: read('registration_mode') !== 'closed',
      pricing: !['off', 'false', '0', 'no', 'hidden'].includes(read('show_pricing')),
    };
  } catch { /* keep the defaults */ }
  cached = { at: Date.now(), value };
  return value;
}

const invalidate = () => { cached = { at: 0, value: cached.value }; };

// In a page, <!--IF:name--> … <!--/IF:name--> is kept only when the switch is on, and
// <!--IF:!name--> … <!--/IF:!name--> only when it is off. Parts that are off are not sent.
function apply(html, on) {
  return String(html).replace(/<!--IF:(!?)(\w+)-->([\s\S]*?)<!--\/IF:\1\2-->/g,
    (m, not, name, body) => ((!!on[name]) !== !!not ? body : ''));
}

module.exports = { get, apply, invalidate };
