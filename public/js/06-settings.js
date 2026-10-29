// Social-Nexus app — Settings, help, admin, theme, sign-in returns, AI model picker.
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ❓ Help & User Guide (public/help.html; opens in its own window in the desktop app)
// ─────────────────────────────────────────────────────────────────────────────

// Help section for each screen (ids in public/help.html)
const HELP_TOPICS = {
  dashboard: 'tour', compose: 'write', generate: 'write', calendar: 'schedule', history: 'failed',
  templates: 'templates', brand: 'templates', hashtags: 'hashtags', utm: 'hashtags', seo: 'seo', aso: 'seo',
  adcopy: 'seo', media: 'ai-keys', email: 'email', clients: 'clients', analytics: 'tour', files: 'data',
  admin: 'team', 'tools-directory': 'ai-keys',
  // Settings tabs
  'settings:platforms': 'connect', 'settings:license': 'licence', 'settings:ai': 'ai-keys',
  'settings:smtp': 'email',
  'settings:members': 'team', 'settings:about': 'support',
};

function helpTopicForPage() {
  const page = document.querySelector('.page.active')?.id?.replace(/^page-/, '') || '';
  if (page === 'settings') {
    const panel = [...document.querySelectorAll('.settings-panel')].find(p => p.style.display !== 'none');
    const tab = panel?.id?.replace(/^settings-panel-/, '');
    if (tab && HELP_TOPICS[`settings:${tab}`]) return HELP_TOPICS[`settings:${tab}`];
  }
  return HELP_TOPICS[page] || '';
}

function openHelp(topic = '') {
  const url = `/help.html${topic ? `#${encodeURIComponent(topic)}` : ''}`;
  const win = window.open(url, 'social-nexus-help');
  if (!win) location.href = url; // pop-ups blocked: open it here instead
}

// F1 opens help for the current screen, like other Windows apps
document.addEventListener('keydown', (e) => {
  if (e.key === 'F1') { e.preventDefault(); openHelp(helpTopicForPage()); }
});

// Settings tabs that change things for everyone on this PC: only the admin can
// edit them. Others see a short note and read-only controls instead of a form
// that would only fail when saved.
const ADMIN_ONLY_TABS = {
  smtp: 'Email sending (SMTP) is set up once for everyone by the admin of this installation. Ask them if emails are not going out.',
  ai: 'Local AI and the default model are set up for everyone by the admin of this installation. You can still save your own API keys below — they are stored on your account only.',
};
function applyAdminOnly(tab) {
  const panel = document.getElementById(`settings-panel-${tab}`);
  if (!panel || !ADMIN_ONLY_TABS[tab]) return;
  const isAdmin = State.user?.role === 'admin';
  let note = panel.querySelector(':scope > .admin-note');
  if (!isAdmin && !note) {
    note = document.createElement('div');
    note.className = 'admin-note';
    note.textContent = '🔒 ' + ADMIN_ONLY_TABS[tab];
    panel.prepend(note);
  }
  if (isAdmin && note) note.remove();
  panel.querySelectorAll('input, select, textarea, button').forEach(el => {
    if (el.closest('.admin-note') || el.closest('.user-scoped') || el.classList.contains('admin-note-exempt')) return;
    if (!isAdmin) { el.dataset.adminLocked = '1'; el.disabled = true; }
    else if (el.dataset.adminLocked) { el.disabled = false; delete el.dataset.adminLocked; }
  });
}

function switchSettingsTab(tab, btn) {
  document.querySelectorAll('.settings-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`settings-panel-${tab}`).style.display = '';
  document.querySelectorAll('.settings-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  if (btn) { btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary'); }
  if (tab === 'members') loadMembers();
  if (tab === 'backups') loadBackups();
  applyAdminOnly(tab);
  if (tab === 'license') { if (State.license) renderLicensePanel(State.license); loadLicense(); }
}

