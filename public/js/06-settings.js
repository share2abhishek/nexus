/// Social-Nexus app — Settings, admin, theme, sign-in returns, AI model picker.
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────
// Sections: platforms (Connected accounts), ai, smtp (Email sending), backups,
// license, members (Team, agency mode), account (My account & app).
// There is no separate help screen: each section explains itself.

const SETTINGS_TABS = ['platforms', 'ai', 'smtp', 'backups', 'license', 'members', 'account'];
// Old names still used by links elsewhere in the app
const SETTINGS_TAB_ALIASES = { accounts: 'platforms', social: 'platforms', email: 'smtp', team: 'members', about: 'account', keys: 'ai' };

// Settings sections that change things for everyone on this PC: only the admin can
// edit them. Others see a short note and read-only controls instead of a form
// that would only fail when saved.
const ADMIN_ONLY_TABS = {
  smtp: 'Email sending is set up once for everyone by the admin of this installation. Ask them if emails are not going out.',
  ai: 'Local AI is set up for everyone by the admin of this installation. You can still add your own online AI keys below — they are saved to your account only.',
};
function applyAdminOnly(tab) {
  const panel = document.getElementById(`settings-panel-${tab}`);
  if (!panel || !ADMIN_ONLY_TABS[tab]) return;
  const isAdmin = State.user?.role === 'admin' || State.user?.role === 'superadmin' || State.user?.is_super_admin;
  let note = panel.querySelector(':scope > .admin-note');
  if (!isAdmin && !note) {
    note = document.createElement('div');
    note.className = 'admin-note';
    note.textContent = '🔒 ' + ADMIN_ONLY_TABS[tab];
    panel.querySelector('.panel-intro')?.after(note) || panel.prepend(note);
  }
  if (isAdmin && note) note.remove();
  panel.querySelectorAll('input, select, textarea, button').forEach(el => {
    if (el.closest('.admin-note') || el.closest('.user-scoped') || el.classList.contains('admin-note-exempt')) return;
    if (!isAdmin) { el.dataset.adminLocked = '1'; el.disabled = true; }
    else if (el.dataset.adminLocked) { el.disabled = false; delete el.dataset.adminLocked; }
  });
}

function switchSettingsTab(tab, btn) {
  tab = SETTINGS_TAB_ALIASES[tab] || tab;
  if (!SETTINGS_TABS.includes(tab)) tab = 'platforms';
  const panel = document.getElementById(`settings-panel-${tab}`);
  if (!panel) return;
  document.querySelectorAll('.settings-panel').forEach(p => { p.style.display = 'none'; });
  panel.style.display = '';
  btn = btn || document.querySelector(`.settings-tab-btn[data-tab="${tab}"]`);
  document.querySelectorAll('.settings-tab-btn').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
  if (btn) { btn.classList.add('active'); btn.setAttribute('aria-current', 'page'); }
  State.settingsTab = tab;
  if (tab === 'members') loadMembers();
  if (tab === 'backups') loadBackups();
  if (tab === 'ai') { loadUserSettings(); loadBusinessAi(); checkOllamaStatus(); refreshAiStatus(); }
  if (tab === 'smtp') loadSMTPSettings();
  if (tab === 'account') loadAccountPanel();
  applyAdminOnly(tab);
  if (tab === 'license') { if (State.license) renderLicensePanel(State.license); loadLicense(); }
}

// Open Settings at one section, from anywhere in the app
function openSettings(tab = 'platforms') {
  State.pendingSettingsTab = tab;
  navigateTo('settings');
}
window.openSettings = openSettings;

async function loadSettings() {
  // Show the section asked for (or the one last open)
  const tab = State.pendingSettingsTab || State.settingsTab || 'platforms';
  State.pendingSettingsTab = null;
  switchSettingsTab(tab);
  try {
    // Platforms Radixile offers one-click connect for (empty when offline)
    State.oneClick = await fetch('/auth/connect/platforms').then(r => r.json()).then(d => d.platforms || []).catch(() => []);
    const platforms = await api('GET', '/api/config/platforms');
    renderPlatformCards(platforms);
  } catch (err) {
    document.getElementById('platform-cards-container').innerHTML =
      `<div class="state-error">Couldn’t load your accounts: ${escapeHtml(err.message)} <button class="btn btn-secondary btn-sm" onclick="loadSettings()">Try again</button></div>`;
  }
  refreshAiStatus();
  loadContentFolderSetting();
  updateSettingsNavStatus();
}

// ── Connected accounts ───────────────────────────────────────────────────────

const PLATFORM_ORDER = ['facebook', 'instagram', 'linkedin', 'threads', 'bluesky', 'pinterest', 'twitter', 'google_business'];

// One plain status per platform: what it means and what to do
function platformState(key, p) {
  const isAdmin = State.user?.role === 'admin' || State.user?.role === 'superadmin' || State.user?.is_super_admin;
  const oneClick = (State.oneClick || []).includes(key);
  const days = p.reconnect_in_days;
  if (p.connected && days != null && days <= 14) {
    return { tone: 'warn', label: days === 0 ? 'Sign in again today' : `Sign in again within ${days} day${days === 1 ? '' : 's'}`, group: 'attention' };
  }
  if (p.connected) return { tone: 'ok', label: 'Connected', group: 'connected' };
  if (p.needs_reconnect) return { tone: 'warn', label: 'Needs signing in again', group: 'attention' };
  if (p.kind === 'oneclick' && !oneClick) return { tone: 'off', label: 'Coming soon', group: 'unavailable' };
  if (p.configured || oneClick || p.kind === 'app_password') return { tone: 'off', label: 'Not connected', group: 'ready' };
  return { tone: 'off', label: isAdmin ? 'Needs a one-time setup' : 'Waiting for your admin', group: 'setup' };
}

function renderAccountsSummary(platforms) {
  const box = document.getElementById('accounts-summary');
  if (!box) return;
  const counts = { connected: 0, attention: 0 };
  for (const key of PLATFORM_ORDER) {
    if (!platforms[key]) continue;
    const g = platformState(key, platforms[key]).group;
    if (g in counts) counts[g]++;
  }
  box.innerHTML = `
    <div class="summary-chip ${counts.connected ? 'ok' : ''}"><span class="status-dot-sm ok"></span><b>${counts.connected}</b> connected</div>
    ${counts.attention ? `<div class="summary-chip warn"><span class="status-dot-sm warn"></span><b>${counts.attention}</b> need${counts.attention === 1 ? 's' : ''} attention</div>` : ''}
    ${!counts.connected ? '<div class="summary-hint">Start with the account you post to most. Facebook + Instagram is the usual first step.</div>' : ''}`;
}

