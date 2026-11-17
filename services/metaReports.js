// Meta (Facebook / WhatsApp) account reports: ad account balance and spend, WhatsApp
// message and cost analytics, number health, and which permissions are still missing.
//
// Multi-tenant: every call uses ONLY the workspace's own saved token and ids. There is
// no fallback to a platform token or to another business's accounts, and the cache is
// keyed by workspace.
const axios = require('axios');

const GRAPH = 'https://graph.facebook.com/v21.0';
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 400;
const MAX_RANGE_DAYS = 92;

// ── Permission guide: what each report needs and how the owner adds it ───────
const GUIDE = {
  ads: {
    title: 'Ad account balance and ad reports',
    permission: 'ads_read',
    steps: [
      'Open developers.facebook.com/apps and choose your Meta app.',
      'Click "Add product" and add "Marketing API" (skip if it is already listed).',
      'Go to App Review → Permissions and features, find "ads_read" and click "Request advanced access". While your app is in Development mode, people with a role on the app (admin, developer, tester) can use it without review.',
      'In business.facebook.com → Business settings → Accounts → Ad accounts, make sure the person who signs in to NEXUS has access to the ad account (at least "View performance").',
      'Back in NEXUS, click "Reconnect Facebook with ads access" below and approve the "Manage your ads" / "Read ads" permission on the Facebook screen.',
    ],
    links: [
      { label: 'Meta apps', url: 'https://developers.facebook.com/apps' },
      { label: 'Business settings', url: 'https://business.facebook.com/settings' },
    ],
  },
  whatsapp: {
    title: 'WhatsApp analytics, cost and number health',
    permission: 'whatsapp_business_management',
    steps: [
      'Open business.facebook.com → Business settings → Users → System users. Add a system user (Admin) or pick your existing one.',
      'Click "Add assets" → "WhatsApp accounts", pick your WhatsApp Business Account and turn on "Manage WhatsApp Business Account" (full control).',
      'Click "Generate new token", choose your app, and tick both "whatsapp_business_management" and "whatsapp_business_messaging". Set the expiry to "Never" and copy the token.',
      'In NEXUS go to WhatsApp · Setup and paste the token in "Access token". Also check that "WhatsApp Business Account ID" is the account ID, not the phone number ID.',
      'Come back here and click "Check again".',
    ],
    links: [
      { label: 'System users', url: 'https://business.facebook.com/settings/system-users' },
      { label: 'WhatsApp Manager', url: 'https://business.facebook.com/wa/manage/home/' },
    ],
  },
  whatsappCredit: {
    note: 'Meta does not share your WhatsApp prepaid credit through any API. Open WhatsApp Manager → Billing to see it. NEXUS shows your WhatsApp spend (cost) instead.',
    url: 'https://business.facebook.com/billing_hub/payment_settings',
  },
};

// ── Meta errors → a message the owner can act on ─────────────────────────────
class MetaError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

function mapError(err) {
  const e = err?.response?.data?.error;
  if (!e) {
    if (err?.code === 'ECONNABORTED') return new MetaError('timeout', 'Meta took too long to answer. Try again in a minute.');
    return new MetaError('error', err?.message || 'Could not reach Meta.');
  }
  const c = Number(e.code);
  const sub = Number(e.error_subcode);
  if (c === 190 || [458, 459, 460, 463, 467].includes(sub)) return new MetaError('token_expired', 'The Meta connection has expired or was removed. Reconnect it and try again.');
  if (c === 10 || (c >= 200 && c <= 299)) return new MetaError('missing_permission', e.message || 'A permission is missing.');
  if ([4, 17, 32, 613, 80000, 80003, 80004, 80006, 80008, 80014].includes(c)) return new MetaError('rate_limited', 'Meta asked us to slow down. Try again in a few minutes.');
  if (c === 100 && /nonexisting field|does not exist|unsupported get request/i.test(e.message || '')) return new MetaError('not_found', 'Meta could not find that account, or it is not shared with this connection.');
  return new MetaError('error', e.message || 'Meta returned an error.');
}

async function graph(path, params, token) {
  try {
    const r = await axios.get(`${GRAPH}/${path}`, { params: { ...params, access_token: token }, timeout: 12000 });
    return r.data;
  } catch (err) { throw mapError(err); }
}

// ── Date ranges ──────────────────────────────────────────────────────────────
const ymd = d => d.toISOString().slice(0, 10);
const utcMidnight = s => Math.floor(Date.parse(`${s}T00:00:00Z`) / 1000);

