// After approving, the Outbox follows the email until it is sent ("Sending…" turns into "Sent"
// without pressing refresh), quietly, and stops by itself.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '12-sellbird.js'), 'utf8');
const s = src.indexOf('let sbWatchTimer');
const e = src.indexOf('async function loadOutbox');

function setup(responses) {
  const state = { isEditingOutbox: false, isEditingReply: false, selectedCampaignId: null, activeTab: 'outbox', outboxItems: [{ id: 1, status: 'sending', scheduled_at: 1 }], stats: null };
  const calls = []; let rendered = 0; let metrics = 0;
  let i = 0;
  const api = async (m, u) => {
    calls.push(u);
    if (u.startsWith('/api/sellbird/stats')) return { sent_today: 1 };
    const r = responses[Math.min(i++, responses.length - 1)];
    return r;
  };
  const make = new Function('SellbirdState', 'api', 'renderOutbox', 'renderSellbirdMetrics', 'setInterval', 'clearInterval', 'Date',
    `${src.slice(s, e)}\nreturn { watchSellbirdSending, refreshSellbirdQuietly };`);
  return { state, calls, counts: () => ({ rendered, metrics }), make: (timers) => make(state, api, () => { rendered++; }, () => { metrics++; }, timers.setInterval, timers.clearInterval, Date) };
}

test('it refreshes until the email is sent, then stops by itself', async () => {
  let tick; let cleared = false;
  const t = { setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { cleared = true; } };
  const { state, make, counts } = setup([[{ id: 1, status: 'sending', scheduled_at: 1 }], [{ id: 1, status: 'sent', scheduled_at: 1 }]]);
  const { watchSellbirdSending } = make(t);
  watchSellbirdSending(60);
  await tick();                                  // still sending
  expect(state.outboxItems[0].status).toBe('sending');
  expect(cleared).toBe(false);
  await tick();                                  // now sent
  expect(state.outboxItems[0].status).toBe('sent');
  expect(state.stats).toEqual({ sent_today: 1 }); // the "0 / 25" number refreshed too
  expect(cleared).toBe(true);
  expect(counts().rendered).toBe(2);
});

test('it leaves the screen alone while an email is being edited', async () => {
  const { state, calls, make } = setup([[{ id: 1, status: 'sent', scheduled_at: 1 }]]);
  const { refreshSellbirdQuietly } = make({ setInterval: () => 1, clearInterval: () => {} });
  state.isEditingOutbox = true;
  await refreshSellbirdQuietly();
  expect(calls).toHaveLength(0);
  expect(state.outboxItems[0].status).toBe('sending');
});
