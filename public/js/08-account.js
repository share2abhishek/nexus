// NexaDrip app — Sign-in state, personal keys, tools directory, start-up.
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

async function checkAuth() {
  try {
    const data = await fetch('/users/me').then(r => r.json());
    if (!data.authenticated) { window.location.href = '/login.html'; return false; }
    State.user = data.user;
    State.server = !!data.server;
    State.business = data.business || null;
    // Desktop-only features (e.g. the Phone companion, which needs a device licence
    // and a running PC) are hidden on the server/cloud edition
    if (State.server) {
      document.body.classList.add('is-server-edition', 'is-saas');
      document.querySelectorAll('[data-desktop-only]').forEach(el => {
        el.hidden = true;
        el.style.display = 'none';
      });
    }
    // Server edition: passwords are reset by email, so no recovery-code reminder
    if (State.server) renderAccountBanner(); else setTimeout(showRecoveryNudge, 1500);
    // Back from the link in the confirmation email
    if (new URLSearchParams(location.search).get('verified') === '1') {
      setTimeout(() => toast('Your email is confirmed. Thank you!', 'success'), 800);
      history.replaceState(null, '', '/');
    }
    // Back from paying for a plan: show the Plan screen
    if (new URLSearchParams(location.search).get('billing') === 'done') {
      history.replaceState(null, '', '/');
      setTimeout(() => {
        toast('Thank you! Your plan is active.', 'success');
        State.pendingSettingsTab = 'license';
        navigateTo('settings');
      }, 600);
    }
    // Update user menu
    const nameEl   = document.getElementById('user-name-label');
    const avatarEl = document.getElementById('user-avatar');
    const infoEl   = document.getElementById('user-info-header');
    if (nameEl)   nameEl.textContent   = data.user.name || data.user.email;
    if (avatarEl) avatarEl.textContent = (data.user.name || data.user.email)[0].toUpperCase();
    if (infoEl)   infoEl.innerHTML     = `
      <div style="font-weight:600;color:var(--text-primary)">${escapeHtml(data.user.name || '')}</div>
      <div>${escapeHtml(data.user.email)}</div>
      ${State.business ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">🏢 ${escapeHtml(State.business.name)}</div>` : ''}
      ${(data.user.role === 'admin' || data.user.role === 'superadmin' || data.user.is_super_admin) ? `<div><span class="badge ${data.user.is_super_admin || data.user.role === 'superadmin' ? 'badge-gold' : 'badge-purple'}" style="font-size:10px;margin-top:4px;${data.user.is_super_admin || data.user.role === 'superadmin' ? 'background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;' : ''}">${data.user.is_super_admin || data.user.role === 'superadmin' ? '⚡ Super Admin' : (State.server ? 'Radixile Admin' : 'Admin')}</span></div>` : ''}`;

    // Show admin nav item only for admins / superadmins
    if (data.user.role === 'admin' || data.user.role === 'superadmin' || data.user.is_super_admin) {
      const adminNav = document.getElementById('nav-admin');
      if (adminNav) adminNav.style.display = '';
      // Add admin link to user dropdown
      const adminDropBtn = document.createElement('button');
      adminDropBtn.className = 'btn';
      adminDropBtn.style = 'width:100%;justify-content:flex-start;border-radius:0;padding:10px 16px;font-size:13px;color:var(--text-primary)';
      adminDropBtn.innerHTML = (data.user.is_super_admin || data.user.role === 'superadmin') ? '⚡ Super Admin Dashboard' : '👑 Admin Dashboard';
      adminDropBtn.onclick = () => { navigateTo('admin'); toggleUserMenu(); };
      const logoutBtn = document.querySelector('#user-dropdown .btn-danger');
      if (logoutBtn) logoutBtn.parentNode.insertBefore(adminDropBtn, logoutBtn);
    }
    return true;
  } catch { return false; }
}

function toggleUserMenu() {
  const dd = document.getElementById('user-dropdown');
  if (dd) {
    if (State.server) {
      dd.querySelectorAll('[data-desktop-only]').forEach(el => {
        el.hidden = true;
        el.style.display = 'none';
      });
    }
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  }
}

// Close dropdowns when clicking outside
document.addEventListener('click', e => {
  const wrap = document.getElementById('user-menu-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const dd = document.getElementById('user-dropdown');
    if (dd) dd.style.display = 'none';
  }
  if (!document.getElementById('workspace-switcher-wrap')?.contains(e.target)) {
    const dd = document.getElementById('workspace-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

async function doLogout() {
  await fetch('/users/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// ── Workspace Switcher ────────────────────────────────────────────────────────

let currentWorkspaceId = null;
let currentWorkspaceName = '';

function toggleWorkspaceSwitcher() {
  const dd = document.getElementById('workspace-dropdown');
  dd.style.display = dd.style.display === 'none' ? '' : 'none';
}

async function loadWorkspaces() {
  try {
    const res = await fetch('/me/workspaces');
    if (res.status === 401) { window.location.href = '/login.html'; return; }
    const workspaces = await res.json();
    State.userWorkspaces = workspaces;
    
    if (workspaces.length > 0 && !currentWorkspaceId) {
      currentWorkspaceId = workspaces[0].workspace_id;
      currentWorkspaceName = workspaces[0].workspace_name;
      const label = document.getElementById('workspace-name-label');
      if (label) label.textContent = currentWorkspaceName;
    }

    const list = document.getElementById('workspace-list');
    if (!list) return;
    list.innerHTML = workspaces.map(w => `
      <button class="btn" onclick="switchWorkspace(${w.workspace_id},${jsAttr(w.workspace_name)})"
        style="width:100%;justify-content:flex-start;border-radius:0;padding:10px 14px;font-size:13px;color:var(--text-primary);${w.workspace_id === currentWorkspaceId ? 'background:var(--glass)' : ''}">
        ${w.workspace_id === currentWorkspaceId ? '✓ ' : ''}${escapeHtml(w.workspace_name)}
        <span style="font-size:11px;color:var(--text-muted);margin-left:auto">${w.role}</span>
      </button>`).join('');
  } catch (err) {
    console.error('loadWorkspaces error:', err);
  }
}

async function switchWorkspace(wsId, wsName, closeDropdown = true) {
  // Create Post belongs to the current workspace (client): never carry it over
  if (String(wsId) !== String(currentWorkspaceId) && typeof composeHasUnsaved === 'function') {
    if (composeHasUnsaved() && !confirm('Create Post has changes you haven’t saved. Switch workspace and discard them?')) return;
    resetCompose();
  }
  try {
    const res = await fetch('/session/active-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: wsId }),
    });
    if (res.status === 401) { window.location.href = '/login.html'; return; }

    currentWorkspaceId = wsId;
    currentWorkspaceName = wsName;

    const label = document.getElementById('workspace-name-label');
    if (label) label.textContent = wsName;

    if (closeDropdown) {
      const dd = document.getElementById('workspace-dropdown');
      if (dd) dd.style.display = 'none';
    }

    await loadWorkspaces();
    await refreshStatus();

    if (typeof State !== 'undefined' && State.currentPage) {
      const hooks = {
        dashboard: loadDashboard,
        calendar:  () => renderCalendar(State.calendarDate),
        history:   loadHistory,
        analytics: loadAnalytics,
        files:     loadLocalFiles,
        compose:   loadScheduled,
        templates: loadTemplates,
        utm:       loadUTMLinks,
        email:     loadEmailPage,
        brand:     loadBrandKit,
        seo:       loadTrackedKeywords,
        settings:  loadSettings,
        clients:   loadClients,
        generate:  loadModels,
        media:     loadModels,
        'user-settings': loadUserSettings,
        admin:     loadAdminDashboard,
      };
      if (hooks[State.currentPage]) hooks[State.currentPage]();
    }
  } catch (err) {
    console.error('Workspace switch error:', err);
  }
}

// ── Client & Brand Management ──────────────────────────────────────────────────

async function loadClients() {
  const grid = document.getElementById('clients-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted)"><div class="spinner lg" style="margin: 0 auto 12px"></div>Loading client brands…</div>';

  try {
    const clients = await fetch('/workspaces').then(r => r.json());
    if (!clients || clients.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1;" class="empty-state">
          <div class="empty-icon">👥</div>
          <div class="empty-title">No client brands found</div>
          <div class="empty-desc">Get started by adding your first client brand portfolio.</div>
          <button class="btn btn-primary" onclick="openAddClientModal()" style="margin-top:16px">➕ Add Client Brand</button>
        </div>`;
      return;
    }

    grid.innerHTML = clients.map(c => {
      const activePlatforms = c.social_accounts && c.social_accounts.length > 0
        ? c.social_accounts.map(acc => {
            const p = PLATFORMS[acc.platform] || { icon: '🔗', label: acc.platform };
            return `<span class="badge badge-purple" title="${escapeHtml(acc.account_label || p.label)}" style="display:inline-flex;align-items:center;gap:4px;margin:2px">
              <span style="font-size:12px">${p.icon}</span> ${escapeHtml(p.label)}
            </span>`;
          }).join('')
        : '<span style="color:var(--text-muted);font-size:12.5px;font-style:italic">No platforms connected</span>';

      const isCurrent = (c.workspace_id === currentWorkspaceId);

      return `
        <div class="card" style="position:relative;display:flex;flex-direction:column;justify-content:between;transition:transform 0.2s, box-shadow 0.2s;${isCurrent ? 'border:1.5px solid var(--accent-purple);box-shadow: 0 0 15px rgba(124, 58, 237, 0.15)' : ''}">
          ${isCurrent ? '<div style="position:absolute;top:12px;right:12px;background:var(--accent-purple);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;text-transform:uppercase">Active</div>' : ''}
          <div class="card-body" style="padding:24px;flex-grow:1;display:flex;flex-direction:column;gap:12px">
            <div>
              <div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-bottom:4px">${escapeHtml(c.name)}</div>
            </div>
            
            <div style="border-top:1px solid var(--border);padding-top:12px">
              <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Connected Channels</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px">${activePlatforms}</div>
            </div>

            <div style="display:flex;justify-content:between;align-items:center;font-size:13px;color:var(--text-muted);margin-top:auto;border-top:1px solid var(--border);padding-top:12px">
              <span>👥 <strong>${c.member_count}</strong> Member${c.member_count !== 1 ? 's' : ''}</span>
              <span style="font-size:12px">Role: <strong style="text-transform:capitalize">${c.role}</strong></span>
            </div>
          </div>
          <div class="card-footer" style="padding:16px 24px;background:rgba(255,255,255,0.01);border-top:1px solid var(--border);display:flex;gap:8px">
            <button class="btn ${isCurrent ? 'btn-secondary' : 'btn-primary'}" onclick="switchClientWorkspace(${c.workspace_id}, ${jsAttr(c.name)})" style="flex:1" ${isCurrent ? 'disabled' : ''}>
              ${isCurrent ? '🟢 Managing Client' : '🔌 Manage Social Media'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openSettings('members')" title="Client Settings">⚙️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteClient(${c.workspace_id}, ${jsAttr(c.name)})" title="Delete Client Brand" ${c.role !== 'manager' ? 'disabled style="opacity:0.3;cursor:not-allowed"' : ''}>🗑️</button>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-danger)">⚠️ Error loading client brands: ${escapeHtml(err.message)}</div>`;
  }
}