function resolveRange({ range, since, until } = {}, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let s; let u = new Date(today);
  if (since && until && /^\d{4}-\d{2}-\d{2}$/.test(since) && /^\d{4}-\d{2}-\d{2}$/.test(until)) {
    s = new Date(`${since}T00:00:00Z`); u = new Date(`${until}T00:00:00Z`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(u.getTime())) throw new MetaError('bad_range', 'Choose a valid start and end date.');
  } else if (range === 'month') {
    s = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  } else {
    const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
    s = new Date(today); s.setUTCDate(s.getUTCDate() - (days - 1));
  }
  if (u > today) u = today;
  if (s > u) throw new MetaError('bad_range', 'The start date is after the end date.');
  const span = Math.round((u - s) / 86400000) + 1;
  if (span > MAX_RANGE_DAYS) throw new MetaError('bad_range', `Choose at most ${MAX_RANGE_DAYS} days at a time.`);
  return { since: ymd(s), until: ymd(u), days: span };
}

// ── Money: the Marketing API returns the smallest unit (paise, cents) as text ─
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'UGX', 'PYG', 'XAF', 'XOF', 'XPF', 'BIF', 'DJF', 'GNF', 'KMF', 'RWF', 'VUV']);
function fromMinor(value, currency) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return ZERO_DECIMAL.has(String(currency || '').toUpperCase()) ? n : n / 100;
}

const ACCOUNT_STATUS = {
  1: 'Active', 2: 'Disabled', 3: 'Payment overdue', 7: 'Under risk review', 8: 'Settling payment',
  9: 'Grace period', 100: 'Closing', 101: 'Closed', 201: 'Active', 202: 'Closed',
};
// Account states that stop ads or are about to: shown as a warning on the card
const STATUS_WARNING = {
  3: 'Payment is overdue. Your ads may be paused until you pay on Meta.',
  9: 'Your account is in a grace period. Pay on Meta soon so your ads keep running.',
  8: 'A payment is being settled. Check Meta if it does not clear.',
  7: 'Meta is reviewing this account. Ads may be paused during the review.',
  2: 'This ad account is disabled by Meta. Open it on Meta to see why.',
  100: 'This ad account is being closed.',
  101: 'This ad account is closed.',
};
// Meta only takes payments on its own pages, so we link to the account's billing page
const billingUrl = (actId) => `https://business.facebook.com/billing_hub/payment_activity?asset_id=${String(actId).replace(/^act_/, '').replace(/\D/g, '')}`;

