// Festival calendar: the list shipped with the app, plus signed updates from
// Radixile's licence server (corrected dates, next year's list) so the calendar
// stays right without installing a new version.
//
// An update is a file signed with the licence key (same format as a licence:
// { v: 2, kid, payload, sig }) whose payload is { doc: 'festivals', version, years }.
// It is only used when the signature checks out with the keys built into the app.
// Each year in an update replaces that year's built-in list.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const builtin = require('./builtin');

const dataDir = () => process.env.NEXUS_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const updateFile = () => path.join(dataDir(), 'festivals.json');

let cache = null;

function verify(file) {
  const license = require('../license');
  const payload = license._verifySignature(file, 'festivals');
  if (!payload || typeof payload.years !== 'object') return null;
  return payload;
}

const validEntry = (h) => h && /^\d{4}-\d{2}-\d{2}$/.test(h.date) && typeof h.name === 'string' && h.name.length <= 120;

function loadUpdate() {
  try {
    const file = JSON.parse(fs.readFileSync(updateFile(), 'utf8'));
    return verify(file);
  } catch { return null; }
}

// Every year → its list, built-in years replaced by the update's
function years() {
  if (cache) return cache;
  const out = { ...builtin };
  const update = loadUpdate();
  if (update) {
    for (const [year, list] of Object.entries(update.years)) {
      if (/^\d{4}$/.test(year) && Array.isArray(list)) out[year] = list.filter(validEntry);
    }
  }
  cache = out;
  return out;
}

function all() {
  return Object.values(years()).flat().sort((a, b) => a.date.localeCompare(b.date));
}

// Versions look like 2026-11-01 or 2026-11-01.2: compare each number
function compareVersions(a, b) {
  const pa = String(a).split(/[-.]/).map(Number), pb = String(b).split(/[-.]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function version() {
  return loadUpdate()?.version || 'built-in';
}

// Ask the licence server for a newer list (daily). Quietly does nothing offline.
async function checkForUpdate(serverUrl) {
  if (!serverUrl) return false;
  try {
    const res = await axios.get(`${serverUrl.replace(/\/$/, '')}/v1/festivals`, { timeout: 15000 });
    const payload = verify(res.data);
    if (!payload) { console.warn('[Festivals] Update ignored: the signature did not check out.'); return false; }
    const current = loadUpdate();
    if (current && compareVersions(current.version, payload.version) >= 0) return false;
    fs.writeFileSync(updateFile(), JSON.stringify(res.data));
    cache = null;
    console.log(`[Festivals] Festival calendar updated (${payload.version}).`);
    return true;
  } catch { return false; }
}

let timer = null;
function start(serverUrl) {
  const run = () => checkForUpdate(serverUrl);
  setTimeout(run, 3 * 60 * 1000);
  timer = setInterval(run, 24 * 3600 * 1000);
  timer.unref?.();
}

module.exports = { all, years, version, compareVersions, checkForUpdate, start, _reset: () => { cache = null; } };
