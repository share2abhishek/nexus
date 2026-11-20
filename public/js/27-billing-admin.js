// Super Admin → Billing (B0): plans and the plan designer, prices and tax, coupons, and the import preview.
// Talks to /api/billing/admin (modules/billing/routes/admin.js). The tab appears only for Radixile staff on the server
// edition with BILLING_ENABLED=true (the status call answers 404 otherwise). The server decides everything; this screen
// only shows and sends. Money is shown in rupees and sent in paise; percentages are shown as % and sent in hundredths.
(function () {
  const BASE = '/api/billing/admin';
  const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s ?? ''));
  const rupees = (minor) => (minor == null ? '—' : (Number(minor) / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }));
  const pctText = (h) => `${(Number(h) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
  const say = (msg, type) => (typeof window.toast === 'function' ? window.toast(msg, type) : console.log(msg));
  const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  let catalogue = null;
  let plansCache = [];
  let tab = 'plans';

  async function call(method, path, body) {
    const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.code = data.code; e.field = data.field; throw e; }
    return data;
  }
  const panel = () => document.getElementById('billing-admin-body');

  // Show the tab only when the server says billing is on for this person
  async function initBillingAdminTab() {
    const btn = document.getElementById('admin-tab-billing');
    if (!btn) return;
    try { await call('GET', '/status'); btn.hidden = false; } catch { btn.hidden = true; }
  }

  async function loadBillingAdmin() {
    if (!catalogue) {
      try { catalogue = await call('GET', '/catalogue'); } catch (e) { panel().innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; return; }
    }
    switchBillingTab(tab);
  }

  function switchBillingTab(t) {
    tab = t;
    document.querySelectorAll('.bill-subtab').forEach((b) => b.classList.toggle('btn-primary', b.dataset.t === t));
    document.querySelectorAll('.bill-subtab').forEach((b) => b.classList.toggle('btn-secondary', b.dataset.t !== t));
    ({ plans: renderPlans, prices: renderPrices, coupons: renderCoupons, import: renderImport })[t]();
  }

  // ── Plans ───────────────────────────────────────────────────────────────
  async function renderPlans() {
    panel().innerHTML = '<div class="empty-state">Loading plans…</div>';
    try { plansCache = await call('GET', '/plans'); } catch (e) { panel().innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; return; }
    const monthly = (p) => p.prices.find((x) => x.pricing_model === 'PER_ACCOUNT') || p.prices[0];
    panel().innerHTML = `
      <div class="bill-toolbar"><button class="btn btn-primary btn-sm" onclick="billingEditPlan(null)">+ New plan</button>
        <span class="bill-hint">Plans are never deleted: make one inactive and the organisations on it keep it.</span></div>
      <div class="table-wrap"><table class="data-table bill-table">
        <thead><tr><th>Plan</th><th>Code</th><th>Rank</th><th>Price list</th><th>Active</th><th>Organisations</th><th>Price</th><th>Features on</th><th></th></tr></thead>
        <tbody>${plansCache.map((p) => `<tr>
          <td><strong>${esc(p.name)}</strong>${p.owner_org_id ? ' <span class="bill-tag">private</span>' : ''}${p.badge ? ` <span class="bill-tag">${esc(p.badge)}</span>` : ''}</td>
          <td><code>${esc(p.code)}</code></td><td>${p.rank}</td><td>${p.public ? 'Yes' : 'No'}</td><td>${p.active ? 'Yes' : 'No'}</td>
          <td>${p.accounts_on_plan}</td>
          <td>${monthly(p) ? `${rupees(monthly(p).unit_price_minor)}${monthly(p).pricing_model === 'PER_UNIT' ? ' per workspace' : ''}/month` : 'by quote'}</td>
          <td>${Object.values(p.features).filter(Boolean).length} of ${Object.keys(p.features).length}</td>
          <td><button class="btn btn-secondary btn-sm" onclick="billingEditPlan('${esc(p.code)}')">Open</button></td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  const MODULE_NAMES = { core: 'Core', social: 'Social publishing', ai: 'AI content', seo: 'Website & SEO', ads: 'Advertising', sales: 'Sales & CRM', whatsapp: 'WhatsApp', webchat: 'Website chat', agents: 'AI agents', admin: 'Access & admin' };

  async function billingEditPlan(code) {
    let plan = null;
    if (code) { try { plan = await call('GET', `/plans/${encodeURIComponent(code)}`); } catch (e) { say(e.message, 'error'); return; } }
    const f = plan ? plan.features : {};
    const l = plan ? plan.limits : {};
    const groups = {};
    for (const x of catalogue.features) (groups[x.module] = groups[x.module] || []).push(x);
    panel().innerHTML = `
      <div class="bill-toolbar"><button class="btn btn-secondary btn-sm" onclick="switchBillingTab('plans')">← All plans</button>
        ${plan ? `<span class="bill-hint">${plan.accounts_on_plan} organisation(s) on this plan · revision ${plan.revision}</span>` : '<span class="bill-hint">A new plan starts off the price list; tick “On the price list” when it is ready to sell.</span>'}</div>
      <div class="bill-designer" id="bill-designer">
        <div class="card bill-card">
          <div class="bill-grid">
            <label>Name<input class="form-input" id="bp-name" value="${esc(plan?.name || '')}" maxlength="80"></label>
            <label>Code (never changes)<input class="form-input" id="bp-code" value="${esc(plan?.code || '')}" ${plan ? 'disabled' : ''} placeholder="e.g. web_ai" maxlength="30"></label>
            <label>Rank (higher = bigger plan)<input class="form-input" id="bp-rank" type="number" min="0" value="${plan?.rank ?? 0}"></label>
            <label>Badge<input class="form-input" id="bp-badge" value="${esc(plan?.badge || '')}" maxlength="30" placeholder="e.g. Popular"></label>
            <label class="bill-wide">Description<input class="form-input" id="bp-desc" value="${esc(plan?.description || '')}" maxlength="500"></label>
            <label class="bill-check"><input type="checkbox" id="bp-public" ${plan?.public ? 'checked' : ''} ${plan?.owner_org_id ? 'disabled' : ''}> On the price list</label>
            <label class="bill-check"><input type="checkbox" id="bp-active" ${!plan || plan.active ? 'checked' : ''}> Active (new customers can choose it)</label>
          </div>
        </div>
        <div class="bill-columns">
          <div class="card bill-card"><div class="bill-card-title">Features</div>
            ${Object.entries(groups).map(([mod, list]) => `<div class="bill-group"><div class="bill-group-title">${esc(MODULE_NAMES[mod] || mod)}</div>
              ${list.map((x) => `<label class="bill-feature"><input type="checkbox" data-feature="${esc(x.key)}" ${f[x.key] ? 'checked' : ''} onchange="billingFeatureChanged(this)">
                <span>${esc(x.name)}${x.requires.length || x.requiresAny.length ? `<small> needs ${esc([...x.requires, ...(x.requiresAny.length ? [`one of ${x.requiresAny.join(' / ')}`] : [])].join(', '))}</small>` : ''}</span></label>`).join('')}</div>`).join('')}
          </div>
          <div class="card bill-card"><div class="bill-card-title">Limits <small>(-1 = unlimited)</small></div>
            ${catalogue.limits.map((x) => `<label class="bill-limit"><span>${esc(x.name)} <small>${esc(x.unit)}</small></span>
              <input class="form-input" type="number" min="-1" step="1" data-limit="${esc(x.key)}" value="${l[x.key] ?? -1}"></label>`).join('')}
            ${plan ? `<div class="bill-card-title" style="margin-top:16px">Prices today</div>
              ${plan.prices.length ? plan.prices.map((p) => `<div class="bill-row">${esc(p.pricing_model)}: ${rupees(p.unit_price_minor)} from ${esc(p.effective_from)}</div>`).join('') : '<div class="bill-row">No price (by quote)</div>'}
              <div class="bill-hint">Change prices in Prices &amp; tax. A new price starts today or later.</div>` : ''}
          </div>
        </div>
        <div class="card bill-card">
          <label class="bill-wide">Why are you changing this? ${plan && plan.accounts_on_plan ? '<b>(required: organisations are on this plan)</b>' : '(optional)'}
            <input class="form-input" id="bp-reason" maxlength="500" placeholder="e.g. More seats for agencies"></label>
          <div class="bill-actions">
            <button class="btn btn-primary" onclick="billingSavePlan(${plan ? `'${esc(plan.code)}'` : 'null'})">${plan ? 'Save changes' : 'Create plan'}</button>
            ${plan ? `<span class="bill-clone"><input class="form-input" id="bp-clone-code" placeholder="new code" maxlength="30"><input class="form-input" id="bp-clone-name" placeholder="new name" maxlength="80">
              <button class="btn btn-secondary" onclick="billingClonePlan('${esc(plan.code)}')">Clone</button></span>` : ''}
          </div>
          <div class="bill-error" id="bp-error" role="alert"></div>
        </div>
        ${plan ? '<div class="card bill-card"><div class="bill-card-title">Revisions</div><div id="bp-revisions">Loading…</div></div>' : ''}
      </div>`;
    if (plan) loadRevisions(plan.code);
  }

  // Ticking a feature ticks what it needs; unticking unticks what needs it (after a confirmation listing them)
  function billingFeatureChanged(box) {
    const byKey = Object.fromEntries(catalogue.features.map((x) => [x.key, x]));
    const boxes = Object.fromEntries([...document.querySelectorAll('[data-feature]')].map((b) => [b.dataset.feature, b]));
    const key = box.dataset.feature;
    if (box.checked) {
      const tick = (k) => { for (const r of byKey[k]?.requires || []) if (boxes[r] && !boxes[r].checked) { boxes[r].checked = true; tick(r); } };
      tick(key);
      const any = byKey[key]?.requiresAny || [];
      if (any.length && !any.some((r) => boxes[r]?.checked)) say(`“${byKey[key].name}” also needs one of: ${any.map((r) => byKey[r]?.name || r).join(', ')}. Tick one before saving.`, 'warning');
    } else {
      const dependants = catalogue.features.filter((x) => boxes[x.key]?.checked && (x.requires.includes(key)
        || (x.requiresAny.includes(key) && !x.requiresAny.some((r) => r !== key && boxes[r]?.checked))));
      if (dependants.length) {
        const list = dependants.map((x) => x.name).join(', ');
        const err = document.getElementById('bp-error');
        dependants.forEach((x) => { boxes[x.key].checked = false; });
        if (err) err.textContent = `Also unticked because they need it: ${list}.`;
      }
    }
  }

  function readPlanForm() {
    const features = Object.fromEntries([...document.querySelectorAll('[data-feature]')].map((b) => [b.dataset.feature, b.checked]));
    const limits = {};
    for (const i of document.querySelectorAll('[data-limit]')) {
      const v = Number(i.value);
      if (!Number.isInteger(v) || v < -1) throw Object.assign(new Error(`${i.closest('label').querySelector('span').textContent.trim()}: a whole number, or -1 for unlimited.`), { field: 'limits' });
      limits[i.dataset.limit] = v;
    }
    return {
      name: document.getElementById('bp-name').value.trim(), rank: Number(document.getElementById('bp-rank').value || 0),
      badge: document.getElementById('bp-badge').value.trim(), description: document.getElementById('bp-desc').value.trim(),
      public: document.getElementById('bp-public').checked, active: document.getElementById('bp-active').checked, features, limits,
      reason: document.getElementById('bp-reason').value.trim(),
    };
  }

  async function billingSavePlan(code) {
    const err = document.getElementById('bp-error');
    err.textContent = '';
    try {
      const body = readPlanForm();
      const saved = code ? await call('PUT', `/plans/${encodeURIComponent(code)}`, body)
        : await call('POST', '/plans', { ...body, code: document.getElementById('bp-code').value.trim() });
      say(code ? 'Plan saved.' : 'Plan created.', 'success');
      billingEditPlan(saved.code);
    } catch (e) { err.textContent = e.message; }
  }

  async function billingClonePlan(code) {
    const err = document.getElementById('bp-error');
    err.textContent = '';
    try {
      const p = await call('POST', `/plans/${encodeURIComponent(code)}/clone`, { code: document.getElementById('bp-clone-code').value.trim(), name: document.getElementById('bp-clone-name').value.trim() || undefined });
      say(`Cloned as ${p.name}. It starts off the price list.`, 'success');
      billingEditPlan(p.code);
    } catch (e) { err.textContent = e.message; }
  }

  async function loadRevisions(code) {
    const el = document.getElementById('bp-revisions');
    try {
      const revs = await call('GET', `/plans/${encodeURIComponent(code)}/revisions`);
      el.innerHTML = revs.map((r) => `<div class="bill-row"><b>#${r.revision}</b> ${new Date(r.created_at * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · ${esc(r.created_by || '')}${r.reason ? ` · ${esc(r.reason)}` : ''}
        · ${Object.values(r.snapshot.features).filter(Boolean).length} features on</div>`).join('') || 'None';
    } catch (e) { el.textContent = e.message; }
  }

  // ── Prices, cycle discounts and tax ─────────────────────────────────────
  async function renderPrices() {
    panel().innerHTML = '<div class="empty-state">Loading…</div>';
    let prices; let cycles; let taxes; let plans;
    try { [prices, cycles, taxes, plans] = await Promise.all([call('GET', '/price-book'), call('GET', '/cycle-discounts'), call('GET', '/tax-rates'), call('GET', '/plans')]); } catch (e) { panel().innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; return; }
    panel().innerHTML = `
      <div class="card bill-card"><div class="bill-card-title">Price book</div>
        <div class="bill-hint">The price for a period is the one in force on its first day, so a new price never changes an issued bill. New prices start today or later.</div>
        <div class="table-wrap"><table class="data-table bill-table"><thead><tr><th>Plan</th><th>Model</th><th>Price per month</th><th>From</th><th>To</th><th>Note</th></tr></thead>
        <tbody>${prices.map((p) => `<tr><td>${esc(p.plan_code)}</td><td>${esc(p.pricing_model)}</td><td>${rupees(p.unit_price_minor)}</td><td>${esc(p.effective_from)}</td><td>${esc(p.effective_to || '')}</td><td>${esc(p.description || '')}</td></tr>`).join('') || '<tr><td colspan="6">No prices yet</td></tr>'}</tbody></table></div>
        <div class="bill-form">
          <select class="form-input" id="pb-plan">${plans.map((p) => `<option value="${esc(p.code)}">${esc(p.name)} (${esc(p.code)})</option>`).join('')}</select>
          <select class="form-input" id="pb-model"><option value="PER_ACCOUNT">Per business</option><option value="PER_UNIT">Per workspace</option><option value="ONE_TIME">One time</option></select>
          <input class="form-input" id="pb-price" type="number" min="0" step="0.01" placeholder="₹ per month">
          <input class="form-input" id="pb-from" type="date" value="${today()}">
          <button class="btn btn-primary btn-sm" onclick="billingAddPrice()">Add price</button>
        </div></div>
      <div class="bill-columns">
        <div class="card bill-card"><div class="bill-card-title">Discount by billing cycle</div>
          ${cycles.map((c) => `<label class="bill-limit"><span>${esc(c.billing_cycle.replace('_', ' ').toLowerCase())}</span>
            <input class="form-input" type="number" min="0" max="100" step="0.01" value="${c.discount_hundredths / 100}" data-cycle="${esc(c.billing_cycle)}" onchange="billingSetCycle(this)"> %</label>`).join('')}
        </div>
        <div class="card bill-card"><div class="bill-card-title">Tax rates</div>
          ${taxes.map((t) => `<div class="bill-row">${esc(t.tax_name)} ${pctText(t.rate_hundredths)} from ${esc(t.effective_from)}</div>`).join('')}
          <div class="bill-hint">Rates are never edited: add a new rate from a date. Past invoices keep theirs.</div>
          <div class="bill-form"><input class="form-input" id="tx-name" value="GST" maxlength="40"><input class="form-input" id="tx-rate" type="number" min="0" max="100" step="0.01" placeholder="%">
            <input class="form-input" id="tx-from" type="date" value="${today()}"><button class="btn btn-primary btn-sm" onclick="billingAddTax()">Add rate</button></div>
        </div>
      </div>
      <div class="card bill-card"><div class="bill-card-title">Try a price</div>
        <div class="bill-form"><select class="form-input" id="q-plan">${plans.map((p) => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('')}</select>
          <select class="form-input" id="q-model"><option value="PER_ACCOUNT">Per business</option><option value="PER_UNIT">Per workspace</option><option value="ONE_TIME">One time</option></select>
          <select class="form-input" id="q-cycle">${cycles.filter((c) => c.billing_cycle !== 'CUSTOM').map((c) => `<option>${esc(c.billing_cycle)}</option>`).join('')}</select>
          <input class="form-input" id="q-qty" type="number" min="1" value="1" title="Workspaces (per-workspace prices)">
          <input class="form-input" id="q-coupon" placeholder="Coupon (optional)">
          <button class="btn btn-secondary btn-sm" onclick="billingQuote()">Show the bill</button></div>
        <div id="q-out"></div></div>`;
  }

  async function billingAddPrice() {
    const r = Number(document.getElementById('pb-price').value);
    if (!(r >= 0)) { say('Type the price in rupees.', 'error'); return; }
    try {
      await call('POST', '/price-book', { plan_code: document.getElementById('pb-plan').value, pricing_model: document.getElementById('pb-model').value, unit_price_minor: Math.round(r * 100), effective_from: document.getElementById('pb-from').value });
      say('Price added.', 'success'); renderPrices();
    } catch (e) { say(e.message, 'error'); }
  }
  async function billingSetCycle(input) {
    try { await call('PUT', `/cycle-discounts/${input.dataset.cycle}`, { discount_hundredths: Math.round(Number(input.value) * 100) }); say('Discount saved.', 'success'); } catch (e) { say(e.message, 'error'); renderPrices(); }
  }
  async function billingAddTax() {
    try {
      await call('POST', '/tax-rates', { tax_name: document.getElementById('tx-name').value, rate_hundredths: Math.round(Number(document.getElementById('tx-rate').value) * 100), effective_from: document.getElementById('tx-from').value });
      say('Tax rate added.', 'success'); renderPrices();
    } catch (e) { say(e.message, 'error'); }
  }
  async function billingQuote() {
    const out = document.getElementById('q-out');
    try {
      const q = await call('POST', '/quote', { plan_code: document.getElementById('q-plan').value, pricing_model: document.getElementById('q-model').value, billing_cycle: document.getElementById('q-cycle').value, quantity: Number(document.getElementById('q-qty').value || 1), coupon_code: document.getElementById('q-coupon').value.trim() || undefined });
      out.innerHTML = `<table class="data-table bill-table">${q.lines.map((l) => `<tr><td>${esc(l.description)}</td><td style="text-align:right">${rupees(l.amount_minor)}</td></tr>`).join('')}
        <tr><td><b>Total</b> (${esc(q.period_start)} to ${esc(q.period_end)})</td><td style="text-align:right"><b>${rupees(q.total)}</b></td></tr></table>`;
    } catch (e) { out.textContent = e.message; }
  }

  // ── Coupons ─────────────────────────────────────────────────────────────
  async function renderCoupons() {
    let list;
    try { list = await call('GET', '/coupons'); } catch (e) { panel().innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; return; }
    panel().innerHTML = `<div class="card bill-card"><div class="bill-card-title">Coupons</div>
      <div class="bill-hint">A coupon is counted only when an invoice is issued with it. Once used, its discount can't change.</div>
      <div class="table-wrap"><table class="data-table bill-table"><thead><tr><th>Code</th><th>Discount</th><th>Valid</th><th>Used</th><th>Active</th></tr></thead>
      <tbody>${list.map((c) => `<tr><td><code>${esc(c.code)}</code></td><td>${c.discount_type === 'PERCENT' ? pctText(c.discount_value) : rupees(c.discount_value)}</td>
        <td>${esc(c.valid_from || '…')} to ${esc(c.valid_to || '…')}</td><td>${c.redemptions}${c.max_redemptions ? ` of ${c.max_redemptions}` : ''}</td>
        <td><input type="checkbox" ${c.active ? 'checked' : ''} onchange="billingCouponActive(${c.id}, this.checked)"></td></tr>`).join('') || '<tr><td colspan="5">No coupons</td></tr>'}</tbody></table></div>
      <div class="bill-form"><input class="form-input" id="cp-code" placeholder="CODE" maxlength="40">
        <select class="form-input" id="cp-type"><option value="PERCENT">% off</option><option value="FIXED">₹ off</option></select>
        <input class="form-input" id="cp-value" type="number" min="0" step="0.01" placeholder="amount">
        <input class="form-input" id="cp-from" type="date" title="Valid from"><input class="form-input" id="cp-to" type="date" title="Valid until">
        <input class="form-input" id="cp-max" type="number" min="1" placeholder="Max uses">
        <button class="btn btn-primary btn-sm" onclick="billingCreateCoupon()">Add coupon</button></div></div>`;
  }
  async function billingCreateCoupon() {
    const type = document.getElementById('cp-type').value;
    const v = Number(document.getElementById('cp-value').value);
    try {
      await call('POST', '/coupons', { code: document.getElementById('cp-code').value.trim(), discount_type: type, discount_value: Math.round(v * 100),
        valid_from: document.getElementById('cp-from').value || null, valid_to: document.getElementById('cp-to').value || null, max_redemptions: document.getElementById('cp-max').value || null });
      say('Coupon added.', 'success'); renderCoupons();
    } catch (e) { say(e.message, 'error'); }
  }
  async function billingCouponActive(id, active) {
    try { await call('PUT', `/coupons/${id}`, { active }); say(active ? 'Coupon on.' : 'Coupon off.', 'success'); } catch (e) { say(e.message, 'error'); renderCoupons(); }
  }

  // ── Import preview ──────────────────────────────────────────────────────
  async function renderImport() {
    let p; let subs;
    try { [p, subs] = await Promise.all([call('GET', '/import/preview'), call('GET', '/subscriptions')]); } catch (e) { panel().innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; return; }
    const d = (s) => (s ? new Date(s * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—');
    panel().innerHTML = `<div class="card bill-card"><div class="bill-card-title">Bring today's organisations into billing (dry run)</div>
      <div class="bill-hint">This list only shows what would happen; nothing is written here. Importing is a deliberate step run on the server
        (<code>node scripts/billing-import-subscriptions.js --apply</code>). Imported organisations get automatic invoicing <b>off</b>, so nobody is billed.</div>
      <div class="bill-row">Would create <b>${p.counts.create}</b> · already imported <b>${p.counts.exists}</b> · skipped <b>${p.counts.skip}</b> · today ${esc(p.today)}</div>
      <div class="table-wrap"><table class="data-table bill-table"><thead><tr><th>Organisation</th><th>Today</th><th>In billing</th><th></th></tr></thead>
      <tbody>${p.rows.map((r) => `<tr><td>${esc(r.name)} <small>#${r.account_id}</small></td>
        <td>${r.current ? `${esc(r.current.plan || '—')} · ${esc(r.current.plan_status || '')} · trial ends ${d(r.current.trial_ends_at)} · paid until ${d(r.current.paid_until)}` : '—'}</td>
        <td>${r.proposed ? `${esc(r.proposed.plan_code)} · ${esc(r.proposed.status)}${r.proposed.trial_end_date ? ` · trial to ${esc(r.proposed.trial_end_date)}` : ''}${r.proposed.current_period_end ? ` · paid to ${esc(r.proposed.current_period_end)}` : ''}` : '—'}</td>
        <td>${esc(r.action)}${r.reason ? ` <small>(${esc(r.reason)})</small>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="bill-card-title" style="margin-top:16px">Imported (${subs.length})</div></div>`;
  }

  Object.assign(window, { loadBillingAdmin, initBillingAdminTab, switchBillingTab, billingEditPlan, billingFeatureChanged, billingSavePlan, billingClonePlan,
    billingAddPrice, billingSetCycle, billingAddTax, billingQuote, billingCreateCoupon, billingCouponActive });
})();