async function switchClientWorkspace(wsId, wsName) {
  await switchWorkspace(wsId, wsName);
  toast(`Switched workspace context to ${wsName}`, 'success');
  loadClients(); // reload grid to update active status border/buttons
}

async function openAddClientModal() {
  document.getElementById('client-name-input').value = '';
  document.getElementById('client-slug-input').value = '';
  document.getElementById('client-timezone-select').value = 'Asia/Kolkata';
  
  const orgSelect = document.getElementById('client-org-select');
  orgSelect.innerHTML = '<option>Loading organizations…</option>';
  
  try {
    const orgs = await fetch('/workspaces/organizations').then(r => r.json());
    if (!orgs || orgs.length === 0) {
      orgSelect.innerHTML = '<option value="">No Organization Found (Contact Admin)</option>';
      document.getElementById('client-org-group').style.display = 'block';
    } else {
      orgSelect.innerHTML = orgs.map(o => `<option value="${o.id}">${escapeHtml(o.name)} (${o.role})</option>`).join('');
      document.getElementById('client-org-group').style.display = orgs.length > 1 ? 'block' : 'none';
      if (orgs.length === 1) {
        orgSelect.value = orgs[0].id;
      }
    }
  } catch (err) {
    orgSelect.innerHTML = '<option value="">Error loading organizations</option>';
  }

  document.getElementById('add-client-modal').style.display = 'flex';
}