function renderPlatformCards(platforms) {
  State.platformConfig = platforms;
  const container = document.getElementById('platform-cards-container');
  const isAdminUser = State.user?.role === 'admin' || State.user?.role === 'superadmin' || State.user?.is_super_admin;
  renderAccountsSummary(platforms);

  // Accounts needing attention first, then connected, then the rest
  const rank = { attention: 0, connected: 1, ready: 2, setup: 3, unavailable: 4 };
  const keys = PLATFORM_ORDER.filter(k => platforms[k])
    .sort((a, b) => rank[platformState(a, platforms[a]).group] - rank[platformState(b, platforms[b]).group]);

  container.innerHTML = keys.map(key => {
    const p = platforms[key];
    const st = platformState(key, p);
    const label = escapeHtml(p.label || PLATFORMS[key]?.label || key);
    const isConnected = p.connected;
    const isConfigured = p.configured;
    const oneClick = (State.oneClick || []).includes(key);
    const profileName = p.profile?.page_name || p.profile?.name || p.profile?.handle || '';
    const since = p.since ? new Date(p.since * 1000).toLocaleDateString() : null;

    // What the status means, in one line
    const detail = isConnected
      ? (key === 'google_business'
        ? (p.location_set ? `Posting to <b>${escapeHtml(p.location_title || 'your location')}</b>` : '<b>Choose which location to post to</b> (below)')
        : `${profileName ? `Posting as <b>${escapeHtml(profileName)}</b>` : 'Ready to post'}`) + (since ? ` · since ${escapeHtml(since)}` : '')
      : st.group === 'attention'
        ? escapeHtml(p.reconnect_reason || 'The saved sign-in stopped working. Click Reconnect and sign in again; your posts are kept.')
      : st.group === 'setup' && isAdminUser
        ? (key === 'instagram' ? 'Instagram connects through Facebook. Set up Facebook + Instagram first, then click Connect here.' : `${label} needs your own developer app first${p.guide?.time && p.guide.time !== '—' ? ` (${escapeHtml(p.guide.time.toLowerCase())})` : ''}. Click <b>Set up</b> for the steps.`)
      : st.group === 'setup'
        ? `Your admin needs to set up ${label} once. Then you can connect it here.`
      : st.group === 'unavailable' ? 'Not available yet.'
      : p.kind === 'app_password' ? 'Sign in with your handle and an app password.'
      : 'Click Connect and sign in. It takes about a minute.';

    // The one main action for this card
    let action = '';
    if (isConnected) {
      action = `<button class="btn btn-secondary btn-sm" onclick="triggerPlatformConnection('${key}', event)" title="Check the sign-in still works">Check</button>
        ${st.group === 'attention' ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(p.oauth_url || '#')}" ${oneClick ? `onclick="event.preventDefault();connectOneClick('${key}', this)"` : ''}>Reconnect</a>` : ''}
        <button class="btn btn-ghost btn-ghost-danger btn-sm" onclick="disconnect('${key}')">Disconnect</button>`;
    } else if (p.kind === 'app_password') {
      action = `<button class="btn btn-primary btn-sm" onclick="connectBluesky('${key}', this)">${p.needs_reconnect ? 'Reconnect' : 'Connect'}</button>`;
    } else if (st.group === 'unavailable') {
      action = '';
    } else if (oneClick) {
      action = `<button class="btn btn-primary btn-sm" onclick="connectOneClick('${key}', this)">${p.needs_reconnect ? 'Reconnect' : 'Connect'}</button>`;
    } else if (isConfigured) {
      action = `<a href="${escapeHtml(p.oauth_url)}" class="btn btn-primary btn-sm">${p.needs_reconnect ? 'Reconnect' : 'Connect'}</a>`;
    } else if (isAdminUser && p.credentials?.length) {
      action = `<button class="btn btn-secondary btn-sm" onclick="openPlatformSetup('${key}')">Set up</button>`;
    }

    const formHtml = !isConnected && p.kind === 'app_password' ? `
      <div class="pcard-form">
        <label class="form-label" for="bsky-handle-${key}">Your handle</label>
        <input class="form-input" id="bsky-handle-${key}" placeholder="yourname.bsky.social" autocomplete="off" />
        <label class="form-label" for="bsky-pass-${key}">App password</label>
        <input class="form-input" id="bsky-pass-${key}" type="password" placeholder="xxxx-xxxx-xxxx-xxxx" autocomplete="off" />
        <div class="form-hint">On Bluesky: Settings → Privacy and security → App passwords → Add. Not your main password.</div>
        <details class="settings-more"><summary>Own server (optional)</summary>
          <input class="form-input" id="bsky-service-${key}" placeholder="https://bsky.social" style="margin-top:6px" /></details>
      </div>` : '';

    const choosersHtml = isConnected && key === 'facebook' ? `
      <div class="pcard-extra">
        <button class="btn btn-secondary btn-sm" onclick="loadFBPages()">Choose Facebook Page</button>
        <div id="fb-page-selector" style="display:none;margin-top:8px"></div>
      </div>`
      : isConnected && key === 'pinterest' ? `
      <div class="pcard-extra">
        <button class="btn btn-secondary btn-sm" onclick="loadPinterestBoards()">Choose board</button>
        <div id="pinterest-board-selector" style="display:none;margin-top:8px"></div>
      </div>`
      : isConnected && key === 'google_business' ? `
      <div class="pcard-extra">
        <button class="btn btn-${p.location_set ? 'secondary' : 'primary'} btn-sm" onclick="loadGoogleLocations()">${p.location_set ? 'Change location' : 'Choose location'}</button>
        <div id="gbp-location-selector" style="display:none;margin-top:8px"></div>
      </div>` : '';

    // If sign-in fails: paste a token (Facebook only)
    const manualTokenHtml = !isConnected && isConfigured && key === 'facebook' ? `
      <details class="settings-more">
        <summary>Sign-in window not working? Paste a token instead</summary>
        <div class="pcard-form">
          <div class="form-hint">In <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener">Graph API Explorer</a>, choose your app → Generate Access Token → copy it here.</div>
          <input type="text" class="form-input" id="manual-token-${key}" placeholder="Paste your access token" style="font-family:monospace" />
          <button class="btn btn-secondary btn-sm" onclick="saveManualToken('${key}')" style="align-self:flex-start">Connect with token</button>
        </div>
      </details>` : '';

    // Admin: one-time developer app setup (guide + keys), folded away once done
    const g = p.guide;
    const setupHtml = !isAdminUser || !p.credentials?.length || (isConnected && isConfigured) ? '' : `
      <details class="settings-more pcard-setup" id="setup-${key}" ${!isConfigured && !oneClick ? '' : ''}>
        <summary>${isConfigured ? 'Developer app details (done)' : 'Set up — one time, by the admin'}</summary>
        ${g ? `
        <div class="pcard-guide">
          ${g.needs?.length ? `<div class="form-hint">You need: ${g.needs.map(n => escapeHtml(n)).join(' · ')}</div>` : ''}
          <ol>
            ${g.steps.map(s => `<li>${escapeHtml(s.text)}
              ${s.link ? ` <a href="${escapeHtml(s.link)}" target="_blank" rel="noopener">Open ↗</a>` : ''}
              ${s.copy ? `<div class="copy-row"><code>${escapeHtml(s.copy)}</code><button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(s.copy)});toast('Copied','success')">Copy</button></div>` : ''}
            </li>`).join('')}
          </ol>
          ${g.notes?.length ? `<div class="form-hint">${g.notes.map(n => escapeHtml(n)).join('<br>')}</div>` : ''}
        </div>` : ''}
        <div class="pcard-form">
          ${p.credentials.filter(c => !c.readonly).map(c => `
            <label class="form-label" for="cred-${key}-${c.key}">${escapeHtml(c.label)}</label>
            <input type="${c.type === 'password' ? 'password' : 'text'}" class="form-input" id="cred-${key}-${c.key}"
              value="${escapeHtml(c.value)}" placeholder="Paste ${escapeHtml(c.label)}" autocomplete="off" />`).join('')}
          <button class="btn btn-primary btn-sm" onclick="savePlatformCredentials('${key}')" style="align-self:flex-start">Save</button>
        </div>
      </details>`;

    const noteHtml = p.note && !isConnected && p.kind !== 'app_password' && st.group !== 'setup' ? `<div class="form-hint pcard-note">${escapeHtml(p.note)}</div>` : '';

    return `
      <div class="pcard pcard-${st.tone}" id="pcard-${key}">
        <div class="pcard-head">
          <div class="pcard-icon" style="background:${escapeHtml(p.color)}1a;border-color:${escapeHtml(p.color)}40">${p.icon}</div>
          <div class="pcard-title">
            <div class="pcard-name">${label}</div>
            <span class="status-pill ${st.tone}"><span class="status-dot-sm ${st.tone}"></span>${escapeHtml(st.label)}</span>
          </div>
          <div class="pcard-actions">${action}</div>
        </div>
        <div class="pcard-detail">${detail}</div>
        ${formHtml}
        ${choosersHtml}
        ${noteHtml}
        ${manualTokenHtml}
        ${setupHtml}
      </div>`;
  }).join('');
}

function openPlatformSetup(key) {
  const d = document.getElementById(`setup-${key}`);
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveManualToken(platform) {
  const input = document.getElementById(`manual-token-${platform}`);
  const token = input?.value.trim();
  if (!token) return toast('Paste your access token first', 'warning');

  const btn = input.nextElementSibling;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Connecting…';

  try {
    const result = await api('POST', `/auth/manual-token/${platform}`, { access_token: token });
    toast(`${PLATFORMS[platform]?.label || platform} connected${result.instagram_detected ? ', and Instagram too' : ''}.`, 'success');
    input.value = '';
    await refreshStatus();
    loadSettings();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect with token';
  }
}

async function savePlatformCredentials(platform) {
  const panel = document.querySelector(`#pcard-${platform}`);
  if (!panel) return;
  const body = {};
  panel.querySelectorAll('input[id^="cred-"]').forEach(input => {
    const key = input.id.replace(`cred-${platform}-`, '');
    const val = input.value.trim();
    if (val && !input.readOnly) body[key] = val;
  });
  if (!Object.keys(body).length) return toast('Paste the details first', 'warning');
  try {
    await api('POST', `/api/config/platforms/${platform}`, body);
    toast(`Saved. Now click Connect on ${PLATFORMS[platform]?.label || platform}.`, 'success');
    loadSettings();
  } catch (err) { toast(err.message, 'error'); }
}

function togglePasswordVisibility(inputId) {
  const el = document.getElementById(inputId);
  if (el) el.type = el.type === 'password' ? 'text' : 'password';
}

async function loadFBPages() {
  const container = document.getElementById('fb-page-selector');
  container.style.display = 'block';
  container.innerHTML = '<div class="form-hint"><span class="spinner"></span> Loading your Pages…</div>';
  try {
    const pages = await api('GET', '/api/config/facebook/pages');
    if (!pages.length) { container.innerHTML = '<div class="form-hint">No Pages found. Make sure you are an admin of a Facebook Page, then click Check.</div>'; return; }
    container.innerHTML = `<div class="form-hint">Which Page should Social-Nexus post to?</div>
      <div class="choice-list">
        ${pages.map(pg => `
          <button class="btn btn-secondary btn-sm" onclick="setFBPage(${jsAttr(pg.id)},${jsAttr(pg.name)})">${escapeHtml(pg.name)}</button>`).join('')}
      </div>`;
  } catch (err) { container.innerHTML = `<div class="state-error">${escapeHtml(err.message)}</div>`; }
}

async function setFBPage(id, name) {
  try {
    const result = await api('POST', '/api/config/facebook/set-page', { page_id: id });
    const msg = result.instagram_connected ? `Posting to “${name}”, and its Instagram account is connected too.`
      : result.instagram_detected ? `Posting to “${name}”. To post to its Instagram as well, click Connect on the Instagram card.`
      : `Posting to “${name}”.`;
    toast(msg, 'success');
    document.getElementById('fb-page-selector').style.display = 'none';
    loadSettings();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadPinterestBoards() {
  const container = document.getElementById('pinterest-board-selector');
  container.style.display = 'block';
  container.innerHTML = '<div class="form-hint"><span class="spinner"></span> Loading boards…</div>';
  try {
    const boards = await api('GET', '/api/config/pinterest/boards');
    if (!boards.length) { container.innerHTML = '<div class="form-hint">No boards found. Create a board on Pinterest first.</div>'; return; }
    container.innerHTML = `<div class="form-hint">Which board should pins go to?</div>
      <div class="choice-list">
        ${boards.map(b => `
          <button class="btn btn-secondary btn-sm" onclick="setPinterestBoard(${jsAttr(b.id)},${jsAttr(b.name)})">${escapeHtml(b.name)}</button>`).join('')}
      </div>`;
  } catch (err) { container.innerHTML = `<div class="state-error">${escapeHtml(err.message)}</div>`; }
}

async function loadGoogleLocations() {
  const container = document.getElementById('gbp-location-selector');
  container.style.display = 'block';
  container.innerHTML = '<div class="form-hint"><span class="spinner"></span> Loading your locations…</div>';
  try {
    const list = await api('GET', '/api/config/google-business/locations');
    if (!list.length) { container.innerHTML = '<div class="form-hint">This Google account doesn’t manage any Business Profile location.</div>'; return; }
    container.innerHTML = `<div class="form-hint">Which location should posts go to?</div>
      <div class="choice-list">
        ${list.map(l => `
          <button class="btn btn-${l.chosen ? 'primary' : 'secondary'} btn-sm" style="text-align:left" onclick="setGoogleLocation(${jsAttr(l.account)},${jsAttr(l.location)})">
            ${escapeHtml(l.title)}${l.address ? `<br><span style="font-weight:400;font-size:11px">${escapeHtml(l.address)}</span>` : ''}</button>`).join('')}
      </div>`;
  } catch (err) { container.innerHTML = `<div class="state-error">${escapeHtml(err.message)}</div>`; }
}

async function setGoogleLocation(account, location) {
  try {
    const r = await api('POST', '/api/config/google-business/set-location', { account, location });
    toast(`Google Business posts will go to “${r.title}”.`, 'success');
    loadSettings();
  } catch (err) { toast(err.message, 'error'); }
}

async function setPinterestBoard(id, name) {
  try {
    await api('POST', '/api/config/pinterest/set-board', { board_id: id, board_name: name });
    toast(`Pins will go to “${name}”.`, 'success');
    document.getElementById('pinterest-board-selector').style.display = 'none';
    loadSettings();
  } catch (err) { toast(err.message, 'error'); }
}

// ── AI status ────────────────────────────────────────────────────────────────

// Which AI will write posts for this person, in one line
async function refreshAiStatus() {
  const card = document.getElementById('ai-status-card');
  try {
    const [keys, ollama] = await Promise.all([
      api('GET', '/users/settings').catch(() => ({})),
      api('GET', '/api/config/ollama/status').catch(() => ({ running: false })),
    ]);
    const names = { google_ai_key: 'Google Gemini', groq_key: 'Groq', openrouter_key: 'OpenRouter', mistral_key: 'Mistral', anthropic_key: 'Claude' };
    const online = Object.entries(names).filter(([k]) => keys[k]).map(([, n]) => n);
    // Server edition: keys the business shares with the team count too
    if (State.server) {
      const biz = await api('GET', '/api/config/business-ai').catch(() => ({}));
      for (const [k, n] of Object.entries(names)) if (biz[k] && !online.includes(n)) online.push(n);
    }
    // Admins also use the shared keys of this installation
    if (State.user?.role === 'admin' || State.user?.role === 'superadmin' || State.user?.is_super_admin) {
      const env = await api('GET', '/api/config/env-status').catch(() => ({}));
      if (env.google_ai && !online.includes('Google Gemini')) online.push('Google Gemini');
      if (env.anthropic && !online.includes('Claude')) online.push('Claude');
    }
    const localReady = ollama.running && ollama.enabled && (ollama.models || []).length > 0;
    const ready = localReady || online.length > 0;
    State.aiReady = ready;
    if (card) {
      card.className = `ai-status-card ${ready ? 'ok' : 'warn'}`;
      card.innerHTML = ready
        ? `<span class="status-dot-sm ok"></span><span><b>AI is ready.</b> ${[localReady ? `Local AI (${escapeHtml(ollama.current || '')})` : '', ...online.map(escapeHtml)].filter(Boolean).join(', ')}</span>`
        : `<span class="status-dot-sm warn"></span><span><b>AI isn't set up yet.</b> The quickest way: get a free Google Gemini key and paste it below.</span>`;
    }
    updateSettingsNavStatus();
  } catch { /* status only */ }
}

// Server edition: AI keys shared by everyone in the business
const BIZ_AI_FIELDS = { 'biz-google-key': 'google_ai_key', 'biz-groq-key': 'groq_key', 'biz-openrouter-key': 'openrouter_key', 'biz-anthropic-key': 'anthropic_key' };
async function loadBusinessAi() {
  const sec = document.getElementById('biz-ai-section');
  const local = document.getElementById('ai-sec-local');
  if (!sec) return;
  sec.hidden = !State.server;
  // Local AI runs on the user's own PC: not part of the hosted edition
  if (local) local.hidden = !!State.server;
  if (!State.server) return;
  try {
    const s = await api('GET', '/api/config/business-ai');
    for (const [id, key] of Object.entries(BIZ_AI_FIELDS)) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.value = '';
      el.disabled = !s.can_manage;
      if (!el.dataset.ph) el.dataset.ph = el.placeholder;
      el.placeholder = s[key] ? 'Saved — leave empty to keep it' : (s.can_manage ? el.dataset.ph : 'Not set');
    }
    const actions = document.getElementById('biz-ai-actions');
    if (actions) actions.hidden = !s.can_manage;
    if (!s.can_manage) setEl('biz-ai-sub', 'Keys your business shares with the team. Only the owner or a manager can change them; you can still add your own below.');
  } catch { sec.hidden = true; }
}

async function saveBusinessAiKeys(btn) {
  const body = {};
  for (const [id, key] of Object.entries(BIZ_AI_FIELDS)) {
    const v = document.getElementById(id)?.value.trim();
    if (v) body[key] = v;
  }
  if (!Object.keys(body).length) return toast('Paste at least one key to save', 'warning');
  if (btn) btn.disabled = true;
  try {
    await api('POST', '/api/config/business-ai', body);
    toast('Saved for everyone in your business', 'success');
    loadBusinessAi();
    refreshAiStatus();
    if (typeof loadModels === 'function') loadModels();
  } catch (err) { toast(err.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

async function saveDefaultModelSetting() {
  const model = document.getElementById('setting-default-model')?.value;
  if (!model) return;
  try {
    await api('POST', '/api/config/ai-keys', { DEFAULT_TEXT_MODEL: model });
    toast('Saved', 'success');
    loadModels();
  } catch (err) { toast(err.message, 'error'); }
}

async function saveContentFolder() {
  const folder = document.getElementById('setting-content-folder')?.value.trim();
  if (!folder) return toast('Type a folder, for example D:/social', 'warning');
  try {
    await api('POST', '/api/config/content-folder', { folder });
    toast(`Folder set to ${folder}`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function loadContentFolderSetting() {
  try {
    const data = await api('GET', '/api/config/content-folder');
    const el = document.getElementById('setting-content-folder');
    if (el) el.value = data.folder || '';
  } catch {}
}

// ── Email sending (SMTP) ─────────────────────────────────────────────────────

async function loadSMTPSettings() {
  if (State.server) setEl('smtp-panel-desc', 'Needed only for the Email and Sales outreach screens. These settings are for your whole business: emails go from this address for everyone on your team.');
  try {
    const s = await api('GET', '/api/config/smtp');
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
    set('smtp-host', s.SMTP_HOST); set('smtp-port', s.SMTP_PORT); set('smtp-user', s.SMTP_USER);
    set('smtp-from', s.SMTP_FROM); set('smtp-from-name', s.SMTP_FROM_NAME);
    const pass = document.getElementById('smtp-pass');
    if (pass) { pass.value = ''; pass.placeholder = s.pass_set ? 'Saved — leave empty to keep it' : 'App password'; }
    State.smtpReady = !!s.configured;
    updateSettingsNavStatus();
  } catch (err) {
    // Server edition: only the owner or a manager may see and change these
    if (State.server) {
      const note = document.getElementById('smtp-manager-note');
      if (note) note.hidden = false;
      document.querySelectorAll('#settings-panel-smtp input, #settings-panel-smtp .settings-actions button').forEach(el => { el.disabled = true; });
    }
  }
}

async function saveSMTPSettings(btn) {
  const val = id => document.getElementById(id).value.trim();
  const user = val('smtp-user');
  if (!user || !val('smtp-host')) return toast('Fill in your email address and the mail server', 'warning');
  if (btn) btn.disabled = true;
  try {
    await api('POST', '/api/config/smtp', {
      SMTP_HOST: val('smtp-host'), SMTP_PORT: val('smtp-port') || '587', SMTP_USER: user,
      SMTP_PASS: document.getElementById('smtp-pass').value, // spaces can be part of an app password
      SMTP_FROM: val('smtp-from') || user, SMTP_FROM_NAME: val('smtp-from-name'),
    });
    toast('Email settings saved', 'success');
    loadSMTPSettings();
  } catch (err) { toast(err.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

// ── My account & app ─────────────────────────────────────────────────────────

async function loadAccountPanel() {
  const u = State.user || {};
  const roleLabel = (u.is_super_admin || u.role === 'superadmin') ? ' · Super Admin' : (u.role === 'admin' ? ' · admin of this installation' : '');
  setEl('account-signed-in', u.email ? `${u.name ? `${u.name} · ` : ''}${u.email}${roleLabel}` : '—');
  try {
    const h = await fetch('/__health').then(r => r.json());
    setEl('app-version-badge', h.version ? `v${h.version}` : '—');
  } catch {}
}

// ── Status dots in the Settings list and the sidebar ─────────────────────────

function updateSettingsNavStatus() {
  const dot = (id, tone, title) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `status-dot-sm ${tone || ''}`;
    el.title = title || '';
  };
  const pc = State.platformConfig;
  if (pc) {
    const groups = PLATFORM_ORDER.filter(k => pc[k]).map(k => platformState(k, pc[k]).group);
    const attention = groups.includes('attention');
    const any = groups.includes('connected') || attention;
    dot('snav-status-platforms', attention ? 'warn' : any ? 'ok' : 'off', attention ? 'An account needs signing in again' : any ? 'Connected' : 'Nothing connected yet');
  }
  if (State.aiReady !== undefined) dot('snav-status-ai', State.aiReady ? 'ok' : 'warn', State.aiReady ? 'AI is ready' : 'AI is not set up');
  if (State.smtpReady !== undefined) dot('snav-status-smtp', State.smtpReady ? 'ok' : 'off', State.smtpReady ? 'Set up' : 'Not set up');
  const lic = State.license;
  if (lic) dot('snav-status-license', lic.can_publish ? 'ok' : 'warn', lic.can_publish ? 'Active' : 'Not active');
}

async function triggerPlatformConnection(platform, evt) {
  const btn = evt?.currentTarget || (evt?.target?.tagName === 'BUTTON' ? evt.target : null);
  const origHtml = btn ? btn.innerHTML : 'Check';
  const name = PLATFORMS[platform]?.label || platform;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Checking…'; }

  try {
    const res = await api('POST', `/auth/refresh/${platform}`);
    if (res.connected) {
      toast(`${name} is working.`, 'success');
      await refreshStatus();
      loadSettings();
    } else if (res.oauth_url) {
      toast(`Opening ${name} sign-in…`, 'info');
      window.location.href = res.oauth_url;
    }
  } catch (err) {
    if (await askConfirm(`${name} needs signing in again. ${err.message}\n\nSign in now?`, 'Sign in')) {
      // Same way in as the card's Connect button
      const p = State.platformConfig?.[platform] || {};
      if ((State.oneClick || []).includes(platform)) connectOneClick(platform, btn);
      else if (p.kind === 'app_password') { loadSettings(); toast('Enter your handle and app password on the card, then click Reconnect.', 'info'); }
      else window.location.href = p.oauth_url || `/auth/${platform}`;
    } else {
      loadSettings();
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

// Confirm dialog (falls back to the browser's when the app dialog isn't loaded)
async function askConfirm(message, okLabel = 'OK') {
  if (typeof window.confirmDialog === 'function') return window.confirmDialog(message, okLabel);
  return confirm(message);
}

async function disconnect(platform) {
  const name = PLATFORMS[platform]?.label || platform;
  const extra = platform === 'facebook' ? ' Instagram (connected through Facebook) is disconnected too.' : '';
  if (!(await askConfirm(`Disconnect ${name}? Scheduled posts to it won't go out until you connect it again.${extra}`, 'Disconnect'))) return;
  try {
    await api('POST', `/auth/disconnect/${platform}`);
    toast(`${name} disconnected`, 'info');
    await refreshStatus();
    loadSettings();
  } catch (err) { toast(err.message, 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// Escapes text for HTML content AND attribute values (quotes included).
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A value passed as an argument inside an inline handler, e.g.
//   onclick="switchWorkspace(${id}, ${jsAttr(name)})"
// JSON-encodes it (a valid JS literal) and then HTML-escapes it for the attribute,
// so names like "Priya's Workspace" or text with quotes can't break the handler.
function jsAttr(value) {
  return escapeHtml(JSON.stringify(value === undefined ? null : value));
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60) return 'just now';
  const intervals = { yr: 31536000, mo: 2592000, d: 86400, h: 3600, m: 60 };
  for (const [unit, secs] of Object.entries(intervals)) {
    const val = Math.floor(seconds / secs);
    if (val >= 1) return `${val}${unit} ago`;
  }
  return 'just now';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function updateCharCount(elId, len) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = `${len} characters`;
  el.className = 'char-count' + (len > 3000 ? ' danger' : len > 2000 ? ' warning' : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Dashboard
// ─────────────────────────────────────────────────────────────────────────────

function switchAdminTab(tab, btn) {
  document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`admin-panel-${tab}`).style.display = '';
  document.querySelectorAll('.admin-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
  if (tab === 'businesses') loadAdminBusinesses();
  if (tab === 'users')    loadAdminUsers();
  if (tab === 'invites')  loadInviteCodes();
  if (tab === 'activity') loadAdminActivity();
  if (tab === 'config')   loadAdminConfig();
  if (tab === 'platform-ai') loadPlatformAiKeys();
}

async function loadAdminDashboard() {
  // Show Subscriptions tab for superadmin/admin or server edition
  const bizTab = document.getElementById('admin-tab-businesses');
  if (bizTab) {
    const canSeeSubs = State.server || State.user?.is_super_admin || State.user?.role === 'superadmin' || State.user?.role === 'admin';
    bizTab.hidden = !canSeeSubs;
  }
  // Platform-default AI keys: Super Admin only, and only meaningful on the server edition
  const paTab = document.getElementById('admin-tab-platform-ai');
  if (paTab) {
    const isSuper = State.user?.is_super_admin || State.user?.role === 'superadmin';
    paTab.hidden = !(isSuper && State.server);
  }
  try {
    const stats = await fetch('/admin/stats').then(r => r.json());
    setEl('adm-total-users', stats.total_users);
    setEl('adm-active-users', stats.active_users);
    setEl('adm-total-posts', stats.total_posts);
    setEl('adm-total-ai', stats.total_ai_gen);
    setEl('adm-scheduled', stats.scheduled_posts);
    const badge = document.getElementById('admin-users-badge');
    if (badge) badge.textContent = stats.total_users;
  } catch {}
}

async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px"><span class="spinner"></span></td></tr>';
  try {
    const users = await fetch('/admin/users').then(r => r.json());
    const viewerIsSuper = !!(State.user?.is_super_admin || State.user?.role === 'superadmin');
    const myId = State.user?.id;

    tbody.innerHTML = users.map(u => {
      const isSuper = !!(u.is_super_admin || u.role === 'superadmin');
      const isAdmin = u.role === 'admin';
      const isMe = u.id === myId;

      let roleBadge = '';
      if (isSuper) {
        roleBadge = '<span class="badge" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-weight:600">⚡ Super Admin</span>';
      } else if (isAdmin) {
        roleBadge = '<span class="badge badge-purple">👑 Admin</span>';
      } else {
        roleBadge = '<span class="badge badge-blue">👤 User</span>';
      }

      let actionsHtml = '';
      if (isMe) {
        actionsHtml = `<span class="badge badge-gray" style="font-size:11px;padding:4px 8px">You</span>
          <button class="btn btn-secondary btn-sm btn-icon" onclick="adminResetPassword(${u.id},${jsAttr(u.email)})" title="Change Password">🔑</button>`;
      } else {
        const roleBtns = [];
        if (viewerIsSuper) {
          if (isSuper) {
            roleBtns.push(`<button class="btn btn-secondary btn-sm" onclick="demoteSuperAdmin(${u.id},${jsAttr(u.email)})" title="Demote to Admin" style="font-size:11px">👑 Make Admin</button>`);
          } else if (isAdmin) {
            roleBtns.push(`<button class="btn btn-secondary btn-sm" onclick="makeSuperAdmin(${u.id},${jsAttr(u.email)})" title="Promote to Super Admin" style="font-size:11px;color:#d97706;border-color:#f59e0b">⚡ Super Admin</button>`);
            roleBtns.push(`<button class="btn btn-secondary btn-sm" onclick="removeAdmin(${u.id},${jsAttr(u.email)})" title="Demote to User" style="font-size:11px">👤 Make User</button>`);
          } else {
            roleBtns.push(`<button class="btn btn-secondary btn-sm" onclick="makeAdmin(${u.id},${jsAttr(u.email)})" title="Promote to Admin" style="font-size:11px">👑 Make Admin</button>`);
            roleBtns.push(`<button class="btn btn-secondary btn-sm" onclick="makeSuperAdmin(${u.id},${jsAttr(u.email)})" title="Promote to Super Admin" style="font-size:11px;color:#d97706;border-color:#f59e0b">⚡ Super Admin</button>`);
          }
        }

        const canSuspendOrDelete = viewerIsSuper ? !isSuper : (!isSuper && !isAdmin);

        actionsHtml = `
          <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
            ${roleBtns.join('')}
            ${canSuspendOrDelete ? (u.status !== 'suspended'
              ? `<button class="btn btn-secondary btn-sm" onclick="suspendUser(${u.id})" title="Suspend">🚫</button>`
              : `<button class="btn btn-success btn-sm" onclick="activateUser(${u.id})" title="Activate">✅</button>`) : ''}
            <button class="btn btn-secondary btn-sm btn-icon" onclick="adminResetPassword(${u.id},${jsAttr(u.email)})" title="Reset Password">🔑</button>
            ${canSuspendOrDelete ? `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteUser(${u.id},${jsAttr(u.email)})" title="Delete">🗑</button>` : ''}
          </div>
        `;
      }

      return `
        <tr>
          <td>
            <div style="font-weight:600;font-size:13px">${escapeHtml(u.name || u.email.split('@')[0])}</div>
            <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(u.email)}</div>
          </td>
          <td>${roleBadge}</td>
          <td><span class="badge badge-${u.status==='suspended'?'red':'green'}">${u.status||'active'}</span></td>
          <td>${u.posts || 0}</td>
          <td>${u.ai_generations || 0}</td>
          <td>${u.platforms_connected || 0}</td>
          <td style="font-size:11px">${new Date(u.created_at * 1000).toLocaleDateString()}</td>
          <td style="font-size:11px">${u.last_active ? timeAgo(new Date(u.last_active * 1000)) : 'Never'}</td>
          <td>${actionsHtml}</td>
        </tr>`;
    }).join('');
  } catch (err) { tbody.innerHTML = `<tr><td colspan="9" style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</td></tr>`; }
}

async function adminCreateUser() {
  const email    = document.getElementById('new-user-email')?.value.trim();
  const password = document.getElementById('new-user-password')?.value;
  const name     = document.getElementById('new-user-name')?.value.trim();
  const role     = document.getElementById('new-user-role')?.value;
  if (!email || !password) return toast('Email and password are required', 'warning');
  try {
    await api('POST', '/admin/users/create', { email, password, name, role });
    toast(`✅ User created: ${email} (${role})`, 'success');
    document.getElementById('new-user-email').value    = '';
    document.getElementById('new-user-password').value = '';
    document.getElementById('new-user-name').value     = '';
    loadAdminUsers(); loadAdminDashboard();
  } catch (err) { toast(err.message, 'error'); }
}

async function adminResetPassword(id, email) {
  const pwd = await askText({ title: 'Reset password', message: `New password for ${email} (at least 6 characters):`, password: true, confirmTwice: true });
  if (!pwd) return;
  if (pwd.length < 6) return toast('Password must be at least 6 characters', 'warning');
  try {
    await api('PATCH', `/admin/users/${id}/password`, { password: pwd });
    toast(`Password reset for ${email}`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// Each action reports the server's answer (e.g. "you can't remove your own admin
// role") instead of always saying it worked.
async function adminUserAction(method, path, body, okMsg, okType = 'success') {
  try {
    await api(method, path, body);
    toast(okMsg, okType);
  } catch (err) { toast(err.message, 'error'); }
  loadAdminUsers();
  loadAdminDashboard();
}
function makeSuperAdmin(id, email) {
  return adminUserAction('PATCH', `/admin/users/${id}/role`, { role: 'superadmin' }, `⚡ ${email || 'User'} promoted to Super Admin!`);
}
function demoteSuperAdmin(id, email) {
  return adminUserAction('PATCH', `/admin/users/${id}/role`, { role: 'admin' }, `👑 ${email || 'User'} role changed to Admin`);
}
function makeAdmin(id, email)    { return adminUserAction('PATCH', `/admin/users/${id}/role`, { role: 'admin' }, `👑 ${email || 'User'} is now an Admin`); }
function removeAdmin(id, email)  { return adminUserAction('PATCH', `/admin/users/${id}/role`, { role: 'user' }, `👤 ${email || 'User'} demoted to User`, 'info'); }
async function suspendUser(id) {
  if (!(await askConfirm('Suspend this user? They can’t sign in until you activate them again.', 'Suspend'))) return;
  return adminUserAction('PATCH', `/admin/users/${id}/status`, { status: 'suspended' }, 'User suspended', 'warning');
}
function activateUser(id) { return adminUserAction('PATCH', `/admin/users/${id}/status`, { status: 'active' }, 'User activated'); }
async function deleteUser(id, email) {
  if (!(await askConfirm(`Permanently delete ${email} and all their data? This can’t be undone.`, 'Delete'))) return;
  return adminUserAction('DELETE', `/admin/users/${id}`, null, `${email} deleted`, 'info');
}

async function generateInviteCode() {
  const note     = document.getElementById('inv-note').value.trim();
  const expires  = parseInt(document.getElementById('inv-expires').value) || null;
  const maxUses  = parseInt(document.getElementById('inv-max-uses').value) || 1;
  const resultEl = document.getElementById('new-invite-result');

  try {
    const data = await api('POST', '/admin/invite-codes', { note, expires_hours: expires, max_uses: maxUses });

    const shareUrl = `${window.location.origin}/login.html?invite=${data.code}`;
    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:12px">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Invite code generated:</div>
        <div style="font-size:22px;font-weight:900;letter-spacing:4px;color:#a78bfa;font-family:monospace">${data.code}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px;word-break:break-all">${shareUrl}</div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(data.code)});toast('Code copied!','success')">📋 Copy Code</button>
          <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(shareUrl)});toast('Link copied!','success')">🔗 Copy Link</button>
        </div>
      </div>`;
    document.getElementById('inv-note').value = '';
    loadInviteCodes();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadInviteCodes() {
  const list = document.getElementById('invite-codes-list');
  if (!list) return;
  try {
    const codes = await fetch('/admin/invite-codes').then(r => r.json());
    if (!codes.length) { list.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon">🎟️</div><div class="empty-title">No invite codes</div></div>'; return; }
    const now = Math.floor(Date.now() / 1000);
    list.innerHTML = codes.map(c => {
      const expired   = c.expires_at && c.expires_at < now;
      const exhausted = c.use_count >= c.max_uses;
      const status    = expired ? 'Expired' : exhausted ? 'Used' : 'Active';
      const badgeCls  = expired || exhausted ? 'badge-red' : 'badge-green';
      return `
        <div class="scheduled-item">
          <div class="scheduled-content">
            <div style="font-size:16px;font-weight:900;letter-spacing:3px;color:#a78bfa;font-family:monospace">${escapeHtml(c.code)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
              By ${escapeHtml(c.creator_email)} · ${c.use_count}/${c.max_uses} uses ·
              ${c.expires_at ? `Expires ${new Date(c.expires_at*1000).toLocaleDateString()}` : 'Never expires'}
              ${c.used_by_email ? ` · Used by ${escapeHtml(c.used_by_email)}` : ''}
            </div>
            ${c.note ? `<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(c.note)}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="badge ${badgeCls}">${status}</span>
            <button class="btn btn-secondary btn-sm btn-icon" onclick="navigator.clipboard.writeText(${jsAttr(c.code)});toast('Copied!','success')" title="Copy">📋</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="revokeInvite(${c.id})" title="Revoke">🗑</button>
          </div>
        </div>`;
    }).join('');
  } catch {}
}

async function revokeInvite(id) {
  try {
    await api('DELETE', `/admin/invite-codes/${id}`);
    toast('Invite code revoked', 'info');
  } catch (err) { toast(err.message, 'error'); }
  loadInviteCodes();
}

async function loadAdminActivity() {
  const list = document.getElementById('admin-activity-list');
  if (!list) return;
  try {
    const posts = await fetch('/admin/activity').then(r => r.json());
    if (!posts.length) { list.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon">📭</div><div class="empty-title">No activity yet</div></div>'; return; }
    list.innerHTML = posts.map(p => `
      <div class="activity-item">
        <div class="activity-icon">📤</div>
        <div class="activity-text">
          <div class="activity-title">${escapeHtml((p.content||'').substring(0,80))}…</div>
          <div class="activity-meta">
            <span class="badge badge-blue">${escapeHtml(p.email||'unknown')}</span>
            ${(p.platforms||[]).map(pl => `<span class="tag">${PLATFORMS[pl]?.icon||''} ${pl}</span>`).join('')}
          </div>
        </div>
        <div class="activity-time">${timeAgo(new Date(p.created_at*1000))}</div>
      </div>`).join('');
  } catch {}
}

async function loadAdminConfig() {
  try {
    const config = await fetch('/admin/config').then(r => r.json());
    const modeEl = document.getElementById('admin-reg-mode');
    const nameEl = document.getElementById('admin-app-name');
    if (modeEl) modeEl.value = config.registration_mode || 'open';
    if (nameEl) nameEl.value = config.app_name || 'Social-Nexus';
  } catch {}
}

async function saveAdminConfig() {
  try {
    await api('POST', '/admin/config', {
      registration_mode: document.getElementById('admin-reg-mode').value,
      app_name:          document.getElementById('admin-app-name').value,
    });
    toast('Saved', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// ── Platform-default AI keys (Super Admin) ───────────────────────────────────

const PLATFORM_AI_FIELDS = {
  'pa-google-key':     'platform_google_ai_key',
  'pa-groq-key':       'platform_groq_key',
  'pa-openrouter-key': 'platform_openrouter_key',
  'pa-mistral-key':    'platform_mistral_key',
  'pa-anthropic-key':  'platform_anthropic_key',
};

async function loadPlatformAiKeys() {
  try {
    const { keys } = await api('GET', '/admin/platform-ai');
    for (const [id, key] of Object.entries(PLATFORM_AI_FIELDS)) {
      const el = document.getElementById(id);
      if (!el) continue;
      // Show a masked placeholder when a key is already saved, so the admin knows
      el.value = '';
      el.placeholder = keys?.[key] ? '•••••••• (saved — leave blank to keep)' : el.placeholder;
    }
  } catch (err) { toast(err.message, 'error'); }
}

async function savePlatformAiKeys(btn) {
  const body = {};
  for (const [id, key] of Object.entries(PLATFORM_AI_FIELDS)) {
    const v = document.getElementById(id)?.value.trim();
    if (v) body[key] = v;
  }
  if (!Object.keys(body).length) { toast('Nothing to save — paste a key first.', 'info'); return; }
  if (btn) { btn.disabled = true; btn.dataset._t = btn.textContent; btn.textContent = 'Saving…'; }
  try {
    await api('POST', '/admin/platform-ai', body);
    toast('Platform AI keys saved', 'success');
    loadPlatformAiKeys();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset._t || '💾 Save platform keys'; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme (Light / Dark)
// ─────────────────────────────────────────────────────────────────────────────

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('nexus_theme', isLight ? 'light' : 'dark');
  const btn = document.getElementById('btn-theme');
  document.getElementById('theme-icon')?.querySelector('use')?.setAttribute('href', `icons/sprite.svg#i-${isLight ? 'sun' : 'moon'}`);
  if (btn) btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
}

function initTheme() {
  const saved = localStorage.getItem('nexus_theme');
  if (saved !== 'dark') {
    document.body.classList.add('light-mode');
    const btn = document.getElementById('btn-theme');
    document.getElementById('theme-icon')?.querySelector('use')?.setAttribute('href', 'icons/sprite.svg#i-sun');
    if (btn) btn.title = 'Switch to dark mode';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL Param Handling (OAuth callbacks)
// ─────────────────────────────────────────────────────────────────────────────

function handleURLParams() {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  const error = params.get('error');

  if (connected === 'google_business' && params.get('gbp_missing')) {
    const why = params.get('gbp_missing');
    toast(why === '1' ? 'Google is connected, but this Google account doesn’t manage any Business Profile location.' : `Google is connected, but its Business Profiles couldn’t be read: ${why}`, 'warning', 15000);
    openSettings('platforms');
    window.history.replaceState({}, '', '/');
    return;
  }
  if (connected === 'google_business' && params.get('select_location')) {
    toast('Google Business is connected. You manage several locations: choose one on the Google Business card.', 'info', 10000);
    openSettings('platforms');
    window.history.replaceState({}, '', '/');
    return;
  }
  if (connected) {
    toast(`${PLATFORMS[connected]?.label || connected} is connected.`, 'success');
    openSettings('platforms'); // show the result where the user started
    if (connected === 'facebook' && params.get('select_page')) {
      toast(params.get('instagram')
        ? 'You manage several Facebook Pages — choose the one linked to your Instagram in Settings → Connected accounts → Choose Facebook Page. Instagram connects when you pick it.'
        : 'You manage several Facebook Pages — choose which one Social-Nexus posts to in Settings → Connected accounts → Choose Facebook Page.', 'info', 9000);
    }
    window.history.replaceState({}, '', '/');
  }

  if (error) {
    const msgs = {
      linkedin_denied: 'LinkedIn authorization was denied',
      linkedin_failed: 'LinkedIn connection failed — check your app credentials',
      facebook_denied: 'Facebook authorization was denied',
      facebook_failed: 'Facebook connection failed — check your app credentials',
      pinterest_denied: 'Pinterest authorization was denied',
      pinterest_failed: 'Pinterest connection failed',
      twitter_denied: 'Twitter authorization was denied',
      twitter_failed: 'Twitter connection failed',
      google_denied: 'Google sign-in was cancelled',
      google_failed: 'Google connection failed — check the Client ID and secret on the Google Business card',
      oauth_state_invalid: 'Sign-in link expired or was not started from Social-Nexus — please try connecting again',
      not_available: 'Posting to this platform is not available yet in Social-Nexus.',
      instagram_not_found: 'Facebook is connected, but no Instagram account is linked to your Facebook Page. In Instagram, switch to a Business or Creator account and link it to the Page, then click Connect on the Instagram card again.',
    };
    if (error === 'not_configured') {
      const names = { linkedin: 'LinkedIn', facebook: 'Facebook', pinterest: 'Pinterest', twitter: 'Twitter/X', google: 'Google Business' };
      const name = names[params.get('platform')] || 'this platform';
      toast(`Before connecting ${name}, set it up first: open “Set up” on its card in Settings → Connected accounts.`, 'warning', 8000);
      openSettings('platforms');
      window.history.replaceState({}, '', '/');
      return;
    }
    toast(msgs[error] || `OAuth error: ${error}`, 'error', error === 'instagram_not_found' ? 12000 : 6000);
    window.history.replaceState({}, '', '/');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Selector
// ─────────────────────────────────────────────────────────────────────────────

const ModelState = {
  textModel:  null,   // selected text generation model
  imageModel: null,   // selected image model
  videoModel: null,   // selected video model
  available:  null,   // cached from /api/models
};

const PROVIDER_COLORS = {
  ollama:     'badge-purple',
  google:     'badge-blue',
  anthropic:  'badge-orange',
  stability:  'badge-green',
  openai:     'badge-green',
  luma:       'badge-blue',
  runway:     'badge-red',
};

const PROVIDER_ICONS = {
  ollama: '🦙', google: '✨', anthropic: '🤖',
  stability: '🎨', openai: '🖼️', luma: '🎬', runway: '🎥',
};

async function loadModels() {
  try {
    const data = await api('GET', '/api/models');
    ModelState.available = data;
    renderModelChips('gen-model-chips', data.text,  'text',  model => {
      ModelState.textModel = model;
      const badge = document.getElementById('gen-active-model-badge');
      if (badge) badge.textContent = model ? model.label : '';
      const desc = document.getElementById('gen-model-desc');
      if (desc) desc.textContent = model ? `Using ${model.label} (${model.provider})` : 'Select a model below';
    });
    renderModelChips('img-model-chips',  data.image, 'image', model => { ModelState.imageModel = model; });
    renderModelChips('vid-model-chips',  data.video, 'video', model => { ModelState.videoModel = model; });

    // Auto-select active or first available
    if (data.text?.length) {
      const activeModel = data.text.find(m => m.active);
      const currentId = ModelState.textModel?.id;
      const targetModel = activeModel || data.text[0];
      if (!ModelState.textModel || (activeModel && activeModel.id !== currentId)) {
        selectModel(targetModel, 'text');
      }
    }
    if (!ModelState.imageModel && data.image?.length) selectModel(data.image[0], 'image');
    if (!ModelState.videoModel && data.video?.length) selectModel(data.video[0], 'video');

    // Populate compose screen model dropdown if present
    const composeSel = document.getElementById('compose-ai-model-select');
    if (composeSel && data.text?.length) {
      const currentVal = composeSel.value;
      composeSel.innerHTML = '<option value="">Auto (Default preference)</option>' +
        data.text.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('');
      if (currentVal && data.text.some(m => m.id === currentVal)) {
        composeSel.value = currentVal;
      }
    }
  } catch {}
}

function renderModelChips(containerId, models, type, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!models?.length) {
    container.innerHTML = `<span style="font-size:11px;color:var(--text-muted)">No ${type} models configured — add API keys in Settings</span>`;
    return;
  }
  container.innerHTML = models.map((m) => {
    const colorClass = PROVIDER_COLORS[m.provider] || 'badge-purple';
    const icon = PROVIDER_ICONS[m.provider] || '🤖';
    const sizeText = m.size ? ` · ${(m.size/1e9).toFixed(1)}GB` : '';
    const isActive = m.active;
    const bg = isActive ? 'rgba(124,58,237,0.2)' : 'var(--glass)';
    const bc = isActive ? 'var(--accent-purple)' : 'var(--border)';
    const color = isActive ? '#a78bfa' : 'var(--text-secondary)';
    return `<button class="model-chip" data-model-id="${m.id}" onclick="selectModel(${jsAttr(m)}, '${type}')"
      style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:20px;border:1px solid ${bc};background:${bg};cursor:pointer;font-size:12px;font-weight:500;color:${color};transition:var(--transition)">
      ${icon} ${escapeHtml(m.label)}${sizeText}
    </button>`;
  }).join('');
}

function selectModel(model, type) {
  const barMap   = { text: 'gen-model-chips', image: 'img-model-chips', video: 'vid-model-chips' };
  const container = document.getElementById(barMap[type]);
  if (container) {
    container.querySelectorAll('.model-chip').forEach(c => {
      const isActive = c.dataset.modelId === model.id;
      c.style.background = isActive ? 'rgba(124,58,237,0.2)' : 'var(--glass)';
      c.style.borderColor = isActive ? 'var(--accent-purple)' : 'var(--border)';
      c.style.color       = isActive ? '#a78bfa' : 'var(--text-secondary)';
    });
  }

  if (type === 'text')  {
    ModelState.textModel = model;
    const badge = document.getElementById('gen-active-model-badge');
    if (badge) badge.textContent = model.label;
    const desc = document.getElementById('gen-model-desc');
    if (desc) desc.textContent = `Using ${model.label} · ${model.provider}`;
  }
  if (type === 'image') ModelState.imageModel = model;
  if (type === 'video') ModelState.videoModel = model;
}

// Show/hide video model bar when switching media tabs
const _origSwitchMediaTab = window.switchMediaTab;

// ── Server edition: businesses and their plans (Radixile admins) ────────────

function formatExpiryInfo(o) {
  const now = Math.floor(Date.now() / 1000);
  const DAY = 86400;
  if (o.plan === 'trial') {
    if (!o.trial_ends_at) return '<span style="color:var(--text-muted);font-size:11px">No trial date</span>';
    const left = Math.ceil((o.trial_ends_at - now) / DAY);
    const dateStr = new Date(o.trial_ends_at * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    if (left > 0) return `<div style="font-size:11px;color:#10b981;font-weight:600">⏳ ${left} days left</div><div style="font-size:10px;color:var(--text-muted)">Ends ${dateStr}</div>`;
    return `<div style="font-size:11px;color:#ef4444;font-weight:600">⚠️ Trial expired</div><div style="font-size:10px;color:var(--text-muted)">Ended ${dateStr}</div>`;
  }
  if (!o.paid_until) return '<span style="color:var(--text-muted);font-size:11px">Lifetime / No expiry</span>';
  const left = Math.ceil((o.paid_until - now) / DAY);
  const dateStr = new Date(o.paid_until * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (left > 0) return `<div style="font-size:11px;color:#10b981;font-weight:600">✅ Active (${left}d left)</div><div style="font-size:10px;color:var(--text-muted)">Until ${dateStr}</div>`;
  return `<div style="font-size:11px;color:#ef4444;font-weight:600">⚠️ Expired ${Math.abs(left)}d ago</div><div style="font-size:10px;color:var(--text-muted)">Ended ${dateStr}</div>`;
}

async function loadAdminBusinesses() {
  const box = document.getElementById('admin-businesses');
  if (!box) return;
  box.innerHTML = '<span class="spinner"></span>';
  try {
    const { organizations, plans } = await api('GET', '/admin/organizations');
    if (!organizations.length) { box.innerHTML = '<div class="form-hint">No businesses found.</div>'; return; }
    const day = (ts) => ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '';
    const n = (v) => (v === -1 || v === undefined ? '∞' : v);

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div class="form-hint">Manage client subscription tiers, extend subscription duration, and configure workspace quotas. Changes apply immediately.</div>
        <button class="btn btn-secondary btn-sm" onclick="loadAdminBusinesses()">🔄 Refresh Subscriptions</button>
      </div>
      <div style="overflow-x:auto">
        <table class="analytics-table">
          <thead>
            <tr>
              <th>Business &amp; Owner</th>
              <th>Subscription Status</th>
              <th>Plan Tier</th>
              <th>Status</th>
              <th>Paid Until</th>
              <th>Trial Ends</th>
              <th>Increase Duration</th>
              <th>Quotas</th>
              <th>Save</th>
            </tr>
          </thead>
          <tbody>
          ${organizations.map(o => `
            <tr>
              <td>
                <div style="font-weight:600;font-size:13px">${escapeHtml(o.name)}</div>
                <div class="form-hint">${escapeHtml(o.owner_email || 'No owner')} · ID #${o.id}</div>
              </td>
              <td>${formatExpiryInfo(o)}</td>
              <td>
                <select class="form-select" id="biz-plan-${o.id}" style="min-width:130px">
                  ${plans.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === o.plan ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
              </td>
              <td>
                <select class="form-select" id="biz-status-${o.id}" style="min-width:110px">
                  ${['', 'active', 'past_due', 'cancelled', 'suspended'].map(st => `<option value="${st}" ${st === (o.plan_status || '') ? 'selected' : ''}>${st || '—'}</option>`).join('')}
                </select>
              </td>
              <td><input type="date" class="form-input" id="biz-paid-${o.id}" value="${day(o.paid_until)}" style="min-width:130px" /></td>
              <td><input type="date" class="form-input" id="biz-trial-${o.id}" value="${day(o.trial_ends_at)}" style="min-width:130px" /></td>
              <td>
                <div style="display:flex;gap:4px;flex-wrap:wrap;min-width:180px">
                  <button class="btn btn-secondary btn-sm" onclick="quickExtendSubscription(${o.id}, 30, 'paid', ${jsAttr(o.name)})" title="Add 30 Days (1 Month) to Paid Subscription" style="font-size:11px;padding:3px 7px">+30d</button>
                  <button class="btn btn-secondary btn-sm" onclick="quickExtendSubscription(${o.id}, 90, 'paid', ${jsAttr(o.name)})" title="Add 90 Days (3 Months) to Paid Subscription" style="font-size:11px;padding:3px 7px">+90d</button>
                  <button class="btn btn-secondary btn-sm" onclick="quickExtendSubscription(${o.id}, 365, 'paid', ${jsAttr(o.name)})" title="Add 1 Year (365 Days) to Paid Subscription" style="font-size:11px;padding:3px 7px">+1 yr</button>
                  <button class="btn btn-secondary btn-sm" onclick="quickExtendSubscription(${o.id}, 14, 'trial', ${jsAttr(o.name)})" title="Add 14 Days Free Trial" style="font-size:11px;padding:3px 7px;color:#3b82f6">+14d Trial</button>
                  <button class="btn btn-secondary btn-sm" onclick="promptCustomExtend(${o.id}, ${jsAttr(o.name)})" title="Custom Days / Plan Duration Extension" style="font-size:11px;padding:3px 7px;color:#f59e0b">⏳ Custom...</button>
                </div>
              </td>
              <td class="form-hint" style="font-size:11px">
                ${n(o.usage.workspaces)}/${n(o.limits.workspaces)} ws<br>${n(o.usage.users)}/${n(o.limits.users)} users
              </td>
              <td>
                <button class="btn btn-primary btn-sm" onclick="saveBusinessPlan(${o.id}, this)">💾 Save</button>
              </td>
            </tr>
          `).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) { box.innerHTML = `<div class="state-error">${escapeHtml(err.message)}</div>`; }
}

async function quickExtendSubscription(id, days, target = 'paid', orgName = 'Business') {
  try {
    const res = await api('POST', `/admin/organizations/${id}/extend`, { days, target });
    toast(`✅ ${res.message || `Extended ${orgName} by +${days} days!`}`, 'success', 5000);
    loadAdminBusinesses();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function promptCustomExtend(id, orgName = 'Business') {
  const daysStr = await askText({
    title: `Increase Subscription Duration`,
    message: `Enter number of days to extend subscription for "${orgName}":`,
    value: '30',
    ok: 'Extend Subscription',
  });
  if (!daysStr) return;
  const days = parseInt(daysStr.trim(), 10);
  if (isNaN(days) || days <= 0) return toast('Please enter a valid positive number of days', 'warning');
  await quickExtendSubscription(id, days, 'paid', orgName);
}

async function saveBusinessPlan(id, btn) {
  btn.disabled = true;
  try {
    const v = (k) => document.getElementById(`biz-${k}-${id}`).value;
    const r = await api('PATCH', `/admin/organizations/${id}/plan`, {
      plan: v('plan'), plan_status: v('status') || null, paid_until: v('paid') || null, trial_ends_at: v('trial') || null,
    });
    toast(r.status.can_publish ? 'Saved. The business can publish.' : `Saved. ${r.status.message || 'Publishing is stopped for this business.'}`, r.status.can_publish ? 'success' : 'warning', 7000);
    loadAdminBusinesses();
  } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
}