const LEAD_ACTIONS =new Set(['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'offsite_conversion.fb_pixel_lead']);

// ── Cache (per workspace) ────────────────────────────────────────────────────
const cache = new Map();
const ws = id => String(id);
function cached(workspaceId, key, fresh, fn) {
  const k = `${ws(workspaceId)}|${key}`;
  const hit = cache.get(k);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);
  return fn().then(value => {
    cache.set(k, { at: Date.now(), value });
    if (cache.size > CACHE_MAX) for (const key2 of cache.keys()) { cache.delete(key2); if (cache.size <= CACHE_MAX * 0.8) break; }
    return value;
  });
}
function clearCache(workspaceId) {
  const p = `${ws(workspaceId)}|`;
  for (const k of cache.keys()) if (k.startsWith(p)) cache.delete(k);
}

// ── Facebook: permissions and ad accounts ────────────────────────────────────
async function grantedPermissions(token) {
  const d = await graph('me/permissions', { limit: 100 }, token);
  return (d.data || []).filter(p => p.status === 'granted').map(p => p.permission);
}

async function listAdAccounts(token) {
  const d = await graph('me/adaccounts', { fields: 'account_id,name,currency,account_status', limit: 100 }, token);
  return (d.data || []).map(a => ({
    id: `act_${String(a.account_id || a.id || '').replace(/^act_/, '')}`,
    name: a.name || a.account_id,
    currency: a.currency || null,
    status: ACCOUNT_STATUS[a.account_status] || 'Unknown',
  }));
}

async function adAccountReport(token, actId, { since, until }) {
  const info = await graph(actId, {
    fields: 'name,currency,account_status,balance,amount_spent,spend_cap,timezone_name,disable_reason,funding_source_details',
  }, token);
  const currency = info.currency || null;
  const base = {
    id: actId,
    name: info.name || actId,
    currency,
    status: ACCOUNT_STATUS[info.account_status] || 'Unknown',
    warning: STATUS_WARNING[Number(info.account_status)] || null,
    billing_url: billingUrl(actId),
    timezone: info.timezone_name || null,
    // "balance" is what Meta says you owe (postpaid); prepaid accounts show their funds in funding_source
    amount_due: fromMinor(info.balance, currency),
    total_spent: fromMinor(info.amount_spent, currency),
    spend_cap: Number(info.spend_cap) > 0 ? fromMinor(info.spend_cap, currency) : null,
    funding_source: info.funding_source_details?.display_string || null,
  };
  const ins = await graph(`${actId}/insights`, {
    fields: 'spend,impressions,clicks,reach,actions',
    time_range: JSON.stringify({ since, until }),
    time_increment: 1,
    limit: 100,
  }, token);
  const days = (ins.data || []).map(r => {
    const leads = (r.actions || []).filter(a => LEAD_ACTIONS.has(a.action_type)).reduce((n, a) => Math.max(n, Number(a.value) || 0), 0);
    return {
      date: r.date_start,
      spend: Number(r.spend) || 0,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      leads,
    };
  });
  const sum = k => days.reduce((n, d) => n + d[k], 0);
  const spend = sum('spend');
  const leads = sum('leads');
  return {
    ...base,
    range: { since, until },
    totals: {
      spend: Math.round(spend * 100) / 100,
      impressions: sum('impressions'),
      clicks: sum('clicks'),
      leads,
      cost_per_lead: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
    },
    daily: days,
  };
}

// One light call that needs whatsapp_business_management: reading the account itself
async function checkWhatsApp(token, wabaId) {
  const a = await graph(wabaId, { fields: 'id,name,currency' }, token);
  return { id: a.id, name: a.name || null, currency: a.currency || null };
}

// ── WhatsApp: number health, message counts and cost ─────────────────────────
async function whatsappReport(token, wabaId, phoneNumberId, { since, until }) {
  const start = utcMidnight(since);
  const end = utcMidnight(until) + 86400;
  const out = { range: { since, until }, phone: null, messages: null, cost: null, errors: {} };

  const tryPart = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out.errors[name] = { code: e.code || 'error', message: e.message }; } };

  if (phoneNumberId) {
    await tryPart('phone', async () => {
      const p = await graph(phoneNumberId, { fields: 'display_phone_number,verified_name,quality_rating,messaging_limit_tier,status,name_status' }, token);
      return {
        number: p.display_phone_number || null,
        name: p.verified_name || null,
        quality: p.quality_rating || null,           // GREEN / YELLOW / RED
        daily_limit: p.messaging_limit_tier || null, // e.g. TIER_1K
        status: p.status || null,
        name_status: p.name_status || null,
      };
    });
  }

  if (wabaId) {
    await tryPart('messages', async () => {
      const d = await graph(wabaId, { fields: `analytics.start(${start}).end(${end}).granularity(DAY)` }, token);
      const pts = d.analytics?.data_points || [];
      const daily = pts.map(p => ({ date: ymd(new Date(p.start * 1000)), sent: Number(p.sent) || 0, delivered: Number(p.delivered) || 0 }));
      return {
        sent: daily.reduce((n, x) => n + x.sent, 0),
        delivered: daily.reduce((n, x) => n + x.delivered, 0),
        daily,
      };
    });
    await tryPart('cost', async () => {
      const d = await graph(wabaId, { fields: `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["PRICING_CATEGORY"])` }, token);
      const pts = (d.pricing_analytics?.data || []).flatMap(x => x.data_points || []);
      const byCategory = {};
      let total = 0; let volume = 0;
      for (const p of pts) {
        const cat = String(p.pricing_category || 'OTHER').toLowerCase();
        const cost = Number(p.cost) || 0;
        const vol = Number(p.volume) || 0;
        byCategory[cat] = byCategory[cat] || { cost: 0, volume: 0 };
        byCategory[cat].cost += cost; byCategory[cat].volume += vol;
        total += cost; volume += vol;
      }
      return {
        currency: d.currency || null,
        total: Math.round(total * 100) / 100,
        messages: volume,
        by_category: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, { cost: Math.round(v.cost * 100) / 100, volume: v.volume }])),
      };
    });
  }
  return out;
}

module.exports = {
  GUIDE, MetaError, mapError, resolveRange, fromMinor, ACCOUNT_STATUS, billingUrl,
  grantedPermissions, listAdAccounts, adAccountReport, whatsappReport, checkWhatsApp,
  cached, clearCache,
};
