// NexaDrip app — Festivals, repost, onboarding, simple/agency mode, licence.
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

// ─────────────────────────────────────────────────────────────────────────────
// 🇮🇳 Indian Holidays & WhatsApp Features
// ─────────────────────────────────────────────────────────────────────────────

let _todayHolidays = [];

async function loadIndianHolidays() {
  try {
    const data = await fetch('/api/holidays').then(r => r.json());
    _todayHolidays = data.today || [];

    // Show dashboard banner if there's a holiday today
    if (_todayHolidays.length > 0) {
      const h = _todayHolidays[0];
      const banner = document.getElementById('india-holiday-banner');
      const nameEl = document.getElementById('holiday-banner-name');
      const emojiEl = document.getElementById('holiday-banner-emoji');
      if (banner && nameEl && emojiEl) {
        nameEl.textContent = `${h.emoji} ${h.name} — Post a special message today!`;
        emojiEl.textContent = h.emoji;
        banner.style.display = 'block';
      }

      // Show in generate page
      const genBar = document.getElementById('gen-holiday-bar');
      const genName = document.getElementById('gen-holiday-name');
      if (genBar && genName) {
        genName.textContent = `${h.emoji} ${h.name}`;
        genBar.style.display = 'block';
      }

      // Store globally for use
      window._activeHoliday = h;
    }

    if (data.all) State.festivals = data.all;
  } catch { /* silent fail */ }
}

async function generateHolidayContent() {
  const holiday = window._activeHoliday;
  if (!holiday) return;
  const platforms = getSelectedPlatforms('gen-platforms');
  const platform = platforms[0] || 'facebook';

  document.getElementById('gen-prompt').value = `Create an engaging ${platform} post for ${holiday.name}`;
  await generateContent();
}

async function generateHolidayContentFromDashboard() {
  const holiday = window._activeHoliday;
  if (!holiday) return;
  if (!startNewCompose()) return;
  document.getElementById('compose-ai-prompt').value = `An engaging post for ${holiday.name}. Warm, celebratory and relevant for Indian audiences.`;
  composeAiWrite();
}