async function loadSettings() {
  try {
    // Platforms Radixile offers one-click connect for (empty when offline)
    State.oneClick = await fetch('/auth/connect/platforms').then(r => r.json()).then(d => d.platforms || []).catch(() => []);
    const platforms = await api('GET', '/api/config/platforms');
    renderPlatformCards(platforms);
  } catch (err) {
    document.getElementById('platform-cards-container').innerHTML =
      `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
  }
  try {
    const envStatus = await api('GET', '/api/config/env-status');
    const el = document.getElementById('setting-default-model');
    if (el && envStatus.default_text_model) {
      el.value = envStatus.default_text_model;
    }
  } catch {}
  checkOllamaStatus();
  loadContentFolderSetting();
}

function renderPlatformCards(platforms) {
  const ORDER = ['linkedin','facebook','instagram','threads','pinterest','twitter','bluesky','google_business'];
  const container = document.getElementById('platform-cards-container');

  container.innerHTML = ORDER.map(key => {
    const p = platforms[key];
    if (!p) return '';

    const isConnected = p.connected;
    const isConfigured = p.configured;
    const profileName = p.profile?.name || p.profile?.id || '';
    const profilePic  = p.profile?.picture || null;
    const since       = p.since ? new Date(p.since * 1000).toLocaleDateString() : null;

    const days = p.reconnect_in_days;
    const statusBadge = isConnected
      ? (days != null && days <= 14
          ? `<span class="badge badge-orange" style="font-size:11px" title="${escapeHtml(PLATFORMS[key]?.label || key)} lets this login last a limited time. Click Connect before then so scheduled posts keep going out.">● Reconnect ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}</span>`
          : `<span class="badge badge-green" style="font-size:11px">● Connected</span>`)
      : p.needs_reconnect
        ? `<span class="badge badge-orange" style="font-size:11px" title="${escapeHtml(p.reconnect_reason || 'The saved sign-in can’t be used to post.')} Click Connect to sign in again.">● Sign in again</span>`
      : p.kind === 'oneclick' && !(State.oneClick || []).includes(key)
        ? `<span class="badge" style="font-size:11px">● Not available yet</span>`
      : isConfigured
        ? `<span class="badge badge-orange" style="font-size:11px">● Ready to Connect</span>`
        : State.user?.role === 'admin' ? `<span class="badge badge-red" style="font-size:11px">● Credentials Needed</span>` : `<span class="badge badge-orange" style="font-size:11px">● Waiting for admin</span>`;

    const profileHtml = isConnected ? `
      <div style="display:flex;align-items:center;gap:10px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;padding:10px 14px;margin-bottom:12px">
        ${profilePic ? `<img src="${escapeHtml(profilePic)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover" />` : `<div style="width:36px;height:36px;border-radius:50%;background:${escapeHtml(p.color)};display:flex;align-items:center;justify-content:center;font-size:18px">${p.icon}</div>`}
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(profileName)}</div>
          ${since ? `<div style="font-size:11px;color:var(--text-muted)">Connected ${since}</div>` : ''}
          ${p.page_id ? `<div style="font-size:11px;color:var(--text-muted)">Page ID: ${escapeHtml(p.page_id)}</div>` : ''}
          ${p.ig_account_id ? `<div style="font-size:11px;color:#e1306c">Instagram: ${escapeHtml(p.ig_account_id)}</div>` : ''}
          ${p.channel_id ? `<div style="font-size:11px;color:#ff0000">Channel: ${escapeHtml(p.channel_id)}</div>` : ''}
          ${p.board_id ? `<div style="font-size:11px;color:#e60023">Board: ${escapeHtml(p.board_id)}</div>` : ''}
        </div>
      </div>` : '';

    // App keys are shared by everyone on this PC, so only the admin enters them
    const isAdminUser = State.user?.role === 'admin';
    const credentialsHtml = !p.credentials?.length ? '' : !isAdminUser ? `
      <div class="admin-note">
        ${isConfigured
          ? `✅ Your admin has set up ${escapeHtml(p.label || key)}. Click <strong>Connect</strong> to link your own account.`
          : `🔒 Your admin needs to add the ${escapeHtml(p.label || key)} app keys first (Settings → Social Platforms). Then you can click <strong>Connect</strong> here.`}
      </div>` : p.credentials?.length ? `
      <details style="margin-bottom:12px" ${!isConfigured ? 'open' : ''}>
        <summary style="font-size:12px;font-weight:600;color:var(--text-secondary);cursor:pointer;padding:4px 0">
          🔑 API Credentials ${isConfigured ? '<span class="badge badge-green" style="font-size:10px">Saved</span>' : '<span class="badge badge-orange" style="font-size:10px">Required</span>'}
        </summary>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
          ${p.credentials.map(c => `
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">${escapeHtml(c.label)}</label>
              <div style="display:flex;gap:6px;margin-top:4px">
                <input type="${c.type === 'password' ? 'password' : 'text'}"
                  class="form-input" id="cred-${key}-${c.key}"
                  value="${escapeHtml(c.value)}"
                  placeholder="${c.readonly ? '' : `Enter ${escapeHtml(c.label)}…`}"
                  ${c.readonly ? 'readonly style="opacity:0.6;cursor:default"' : ''}
                  style="flex:1;font-size:13px" />
                ${c.type === 'password' && c.value ? `<button class="btn btn-secondary btn-sm btn-icon" onclick="togglePasswordVisibility('cred-${key}-${c.key}')" title="Show/hide">👁</button>` : ''}
              </div>
            </div>`).join('')}
          <button class="btn btn-primary btn-sm" onclick="savePlatformCredentials('${key}')" style="align-self:flex-start;margin-top:4px">
            💾 Save Credentials
          </button>
          ${p.setup_url ? `<a href="${escapeHtml(p.setup_url)}" target="_blank" class="btn btn-secondary btn-sm" style="align-self:flex-start">🔗 Get Credentials</a>` : ''}
          ${p.scopes ? `<div style="font-size:11px;color:var(--text-muted)">Required scopes: <code>${escapeHtml(p.scopes)}</code></div>` : ''}
        </div>
      </details>` : '';

    // Step-by-step guide (open by default until the platform is connected)
    const g = p.guide;
    const availBadge = !g ? '' : g.availability === 'unavailable'
      ? '<span class="badge badge-red" style="font-size:10px">Not available yet</span>'
      : g.availability === 'limited' ? '<span class="badge badge-orange" style="font-size:10px">Works with limits</span>' : '';
    const guideHtml = !g ? '' : `
      <details style="margin-bottom:12px" ${!isConnected && isAdminUser && g.availability !== 'unavailable' ? 'open' : ''}>
        <summary style="font-size:12px;font-weight:600;color:var(--text-secondary);cursor:pointer;padding:4px 0">
          📘 Setup guide ${g.time && g.time !== '—' ? `<span style="font-weight:400;color:var(--text-muted)">· ${escapeHtml(g.time)}</span>` : ''} ${availBadge}
        </summary>
        <div style="font-size:13px;margin-top:8px">
          <div style="color:var(--text-muted);margin-bottom:6px">You need: ${g.needs.map(n => escapeHtml(n)).join(' · ')}</div>
          <ol style="margin:0 0 0 18px;padding:0;display:flex;flex-direction:column;gap:6px">
            ${g.steps.map(st => `<li>${escapeHtml(st.text)}
              ${st.link ? ` <a href="${escapeHtml(st.link)}" target="_blank" rel="noopener" style="color:#60a5fa">Open ↗</a>` : ''}
              ${st.copy ? `<div style="display:flex;gap:6px;margin-top:4px"><code style="flex:1;padding:6px 8px;background:var(--glass);border-radius:6px;font-size:12px;word-break:break-all">${escapeHtml(st.copy)}</code><button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(st.copy)});toast('Copied — paste it into the developer portal','success')">📋 Copy</button></div>` : ''}
            </li>`).join('')}
          </ol>
          ${g.notes?.length ? `<div style="margin-top:8px;color:var(--text-muted);font-size:12px">${g.notes.map(n => `ℹ️ ${escapeHtml(n)}`).join('<br>')}</div>` : ''}
        </div>
      </details>`;

    const noteHtml = p.note ? `<div style="font-size:11px;color:var(--text-muted);background:rgba(255,255,255,0.03);border-radius:6px;padding:8px;margin-bottom:10px">💡 ${escapeHtml(p.note)}</div>` : '';

    const manualTokenHtml = !isConnected && isConfigured && key === 'facebook' ? `
      <details style="margin-top:8px">
        <summary style="font-size:12px;color:var(--accent-blue);cursor:pointer;padding:4px 0">🔑 Paste token manually (if OAuth fails)</summary>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">
          <div style="font-size:11px;color:var(--text-muted)">Get a token from <a href="https://developers.facebook.com/tools/explorer" target="_blank" style="color:#60a5fa">Graph API Explorer</a> → select your app → Generate Access Token → copy it here</div>
          <input type="text" class="form-input" id="manual-token-${key}" placeholder="Paste your access token here…" style="font-size:12px;font-family:monospace" />
          <button class="btn btn-primary btn-sm" onclick="saveManualToken('${key}')" style="align-self:flex-start">✅ Connect with Token</button>
        </div>
      </details>` : '';

    const subConfigHtml = isConnected && key === 'facebook' ? `
      <div style="margin-top:8px;display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="loadFBPages('${key}')">📄 Select Facebook Page</button>
      </div>
      <div id="fb-page-selector" style="display:none;margin-top:8px"></div>` : '';

    const pinterestConfigHtml = isConnected && key === 'pinterest' ? `
      <div style="margin-top:8px;display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="loadPinterestBoards()">📌 Select Board</button>
      </div>
      <div id="pinterest-board-selector" style="display:none;margin-top:8px"></div>` : '';

    // Bluesky: handle + app password form; Threads: one-click only
    if (!isConnected && p.kind === 'app_password') {
      p._formHtml = `
        <div class="bsky-form" style="display:grid;gap:8px;margin:10px 0">
          <input class="form-input" id="bsky-handle-${key}" placeholder="yourname.bsky.social" autocomplete="off" />
          <input class="form-input" id="bsky-pass-${key}" type="password" placeholder="App password (xxxx-xxxx-xxxx-xxxx)" autocomplete="off" />
          <details><summary style="font-size:12px;color:var(--text-muted);cursor:pointer">Own server (optional)</summary>
            <input class="form-input" id="bsky-service-${key}" placeholder="https://bsky.social" style="margin-top:6px" /></details>
        </div>`;
    }
    const connectBtn = isConnected
      ? `<div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm" onclick="triggerPlatformConnection('${key}', event)" title="Refresh & re-verify status">🔄 Refresh</button>
          <button class="btn btn-danger btn-sm" onclick="disconnect('${key}')">Disconnect</button>
         </div>`
      : p.kind === 'app_password'
        ? `<button class="btn btn-primary btn-sm" onclick="connectBluesky('${key}', this)">Connect</button>`
      : p.kind === 'oneclick' && !(State.oneClick || []).includes(key)
        ? `<span style="font-size:12px;color:var(--text-muted)">Coming soon</span>`
      : (State.oneClick || []).includes(key)
        // Radixile's approved app: no developer app or keys needed
        ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn btn-primary btn-sm" onclick="connectOneClick('${key}', this)">⚡ Connect in one click</button>
            <a href="${escapeHtml(p.oauth_url)}" class="btn btn-secondary btn-sm" title="Use your own developer app (keys below)" ${!isConfigured ? 'style="display:none"' : ''}>Own app</a>
           </div>`
        : `<div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm" onclick="triggerPlatformConnection('${key}', event)" title="Check or trigger connection">🔄 Refresh</button>
          <a href="${escapeHtml(p.oauth_url)}" class="btn btn-${isConfigured ? 'primary' : 'secondary'} btn-sm" ${!isConfigured ? 'title="Save credentials first"' : ''}>Connect</a>
         </div>`;

    return `
      <div class="platform-config-card" id="pcard-${key}" style="border-left:3px solid ${p.color}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:40px;height:40px;border-radius:10px;background:${p.color}22;display:flex;align-items:center;justify-content:center;font-size:20px;border:1px solid ${p.color}44">${p.icon}</div>
            <div>
              <div style="font-size:15px;font-weight:700;color:var(--text-primary)">${p.label}</div>
              <div>${statusBadge}</div>
            </div>
          </div>
          <div>${connectBtn}</div>
        </div>
        ${profileHtml}
        ${guideHtml}
        ${noteHtml}
        ${p._formHtml || ''}
        ${credentialsHtml}
        ${manualTokenHtml}
        ${subConfigHtml}
        ${pinterestConfigHtml}
      </div>`;
  }).join('');
}

async function saveManualToken(platform) {
  const input = document.getElementById(`manual-token-${platform}`);
  const token = input?.value.trim();
  if (!token) return toast('Please paste your access token first', 'warning');

  const btn = input.nextElementSibling;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Connecting…';

  try {
    const result = await api('POST', `/auth/manual-token/${platform}`, { access_token: token });
    toast(`${platform} connected! ${result.instagram_detected ? '+ Instagram detected ✅' : '✅'}`, 'success');
    input.value = '';
    await refreshStatus();
    loadSettings();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✅ Connect with Token';
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
  try {
    await api('POST', `/api/config/platforms/${platform}`, body);
    toast(`${platform} credentials saved! ✅`, 'success');
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
  container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)"><span class="spinner"></span> Loading pages…</div>';
  try {
    const pages = await api('GET', '/api/config/facebook/pages');
    if (!pages.length) { container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No pages found. Make sure your Facebook Page is connected to your account.</div>'; return; }
    container.innerHTML = `<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px">Select a page to post from:</div>
      <div style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto">
        ${pages.map(pg => `
          <button class="btn btn-secondary btn-sm" onclick="setFBPage(${jsAttr(pg.id)},${jsAttr(pg.name)})" style="justify-content:flex-start;text-align:left">
            📄 ${escapeHtml(pg.name)} <span style="font-size:10px;color:var(--text-muted);margin-left:auto">${escapeHtml(pg.id)}</span>
          </button>`).join('')}
      </div>`;
  } catch (err) { container.innerHTML = `<div style="color:#ef4444;font-size:12px">${escapeHtml(err.message)}</div>`; }
}

async function setFBPage(id, name) {
  try {
    const result = await api('POST', '/api/config/facebook/set-page', { page_id: id });
    const msg = result.instagram_connected ? `Page "${name}" set, and its Instagram account is connected too. ✅`
      : result.instagram_detected ? `Page "${name}" set. ✅ To post to its linked Instagram, click Connect on the Instagram card.`
      : `Page "${name}" set as default. ✅`;
    toast(msg, 'success');
    document.getElementById('fb-page-selector').style.display = 'none';
    loadSettings();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadPinterestBoards() {
  const container = document.getElementById('pinterest-board-selector');
  container.style.display = 'block';
  container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)"><span class="spinner"></span> Loading boards…</div>';
  try {
    const boards = await api('GET', '/api/config/pinterest/boards');
    if (!boards.length) { container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No boards found.</div>'; return; }
    container.innerHTML = `<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px">Select a board:</div>
      <div style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto">
        ${boards.map(b => `
          <button class="btn btn-secondary btn-sm" onclick="setPinterestBoard(${jsAttr(b.id)},${jsAttr(b.name)})" style="justify-content:flex-start">
            📌 ${escapeHtml(b.name)}
          </button>`).join('')}
      </div>`;
  } catch (err) { container.innerHTML = `<div style="color:#ef4444;font-size:12px">${escapeHtml(err.message)}</div>`; }
}

async function setPinterestBoard(id, name) {
  try {
    await api('POST', '/api/config/pinterest/set-board', { board_id: id, board_name: name });
    toast(`Board "${name}" set as default. ✅`, 'success');
    document.getElementById('pinterest-board-selector').style.display = 'none';
    loadSettings();
  } catch (err) { toast(err.message, 'error'); }
}

async function saveDefaultModelSetting() {
  const model = document.getElementById('setting-default-model').value;
  try {
    await api('POST', '/api/config/ai-keys', { DEFAULT_TEXT_MODEL: model });
    toast('✅ Default AI model saved!', 'success');
    loadSettings();
    loadModels();
  } catch (err) { toast(err.message, 'error'); }
}

// All AI and media keys are saved to the signed-in user's own account
// (POST /users/settings) — never shared with other users of this PC.
const ENV_TO_USER_SETTING = {
  GOOGLE_AI_KEY: 'google_ai_key', ANTHROPIC_API_KEY: 'anthropic_key',
  STABILITY_API_KEY: 'stability_key', OPENAI_API_KEY: 'openai_key',
  LUMA_API_KEY: 'luma_key', RUNWAY_API_KEY: 'runway_key',
};

async function saveUserKey(settingKey, value, label) {
  if (!value) return toast(`Please enter your ${label}`, 'warning');
  try {
    await api('POST', '/users/settings', { [settingKey]: value });
    toast(`✅ ${label} saved to your account`, 'success');
    loadModels?.();
  } catch (err) { toast(err.message, 'error'); }
}

function saveApiKey() {
  return saveUserKey('google_ai_key', document.getElementById('setting-anthropic-key').value.trim(), 'Google Gemini API key');
}

function saveClaudeKey() {
  return saveUserKey('anthropic_key', document.getElementById('setting-claude-key').value.trim(), 'Anthropic API key');
}

async function saveMediaKey(envKey, inputId) {
  const settingKey = ENV_TO_USER_SETTING[envKey];
  if (!settingKey) return toast('Unknown key type', 'error');
  return saveUserKey(settingKey, document.getElementById(inputId)?.value.trim(), 'key');
}

async function saveContentFolder() {
  const folder = document.getElementById('setting-content-folder')?.value.trim();
  if (!folder) return toast('Please enter a folder path', 'warning');
  try {
    await api('POST', '/api/config/content-folder', { folder });
    toast(`✅ Content folder set to: ${folder}`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function loadContentFolderSetting() {
  try {
    const data = await api('GET', '/api/config/content-folder');
    const el = document.getElementById('setting-content-folder');
    if (el) el.value = data.folder || 'D:/social';
  } catch {}
}

async function saveSMTPSettings() {
  try {
    await api('POST', '/api/config/smtp', {
      SMTP_HOST: document.getElementById('smtp-host').value.trim(),
      SMTP_PORT: document.getElementById('smtp-port').value.trim(),
      SMTP_USER: document.getElementById('smtp-user').value.trim(),
      SMTP_PASS: document.getElementById('smtp-pass').value.trim(),
      SMTP_FROM: document.getElementById('smtp-from').value.trim(),
      SMTP_FROM_NAME: document.getElementById('smtp-from-name').value.trim(),
    });
    toast('✅ SMTP settings saved!', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function triggerPlatformConnection(platform, evt) {
  const btn = evt?.currentTarget || (evt?.target?.tagName === 'BUTTON' ? evt.target : null);
  const origHtml = btn ? btn.innerHTML : '🔄 Refresh';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Verifying…'; }

  try {
    const res = await api('POST', `/auth/refresh/${platform}`);
    if (res.connected) {
      toast(`✅ ${platform} connection verified & refreshed!`, 'success');
      await refreshStatus();
      loadSettings();
      renderDashboardPlatforms();
    } else if (res.oauth_url) {
      toast(`Starting ${platform} authorization…`, 'info');
      window.location.href = res.oauth_url;
    }
  } catch (err) {
    toast(err.message, 'warning');
    const oauthUrl = `/auth/${platform}`;
    if (confirm(`${err.message}\n\nWould you like to connect ${platform} now?`)) {
      window.location.href = oauthUrl;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

async function disconnect(platform) {
  if (!confirm(`Disconnect ${platform}?`)) return;
  try {
    await api('POST', `/auth/disconnect/${platform}`);
    toast(`${platform} disconnected`, 'info');
    await refreshStatus();
    renderDashboardPlatforms();
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
  if (tab === 'users')    loadAdminUsers();
  if (tab === 'invites')  loadInviteCodes();
  if (tab === 'activity') loadAdminActivity();
  if (tab === 'config')   loadAdminConfig();
}

async function loadAdminDashboard() {
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
    tbody.innerHTML = users.map(u => `
      <tr>
        <td>
          <div style="font-weight:600;font-size:13px">${escapeHtml(u.name || u.email.split('@')[0])}</div>
          <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(u.email)}</div>
        </td>
        <td><span class="badge badge-${u.role==='admin'?'purple':'blue'}">${u.role==='admin'?'👑 Admin':'👤 User'}</span></td>
        <td><span class="badge badge-${u.status==='suspended'?'red':'green'}">${u.status||'active'}</span></td>
        <td>${u.posts || 0}</td>
        <td>${u.ai_generations || 0}</td>
        <td>${u.platforms_connected || 0}</td>
        <td style="font-size:11px">${new Date(u.created_at * 1000).toLocaleDateString()}</td>
        <td style="font-size:11px">${u.last_active ? timeAgo(new Date(u.last_active * 1000)) : 'Never'}</td>
        <td>
          <div style="display:flex;gap:4px">
            ${u.role !== 'admin'
              ? `<button class="btn btn-secondary btn-sm" onclick="makeAdmin(${u.id})" title="Make Admin">👑</button>`
              : `<button class="btn btn-secondary btn-sm" onclick="removeAdmin(${u.id})" title="Remove Admin">👤</button>`}
            ${u.status !== 'suspended'
              ? `<button class="btn btn-secondary btn-sm" onclick="suspendUser(${u.id})" title="Suspend">🚫</button>`
              : `<button class="btn btn-success btn-sm" onclick="activateUser(${u.id})" title="Activate">✅</button>`}
            <button class="btn btn-secondary btn-sm btn-icon" onclick="adminResetPassword(${u.id},${jsAttr(u.email)})" title="Reset Password">🔑</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="deleteUser(${u.id},${jsAttr(u.email)})" title="Delete">🗑</button>
          </div>
        </td>
      </tr>`).join('');
  } catch (err) { tbody.innerHTML = `<tr><td colspan="9" style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</td></tr>`; }
}

async function adminCreateUser() {
  const email    = document.getElementById('new-user-email')?.value.trim();
  const password = document.getElementById('new-user-password')?.value;
  const name     = document.getElementById('new-user-name')?.value.trim();
  const role     = document.getElementById('new-user-role')?.value;
  if (!email || !password) return toast('Email and password are required', 'warning');
  try {
    const r = await fetch('/admin/users/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, role }),
    }).then(r => r.json());
    if (r.error) return toast(r.error, 'error');
    toast(`✅ User created: ${email}`, 'success');
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
    await fetch(`/admin/users/${id}/password`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    });
    toast(`Password reset for ${email}`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function makeAdmin(id)    { await fetch(`/admin/users/${id}/role`,   { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role: 'admin' }) }); toast('User promoted to Admin', 'success'); loadAdminUsers(); }
async function removeAdmin(id)  { await fetch(`/admin/users/${id}/role`,   { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role: 'user' }) });  toast('Admin rights removed', 'info');    loadAdminUsers(); }
async function suspendUser(id)  { if (!confirm('Suspend this user?')) return; await fetch(`/admin/users/${id}/status`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'suspended' }) }); toast('User suspended', 'warning'); loadAdminUsers(); }
async function activateUser(id) { await fetch(`/admin/users/${id}/status`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'active' }) });   toast('User activated', 'success');  loadAdminUsers(); }
async function deleteUser(id, email) {
  if (!confirm(`Permanently delete ${email} and ALL their data? This cannot be undone.`)) return;
  await fetch(`/admin/users/${id}`, { method: 'DELETE' });
  toast(`${email} deleted`, 'info');
  loadAdminUsers();
  loadAdminDashboard();
}

async function generateInviteCode() {
  const note     = document.getElementById('inv-note').value.trim();
  const expires  = parseInt(document.getElementById('inv-expires').value) || null;
  const maxUses  = parseInt(document.getElementById('inv-max-uses').value) || 1;
  const resultEl = document.getElementById('new-invite-result');

  try {
    const data = await fetch('/admin/invite-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, expires_hours: expires, max_uses: maxUses }),
    }).then(r => r.json());

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
  await fetch(`/admin/invite-codes/${id}`, { method: 'DELETE' });
  toast('Invite code revoked', 'info');
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
    await fetch('/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registration_mode: document.getElementById('admin-reg-mode').value,
        app_name:          document.getElementById('admin-app-name').value,
      }),
    });
    toast('✅ Platform configuration saved!', 'success');
  } catch (err) { toast(err.message, 'error'); }
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
  if (saved === 'light') {
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

  if (connected) {
    toast(`✅ ${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully!`, 'success');
    if (connected === 'facebook' && params.get('select_page')) {
      toast(params.get('instagram')
        ? 'You manage several Facebook Pages — choose the one linked to your Instagram in Settings → Facebook → Select page. Instagram connects when you pick it.'
        : 'You manage several Facebook Pages — choose which one Social-Nexus posts to in Settings → Facebook → Select page.', 'info', 9000);
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
      oauth_state_invalid: 'Sign-in link expired or was not started from Social-Nexus — please try connecting again',
      not_available: 'Posting to this platform is not available yet in Social-Nexus.',
      instagram_not_found: 'Facebook is connected, but no Instagram account is linked to your Facebook Page. In Instagram, switch to a Business or Creator account and link it to the Page, then click Connect on the Instagram card again.',
    };
    if (error === 'not_configured') {
      const names = { linkedin: 'LinkedIn', facebook: 'Facebook', pinterest: 'Pinterest', twitter: 'Twitter/X', google: 'Google Business' };
      const name = names[params.get('platform')] || 'this platform';
      toast(`Before connecting ${name}, add your ${name} app details in Settings → Social Platforms (open "API Credentials" on its card).`, 'warning', 8000);
      navigateTo('settings');
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
