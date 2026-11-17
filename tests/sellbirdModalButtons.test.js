// "Find companies": only the button for the open tab may show. The modal's button style forces
// display with !important, so hiding the other one must be !important as well (both used to show,
// and "Discover & write emails" on the Specific Websites tab asked for a business type).
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '12-sellbird.js'), 'utf8');
const start = src.indexOf('function sbShowOnly');
const end = src.indexOf('window.toggleSellbirdDiscoveryMode =');

function fakeEl() {
  const props = {};
  return { props, className: '', style: { setProperty: (k, v, pr) => { props[k] = { v, pr }; }, removeProperty: (k) => { delete props[k]; }, display: '' } };
}

test('the button of the other tab is hidden with !important, and the open tab’s button is shown', () => {
  const ids = ['box-discover-by-type', 'box-custom-domains', 'btn-discover-mode-type', 'btn-discover-mode-domain', 'btn-start-type-discovery', 'btn-start-real-discovery'];
  const els = Object.fromEntries(ids.map((i) => [i, fakeEl()]));
  const run = new Function('document', `${src.slice(start, end)}\nreturn toggleSellbirdDiscoveryMode;`);
  const toggle = run({ getElementById: (id) => els[id] || null });

  toggle('domain');
  expect(els['btn-start-type-discovery'].props.display).toEqual({ v: 'none', pr: 'important' });
  expect(els['btn-start-real-discovery'].props.display).toBeUndefined(); // shown
  expect(els['box-custom-domains'].style.display).toBe('block');

  toggle('type');
  expect(els['btn-start-real-discovery'].props.display).toEqual({ v: 'none', pr: 'important' });
  expect(els['btn-start-type-discovery'].props.display).toBeUndefined();
  expect(els['box-discover-by-type'].style.display).toBe('flex');
});

describe('"Add them and write emails" sends the websites that were typed', () => {
  const s = src.indexOf('async function triggerRealWorldDiscovery');
  const e = src.indexOf('async function cleanSellbirdDummyDataUI');
  const make = (text, campaign = '7') => {
    const calls = []; const toasts = [];
    const els = {
      'input-custom-real-domains': { value: text },
      'discover-type-campaign-id': { value: campaign },
      'btn-start-real-discovery': { innerHTML: 'Add', disabled: false },
    };
    const run = new Function('document', 'api', 'toast', 'closeSellbirdModals', 'loadSellbird', 'switchSellbirdTab', 'console',
      `${src.slice(s, e)}\nreturn triggerRealWorldDiscovery;`);
    const fn = run({ getElementById: (id) => els[id] || null, querySelector: () => null },
      async (m, u, b) => { calls.push([m, u, b]); return { message: 'Added 0 companies; 1 couldn’t be added.', skipped: [{ domain: 'urbansociety.in', reason: 'urbansociety.in is already in this campaign, so it was not added again.' }] }; },
      (msg, kind) => toasts.push([msg, kind]), () => {}, async () => {}, () => {}, console);
    return { fn, calls, toasts };
  };

  test('the typed websites go to the server (any separator, no repeats) with the chosen campaign', async () => {
    const { fn, calls } = make('https://urbansociety.in\nacme.in, beta.in;  acme.in\n');
    await fn();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe('/api/sellbird/discover-real');
    expect(calls[0][2]).toEqual({ targets: ['https://urbansociety.in', 'acme.in', 'beta.in'], campaign_id: '7' });
  });

  test('an empty box asks for a website, and the reason a site was skipped is shown', async () => {
    const empty = make('  \n ');
    await empty.fn();
    expect(empty.calls).toHaveLength(0);
    expect(empty.toasts[0][0]).toMatch(/Type at least one company website/);

    const { fn, toasts } = make('urbansociety.in');
    await fn();
    expect(toasts[0][0]).toMatch(/Not added: urbansociety\.in: urbansociety\.in is already in this campaign/);
  });
});