function shareViaWhatsApp(text) {
  if (!text?.trim()) { toast('No content to share', 'warning'); return; }
  const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔁 Edit & Repost Modal
// ─────────────────────────────────────────────────────────────────────────────

function openRepostModal(postId) {
  const post = State.postsHistoryMap?.[postId];
  if (!post) return;

  const modal = document.getElementById('repost-modal');
  const content = document.getElementById('repost-content');
  content.value = post.content || '';

  // Pre-select the same platforms
  const platforms = Array.isArray(post.platforms) ? post.platforms : [];
  document.querySelectorAll('#repost-platforms .platform-toggle').forEach(el => {
    const p = el.dataset.platform;
    if (platforms.includes(p)) el.classList.add('selected');
    else el.classList.remove('selected');
    el.onclick = () => el.classList.toggle('selected');
  });

  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  window._repostPostId = postId;
}

function closeRepostModal() {
  const modal = document.getElementById('repost-modal');
  if (modal) modal.style.display = 'none';
}

function sendRepostToCompose() {
  const content = document.getElementById('repost-content')?.value;
  if (!content) return;
  closeRepostModal();
  if (!startNewCompose({ text: content })) return;
  toast('Content loaded into Compose ✏️', 'success');
}

async function publishRepost() {
  const content = document.getElementById('repost-content')?.value?.trim();
  if (!content) return toast('Add content before posting', 'warning');

  const platforms = [];
  document.querySelectorAll('#repost-platforms .platform-toggle.selected').forEach(el => {
    if (el.dataset.platform && el.dataset.platform !== 'whatsapp') {
      platforms.push(el.dataset.platform);
    }
  });

  if (!platforms.length) {
    // WhatsApp deep link if only WhatsApp is selected
    shareViaWhatsApp(content);
    closeRepostModal();
    return;
  }

  try {
    const btn = document.querySelector('#repost-modal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
    await api('POST', '/api/post/now', { content, platforms, image_url: '' });
    closeRepostModal();
    toast('✅ Reposted successfully!', 'success');
    loadPostHistory();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    const btn = document.querySelector('#repost-modal .btn-primary');
    if (btn) { btn.disabled = false; btn.textContent = '📤 Post Now'; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🚀 Onboarding Wizard
// ─────────────────────────────────────────────────────────────────────────────

// Remembered per user, so a second person on the same PC still gets the welcome steps
function onboardingKey() {
  return `nexus_onboarding_v2_done_${State.user?.id || 'anon'}`;
}

function checkOnboarding() {
  let done = false;
  try { done = !!localStorage.getItem(onboardingKey()); } catch {}
  if (!done) setTimeout(() => showOnboarding(), 800);
}

function showOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
  }
}

function closeOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (overlay) overlay.style.display = 'none';
  try { localStorage.setItem(onboardingKey(), '1'); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple / Agency mode
//   Simple (default for one person): short menu, no review step, no client screens.
//   Agency: clients & brands, team review, workspace switcher, members.
// Saved per user; when never chosen, Agency is used once there are several
// workspaces or team members.
// ─────────────────────────────────────────────────────────────────────────────
function isAgencyMode() { return document.body.classList.contains('agency-mode'); }

function applyUiMode(mode) {
  const agency = mode === 'agency';
  document.body.classList.toggle('agency-mode', agency);
  const sw = document.getElementById('mode-switch');
  if (sw) sw.checked = agency;
}

async function initUiMode() {
  let mode = null;
  try { mode = (await fetch('/users/settings').then(r => r.json())).ui_mode || null; } catch {}
  if (!mode) {
    // Not chosen yet: decide from how the app is used
    try {
      const workspaces = await fetch('/workspaces').then(r => r.json());
      let members = 1;
      if (currentWorkspaceId) members = (await fetch(`/workspaces/${currentWorkspaceId}/members`).then(r => r.json())).length || 1;
      mode = (Array.isArray(workspaces) && workspaces.length > 1) || members > 1 ? 'agency' : 'simple';
    } catch { mode = 'simple'; }
  }
  applyUiMode(mode);
}

async function setUiMode(mode) {
  applyUiMode(mode);
  try { await api('POST', '/users/settings', { ui_mode: mode }); } catch {}
  toast(mode === 'agency'
    ? 'Agency mode: clients & brands, team review and the workspace switcher are now shown'
    : 'Simple mode: the menu shows just what one person needs', 'info');
  if (State.currentPage === 'calendar' && State.selectedContentItem) openContentDetail(State.selectedContentItem.id);
}

function toggleMoreTools(forceOpen) {
  const box = document.getElementById('nav-more');
  const btn = document.getElementById('nav-more-toggle');
  if (!box || !btn) return;
  const open = forceOpen === true ? true : !box.classList.contains('open');
  box.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  try { localStorage.setItem('nexus_more_tools_open', open ? '1' : ''); } catch {}
}

function openPlatformSettings() { openSettings('platforms'); }

// Welcome guide step 2: say so when Ollama is already installed and ready
async function checkOnboardOllama() {
  const box = document.getElementById('onboard-ollama-status');
  if (!box) return;
  try {
    const st = await fetch('/api/config/ollama/status').then(r => r.json());
    if (!st.running) return; // keep the download hint
    const want = String(st.current || 'llama3.2').split(':')[0];
    const ready = (st.models || []).some(m => m.name === st.current || m.name.split(':')[0] === want);
    if (ready) {
      // Nothing to set up: the main button just moves on
      const btn = document.getElementById('onboard-ai-btn');
      if (btn) { btn.textContent = 'Continue →'; btn.onclick = () => goOnboardStep(3); }
    }
    box.textContent = ready
      ? `✅ Ollama is running on this computer and ${st.current} is ready. Nothing else to set up.`
      : `✅ Ollama is running. Download the ${st.current} model in Settings → Local AI (one click).`;
  } catch {}
}

function goOnboardStep(step) {
  // Hide all panels
  document.querySelectorAll('.onboard-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById(`onboard-panel-${step}`);
  if (panel) panel.style.display = 'block';
  if (step === 2) checkOnboardOllama();

  // Update step indicators
  document.querySelectorAll('.onboard-step').forEach(el => {
    const s = parseInt(el.dataset.step);
    if (s === step) {
      el.style.borderBottomColor = 'var(--accent-purple)';
      el.style.color = 'var(--accent-purple)';
    } else {
      el.style.borderBottomColor = 'var(--border)';
      el.style.color = 'var(--text-muted)';
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔑 Licence (Settings → Licence + top banner)
// ─────────────────────────────────────────────────────────────────────────────

const LICENSE_BUY_URL = 'https://license.radixile.com/buy';

function licenseDate(epoch) {
  return epoch ? new Date(epoch * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

async function loadLicense() {
  licenseLastCheck = Date.now();
  try {
    State.license = await api('GET', '/api/license');
  } catch { return; }
  if (!State.license?.state) return; // signed out: api() is sending the page to sign-in
  renderLicenseBanner(State.license);
  if (typeof updateSettingsNavStatus === 'function') updateSettingsNavStatus();
  if (document.getElementById('settings-panel-license')?.style.display !== 'none') renderLicensePanel(State.license);
}

// The licence can change while this page stays open (activated in another tab or
// window, renewed, lease ran out): look again when the window comes back into view.
var licenseLastCheck = 0; // var: loadLicense may run before this line is reached
document.addEventListener('visibilitychange', () => {
  // State.user: only once signed in (also retries if the first check failed)
  if (document.visibilityState !== 'visible' || !State.user || Date.now() - licenseLastCheck < 30000) return;
  licenseLastCheck = Date.now();
  loadLicense();
});

function renderLicenseBanner(s) {
  const bar = document.getElementById('license-banner');
  if (!bar) return;
  // Server edition: businesses have plans, not licence keys (see the account banner)
  if (State.server) { bar.style.display = 'none'; return; }
  // Start-up checks take a few seconds: don't flash a warning, just look again
  if (s.state === 'checking') {
    bar.style.display = 'none';
    clearTimeout(renderLicenseBanner._t);
    renderLicenseBanner._t = setTimeout(loadLicense, 3000);
    return;
  }
  const show = s.state !== 'active' || !!s.message;
  bar.style.display = show ? 'flex' : 'none';
  if (!show) return;
  document.getElementById('license-banner-text').textContent =
    s.state === 'active' ? `🔑 ${s.message}` : `🔑 ${s.message || 'Activate NexaDrip to start publishing.'} You can keep writing, planning and exporting meanwhile.`;
  const btn = document.getElementById('license-banner-btn');
  const checkFirst = s.state === 'offline' || (s.lic && s.state === 'invalid');
  btn.textContent = s.state === 'active' ? 'Renew' : checkFirst ? 'Check now' : 'Activate';
  btn.onclick = () => {
    if (checkFirst) return licenseRefresh();
    openSettings('license');
  };
}

function renderLicensePanel(s) {
  if (typeof updateSettingsNavStatus === 'function') setTimeout(updateSettingsNavStatus);
  const box = document.getElementById('license-panel');
  if (!box) return;
  if (s.server) return renderPlanPanel(box, s);
  const isAdmin = State.user?.role === 'admin';
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'onclick') e.addEventListener('click', v); else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v);
    }
    for (const k of kids) if (k !== null && k !== undefined) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  };
  const row = (label, value) => el('div', { class: 'settings-row' },
    el('div', { class: 'settings-row-info' }, el('div', { class: 'settings-row-title' }, label)),
    el('div', { style: 'font-size:13px;color:var(--text-secondary)' }, value));
  const stateText = { active: '✅ Active', checking: '⏳ Checking…', unlicensed: '⚪ Not activated', offline: '🟠 Needs internet', expired: '🔴 Ended', invalid: '🔴 Not valid on this PC' }[s.state] || s.state;

  const parts = [];
  if (s.message) parts.push(el('div', { style: 'padding:10px 12px;border-radius:8px;background:var(--glass);margin-bottom:12px;font-size:13px' }, s.message));
  parts.push(row('Status', stateText));
  if (s.lic) {
    parts.push(row('Licensed to', s.licensee || '—'));
    parts.push(row('Edition', `${s.edition_name || s.edition}${s.type === 'coupon' ? ' (coupon)' : s.type === 'subscription' ? ' (yearly)' : ' (one-time)'}`));
    if (s.expires_at) parts.push(row(s.type === 'coupon' ? 'Coupon ends' : 'Renews / ends', licenseDate(s.expires_at)));
    if (s.updates_until) parts.push(row('Updates included until', licenseDate(s.updates_until)));
    parts.push(row('Works offline until', `${licenseDate(s.lease_until)} (checks in automatically when online)`));
    const lim = s.limits || {};
    const n = (v) => (v === -1 ? 'unlimited' : v);
    const plural = (v, word) => `${v} ${word}${v === 1 ? '' : 's'}`;
    parts.push(row('Includes', [plural(n(lim.seats), 'PC'), plural(n(lim.workspaces), 'workspace'), plural(n(lim.users), 'user'), plural(n(lim.seo_sites), 'SEO site')].join(' · ')));
  }

  if (!isAdmin) {
    parts.push(el('p', { style: 'margin-top:12px;font-size:13px;color:var(--text-muted)' }, 'Only the admin of this installation can activate or change the licence.'));
    box.replaceChildren(...parts);
    return;
  }

  // A licence that stopped working may just need a check-in (renewed, lifted
  // suspension, lease ran out): offer that before asking for a new key
  if (s.lic && s.state !== 'active') {
    parts.push(el('div', { style: 'margin-top:16px' },
      el('button', { class: 'btn btn-primary', onclick: licenseRefresh }, '🔄 Check licence now'),
      el('span', { style: 'margin-left:10px;font-size:12px;color:var(--text-muted)' }, 'Renewed or moved your licence? Check first. Otherwise enter a key below.')));
  }

  // Activate (key or coupon)
  if (s.state !== 'active') {
    const code = el('input', { class: 'form-input', id: 'lic-code', placeholder: 'SNXP-… / SNXS-… licence key, or SNX-XXXX-XXXX coupon', style: 'font-family:monospace' });
    const email = el('input', { class: 'form-input', id: 'lic-email', type: 'email', placeholder: 'Your email (needed for coupons)' });
    const name = el('input', { class: 'form-input', id: 'lic-name', placeholder: 'Your name or business (shown as "Licensed to")' });
    const device = el('input', { class: 'form-input', id: 'lic-device', placeholder: 'Name for this computer, e.g. "Office PC" (optional)' });
    const msg = el('div', { style: 'font-size:13px;margin-top:8px' });
    const go = el('button', { class: 'btn btn-primary', onclick: async () => {
      go.disabled = true; msg.textContent = 'Activating…'; msg.style.color = '';
      try {
        const r = await api('POST', '/api/license/activate', { key: code.value, email: email.value, name: name.value, device_name: device.value });
        State.license = r;
        toast('NexaDrip is activated ✅', 'success');
        renderLicensePanel(r); renderLicenseBanner(r);
      } catch (err) {
        msg.textContent = err.message; msg.style.color = '#ef4444';
      } finally { go.disabled = false; }
    } }, 'Activate');
    parts.push(el('h3', { style: 'margin:20px 0 8px;font-size:15px' }, 'Activate'),
      code, el('div', { style: 'height:8px' }), email, el('div', { style: 'height:8px' }), name, el('div', { style: 'height:8px' }), device,
      el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, go,
        el('a', { class: 'btn btn-secondary', href: LICENSE_BUY_URL, target: '_blank', rel: 'noopener' }, 'Buy a licence')),
      msg,
      el('p', { style: 'font-size:12px;color:var(--text-muted);margin-top:10px' },
        'Privacy: activation sends only scrambled (hashed) computer identifiers, the computer name you type, and your email for coupons. Your posts, accounts and keys never leave this PC.'));

    // Offline activation
    const offKey = el('input', { class: 'form-input', placeholder: 'Licence key (SNXP-… / SNXS-…)', style: 'font-family:monospace' });
    const file = el('input', { type: 'file', accept: '.snlic,application/json' });
    parts.push(el('details', { style: 'margin-top:16px' },
      el('summary', { style: 'cursor:pointer;font-size:13px;color:var(--accent-blue)' }, 'No internet on this computer? Activate offline'),
      el('ol', { style: 'font-size:13px;color:var(--text-secondary);margin:8px 0 8px 18px' },
        el('li', {}, 'Enter your licence key and save the request file.'),
        el('li', {}, 'On any device with internet, open license.radixile.com/offline and upload it.'),
        el('li', {}, 'Bring back the downloaded license.snlic and import it below.')),
      offKey,
      el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center' },
        el('button', { class: 'btn btn-secondary btn-sm', onclick: async () => {
          try {
            const req = await api('POST', '/api/license/offline-request', { key: offKey.value, device_name: device.value });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify(req, null, 2)], { type: 'application/json' }));
            a.download = 'activation.snreq';
            a.click();
          } catch (err) { toast(err.message, 'error'); }
        } }, '💾 Save request file'),
        file,
        el('button', { class: 'btn btn-secondary btn-sm', onclick: async () => {
          const f = file.files[0];
          if (!f) return toast('Choose the license.snlic file first', 'warning');
          try {
            const r = await api('POST', '/api/license/import', { content: await f.text() });
            State.license = r; toast('Licence imported ✅', 'success'); renderLicensePanel(r); renderLicenseBanner(r);
          } catch (err) { toast(err.message, 'error'); }
        } }, '📥 Import licence file'))));
  } else {
    parts.push(el('div', { style: 'display:flex;gap:8px;margin-top:16px;flex-wrap:wrap' },
      el('button', { class: 'btn btn-secondary', onclick: licenseRefresh }, '🔄 Check licence now'),
      s.type !== 'perpetual' ? el('a', { class: 'btn btn-secondary', href: LICENSE_BUY_URL, target: '_blank', rel: 'noopener' }, s.type === 'coupon' ? 'Buy a licence' : 'Manage / renew') : null,
      el('button', { class: 'btn btn-danger', onclick: async () => {
        if (!confirm('Deactivate this computer? Use this before moving NexaDrip to a new PC. Your data stays here; publishing stops until you activate again.')) return;
        try {
          const r = await api('POST', '/api/license/deactivate');
          State.license = r; toast('This computer was deactivated', 'info'); renderLicensePanel(r); renderLicenseBanner(r);
        } catch (err) { toast(err.message, 'error'); }
      } }, 'Deactivate this PC')));
  }

  // ── Manual License Approval / Emergency Override (Admin) ──────────────────
  if (isAdmin) {
    const manualDetails = el('details', {
      style: 'margin-top:24px;padding:16px;border:1px solid var(--border-subtle, rgba(255,255,255,0.12));border-radius:10px;background:var(--card-bg, rgba(255,255,255,0.02))',
      open: s.state !== 'active'
    });

    const summary = el('summary', {
      style: 'cursor:pointer;font-weight:600;font-size:14px;color:var(--text-primary);display:flex;align-items:center;gap:8px'
    }, '🛠️ Manual License Approval & Emergency Override');

    const desc = el('p', {
      style: 'font-size:12px;color:var(--text-muted);margin:8px 0 14px'
    }, 'If a license becomes damaged, invalid, or the licensing server is unreachable, administrators can manually approve and sign an active license directly on this machine.');

    const mLicensee = el('input', {
      class: 'form-input',
      placeholder: 'Business name on the licence',
      value: s.licensee || '',
      style: 'margin-bottom:8px'
    });

    const mEdition = el('select', {
      class: 'form-select',
      style: 'margin-bottom:8px;width:100%'
    },
      el('option', { value: 'agency' }, 'Agency Edition (All Features - 25 Workspaces, 10 Users)'),
      el('option', { value: 'individual' }, 'Individual Edition (1 Workspace, 2 Users)')
    );

    const btnApprove = el('button', {
      class: 'btn btn-primary',
      style: 'display:inline-flex;align-items:center;gap:6px',
      onclick: async () => {
        btnApprove.disabled = true;
        btnApprove.textContent = 'Approving & Signing…';
        try {
          const res = await api('POST', '/api/license/manual-approve', {
            licensee: mLicensee.value,
            edition: mEdition.value,
            validYears: 10,
          });
          State.license = res.license;
          toast('License manually approved and activated! ✅', 'success', 6000);
          renderLicensePanel(res.license);
          renderLicenseBanner(res.license);
        } catch (err) {
          toast(err.message, 'error', 8000);
        } finally {
          btnApprove.disabled = false;
          btnApprove.textContent = '⚡ Approve & Activate License Now';
        }
      }
    }, '⚡ Approve & Activate License Now');

    manualDetails.append(
      summary,
      desc,
      el('div', { style: 'display:flex;flex-direction:column;gap:4px;max-width:480px' },
        el('label', { style: 'font-size:12px;color:var(--text-secondary)' }, 'Licensed To:'),
        mLicensee,
        el('label', { style: 'font-size:12px;color:var(--text-secondary)' }, 'License Tier:'),
        mEdition,
        el('div', { style: 'margin-top:8px' }, btnApprove)
      )
    );

    parts.push(manualDetails);
  }

  box.replaceChildren(...parts);
}

async function licenseRefresh() {
  try {
    const r = await api('POST', '/api/license/refresh');
    State.license = r;
    toast(r.state === 'active' ? 'Licence confirmed ✅' : (r.last_error || r.message || 'Licence checked'), r.state === 'active' ? 'success' : 'warning');
    renderLicenseBanner(r);
    renderLicensePanel(r);
  } catch (err) { toast(err.message, 'error'); }
}

// ── Server edition: the business's plan (no licence keys) ────────────────────
function renderPlanPanel(box, s) {
  // The tab is about the plan here
  const nav = document.querySelector('.settings-nav-item[data-tab="license"]');
  if (nav) {
    nav.querySelector('.settings-nav-title').textContent = 'Plan';
    nav.querySelector('.settings-nav-sub').textContent = s.plan === 'trial' ? 'Free trial' : (s.plan_name || 'Your plan');
  }
  const panel = document.getElementById('settings-panel-license');
  if (panel) {
    panel.querySelector('.panel-title').textContent = 'Plan';
    panel.querySelector('.panel-desc').textContent = 'What your business’s plan includes. Writing and planning always work; publishing and automation need an active trial or plan.';
  }
  const n = (v) => (v === -1 || v === undefined ? 'unlimited' : v);
  const label = { workspaces: 'Brand/client workspaces', users: 'Team members', seo_sites: 'SEO autopilot websites' };
  const state = s.can_publish
    ? (s.plan === 'trial' ? `✅ Free trial · ${s.trial_days_left} day${s.trial_days_left === 1 ? '' : 's'} left` : '✅ Active')
    : (s.state === 'invalid' ? '🔴 Paused' : '🔴 Ended');
  const rows = Object.keys(s.limits || {}).map((k) => {
    const used = s.usage?.[k] ?? 0;
    const lim = s.limits[k];
    const full = lim !== -1 && used >= lim;
    return `<div class="settings-row"><div class="settings-row-info"><div class="settings-row-title">${escapeHtml(label[k] || k)}</div></div>
      <div style="font-size:13px;color:${full ? '#b45309' : 'var(--text-secondary)'}">${used} of ${n(lim)}${full ? ' · full' : ''}</div></div>`;
  }).join('');
  box.innerHTML = `
    ${s.message ? `<div style="padding:10px 12px;border-radius:8px;background:var(--glass);margin-bottom:12px;font-size:13px">${escapeHtml(s.message)}</div>` : ''}
    <div class="settings-row"><div class="settings-row-info"><div class="settings-row-title">Business</div></div><div style="font-size:13px;color:var(--text-secondary)">${escapeHtml(s.business || '')}</div></div>
    <div class="settings-row"><div class="settings-row-info"><div class="settings-row-title">Plan</div></div><div style="font-size:13px;color:var(--text-secondary)">${escapeHtml(s.plan_name || s.plan || '')}</div></div>
    <div class="settings-row"><div class="settings-row-info"><div class="settings-row-title">Status</div></div><div style="font-size:13px;color:var(--text-secondary)">${state}</div></div>
    ${rows}
    <div id="billing-box" style="margin-top:20px"><p class="form-hint">Loading plans…</p></div>`;
  loadBillingSection();
}

// ── Paying for the plan online (server edition) ─────────────────────────────
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: paise % 100 ? 2 : 0 })}`;
const billingDate = (epoch) => new Date(epoch * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
State.billingInterval = State.billingInterval || 'monthly';

async function loadBillingSection() {
  const box = document.getElementById('billing-box');
  if (!box) return;
  let b;
  try { b = await api('GET', '/api/billing'); } catch (err) { box.innerHTML = `<p class="form-hint">${escapeHtml(err.message)}</p>`; return; }
  State.billing = b;
  if (!b.configured) {
    box.innerHTML = '<p class="form-hint">To choose or change a plan, write to <a href="mailto:info@radixile.com">info@radixile.com</a>. Paying online here is coming soon.</p>';
    return;
  }
  const sub = b.subscription || {};
  const paying = ['active', 'past_due'].includes(sub.status);
  const parts = [];

  // Current subscription
  if (paying || sub.status === 'cancelled') {
    const ends = sub.cancel_at_period_end || sub.status === 'cancelled';
    const when = sub.paid_until ? `${ends ? 'Ends' : 'Renews'} on ${billingDate(sub.paid_until)}` : '';
    parts.push(`<div class="billing-current">
      <div><div class="settings-row-title">${escapeHtml(sub.product_name || 'Your plan')}</div>
      <div class="form-hint" style="margin:2px 0 0">${escapeHtml(when)}${sub.status === 'past_due' ? ' · the last payment failed. Razorpay tries again, or choose a plan below to pay now' : ''}</div></div>
      ${b.can_manage && paying && !sub.cancel_at_period_end ? '<button class="btn btn-ghost btn-ghost-danger btn-sm" data-bill="cancel">Cancel plan</button>' : ''}
    </div>`);
  }

  // Plans to choose from
  // A cancelled plan, or one whose payments fail, can be replaced by paying for a new one
  const canChoose = !paying || sub.cancel_at_period_end || sub.status === 'past_due';
  if (canChoose && b.plans?.length) {
    const intervals = [...new Set(b.plans.map((p) => p.interval))];
    if (!intervals.includes(State.billingInterval)) State.billingInterval = intervals[0];
    const shown = b.plans.filter((p) => p.interval === State.billingInterval);
    const lim = (v) => (Number(v) === -1 ? 'Unlimited' : Number(v) || 0);
    parts.push(`<div class="billing-head">
      <h3 class="settings-section-title" style="margin:0">${paying ? 'Choose your next plan' : 'Choose a plan'}</h3>
      ${intervals.length > 1 ? `<div class="segmented" role="radiogroup" aria-label="Billing period" style="width:auto">
        ${intervals.map((i) => `<button class="seg" role="radio" aria-checked="${i === State.billingInterval}" data-bill="interval" data-value="${escapeHtml(i)}">${i === 'yearly' ? 'Yearly' : 'Monthly'}</button>`).join('')}
      </div>` : ''}
    </div>
    <div class="plan-grid">${shown.map((p) => `
      <div class="plan-card">
        <div class="plan-name">${escapeHtml(p.plan_name)}</div>
        <div class="plan-price">${rupees(p.total)}<span>/${p.interval === 'yearly' ? 'year' : 'month'}</span></div>
        <div class="form-hint" style="margin:0 0 10px">${rupees(p.base)} + ${p.gst_percent}% GST</div>
        <ul class="plan-limits">
          <li>${lim(p.limits?.workspaces)} brand/client workspace${p.limits?.workspaces === 1 ? '' : 's'}</li>
          <li>${lim(p.limits?.users)} team member${p.limits?.users === 1 ? '' : 's'}</li>
          <li>${lim(p.limits?.seo_sites)} SEO autopilot website${p.limits?.seo_sites === 1 ? '' : 's'}</li>
        </ul>
        ${b.can_manage
          ? `<button class="btn btn-primary btn-sm" style="width:100%" ${p.ready ? '' : 'disabled title="Not available for payment yet"'} data-bill="choose" data-value="${escapeHtml(p.code)}">Choose ${escapeHtml(p.plan_name)}</button>`
          : ''}
      </div>`).join('')}
    </div>
    ${b.can_manage ? '' : '<p class="form-hint">Only the owner of the business can choose and pay for a plan.</p>'}
    <div id="billing-form"></div>`);
  } else if (paying) {
    parts.push('<p class="form-hint">To change plan, write to <a href="mailto:info@radixile.com">info@radixile.com</a>.</p>');
  }
  if (b.plans_error) parts.push(`<p class="form-hint">${escapeHtml(b.plans_error)}</p>`);
  if (b.mode === 'mock' && b.can_manage) parts.push('<p class="form-hint">Test mode: no real money is charged.</p>');

  // Invoices
  if (b.invoices?.length) {
    parts.push(`<h3 class="settings-section-title" style="margin:20px 0 6px">Invoices</h3>
      ${b.invoices.map((i) => `<div class="settings-row"><div class="settings-row-info"><div class="settings-row-title">${escapeHtml(i.invoice_no)}</div>
        <div class="settings-row-desc">${i.paid_at ? billingDate(i.paid_at) : ''}${i.refund ? ' · refunded' : ''}</div></div>
        <div style="display:flex;gap:12px;align-items:center;font-size:13px">${rupees(i.amount_paise)}
        <a href="${escapeHtml(i.url)}" target="_blank" rel="noopener">Open</a></div></div>`).join('')}`);
  }
  parts.push('<p class="form-hint" style="margin-top:14px">Payments are handled securely by Razorpay. See the <a href="/legal/refunds" target="_blank" rel="noopener">refund and cancellation policy</a>.</p>');
  box.innerHTML = parts.join('');
  // Buttons are wired here (no values inside onclick text)
  box.querySelectorAll('[data-bill]').forEach((el) => el.addEventListener('click', () => {
    const v = el.dataset.value;
    if (el.dataset.bill === 'cancel') cancelBillingPlan(el);
    else if (el.dataset.bill === 'interval') setBillingInterval(v);
    else if (el.dataset.bill === 'choose') openBillingForm(v);
  }));
}

function setBillingInterval(i) {
  State.billingInterval = i;
  loadBillingSection();
}

// GST details for the invoice, then off to the payment page
function openBillingForm(code) {
  const b = State.billing || {};
  const plan = (b.plans || []).find((p) => p.code === code);
  const box = document.getElementById('billing-form');
  if (!plan || !box) return;
  const states = Object.entries(b.states || {}).sort((x, y) => x[1].localeCompare(y[1]));
  box.innerHTML = `<div class="billing-form card" style="margin-top:14px">
    <div class="card-body">
      <div class="settings-row-title" style="margin-bottom:4px">${escapeHtml(plan.name)}: ${rupees(plan.total)} per ${plan.interval === 'yearly' ? 'year' : 'month'}</div>
      <p class="form-hint" style="margin:0 0 12px">For the GST invoice. It renews automatically; cancel any time here.</p>
      <div class="grid-2">
        <div class="form-group"><label class="form-label" for="bill-name">Name on the invoice</label><input class="form-input" id="bill-name" value="${escapeHtml(b.business || '')}" maxlength="160" /></div>
        <div class="form-group"><label class="form-label" for="bill-email">Invoice email</label><input class="form-input" id="bill-email" type="email" value="${escapeHtml(b.email || '')}" /></div>
        <div class="form-group"><label class="form-label" for="bill-gstin">GSTIN (optional)</label><input class="form-input" id="bill-gstin" placeholder="27ABCDE1234F1Z5" maxlength="15" style="text-transform:uppercase" /></div>
        <div class="form-group"><label class="form-label" for="bill-state">State</label><select class="form-select" id="bill-state"><option value="">Choose your state</option>${states.map(([c, n]) => `<option value="${escapeHtml(c)}">${escapeHtml(n)}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label class="form-label" for="bill-address">Billing address (optional)</label><input class="form-input" id="bill-address" maxlength="400" /></div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="bill-go">Continue to payment →</button>
        <button class="btn btn-ghost" id="bill-close">Cancel</button>
      </div>
    </div></div>`;
  document.getElementById('bill-go').addEventListener('click', (e) => startBillingCheckout(code, e.currentTarget));
  document.getElementById('bill-close').addEventListener('click', () => { box.innerHTML = ''; });
  // A GSTIN already says the state
  document.getElementById('bill-gstin').addEventListener('input', (e) => {
    const code2 = e.target.value.trim().slice(0, 2);
    if (/^\d{2}$/.test(code2) && b.states?.[code2]) document.getElementById('bill-state').value = code2;
  });
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('bill-state').focus();
}

async function startBillingCheckout(code, btn) {
  const v = (id) => document.getElementById(id)?.value.trim() || '';
  if (!v('bill-state') && !v('bill-gstin')) return toast('Choose your state (needed for the GST invoice)', 'warning');
  btn.disabled = true;
  try {
    const r = await api('POST', '/api/billing/checkout', {
      product_code: code, company: v('bill-name'), email: v('bill-email'), gstin: v('bill-gstin').toUpperCase(),
      state_code: v('bill-state'), address: v('bill-address'),
    });
    window.location.href = r.pay_url;
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
}

async function cancelBillingPlan(btn) {
  const sub = State.billing?.subscription || {};
  const until = sub.paid_until ? billingDate(sub.paid_until) : 'the end of the period you paid for';
  if (!(await askConfirm(`Cancel the plan? It keeps working until ${until}; after that, publishing and sending stop. Your posts and settings are kept.`, 'Cancel plan'))) return;
  btn.disabled = true;
  try {
    await api('POST', '/api/billing/cancel');
    toast(`Plan cancelled. It keeps working until ${until}.`, 'success');
    await loadLicense();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
}