function closeAddClientModal() {
  document.getElementById('add-client-modal').style.display = 'none';
}

function autoGenerateClientSlug() {
  const name = document.getElementById('client-name-input').value;
  const slug = name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')     // remove non-alphanumeric, spaces or dashes
    .replace(/\s+/g, '-')             // replace spaces with single dashes
    .replace(/-+/g, '-');             // replace multiple dashes with single dashes
  document.getElementById('client-slug-input').value = slug;
}

async function submitCreateClient() {
  const name = document.getElementById('client-name-input').value.trim();
  // The short web name is generated from the client name unless the user typed one
  const slug = document.getElementById('client-slug-input').value.trim()
    || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const timezone = document.getElementById('client-timezone-select').value;
  const orgId = parseInt(document.getElementById('client-org-select').value);

  if (!name) {
    return toast('Please enter the client name', 'warning');
  }
  if (!orgId) {
    return toast('A valid Organization must be selected', 'warning');
  }

  try {
    const res = await fetch('/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, name, slug, timezone })
    });
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to create workspace');
    }

    toast('🎉 Client workspace created successfully!', 'success');
    closeAddClientModal();
    
    // Switch to new client workspace immediately
    const newWs = await res.json();
    await switchWorkspace(newWs.id, newWs.name);
    loadClients();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteClient(id, name) {
  if (!confirm(`Are you absolutely sure you want to delete client "${name}"?\nThis will permanently delete all associated social media tokens, scheduled posts, history, and brand assets for this client.`)) {
    return;
  }
  
  try {
    const res = await fetch(`/workspaces/${id}`, {
      method: 'DELETE'
    });
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to delete workspace');
    }

    toast(`Deleted client brand "${name}"`, 'info');
    
    // If the deleted workspace was the active workspace, switch to first available
    if (id === currentWorkspaceId) {
      currentWorkspaceId = null;
      await loadWorkspaces(); // will auto-assign first available workspace
    }
    
    loadClients();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Members Panel ─────────────────────────────────────────────────────────────

async function loadMembers() {
  const el = document.getElementById('members-list');
  if (!el) return;
  if (!currentWorkspaceId) { el.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center">No active workspace</div>'; return; }
  try {
    const members = await fetch(`/workspaces/${currentWorkspaceId}/members`).then(r => r.json());
    if (!members.length) { el.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center">No members yet</div>'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse">
      <thead><tr style="font-size:11px;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:8px 4px">User</th>
        <th style="text-align:left;padding:8px 4px">Role</th>
        <th style="text-align:left;padding:8px 4px">Status</th>
      </tr></thead>
      <tbody>${members.map(m => `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:10px 4px;font-size:13px">${escapeHtml(m.name || m.email || `User #${m.user_id}`)}${m.name && m.email ? `<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(m.email)}</div>` : ''}</td>
        <td style="padding:10px 4px"><span style="font-size:11px;background:var(--glass);padding:2px 8px;border-radius:20px">${escapeHtml(m.role)}</span></td>
        <td style="padding:10px 4px"><span style="font-size:11px;color:${m.status==='active'?'#22c55e':'var(--text-muted)'}">${escapeHtml(m.status)}</span></td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (err) {
    el.innerHTML = `<div style="color:#ef4444;padding:20px">Failed to load members</div>`;
  }
}

async function sendInvite() {
  const email = document.getElementById('invite-email')?.value.trim();
  const role = document.getElementById('invite-role')?.value;
  const resultEl = document.getElementById('invite-result');
  if (!email) { if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">Email is required</span>'; return; }
  if (!currentWorkspaceId) { if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">No active workspace</span>'; return; }
  try {
    const r = await fetch('/invitations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workspace-id': String(currentWorkspaceId),
      },
      body: JSON.stringify({ workspaceId: currentWorkspaceId, email, role }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to send invite');
    if (resultEl) resultEl.innerHTML = `<span style="color:#22c55e">Invite created. Copy this link and send it to them (it is not emailed automatically): <a href="${escapeHtml(data.invite_url)}" target="_blank" style="color:#60a5fa">${escapeHtml(data.invite_url)}</a></span>`;
    document.getElementById('invite-email').value = '';
  } catch (err) {
    if (resultEl) resultEl.innerHTML = `<span style="color:#ef4444">${escapeHtml(err.message)}</span>`;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// User API Settings (per-user keys)
// ─────────────────────────────────────────────────────────────────────────────

async function loadUserSettings() {
  try {
    const s = await fetch('/users/settings').then(r => r.json());
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('u-google-key',      s.google_ai_key);
    set('u-groq-key',        s.groq_key);
    set('u-openrouter-key',  s.openrouter_key);
    set('u-mistral-key',     s.mistral_key);
    set('u-anthropic-key',   s.anthropic_key);
    set('u-stability-key',   s.stability_key);
    set('u-openai-key',      s.openai_key);
    set('u-luma-key',        s.luma_key);
    set('u-runway-key',      s.runway_key);
    set('u-ollama-model',    s.ollama_model);
    set('u-ollama-url',      s.ollama_url);
    set('u-default-text-model', s.default_text_model);
    const toggle = document.getElementById('u-ollama-enabled');
    if (toggle) toggle.checked = !!s.ollama_enabled;
  } catch {}
}

// Saves only the fields shown on screen (an empty key box keeps nothing; a masked
// "••••" value is skipped by the server so the saved key stays).
async function saveUserApiSettings(btn) {
  const fields = {
    'u-google-key': 'google_ai_key', 'u-groq-key': 'groq_key', 'u-openrouter-key': 'openrouter_key',
    'u-mistral-key': 'mistral_key', 'u-anthropic-key': 'anthropic_key', 'u-stability-key': 'stability_key',
    'u-openai-key': 'openai_key', 'u-luma-key': 'luma_key', 'u-runway-key': 'runway_key',
  };
  const body = {};
  for (const [id, key] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el) body[key] = el.value.trim();
  }
  const model = document.getElementById('u-default-text-model');
  if (model) body.default_text_model = model.value;
  if (btn) btn.disabled = true;
  try {
    await api('POST', '/users/settings', body);
    toast('AI settings saved to your account', 'success');
    loadUserSettings();
    loadModels(); // refresh model selector
    if (typeof refreshAiStatus === 'function') refreshAiStatus();
  } catch (err) { toast(err.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Tools Directory
// ─────────────────────────────────────────────────────────────────────────────

const AI_TOOLS = {
  'Text Generation': {
    free: [
      { name: 'Ollama',          desc: 'Run Llama, Mistral, Gemma locally. 100% free, 100% private.',  url: 'https://ollama.com',                  badge: '🦙 Local' },
      { name: 'Google Gemini',   desc: 'Gemini Flash — free tier with generous limits.',           url: 'https://aistudio.google.com',         badge: '✨ Free tier' },
      { name: 'Claude.ai',       desc: 'Anthropic Claude — free tier for personal use.',               url: 'https://claude.ai',                   badge: '🤖 Free tier' },
      { name: 'ChatGPT',         desc: 'OpenAI GPT-4o mini — free tier available.',                    url: 'https://chat.openai.com',             badge: '🟢 Free tier' },
      { name: 'Groq',            desc: 'Blazing fast Llama/Mixtral inference. Generous free API.',     url: 'https://console.groq.com',            badge: '⚡ Free API' },
      { name: 'Perplexity',      desc: 'AI search + generation. Free tier available.',                 url: 'https://www.perplexity.ai',           badge: '🔍 Free' },
      { name: 'Mistral',         desc: 'French AI — free Le Chat + free API tier.',                    url: 'https://mistral.ai',                  badge: '🆓 Free API' },
      { name: 'Hugging Face',    desc: 'Access thousands of open models via free inference API.',      url: 'https://huggingface.co',              badge: '🤗 Free' },
      { name: 'Together AI',     desc: 'Open source models with free $5 starter credits.',             url: 'https://www.together.ai',             badge: '💰 Free credits' },
      { name: 'Cohere',          desc: 'Command R+ — free trial API for text tasks.',                  url: 'https://cohere.com',                  badge: '🆓 Trial' },
    ],
    paid: [
      { name: 'OpenAI GPT-4o',   desc: '$5/1M input tokens. Best for complex reasoning tasks.',        url: 'https://platform.openai.com',         badge: '💲 $5/1M' },
      { name: 'Claude Opus',     desc: '$15/1M tokens. Anthropic\'s most capable model.',              url: 'https://console.anthropic.com',       badge: '💲 $15/1M' },
      { name: 'Gemini Pro 1.5',  desc: '$3.5/1M tokens. Best price/performance for long context.',     url: 'https://aistudio.google.com',         badge: '💲 $3.5/1M' },
      { name: 'Groq API',        desc: '$0.27/1M tokens. Fastest inference available.',                url: 'https://console.groq.com',            badge: '💲 $0.27/1M' },
      { name: 'Mistral Large',   desc: '$8/1M tokens. Strong multilingual & coding model.',            url: 'https://mistral.ai',                  badge: '💲 $8/1M' },
      { name: 'Cohere C4AI',     desc: '$3/1M tokens. Great for RAG and enterprise tasks.',            url: 'https://cohere.com',                  badge: '💲 $3/1M' },
      { name: 'AWS Bedrock',     desc: 'Access all major models via AWS infrastructure.',              url: 'https://aws.amazon.com/bedrock',      badge: '☁️ AWS' },
      { name: 'Azure OpenAI',    desc: 'OpenAI models with enterprise security and SLAs.',             url: 'https://azure.microsoft.com/ai',      badge: '☁️ Azure' },
      { name: 'Vertex AI',       desc: 'Google Cloud — Gemini + Claude + Llama on cloud.',             url: 'https://cloud.google.com/vertex-ai',  badge: '☁️ GCP' },
      { name: 'Fireworks AI',    desc: '$0.20/1M tokens. Fast open-source model hosting.',             url: 'https://fireworks.ai',                badge: '💲 $0.20/1M' },
    ],
  },
  'Image Generation': {
    free: [
      { name: 'ComfyUI (Local)', desc: 'Most powerful local image gen. Stable Diffusion + Flux.',      url: 'https://github.com/comfyanonymous/ComfyUI', badge: '🖥️ Local' },
      { name: 'Stable Diffusion',desc: 'AUTOMATIC1111 WebUI — run any model locally.',                 url: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui', badge: '🖥️ Local' },
      { name: 'Bing Image Creator',desc: 'DALL-E based. Free with Microsoft account.',                 url: 'https://www.bing.com/images/create',   badge: '🆓 Free' },
      { name: 'Adobe Firefly',   desc: 'Commercially safe AI images. Free tier available.',            url: 'https://firefly.adobe.com',           badge: '🆓 Free tier' },
      { name: 'Canva AI',        desc: 'Text-to-image inside Canva. Free plan available.',             url: 'https://www.canva.com',               badge: '🆓 Free tier' },
      { name: 'Ideogram',        desc: 'Great for text-in-image. Free tier available.',                url: 'https://ideogram.ai',                 badge: '🆓 Free' },
      { name: 'Leonardo AI',     desc: '150 free tokens/day. High quality anime/art styles.',          url: 'https://leonardo.ai',                 badge: '🆓 150/day' },
      { name: 'NightCafe',       desc: 'Free credits daily. Many art styles.',                         url: 'https://creator.nightcafe.studio',    badge: '🆓 Daily credits' },
      { name: 'Craiyon',         desc: 'Unlimited free image generation (slower).',                    url: 'https://www.craiyon.com',             badge: '🆓 Unlimited' },
      { name: 'DreamStudio',     desc: 'Stability AI official — 25 free credits on signup.',           url: 'https://dreamstudio.ai',              badge: '🆓 25 credits' },
    ],
    paid: [
      { name: 'Stability AI API',desc: '$0.01/image. SDXL + SD3 via API. Best for apps.',             url: 'https://stability.ai',                badge: '💲 $0.01' },
      { name: 'OpenAI GPT Image', desc: 'Paid per image. OpenAI image generation API.',               url: 'https://platform.openai.com',         badge: '💲 Paid' },
      { name: 'Midjourney',      desc: '$10/mo. Best artistic quality. Discord-based.',                url: 'https://www.midjourney.com',          badge: '💲 $10/mo' },
      { name: 'Flux Pro API',    desc: '$0.05/image. State-of-art image quality (2024).',              url: 'https://replicate.com/black-forest-labs', badge: '💲 $0.05' },
      { name: 'Adobe Firefly API',desc: '$0.02/image. Commercially safe, no copyright issues.',       url: 'https://developer.adobe.com/firefly', badge: '💲 $0.02' },
      { name: 'Ideogram API',    desc: '$0.08/image. Best for text inside images.',                    url: 'https://ideogram.ai/api',             badge: '💲 $0.08' },
      { name: 'Leonardo API',    desc: '$10/mo. Anime, concept art, product images.',                  url: 'https://leonardo.ai',                 badge: '💲 $10/mo' },
      { name: 'Imagen 3',        desc: 'Google\'s best image model. Available via Vertex AI.',         url: 'https://cloud.google.com/vertex-ai',  badge: '☁️ GCP' },
      { name: 'Recraft AI',      desc: '$15/mo. SVG + consistent brand image generation.',             url: 'https://www.recraft.ai',              badge: '💲 $15/mo' },
      { name: 'Getimg.ai',       desc: '$12/mo. 3000+ models including fine-tunes.',                   url: 'https://getimg.ai',                   badge: '💲 $12/mo' },
    ],
  },
  'Video Generation': {
    free: [
      { name: 'Stable Video (Local)', desc: 'Animate images locally with Stability AI SVD.',          url: 'https://stability.ai/stable-video',   badge: '🖥️ Local' },
      { name: 'Kling AI',        desc: 'High quality video. Free tier with limited credits.',          url: 'https://klingai.com',                 badge: '🆓 Free tier' },
      { name: 'Pika',            desc: 'AI video creation. Free tier available.',                      url: 'https://pika.art',                    badge: '🆓 Free' },
      { name: 'CapCut AI',       desc: 'Free AI video editing and generation. Mobile + web.',          url: 'https://www.capcut.com',              badge: '🆓 Free' },
      { name: 'Canva Video AI',  desc: 'AI video with templates. Free plan available.',                url: 'https://www.canva.com',               badge: '🆓 Free tier' },
      { name: 'InVideo AI',      desc: 'Text-to-video. Free tier with watermark.',                     url: 'https://invideo.io',                  badge: '🆓 Free tier' },
      { name: 'HeyGen',          desc: 'AI avatars and video. Free trial.',                            url: 'https://www.heygen.com',              badge: '🆓 Trial' },
      { name: 'Synthesia',       desc: 'AI presenter videos. Free trial.',                             url: 'https://www.synthesia.io',            badge: '🆓 Trial' },
      { name: 'Runway (Trial)',  desc: '125 free credits. Professional AI video.',                     url: 'https://runwayml.com',                badge: '💰 125 credits' },
      { name: 'Luma (Trial)',    desc: '30 free videos/month. Photorealistic quality.',                url: 'https://lumalabs.ai',                 badge: '🆓 30/month' },
    ],
    paid: [
      { name: 'Luma Dream Machine', desc: '$29/mo. Best image-to-video. NexaDrip integrated.',           url: 'https://lumalabs.ai',                 badge: '💲 $29/mo' },
      { name: 'Runway Gen-3',    desc: '$15/mo. 625 credits. Professional video gen.',                 url: 'https://runwayml.com',                badge: '💲 $15/mo' },
      { name: 'Kling AI Pro',    desc: '$10/mo. Chinese model, excellent quality.',                    url: 'https://klingai.com',                 badge: '💲 $10/mo' },
      { name: 'Pika 2.0',        desc: '$8/mo. 150 videos/month. Good for social.',                   url: 'https://pika.art',                    badge: '💲 $8/mo' },
      { name: 'HeyGen',          desc: '$29/mo. Best for talking avatar videos.',                      url: 'https://www.heygen.com',              badge: '💲 $29/mo' },
      { name: 'Synthesia',       desc: '$22/mo. AI presenter for training & marketing.',               url: 'https://www.synthesia.io',            badge: '💲 $22/mo' },
      { name: 'Sora (OpenAI)',   desc: 'In ChatGPT Plus $20/mo. 50 videos/month.',                    url: 'https://sora.com',                    badge: '💲 $20/mo' },
      { name: 'Veo 2 (Google)',  desc: 'Google\'s most advanced video model. Enterprise.',             url: 'https://deepmind.google/veo',         badge: '☁️ Enterprise' },
      { name: 'Minimax',         desc: '$0.14/video. Good quality, API available.',                    url: 'https://minimaxi.com',                badge: '💲 $0.14' },
      { name: 'Lightricks LTX',  desc: '$10/mo. Real-time video generation.',                         url: 'https://www.lightricks.com',          badge: '💲 $10/mo' },
    ],
  },
  'SEO Tools': {
    free: [
      { name: 'Google Search Console', desc: 'Free keyword data, ranking, click analytics.',          url: 'https://search.google.com/search-console', badge: '🆓 Free' },
      { name: 'Ubersuggest (Free)', desc: '3 searches/day. Keywords, competitor analysis.',           url: 'https://neilpatel.com/ubersuggest',    badge: '🆓 3/day' },
      { name: 'Google Keyword Planner', desc: 'Free keyword research via Google Ads account.',        url: 'https://ads.google.com',              badge: '🆓 Free' },
      { name: 'AnswerThePublic', desc: 'Visual keyword research. 3 free searches/day.',               url: 'https://answerthepublic.com',         badge: '🆓 3/day' },
      { name: 'Yoast SEO',       desc: 'Free WordPress plugin for on-page SEO optimization.',         url: 'https://yoast.com',                   badge: '🆓 WordPress' },
      { name: 'SEOquake',        desc: 'Free browser extension for SEO metrics.',                     url: 'https://www.seoquake.com',            badge: '🆓 Extension' },
      { name: 'Moz Bar',         desc: 'Free DA/PA checker browser extension.',                       url: 'https://moz.com/products/pro/seo-toolbar', badge: '🆓 Extension' },
      { name: 'Keyword Surfer',  desc: 'Free Chrome extension for keyword volumes in SERPs.',         url: 'https://surferseo.com/keyword-surfer-extension', badge: '🆓 Extension' },
      { name: 'Rank Math (Free)',desc: 'Free WordPress SEO plugin with AI suggestions.',              url: 'https://rankmath.com',                badge: '🆓 WordPress' },
      { name: 'Screaming Frog',  desc: 'Free for up to 500 URLs. Best site crawler.',                 url: 'https://www.screamingfrog.co.uk',     badge: '🆓 500 URLs' },
    ],
    paid: [
      { name: 'Ahrefs',          desc: '$99/mo. Most complete SEO tool. Best backlink data.',          url: 'https://ahrefs.com',                  badge: '💲 $99/mo' },
      { name: 'Semrush',         desc: '$130/mo. Comprehensive SEO + competitor + ads.',              url: 'https://www.semrush.com',             badge: '💲 $130/mo' },
      { name: 'Moz Pro',         desc: '$99/mo. Industry standard. DA/PA metrics.',                   url: 'https://moz.com',                     badge: '💲 $99/mo' },
      { name: 'Surfer SEO',      desc: '$89/mo. AI content optimization for rankings.',               url: 'https://surferseo.com',               badge: '💲 $89/mo' },
      { name: 'SE Ranking',      desc: '$55/mo. Best value full-suite SEO platform.',                 url: 'https://seranking.com',               badge: '💲 $55/mo' },
      { name: 'Ubersuggest Pro', desc: '$12/mo. Keyword + content + backlink tools.',                 url: 'https://neilpatel.com',               badge: '💲 $12/mo' },
      { name: 'Clearscope',      desc: '$170/mo. AI content optimization for SEO writers.',           url: 'https://www.clearscope.io',           badge: '💲 $170/mo' },
      { name: 'Mangools',        desc: '$29/mo. Beginner-friendly. KWFinder + SERPChecker.',          url: 'https://mangools.com',                badge: '💲 $29/mo' },
      { name: 'SpyFu',           desc: '$39/mo. Best for competitor PPC & SEO spying.',               url: 'https://www.spyfu.com',               badge: '💲 $39/mo' },
      { name: 'Majestic SEO',    desc: '$50/mo. Best backlink database and Trust Flow.',              url: 'https://majestic.com',                badge: '💲 $50/mo' },
    ],
  },
  'Email Marketing': {
    free: [
      { name: 'Brevo (Sendinblue)', desc: '300 emails/day free. Full marketing platform.',           url: 'https://www.brevo.com',               badge: '🆓 300/day' },
      { name: 'Mailchimp',       desc: '500 contacts, 1000 sends/month free.',                        url: 'https://mailchimp.com',               badge: '🆓 500 contacts' },
      { name: 'MailerLite',      desc: '1000 subscribers, 12k emails/month free.',                    url: 'https://www.mailerlite.com',          badge: '🆓 1k subs' },
      { name: 'Klaviyo',         desc: '500 emails/month free. Best for e-commerce.',                 url: 'https://www.klaviyo.com',             badge: '🆓 500/mo' },
      { name: 'HubSpot Email',   desc: '2000 emails/month in HubSpot free CRM.',                      url: 'https://www.hubspot.com',             badge: '🆓 2k/mo' },
      { name: 'Omnisend',        desc: '500 emails/month. Good for WooCommerce/Shopify.',             url: 'https://www.omnisend.com',            badge: '🆓 500/mo' },
      { name: 'Sender',          desc: '2500 subscribers, 15k emails/month free.',                    url: 'https://www.sender.net',              badge: '🆓 2.5k subs' },
      { name: 'Benchmark Email', desc: '500 subscribers, 3500 emails/month free.',                    url: 'https://www.benchmarkemail.com',      badge: '🆓 500 subs' },
      { name: 'Elastic Email',   desc: '100 emails/day free. API-first platform.',                    url: 'https://elasticemail.com',            badge: '🆓 100/day' },
      { name: 'Gmail + Google Apps Script', desc: 'Free bulk email via personal Gmail. 500/day.',    url: 'https://script.google.com',           badge: '🆓 500/day' },
    ],
    paid: [
      { name: 'Klaviyo',         desc: '$45/mo. Best ROI for e-commerce email + SMS.',                url: 'https://www.klaviyo.com',             badge: '💲 $45/mo' },
      { name: 'ActiveCampaign',  desc: '$29/mo. CRM + email + automation powerhouse.',                url: 'https://www.activecampaign.com',      badge: '💲 $29/mo' },
      { name: 'Mailchimp Pro',   desc: '$13/mo. Industry standard. Good analytics.',                  url: 'https://mailchimp.com',               badge: '💲 $13/mo' },
      { name: 'ConvertKit',      desc: '$25/mo. Best for creators and newsletters.',                  url: 'https://convertkit.com',              badge: '💲 $25/mo' },
      { name: 'Drip',            desc: '$39/mo. E-commerce focused automation.',                      url: 'https://www.drip.com',                badge: '💲 $39/mo' },
      { name: 'SendGrid',        desc: '$20/mo. Developer-friendly. Best deliverability.',            url: 'https://sendgrid.com',                badge: '💲 $20/mo' },
      { name: 'Mailgun',         desc: '$35/mo. API-first. Used by large enterprises.',               url: 'https://www.mailgun.com',             badge: '💲 $35/mo' },
      { name: 'Campaign Monitor',desc: '$11/mo. Beautiful templates. Easy to use.',                   url: 'https://www.campaignmonitor.com',     badge: '💲 $11/mo' },
      { name: 'Brevo Pro',       desc: '$25/mo. Unlimited contacts + CRM + SMS.',                    url: 'https://www.brevo.com',               badge: '💲 $25/mo' },
      { name: 'Amazon SES',      desc: '$0.10/1000 emails. Cheapest at scale. AWS.',                  url: 'https://aws.amazon.com/ses',          badge: '💲 $0.10/1k' },
    ],
  },
  'Social Media Management': {
    free: [
      { name: 'NexaDrip (This App)', desc: 'Free, local, AI-powered social marketing suite.',            url: 'http://localhost:3000',               badge: '⚡ You are here' },
      { name: 'Buffer (Free)',    desc: '3 channels, 10 scheduled posts free.',                       url: 'https://buffer.com',                  badge: '🆓 3 channels' },
      { name: 'Later (Free)',     desc: '30 posts/month per social profile.',                          url: 'https://later.com',                   badge: '🆓 30 posts/mo' },
      { name: 'Zoho Social',     desc: '1 user, 1 brand free. Good all-round tool.',                  url: 'https://www.zoho.com/social',         badge: '🆓 1 brand' },
      { name: 'Hootsuite (Trial)',desc: '30-day free trial. Industry leader.',                         url: 'https://hootsuite.com',               badge: '🆓 30-day trial' },
      { name: 'Canva',           desc: 'Free design tool with social publishing.',                     url: 'https://www.canva.com',               badge: '🆓 Free' },
      { name: 'Facebook Creator Studio', desc: 'Free Meta tool for FB + Instagram scheduling.',       url: 'https://business.facebook.com',       badge: '🆓 Free' },
      { name: 'TweetDeck',       desc: 'Free Twitter/X management and scheduling.',                   url: 'https://tweetdeck.twitter.com',       badge: '🆓 Free' },
      { name: 'Followerwonk',    desc: 'Free Twitter analytics and follower management.',              url: 'https://followerwonk.com',            badge: '🆓 Free' },
      { name: 'Metricool (Free)',desc: '50 posts/month free. Analytics included.',                    url: 'https://metricool.com',               badge: '🆓 50 posts/mo' },
    ],
    paid: [
      { name: 'Hootsuite',       desc: '$99/mo. Enterprise social management leader.',                url: 'https://hootsuite.com',               badge: '💲 $99/mo' },
      { name: 'Sprout Social',   desc: '$249/mo. Best analytics + team collaboration.',              url: 'https://sproutsocial.com',            badge: '💲 $249/mo' },
      { name: 'Buffer Pro',      desc: '$6/mo. Simple, clean, affordable scheduling.',               url: 'https://buffer.com',                  badge: '💲 $6/mo' },
      { name: 'ContentStudio',   desc: '$25/mo. AI content + scheduling all-in-one.',               url: 'https://contentstudio.io',            badge: '💲 $25/mo' },
      { name: 'Agorapulse',      desc: '$79/mo. Best inbox management + team features.',             url: 'https://www.agorapulse.com',          badge: '💲 $79/mo' },
      { name: 'SocialBee',       desc: '$29/mo. Category-based scheduling + AI writer.',             url: 'https://socialbee.com',               badge: '💲 $29/mo' },
      { name: 'Publer',          desc: '$12/mo. Great value. Bulk scheduling + AI.',                 url: 'https://publer.io',                   badge: '💲 $12/mo' },
      { name: 'Metricool',       desc: '$22/mo. Analytics + scheduling + link in bio.',              url: 'https://metricool.com',               badge: '💲 $22/mo' },
      { name: 'Sendible',        desc: '$29/mo. Agency-friendly multi-client management.',           url: 'https://www.sendible.com',            badge: '💲 $29/mo' },
      { name: 'Iconosquare',     desc: '$49/mo. Best Instagram analytics + scheduling.',             url: 'https://www.iconosquare.com',         badge: '💲 $49/mo' },
    ],
  },
};

function renderToolsDirectory() {
  const container = document.getElementById('tools-directory-content');
  if (!container) return;

  container.innerHTML = Object.entries(AI_TOOLS).map(([category, { free, paid }]) => `
    <div style="margin-bottom:32px">
      <div class="section-title" style="margin-bottom:16px">${category}</div>
      <div class="grid-2">
        <!-- Free -->
        <div class="card">
          <div class="card-header">
            <div class="card-title" style="color:var(--accent-green)">🆓 Free Tools</div>
            <span class="badge badge-green">${free.length} tools</span>
          </div>
          <div class="card-body" style="padding:0">
            ${free.map(t => toolCard(t)).join('')}
          </div>
        </div>
        <!-- Paid -->
        <div class="card">
          <div class="card-header">
            <div class="card-title" style="color:var(--accent-orange)">💲 Paid Tools</div>
            <span class="badge badge-orange">${paid.length} tools</span>
          </div>
          <div class="card-body" style="padding:0">
            ${paid.map(t => toolCard(t)).join('')}
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

function toolCard(t) {
  return `
    <a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--border);text-decoration:none;transition:var(--transition);"
       onmouseover="this.style.background='var(--glass)'" onmouseout="this.style.background='none'">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(t.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;line-height:1.4">${escapeHtml(t.desc)}</div>
      </div>
      <span class="badge badge-${t.badge.includes('🆓')||t.badge.includes('Local')||t.badge.includes('Free')||t.badge.includes('free') ? 'green' : t.badge.includes('💲') ? 'orange' : 'purple'}" style="font-size:10px;flex-shrink:0;white-space:nowrap">${escapeHtml(t.badge)}</span>
    </a>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Auth check — redirect to login if not authenticated
  const authed = await checkAuth();
  if (!authed) return;

  initPlatformSelectors();
  initTheme();
  handleURLParams();
  loadWorkspaces().then(initUiMode).catch(() => applyUiMode("simple"));
  try { if (localStorage.getItem("nexus_more_tools_open")) toggleMoreTools(true); } catch {}
  checkOnboarding();
  loadLicense();
  setInterval(loadLicense, 10 * 60 * 1000);

  // Handle local computer file import
  const fileInput = document.getElementById('computer-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        closeFileBrowserModal();
        // A new post, so it never overwrites a post being edited
        if (!startNewCompose({ text: content })) return;
        toast(`Successfully imported "${file.name}"!`, 'success');
      };
      reader.onerror = () => {
        toast('Failed to read file from computer', 'error');
      };
      reader.readAsText(file);
      fileInput.value = ''; // reset
    });
  }

  // Keys used to be kept in browser storage, where the next person on this PC
  // could use them. They now live only in each user's account — remove leftovers.
  try { localStorage.removeItem('nexus_api_key'); localStorage.removeItem('nexus_claude_key'); } catch {}

  // Set default post mode
  setPostMode('schedule');

  // Load initial page
  navigateTo('dashboard');

  // Poll status every 60s
  setInterval(refreshStatus, 60000);

  // Live brand preview
  ['brand-name','brand-tagline','brand-logo','brand-primary-hex','brand-secondary-hex','brand-accent-hex'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateBrandPreview);
  });
  ['brand-primary-color','brand-secondary-color','brand-accent-color'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
      const type = id.replace('brand-','').replace('-color','');
      const hexEl = document.getElementById(`brand-${type}-hex`);
      if (hexEl) { hexEl.value = el.value; updateBrandPreview(); }
    });
  });

  console.log('NexaDrip v2.0 initialized ⚡ — Full Digital Marketing Suite');
});

// ── Server edition: confirm your email, and trial days left ─────────────────
function renderAccountBanner() {
  const bar = document.getElementById('account-banner');
  if (!bar || !State.server) return;
  const parts = [];
  const b = State.business;
  if (State.user && State.user.email_verified === false) {
    parts.push(`<span>📧 Please confirm your email: we sent a link to <b>${escapeHtml(State.user.email)}</b>.</span>
      <button class="btn btn-secondary btn-sm" id="btn-resend-verify" onclick="resendVerification(this)">Send it again</button>`);
  }
  if (b && b.plan === 'trial' && b.trial_days_left != null) {
    parts.push(b.trial_days_left > 0
      ? `<span>⏳ Free trial: <b>${b.trial_days_left} day${b.trial_days_left === 1 ? '' : 's'} left</b> for ${escapeHtml(b.name)}.</span>`
      : `<span>⏳ The free trial for ${escapeHtml(b.name)} has ended. Your posts and settings are kept; choose a plan to keep publishing.</span>`);
  }
  bar.innerHTML = parts.map(p => `<div class="account-banner-row">${p}</div>`).join('');
  bar.style.display = parts.length ? '' : 'none';
}

async function resendVerification(btn) {
  btn.disabled = true;
  try {
    const r = await api('POST', '/users/resend-verification');
    toast(r.already ? 'Your email is already confirmed.' : r.sent ? 'Sent. Check your inbox (and spam folder).' : 'Email isn’t set up on the server yet: ask Radixile support.', r.sent || r.already ? 'success' : 'warning', 7000);
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
}
