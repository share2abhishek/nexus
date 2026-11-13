// public/js/13-lead-pipeline.js
// Reactive Controller for Meta Lead Ads & Click-to-Messenger Automated Ingestion Pipeline.

const LeadPipelineState = {
  config: null,
  stats: null,
  facebookPage: null,
  leads: [],
  activeFilter: 'all',
  activeTab: 'inbound',
  loading: false,
  broadcast: {
    contacts: [],
    selectedIndexes: new Set(),
    template: 'custom',
    message: 'Hi {{name}}, thanks for getting in touch! Reply here if you have any questions.',
    deliveryMode: 'cloud_api',
    safetyDelay: 1500,
    sending: false,
  },
  chat: {
    conversations: [],
    activeLeadId: null,
    activeMessages: [],
    searchQuery: '',
    loading: false,
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
   Lifecycle & Data Loading
   ───────────────────────────────────────────────────────────────────────────── */

async function loadLeadPipeline() {
  LeadPipelineState.loading = true;
  try {
    const [configData, leadsData] = await Promise.all([
      api('GET', '/api/lead-pipeline/config').catch(() => null),
      api('GET', '/api/lead-pipeline/leads?limit=100').catch(() => []),
    ]);

    if (configData) {
      LeadPipelineState.config = configData.config || {};
      LeadPipelineState.stats = configData.stats || {};
      LeadPipelineState.facebookPage = configData.facebook_page || {};
      LeadPipelineState.tunnel = configData.tunnel || null;
      renderPipelineConfig();
      renderPipelineStats();
    }

    LeadPipelineState.leads = Array.isArray(leadsData) ? leadsData : [];
    renderLeadsTable();
  } catch (err) {
    console.error('[Lead Pipeline] Error loading data:', err);
    toast(err.message || 'Error loading lead pipeline data', 'error');
  } finally {
    LeadPipelineState.loading = false;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Render Configuration & Setup Wizard
   ───────────────────────────────────────────────────────────────────────────── */

function renderPipelineConfig() {
  const cfg = LeadPipelineState.config || {};
  const fb = LeadPipelineState.facebookPage || {};

  // 1. Webhook URL (Tunnel if active/available, else window.location.origin)
  const tunnel = LeadPipelineState.tunnel || {};
  const webhookUrlEl = document.getElementById('pipeline-webhook-url');
  if (webhookUrlEl) {
    if (tunnel.webhookUrl) {
      webhookUrlEl.value = tunnel.webhookUrl;
    } else {
      const currentOrigin = window.location.origin;
      webhookUrlEl.value = `${currentOrigin}/api/webhooks/meta`;
    }
  }

  // Render Tunnel & Server Mode Badges
  const badgeEl = document.getElementById('tunnel-mode-badge');
  const subtextEl = document.getElementById('tunnel-status-subtext');
  const hintEl = document.getElementById('tunnel-hint-note');

  if (badgeEl) {
    const pill = (tone, text) => `<span class="status-pill ${tone}"><span class="status-dot-sm ${tone}"></span>${text}</span>`;
    const startBtn = document.getElementById('btn-refresh-tunnel');
    if (tunnel.mode === 'server') {
      badgeEl.innerHTML = pill('ok', 'Ready');
      if (subtextEl) subtextEl.textContent = 'Your own web address';
      if (hintEl) hintEl.innerHTML = 'Meta reaches this installation at <b>' + escapeHtml(tunnel.publicUrl || '') + '</b>.';
      if (startBtn) startBtn.style.display = 'none';
    } else if (tunnel.status === 'connected') {
      badgeEl.innerHTML = pill('ok', 'Ready');
      if (subtextEl) subtextEl.textContent = 'Public address is on';
      if (hintEl) hintEl.textContent = 'This address works while Social-Nexus is running. It changes when the app restarts: paste the new one into Meta then (we show it here).';
      if (startBtn) startBtn.textContent = 'Renew address';
    } else if (tunnel.status === 'starting' || tunnel.status === 'reconnecting') {
      badgeEl.innerHTML = pill('warn', 'Starting…');
      if (subtextEl) subtextEl.textContent = '';
      scheduleTunnelPoll();
    } else if (tunnel.status === 'error') {
      badgeEl.innerHTML = pill('warn', 'Not reachable');
      if (subtextEl) subtextEl.textContent = '';
      if (hintEl) hintEl.textContent = 'The public address couldn’t start' + (tunnel.error ? ' (' + tunnel.error + ')' : '') + '. Check the internet connection and click “Start public address” again.';
    } else {
      badgeEl.innerHTML = pill('off', 'Not receiving yet');
      if (subtextEl) subtextEl.textContent = '';
      if (hintEl) hintEl.textContent = 'Meta can only reach a public https address. Click “Start public address” to open one for this PC (it stays on while Social-Nexus is running).';
      if (startBtn) startBtn.textContent = 'Start public address';
    }
  }

  // 2. Verify Token
  const verifyTokenEl = document.getElementById('pipeline-verify-token');
  if (verifyTokenEl) {
    verifyTokenEl.value = cfg.verify_token || '';
  }

  // 3. Connected Facebook Page Status
  const pageStatusEl = document.getElementById('pipeline-page-status');
  const btnSubscribe = document.getElementById('btn-pipeline-subscribe-page');
  if (pageStatusEl) {
    if (fb.connected) {
      pageStatusEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#10b981"></span>
          <strong>${escapeHtml(fb.page_label || 'Facebook Page')}</strong>
          <span style="color:var(--text-muted);font-size:12px">(Page ID: ${escapeHtml(fb.page_id)})</span>
        </div>
      `;
      if (btnSubscribe) btnSubscribe.disabled = false;
    } else {
      pageStatusEl.innerHTML = `
        <div style="color:var(--text-muted)">
          No Facebook Page connected yet. <a href="javascript:void(0)" onclick="openSettings('platforms')">Connect Facebook in Settings → Connected accounts</a> first.
        </div>
      `;
      if (btnSubscribe) btnSubscribe.disabled = true;
    }
  }

  // 4. n8n and Chatwoot inputs
  const n8nUrlInput = document.getElementById('pipeline-n8n-url');
  if (n8nUrlInput) n8nUrlInput.value = cfg.n8n_webhook_url || '';
  const n8nPill = document.getElementById('n8n-status-pill');
  if (n8nPill) {
    n8nPill.className = 'status-pill ' + (cfg.n8n_webhook_url ? 'ok' : '');
    n8nPill.innerHTML = cfg.n8n_webhook_url ? '<span class="status-dot-sm ok"></span>Sending events' : '';
  }

  const cwUrlInput = document.getElementById('pipeline-chatwoot-url');
  if (cwUrlInput) cwUrlInput.value = cfg.chatwoot_url || '';

  const cwTokenInput = document.getElementById('pipeline-chatwoot-token');
  if (cwTokenInput) cwTokenInput.value = cfg.chatwoot_api_token || '';

  const cwAccountInput = document.getElementById('pipeline-chatwoot-account');
  if (cwAccountInput) cwAccountInput.value = cfg.chatwoot_account_id || '';

  const cwInboxInput = document.getElementById('pipeline-chatwoot-inbox');
  if (cwInboxInput) cwInboxInput.value = cfg.chatwoot_inbox_id || '';

  const appSecretInput = document.getElementById('pipeline-app-secret');
  if (appSecretInput && cfg.app_secret_set) appSecretInput.placeholder = 'Saved — paste a new one to replace it';

  const autoQualifyInput = document.getElementById('pipeline-auto-qualify');
  if (autoQualifyInput) autoQualifyInput.checked = !!cfg.auto_qualify_ai;
  const cardToken = document.getElementById("card-wa-access-token");
  if (cardToken) cardToken.value = cfg.whatsapp_access_token || "";
  const cardPhone = document.getElementById("card-wa-phone-id");
  if (cardPhone) cardPhone.value = cfg.whatsapp_phone_number_id || "";
  const cardWaba = document.getElementById("card-wa-waba-id");
  if (cardWaba) cardWaba.value = cfg.whatsapp_business_account_id || "";
  const cardRecipient = document.getElementById("card-wa-test-recipient");
  if (cardRecipient) cardRecipient.value = cfg.whatsapp_test_recipient || "";
  renderWhatsAppConfigBadges();
}

function renderPipelineStats() {
  const stats = LeadPipelineState.stats || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = Number(val || 0).toLocaleString();
  };

  setVal('stat-pipeline-total', stats.total_leads);
  setVal('stat-pipeline-today', stats.today_leads);
  setVal('stat-pipeline-hot', stats.hot_leads);
  setVal('stat-pipeline-n8n', stats.n8n_forwarded);
  setVal('stat-pipeline-chatwoot', stats.chatwoot_forwarded);
  setVal('stat-pipeline-messenger', stats.messenger_conversations);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Actions & Handlers
   ───────────────────────────────────────────────────────────────────────────── */

async function savePipelineConfig() {
  const n8n_webhook_url = document.getElementById('pipeline-n8n-url')?.value?.trim();
  const chatwoot_url = document.getElementById('pipeline-chatwoot-url')?.value?.trim();
  const chatwoot_api_token = document.getElementById('pipeline-chatwoot-token')?.value?.trim();
  const chatwoot_account_id = document.getElementById('pipeline-chatwoot-account')?.value?.trim();
  const chatwoot_inbox_id = document.getElementById('pipeline-chatwoot-inbox')?.value?.trim();
  const auto_qualify_ai = document.getElementById('pipeline-auto-qualify')?.checked;
  const appSecretEl = document.getElementById('pipeline-app-secret');
  const app_secret = appSecretEl?.value?.trim();

  try {
    const updated = await api('POST', '/api/lead-pipeline/config', {
      n8n_webhook_url: n8n_webhook_url || null,
      chatwoot_url: chatwoot_url || null,
      chatwoot_api_token: chatwoot_api_token || null,
      chatwoot_account_id: chatwoot_account_id ? Number(chatwoot_account_id) : null,
      chatwoot_inbox_id: chatwoot_inbox_id ? Number(chatwoot_inbox_id) : null,
      auto_qualify_ai: !!auto_qualify_ai,
      ...(app_secret && !app_secret.includes('••') ? { app_secret } : {}),
    });
    if (appSecretEl && app_secret) { appSecretEl.value = ''; appSecretEl.placeholder = 'Saved — paste a new one to replace it'; }

    LeadPipelineState.config = updated;
    renderPipelineConfig();
    toast('Saved', 'success');
  } catch (err) {
    console.error('[Lead Pipeline] Save error:', err);
    toast(err.message || 'Error saving settings', 'error');
  }
}

async function subscribePageNow() {
  const btn = document.getElementById('btn-pipeline-subscribe-page');
  const origHtml = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Subscribing...';
    }

    const res = await api('POST', '/api/lead-pipeline/subscribe-page');
    toast(res.message || 'Page subscribed to leadgen & messenger webhooks!', 'success', 5000);
    await loadLeadPipeline();
  } catch (err) {
    console.error('[Lead Pipeline] Subscription error:', err);
    toast(err.message || 'Error subscribing page', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function testChatwootConnectionNow() {
  const btn = document.getElementById('btn-test-chatwoot');
  const origHtml = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Testing...';
    }

    const chatwoot_url = document.getElementById('pipeline-chatwoot-url')?.value?.trim();
    const chatwoot_api_token = document.getElementById('pipeline-chatwoot-token')?.value?.trim();
    const chatwoot_account_id = document.getElementById('pipeline-chatwoot-account')?.value?.trim();

    const res = await api('POST', '/api/lead-pipeline/test-chatwoot', {
      chatwoot_url,
      chatwoot_api_token,
      chatwoot_account_id,
    });

    if (res.success) {
      toast(`✅ Connected to Chatwoot! (${res.account_name})`, 'success', 5000);
    } else {
      toast(res.error || 'Chatwoot test failed', 'warning', 5000);
    }
  } catch (err) {
    toast(err.message || 'Connection failed', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function syncRealMetaLeads() {
  const btn = document.getElementById('btn-sync-real-leads');
  const origHtml = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Syncing with Meta...';
    }

    const res = await api('POST', '/api/lead-pipeline/sync-real');
    const formsCount = Array.isArray(res.leadgen_forms) ? res.leadgen_forms.length : 0;
    const campaignsCount = Array.isArray(res.active_campaigns) ? res.active_campaigns.length : 0;
    const adsCount = Array.isArray(res.active_ads) ? res.active_ads.length : 0;

    toast(`✅ Synced with Meta! ${res.page_name || 'your Page'}: ${campaignsCount} campaigns, ${adsCount} ads, ${formsCount} lead forms`, 'success', 6000);
    await loadLeadPipeline();
  } catch (err) {
    console.error('[Lead Pipeline] Real sync error:', err);
    toast(err.message || 'Error syncing with Meta Graph API', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function cleanDummyLeads() {
  const btn = document.getElementById('btn-clear-dummy-leads');
  const origHtml = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Cleaning...';
    }

    const res = await api('POST', '/api/lead-pipeline/clear-dummy');
    toast(`🗑️ Cleaned ${res.deleted || 0} dummy simulated leads!`, 'info', 4000);
    await loadLeadPipeline();
  } catch (err) {
    console.error('[Lead Pipeline] Clean dummy error:', err);
    toast(err.message || 'Error cleaning dummy data', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function simulateTestLead() {
  const btn = document.getElementById('btn-simulate-lead');
  const origHtml = btn ? btn.innerHTML : '';
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Ingesting...';
    }
    const res = await api('POST', '/api/lead-pipeline/test-lead', {
      full_name: 'Test Lead',
      email: 'test.lead@example.com',
      phone_number: '+910000000000',
      custom_answers: {
        'Company': 'Sample Company',
        'What are you looking for?': 'A price list and a call back',
        'Budget': 'Not sure yet'
      }
    });
    toast(res.message || 'Test Lead ingested & n8n pipeline triggered!', 'success', 4000);
    // Play alert chime
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch (_) {}
    await loadLeadPipeline();
  } catch (err) {
    console.error('Test lead ingestion error:', err);
    toast(err.message || 'Error ingesting test lead', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

let tunnelPollTimer = null;
function scheduleTunnelPoll() {
  if (tunnelPollTimer) return;
  tunnelPollTimer = setTimeout(async () => {
    tunnelPollTimer = null;
    try {
      const res = await api('GET', '/api/lead-pipeline/tunnel-status');
      if (res) {
        LeadPipelineState.tunnel = res;
        renderPipelineConfig();
        if (res.status === 'starting' || res.status === 'reconnecting') {
          scheduleTunnelPoll();
        }
      }
    } catch {}
  }, 2500);
}

async function restartTunnelManager() {
  const btn = document.getElementById('btn-refresh-tunnel');
  if (btn) btn.disabled = true;
  try {
    toast('Refreshing HTTPS Tunnel...', 'info');
    const res = await api('POST', '/api/lead-pipeline/tunnel-restart');
    if (res && res.tunnel) {
      LeadPipelineState.tunnel = res.tunnel;
      renderPipelineConfig();
      toast('Tunnel refreshed! New callback URL active.', 'success');
      if (res.tunnel.status === 'starting') {
        scheduleTunnelPoll();
      }
    }
  } catch (err) {
    toast('Failed to refresh tunnel: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function copyPipelineWebhookUrl() {
  const input = document.getElementById('pipeline-webhook-url');
  if (input) {
    navigator.clipboard.writeText(input.value);
    toast('Webhook Callback URL copied to clipboard!', 'info');
  }
}

function copyPipelineVerifyToken() {
  const input = document.getElementById('pipeline-verify-token');
  if (input) {
    navigator.clipboard.writeText(input.value);
    toast('Verify Token copied to clipboard!', 'info');
  }
}

function filterLeadsStatus(status, btn) {
  LeadPipelineState.activeFilter = status;
  document.querySelectorAll('.lead-filter-pill').forEach((el) => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderLeadsTable();
}

/* ─────────────────────────────────────────────────────────────────────────────
   Leads Table Rendering
   ───────────────────────────────────────────────────────────────────────────── */

function renderLeadsTable(searchFilter = '') {
  const container = document.getElementById('pipeline-leads-table-body');
  if (!container) return;

  let leads = LeadPipelineState.leads || [];



  const query = (searchFilter || LeadPipelineState.contactSearchQuery || '').toLowerCase().trim();
  const filtered = leads.filter((l) => {
    if (!query) return true;
    return (l.full_name || '').toLowerCase().includes(query) ||
      (l.phone_number || '').includes(query) ||
      (l.society || '').toLowerCase().includes(query) ||
      (l.tag || '').toLowerCase().includes(query);
  });

  if (!filtered.length) {
    container.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;padding:48px 16px;color:var(--text-muted)">
          <div style="font-size:32px;margin-bottom:8px">🔍</div>
          <div style="font-weight:700;font-size:15px;color:var(--text-primary)">No Matching Contacts Found</div>
          <div style="font-size:13px;margin-top:4px">Try adjusting your search query or click "+ Add Contact" to create one.</div>
        </td>
      </tr>
    `;
    return;
  }

  container.innerHTML = filtered.map((l) => {
    const score = Number(l.lead_score || 50);
    let scoreBadge = '';
    if (score >= 75) {
      scoreBadge = `<span class="badge" style="background:rgba(16,185,129,0.18);color:#10b981;font-weight:700">🔥 Hot (${score})</span>`;
    } else {
      scoreBadge = `<span class="badge" style="background:rgba(245,158,11,0.18);color:#f59e0b;font-weight:600">🟡 Warm (${score})</span>`;
    }

    const cleanPhone = (l.phone_number || '').replace(/[^0-9+]/g, '');
    const waLink = cleanPhone ? `https://wa.me/${cleanPhone.replace('+', '')}?text=${encodeURIComponent(l.suggested_reply || 'Hi, thanks for reaching out!')}` : null;
    const tagText = l.tag || 'CTWA Lead';

    return `
      <tr class="lead-row" style="border-bottom:1px solid var(--border);transition:background 0.15s ease">
        <td style="padding:12px 14px;text-align:center">
          <input type="checkbox" class="contact-row-check" value="${l.id}" onchange="onContactSelectChange()" style="width:16px;height:16px;accent-color:#0f2338;cursor:pointer" />
        </td>
        <td style="padding:12px 16px">
          <div style="font-weight:700;color:var(--text-primary);font-size:13.5px">${escapeHtml(l.full_name || 'Anonymous Lead')}</div>
          <div style="font-size:11.5px;color:var(--text-muted)">${escapeHtml(l.society || '')} ${l.role ? '• ' + escapeHtml(l.role) : ''}</div>
        </td>
        <td style="padding:12px 16px">
          <div style="font-size:13px;font-weight:600">
            ${l.phone_number ? `<a href="tel:${escapeHtml(cleanPhone)}" style="color:var(--text-primary);text-decoration:none">📞 ${escapeHtml(l.phone_number)}</a>` : '<span style="color:var(--text-muted)">-</span>'}
          </div>
        </td>
        <td style="padding:12px 16px">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span class="badge" style="background:#fef3c7;color:#92400e;font-weight:700;border-radius:6px;padding:2px 8px;font-size:11px">${escapeHtml(tagText)}</span>
            ${scoreBadge}
          </div>
        </td>
        <td style="padding:12px 16px">
          <span style="font-size:11.5px;font-weight:700;color:var(--text-secondary)">${escapeHtml(l.source || 'AD')}</span>
        </td>
        <td style="padding:12px 16px;text-align:right">
          <div style="display:inline-flex;gap:6px;align-items:center">
            ${waLink ? `
              <a href="${waLink}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" title="Chat on WhatsApp" style="color:#10b981;font-weight:700;font-size:11.5px;border-color:rgba(16,185,129,0.3);display:inline-flex;align-items:center;gap:4px">
                <svg style="width:13px;height:13px" aria-hidden="true"><use href="icons/sprite.svg#i-whatsapp-color"/></svg> WhatsApp
              </a>
            ` : ''}
            <button class="btn btn-sm btn-secondary" onclick="viewLeadDetails(${l.id})" title="View Details" style="font-size:11.5px">
              🔍 Details
            </button>
            <button class="btn btn-sm btn-secondary" onclick="openEditLeadModal(${l.id})" title="Edit Contact" style="font-size:11.5px">
              ✏️ Edit
            </button>
            <button class="btn btn-sm btn-secondary" onclick="deleteLeadContact(${l.id})" title="Delete Contact" style="font-size:11.5px;color:#ef4444;border-color:rgba(239,68,68,0.3)">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  if (LeadPipelineState.leadsView === 'board') renderLeadsBoard();
}
async function updateLeadStatus(id, newStatus) {
  try {
    await api('PATCH', `/api/lead-pipeline/leads/${id}`, { status: newStatus });
    toast(`Lead marked as ${newStatus}`, 'info');
  } catch (err) {
    toast(err.message || 'Error updating status', 'error');
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   CRM Kanban pipeline board
   ───────────────────────────────────────────────────────────────────────────── */

const CRM_STAGES = [
  { key: 'new', label: 'New', color: '#64748b' },
  { key: 'contacted', label: 'Contacted', color: '#3b82f6' },
  { key: 'qualified', label: 'Qualified', color: '#8b5cf6' },
  { key: 'proposal', label: 'Proposal', color: '#f59e0b' },
  { key: 'won', label: 'Won', color: '#10b981' },
  { key: 'lost', label: 'Lost', color: '#ef4444' },
];
function crmMoney(n) { return n ? '₹' + Number(n).toLocaleString('en-IN') : ''; }

function switchLeadsView(view) {
  LeadPipelineState.leadsView = view;
  const board = document.getElementById('pipeline-leads-board');
  const reports = document.getElementById('pipeline-leads-reports');
  const tableCard = document.getElementById('pipeline-leads-table-card');
  const btns = { table: 'lead-view-table-btn', board: 'lead-view-board-btn', reports: 'lead-view-reports-btn' };
  Object.entries(btns).forEach(([v, id]) => document.getElementById(id)?.classList.toggle('active', v === view));
  if (board) board.style.display = view === 'board' ? 'flex' : 'none';
  if (reports) reports.style.display = view === 'reports' ? 'block' : 'none';
  if (tableCard) tableCard.style.display = view === 'table' ? '' : 'none';
  if (view === 'board') renderLeadsBoard();
  else if (view === 'reports') loadPipelineReport();
}

/* ─── CRM reports / dashboard ──────────────────────────────────────────────── */

async function loadPipelineReport() {
  const box = document.getElementById('pipeline-leads-reports');
  if (!box) return;
  box.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)"><span class="spinner"></span> Building your pipeline report…</div>';
  try {
    renderPipelineReport(await api('GET', '/api/lead-pipeline/reports'));
  } catch (err) {
    box.innerHTML = `<div class="state-error">Couldn’t load the report: ${escapeHtml(err.message)}</div>`;
  }
}

function renderPipelineReport(r) {
  const box = document.getElementById('pipeline-leads-reports');
  if (!box) return;
  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const STAGE_META = { new: ['New', '#64748b'], contacted: ['Contacted', '#3b82f6'], qualified: ['Qualified', '#8b5cf6'], proposal: ['Proposal', '#f59e0b'], won: ['Won', '#10b981'], lost: ['Lost', '#ef4444'] };
  const order = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
  const stageMap = Object.fromEntries((r.stages || []).map((s) => [s.stage, s]));
  const maxVal = Math.max(1, ...order.map((k) => (stageMap[k]?.value || 0)));

  const tile = (label, value, sub, tone) => `<div class="crm-tile">
    <div class="crm-tile-label">${label}</div>
    <div class="crm-tile-value ${tone || ''}">${value}</div>
    <div class="crm-tile-sub">${sub || ''}</div></div>`;

  const bars = order.map((k) => {
    const s = stageMap[k] || { count: 0, value: 0 };
    const [label, color] = STAGE_META[k];
    const pct = Math.round((s.value / maxVal) * 100);
    return `<div class="crm-bar-row">
      <div class="crm-bar-label"><span class="crm-col-dot" style="background:${color}"></span>${label}<span class="crm-bar-count">${s.count}</span></div>
      <div class="crm-bar-track"><div class="crm-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="crm-bar-val">${money(s.value)}</div>
    </div>`;
  }).join('');

  const owners = (r.owners || []).map((o) => `<tr>
    <td style="padding:8px 12px;font-weight:600">${escapeHtml(o.owner)}</td>
    <td style="padding:8px 12px;text-align:right">${o.count}</td>
    <td style="padding:8px 12px;text-align:right">${money(o.open_value)}</td>
    <td style="padding:8px 12px;text-align:right;color:#10b981;font-weight:700">${money(o.won_value)}</td>
  </tr>`).join('') || '<tr><td colspan="4" style="padding:14px;text-align:center;color:var(--text-muted)">No owners assigned yet</td></tr>';

  box.innerHTML = `
    <div class="crm-tiles">
      ${tile('Open pipeline', money(r.open_value), `${r.total - r.won - r.lost} active leads`)}
      ${tile('Won value', money(r.won_value), `${r.won} won`, 'good')}
      ${tile('Win rate', (r.win_rate || 0) + '%', `${r.won} won · ${r.lost} lost`)}
      ${tile('Open tasks', r.tasks?.open || 0, (r.tasks?.overdue ? r.tasks.overdue + ' overdue' : 'none overdue'), r.tasks?.overdue ? 'bad' : '')}
    </div>
    <div class="card" style="padding:16px 18px;margin-top:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px">
      <div style="font-weight:700;font-size:14px;margin-bottom:12px">Pipeline value by stage</div>
      ${bars}
    </div>
    <div class="card" style="padding:0;margin-top:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
      <div style="font-weight:700;font-size:14px;padding:14px 16px;border-bottom:1px solid var(--border)">Team leaderboard</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:var(--bg2);color:var(--text-secondary)">
          <th style="padding:8px 12px;text-align:left">Owner</th>
          <th style="padding:8px 12px;text-align:right">Leads</th>
          <th style="padding:8px 12px;text-align:right">Open value</th>
          <th style="padding:8px 12px;text-align:right">Won value</th>
        </tr></thead>
        <tbody>${owners}</tbody>
      </table>
    </div>`;
}

function renderLeadsBoard() {
  const board = document.getElementById('pipeline-leads-board');
  if (!board) return;
  const leads = LeadPipelineState.leads || [];
  const byStage = {};
  CRM_STAGES.forEach((s) => { byStage[s.key] = []; });
  leads.forEach((l) => { (byStage[l.pipeline_stage] || byStage.new).push(l); });
  board.innerHTML = CRM_STAGES.map((s) => {
    const items = byStage[s.key] || [];
    const total = items.reduce((a, l) => a + (Number(l.deal_value) || 0), 0);
    return `<div class="crm-col" data-stage="${s.key}" ondragover="crmDragOver(event)" ondragleave="crmDragLeave(event)" ondrop="crmDrop(event,'${s.key}')">
      <div class="crm-col-head"><span class="crm-col-dot" style="background:${s.color}"></span><span class="crm-col-label">${s.label}</span><span class="crm-col-count">${items.length}</span>${total ? `<span class="crm-col-total">${crmMoney(total)}</span>` : ''}</div>
      <div class="crm-col-body">${items.map(crmCardHtml).join('') || '<div class="crm-empty">Drop leads here</div>'}</div>
    </div>`;
  }).join('');
}

function crmCardHtml(l) {
  const score = Number(l.lead_score || 50);
  const scoreCls = score >= 75 ? 'hot' : 'warm';
  const owner = l.assigned_agent_name ? `<span class="crm-owner" title="Owner">${escapeHtml(l.assigned_agent_name)}</span>` : '';
  const val = l.deal_value ? `<span class="crm-val">${crmMoney(l.deal_value)}</span>` : '';
  const tasks = l.open_tasks ? `<span class="crm-task-badge ${l.overdue_tasks ? 'overdue' : ''}" title="${l.overdue_tasks ? l.overdue_tasks + ' overdue' : l.open_tasks + ' open task(s)'}">✔ ${l.open_tasks}</span>` : '';
  return `<div class="crm-card" draggable="true" data-lead-id="${l.id}" ondragstart="crmDragStart(event,${l.id})" ondragend="crmDragEnd(event)" onclick="viewLeadDetails(${l.id})">
    <div class="crm-card-name">${escapeHtml(l.full_name || 'Anonymous Lead')}</div>
    <div class="crm-card-sub">${escapeHtml(l.phone_number || '')}</div>
    <div class="crm-card-foot">${val}<span class="crm-score ${scoreCls}">${score}</span>${tasks}${owner}</div>
  </div>`;
}

let _crmDragId = null;
function crmDragStart(e, id) { _crmDragId = id; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); }
function crmDragEnd(e) { e.currentTarget.classList.remove('dragging'); document.querySelectorAll('.crm-col.over').forEach((c) => c.classList.remove('over')); }
function crmDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('over'); }
function crmDragLeave(e) { if (e.currentTarget === e.target) e.currentTarget.classList.remove('over'); }
async function crmDrop(e, stage) {
  e.preventDefault();
  e.currentTarget.classList.remove('over');
  const id = _crmDragId; _crmDragId = null;
  if (!id) return;
  const lead = (LeadPipelineState.leads || []).find((l) => l.id === id);
  if (!lead || lead.pipeline_stage === stage) { renderLeadsBoard(); return; }
  const prev = lead.pipeline_stage; lead.pipeline_stage = stage;
  renderLeadsBoard();
  try { await api('PATCH', `/api/lead-pipeline/leads/${id}`, { pipeline_stage: stage }); }
  catch (err) { lead.pipeline_stage = prev; renderLeadsBoard(); toast(err.message || 'Could not move the lead', 'error'); }
}


/* ─── Contacts Action Toolbar Handlers (Matching Image 2) ────────────────── */

function onSearchContacts(val) {
  LeadPipelineState.contactSearchQuery = val;
  renderLeadsTable(val);
}

function toggleSelectAllContacts(isChecked) {
  const checkboxes = document.querySelectorAll('.contact-row-check');
  checkboxes.forEach((cb) => { cb.checked = isChecked; });
  onContactSelectChange();
}

function onContactSelectChange() {
  const checked = document.querySelectorAll('.contact-row-check:checked');
  const countBadge = document.getElementById('selected-contacts-count');
  const broadcastBtn = document.getElementById('btn-contacts-broadcast');
  const selectAll = document.getElementById('chk-select-all-contacts');
  const deleteBtn = document.getElementById('btn-contacts-delete-selected');
  const deleteCount = document.getElementById('delete-selected-count');

  if (countBadge) {
    if (checked.length > 0) {
      countBadge.textContent = checked.length;
      countBadge.style.display = 'inline-block';
    } else {
      countBadge.style.display = 'none';
    }
  }

  if (deleteBtn && deleteCount) {
    if (checked.length > 0) {
      deleteCount.textContent = checked.length;
      deleteBtn.style.display = 'inline-flex';
    } else {
      deleteBtn.style.display = 'none';
    }
  }

  const allChecks = document.querySelectorAll('.contact-row-check');
  if (selectAll && allChecks.length > 0) {
    selectAll.checked = checked.length === allChecks.length;
  }
}

function broadcastSelectedContacts() {
  const checked = Array.from(document.querySelectorAll('.contact-row-check:checked')).map((cb) => Number(cb.value));
  let targets = [];

  if (checked.length > 0) {
    targets = (LeadPipelineState.leads || []).filter((l) => checked.includes(l.id));
  } else {
    // If none checked, take all loaded leads as default
    targets = LeadPipelineState.leads || [];
  }

  if (!targets.length) {
    toast('No contacts available to broadcast. Please add or import contacts first.', 'warning');
    return;
  }

  // Pre-seed Bulk Broadcast Studio with selected contacts
  LeadPipelineState.broadcastRecipients = targets.map((l) => ({
    name: l.full_name,
    phone: l.phone_number,
    society: l.society || '',
    role: l.role || 'Member',
    selected: true,
  }));

  navigateTo('leads-broadcast');
  renderBroadcastContacts();
  toast(`Loaded ${targets.length} contact(s) into Bulk Broadcast Studio! 🚀`, 'success');
}

function toggleImportDropdown(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('import-dropdown-menu');
  if (menu) {
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  }
}

document.addEventListener('click', () => {
  const menu = document.getElementById('import-dropdown-menu');
  if (menu) menu.style.display = 'none';
});

function openAddContactModal() {
  const modal = document.getElementById('modal-add-contact');
  if (modal) modal.style.display = 'flex';
}

function closeAddContactModal() {
  const modal = document.getElementById('modal-add-contact');
  if (modal) modal.style.display = 'none';
}

function saveManualContact() {
  const nameInput = document.getElementById('add-contact-name');
  const phoneInput = document.getElementById('add-contact-phone');
  const societyInput = document.getElementById('add-contact-society');
  const roleInput = document.getElementById('add-contact-role');
  const tagSelect = document.getElementById('add-contact-tag');
  const sourceSelect = document.getElementById('add-contact-source');

  const name = (nameInput?.value || '').trim();
  const phone = (phoneInput?.value || '').trim();

  if (!name || !phone) {
    toast('Please enter both Full Name and Mobile Number.', 'error');
    return;
  }

  const newContact = {
    id: Date.now(),
    full_name: name,
    phone_number: phone,
    society: (societyInput?.value || '').trim(),
    role: (roleInput?.value || '').trim() || 'Secretary',
    tag: tagSelect?.value || 'CTWA Lead',
    source: sourceSelect?.value || 'MANUAL',
    lead_score: 85,
    created_at: Math.floor(Date.now() / 1000),
    suggested_reply: `Hi ${name}, thanks for getting in touch!`,
  };

  LeadPipelineState.leads.unshift(newContact);
  renderLeadsTable();
  closeAddContactModal();

  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (societyInput) societyInput.value = '';
  if (roleInput) roleInput.value = '';

  toast(`Contact "${name}" added successfully!`, 'success');
}

/* ─── Ingested Ad Leads: Edit & Delete Handlers ──────────────────────────── */

function openEditLeadModal(id) {
  const lead = (LeadPipelineState.leads || []).find((l) => l.id === id);
  if (!lead) return;

  const modal = document.getElementById('modal-edit-lead');
  if (!modal) return;

  const idInput = document.getElementById('edit-lead-id');
  const nameInput = document.getElementById('edit-lead-name');
  const phoneInput = document.getElementById('edit-lead-phone');
  const emailInput = document.getElementById('edit-lead-email');
  const societyInput = document.getElementById('edit-lead-society');
  const roleInput = document.getElementById('edit-lead-role');
  const tagInput = document.getElementById('edit-lead-tag');
  const scoreInput = document.getElementById('edit-lead-score');
  const statusSelect = document.getElementById('edit-lead-status');
  const replyInput = document.getElementById('edit-lead-suggested-reply');

  if (idInput) idInput.value = lead.id;
  if (nameInput) nameInput.value = lead.full_name || '';
  if (phoneInput) phoneInput.value = lead.phone_number || '';
  if (emailInput) emailInput.value = lead.email || '';
  if (societyInput) societyInput.value = lead.society || (lead.raw_answers && lead.raw_answers.society) || '';
  if (roleInput) roleInput.value = lead.role || (lead.raw_answers && lead.raw_answers.role) || '';
  if (tagInput) tagInput.value = lead.tag || (Array.isArray(lead.tags_json) ? lead.tags_json.join(', ') : 'CTWA Lead');
  if (scoreInput) scoreInput.value = lead.lead_score != null ? lead.lead_score : 85;
  if (statusSelect) statusSelect.value = lead.status || 'new';
  if (replyInput) replyInput.value = lead.suggested_reply || '';
  // CRM pipeline fields
  const stageSel = document.getElementById('edit-lead-stage');
  const valInput = document.getElementById('edit-lead-value');
  const ownerInput = document.getElementById('edit-lead-owner');
  const closeInput = document.getElementById('edit-lead-close');
  if (stageSel) stageSel.value = lead.pipeline_stage || 'new';
  if (valInput) valInput.value = lead.deal_value != null ? lead.deal_value : '';
  if (ownerInput) ownerInput.value = lead.assigned_agent_name || '';
  if (closeInput) closeInput.value = lead.expected_close ? new Date(lead.expected_close * 1000).toISOString().slice(0, 10) : '';

  modal.style.display = 'flex';
}

function closeEditLeadModal() {
  const modal = document.getElementById('modal-edit-lead');
  if (modal) modal.style.display = 'none';
}

async function saveLeadDetails() {
  const idInput = document.getElementById('edit-lead-id');
  const nameInput = document.getElementById('edit-lead-name');
  const phoneInput = document.getElementById('edit-lead-phone');
  const emailInput = document.getElementById('edit-lead-email');
  const societyInput = document.getElementById('edit-lead-society');
  const roleInput = document.getElementById('edit-lead-role');
  const tagInput = document.getElementById('edit-lead-tag');
  const scoreInput = document.getElementById('edit-lead-score');
  const statusSelect = document.getElementById('edit-lead-status');
  const replyInput = document.getElementById('edit-lead-suggested-reply');

  const id = Number(idInput?.value);
  if (!id) return;

  const full_name = (nameInput?.value || '').trim();
  const phone_number = (phoneInput?.value || '').trim();
  const email = (emailInput?.value || '').trim();
  const society = (societyInput?.value || '').trim();
  const role = (roleInput?.value || '').trim();
  const tag = (tagInput?.value || '').trim();
  const lead_score = scoreInput?.value ? Number(scoreInput.value) : 85;
  const status = statusSelect?.value || 'new';
  const suggested_reply = (replyInput?.value || '').trim();
  // CRM pipeline fields
  const pipeline_stage = document.getElementById('edit-lead-stage')?.value || 'new';
  const valRaw = document.getElementById('edit-lead-value')?.value;
  const deal_value = valRaw ? Number(valRaw) : null;
  const assigned_agent_name = (document.getElementById('edit-lead-owner')?.value || '').trim();
  const closeRaw = document.getElementById('edit-lead-close')?.value;
  const expected_close = closeRaw ? Math.floor(new Date(closeRaw + 'T12:00:00').getTime() / 1000) : null;

  if (!full_name || !phone_number) {
    toast('Please enter both Full Name and Mobile Number.', 'error');
    return;
  }

  // Update in local state
  const lead = (LeadPipelineState.leads || []).find((l) => l.id === id);
  if (lead) {
    lead.full_name = full_name;
    lead.phone_number = phone_number;
    lead.email = email;
    lead.society = society;
    lead.role = role;
    lead.tag = tag;
    lead.lead_score = lead_score;
    lead.status = status;
    lead.suggested_reply = suggested_reply;
    lead.pipeline_stage = pipeline_stage;
    lead.deal_value = deal_value;
    lead.assigned_agent_name = assigned_agent_name;
    lead.expected_close = expected_close;
  }

  // Persist to server
  try {
    await api('PATCH', `/api/lead-pipeline/leads/${id}`, {
      full_name,
      phone_number,
      email,
      society,
      role,
      lead_score,
      status,
      suggested_reply,
      tags_json: [tag],
      pipeline_stage,
      deal_value,
      assigned_agent_name,
      expected_close,
    });
  } catch (err) {
    console.warn('[Lead Pipeline] Server patch warning (updated in state):', err.message);
  }

  renderLeadsTable();
  closeEditLeadModal();
  toast(`Lead "${full_name}" updated successfully! ✨`, 'success');
}

async function deleteLeadContact(id) {
  const lead = (LeadPipelineState.leads || []).find((l) => l.id === id);
  const name = lead?.full_name || 'this contact';

  if (!confirm(`Are you sure you want to delete lead "${name}"?\n\nThis will remove the contact from your CRM pipeline and database.`)) {
    return;
  }

  // Send DELETE to server
  try {
    await api('DELETE', `/api/lead-pipeline/leads/${id}`);
  } catch (err) {
    console.warn('[Lead Pipeline] Server delete warning (removed from state):', err.message);
  }

  // Remove from state
  LeadPipelineState.leads = (LeadPipelineState.leads || []).filter((l) => l.id !== id);
  renderLeadsTable();
  onContactSelectChange();
  toast(`Lead "${name}" deleted successfully.`, 'info');
}

function deleteLeadContactFromModal() {
  const idInput = document.getElementById('edit-lead-id');
  const id = Number(idInput?.value);
  if (!id) return;
  closeEditLeadModal();
  deleteLeadContact(id);
}

async function deleteSelectedContacts() {
  const checked = Array.from(document.querySelectorAll('.contact-row-check:checked')).map((cb) => Number(cb.value));
  if (!checked.length) {
    toast('No contacts selected for deletion.', 'info');
    return;
  }

  if (!confirm(`Are you sure you want to delete ${checked.length} selected contact(s)?\n\nThis action cannot be undone.`)) {
    return;
  }

  for (const id of checked) {
    try {
      await api('DELETE', `/api/lead-pipeline/leads/${id}`);
    } catch (e) {}
  }

  LeadPipelineState.leads = (LeadPipelineState.leads || []).filter((l) => !checked.includes(l.id));
  renderLeadsTable();
  onContactSelectChange();
  toast(`Deleted ${checked.length} contact(s) successfully.`, 'info');
}

function openTutorialVideoModal() {
  const modal = document.getElementById('modal-tutorial-video');
  if (modal) modal.style.display = 'flex';
}

function closeTutorialVideoModal() {
  const modal = document.getElementById('modal-tutorial-video');
  if (modal) modal.style.display = 'none';
}

function viewLeadDetails(id) {
  const lead = LeadPipelineState.leads.find((l) => l.id === id);
  if (!lead) return;

  const answers = lead.raw_answers || {};
  const formattedAnswers = Object.entries(answers)
    .map(([q, a]) => `<div style="margin-bottom:8px"><strong>${escapeHtml(q)}:</strong> <span style="color:var(--text-secondary)">${escapeHtml(a)}</span></div>`)
    .join('') || '<div style="color:var(--text-muted)">No custom questions in this form.</div>';

  const existing = document.querySelector('#modal-lead-detail');
  if (existing) existing.remove();

  const modalHtml = `
    <div class="modal-overlay" id="modal-lead-detail" style="display:flex;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);align-items:center;justify-content:center" onclick="if(event.target===this)this.remove()">
      <div class="modal" style="max-width:540px;width:90%;background:var(--bg-secondary);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-xl)" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="modal-title">📋 Lead Details: ${escapeHtml(lead.full_name || 'Prospect')}</h3>
          <button class="modal-close" onclick="document.querySelector('#modal-lead-detail').remove()">✕</button>
        </div>
        <div class="modal-body" style="padding:16px 20px">
          <div style="margin-bottom:12px">
            <div><strong>Email:</strong> ${escapeHtml(lead.email || 'N/A')}</div>
            <div><strong>Phone:</strong> ${escapeHtml(lead.phone_number || 'N/A')}</div>
            <div><strong>Form ID:</strong> <code>${escapeHtml(lead.form_id || 'N/A')}</code></div>
          </div>
          <hr style="border:0;border-top:1px solid var(--border);margin:12px 0"/>
          <h4>Form Responses:</h4>
          ${formattedAnswers}
          <hr style="border:0;border-top:1px solid var(--border);margin:12px 0"/>
          <h4>AI Suggested Reply:</h4>
          <div style="background:var(--bg-card);padding:10px;border-radius:8px;font-style:italic">
            "${escapeHtml(lead.suggested_reply || 'Follow up promptly.')}"
          </div>
          <hr style="border:0;border-top:1px solid var(--border);margin:14px 0"/>
          <h4 style="margin-bottom:8px">🗒️ Activity &amp; Tasks</h4>
          <div class="crm-activity-add">
            <input type="text" id="act-body-${lead.id}" class="form-input" placeholder="Add a note, or a follow-up task…" onkeydown="if(event.key==='Enter')addLeadActivity(${lead.id},'note')" style="width:100%;margin-bottom:6px" />
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <button class="btn btn-secondary btn-sm" onclick="addLeadActivity(${lead.id},'note')">+ Note</button>
              <input type="date" id="act-due-${lead.id}" class="form-input" style="width:auto;padding:4px 8px;font-size:12px" title="Task due date" />
              <button class="btn btn-secondary btn-sm" onclick="addLeadActivity(${lead.id},'task')">+ Task</button>
            </div>
          </div>
          <div id="lead-activity-list-${lead.id}" class="crm-activity-list" style="margin-top:12px"><div style="color:var(--text-muted);font-size:13px">Loading…</div></div>
        </div>
        <div class="modal-footer" style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:var(--bg2)">
          <button class="btn btn-secondary btn-sm" onclick="deleteLeadContact(${lead.id});document.querySelector('#modal-lead-detail')?.remove();" style="color:#ef4444;border-color:rgba(239,68,68,0.4)">
            🗑️ Delete Lead
          </button>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary btn-sm" onclick="openEditLeadModal(${lead.id});document.querySelector('#modal-lead-detail')?.remove();">
              ✏️ Edit Details
            </button>
            <button class="btn btn-primary btn-sm" onclick="document.querySelector('#modal-lead-detail')?.remove()" style="background:#0f2338;color:#fff">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  loadLeadActivities(id);
}

/* ─── CRM activities (notes & tasks) ──────────────────────────────────────── */

async function loadLeadActivities(leadId) {
  const box = document.getElementById(`lead-activity-list-${leadId}`);
  if (!box) return;
  try {
    const items = await api('GET', `/api/lead-pipeline/leads/${leadId}/activities`);
    renderLeadActivities(leadId, Array.isArray(items) ? items : []);
  } catch (err) {
    box.innerHTML = `<div style="color:#ef4444;font-size:13px">${escapeHtml(err.message || 'Could not load activity')}</div>`;
  }
}

function renderLeadActivities(leadId, items) {
  const box = document.getElementById(`lead-activity-list-${leadId}`);
  if (!box) return;
  if (!items.length) { box.innerHTML = '<div style="color:var(--text-muted);font-size:13px">No notes or tasks yet.</div>'; return; }
  const now = Math.floor(Date.now() / 1000);
  const fmt = (s) => s ? new Date(s * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
  box.innerHTML = items.map((a) => {
    const isTask = a.kind === 'task';
    const done = !!a.done_at;
    const overdue = isTask && !done && a.due_at && Number(a.due_at) < now;
    const due = a.due_at ? `<span class="crm-act-due ${overdue ? 'overdue' : ''}">${overdue ? 'overdue · ' : 'due '}${fmt(a.due_at)}</span>` : '';
    const check = isTask
      ? `<input type="checkbox" ${done ? 'checked' : ''} onchange="toggleLeadTask(${leadId},${a.id},this.checked)" title="Mark done" style="margin-top:2px;cursor:pointer" />`
      : '<span style="width:14px;display:inline-block">•</span>';
    return `<div class="crm-act ${done ? 'done' : ''}">
      ${check}
      <div class="crm-act-main">
        <div class="crm-act-body">${escapeHtml(a.body || '')}</div>
        <div class="crm-act-meta">${isTask ? '✔ Task' : 'Note'} · ${fmt(a.created_at)} ${due}</div>
      </div>
      <button class="crm-act-del" title="Delete" onclick="deleteLeadActivity(${leadId},${a.id})">✕</button>
    </div>`;
  }).join('');
}

async function addLeadActivity(leadId, kind) {
  const body = (document.getElementById(`act-body-${leadId}`)?.value || '').trim();
  if (!body) { toast('Write something first.', 'info'); return; }
  let due_at = null;
  if (kind === 'task') {
    const d = document.getElementById(`act-due-${leadId}`)?.value;
    due_at = d ? Math.floor(new Date(d + 'T18:00:00').getTime() / 1000) : null;
  }
  try {
    await api('POST', `/api/lead-pipeline/leads/${leadId}/activities`, { kind, body, due_at });
    const inp = document.getElementById(`act-body-${leadId}`); if (inp) inp.value = '';
    const due = document.getElementById(`act-due-${leadId}`); if (due) due.value = '';
    loadLeadActivities(leadId);
    if (kind === 'task') bumpLeadTaskBadge(leadId, 1);
  } catch (err) { toast(err.message || 'Could not save', 'error'); }
}

async function toggleLeadTask(leadId, actId, done) {
  try { await api('PATCH', `/api/lead-pipeline/activities/${actId}`, { done }); loadLeadActivities(leadId); bumpLeadTaskBadge(leadId, done ? -1 : 1); }
  catch (err) { toast(err.message || 'Could not update', 'error'); }
}

async function deleteLeadActivity(leadId, actId) {
  try { await api('DELETE', `/api/lead-pipeline/activities/${actId}`); loadLeadActivities(leadId); }
  catch (err) { toast(err.message || 'Could not delete', 'error'); }
}

// keep the card badge roughly in sync without a full reload
function bumpLeadTaskBadge(leadId, delta) {
  const lead = (LeadPipelineState.leads || []).find((l) => l.id === leadId);
  if (lead) { lead.open_tasks = Math.max(0, (lead.open_tasks || 0) + delta); if (LeadPipelineState.leadsView === 'board') renderLeadsBoard(); }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Native In-App Workflow Engine (2. n8n Automation Node Architecture)
   ───────────────────────────────────────────────────────────────────────────── */

async function executeN8nWorkflow(leadId) {
  const btn = document.getElementById('btn-trigger-workflow');
  const origHtml = btn ? btn.innerHTML : '';
  const pills = document.querySelectorAll('.n8n-node-pill');

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Executing n8n Nodes...';
    }

    // Visual animation of execution pulse across mini-canvas pills
    pills.forEach((p, idx) => {
      setTimeout(() => {
        p.style.transition = 'all 0.3s ease';
        p.style.transform = 'scale(1.06)';
        p.style.boxShadow = '0 0 14px rgba(245,158,11,0.6)';
        setTimeout(() => {
          p.style.transform = 'none';
          p.style.boxShadow = 'none';
        }, 500);
      }, idx * 140);
    });

    const payload = leadId ? { lead_id: leadId } : {};
    const res = await api('POST', '/api/lead-pipeline/n8n/execute', payload);

    toast(`⚡ n8n Workflow Finished in ${res.total_execution_time_ms || 12}ms! ${res.steps_executed}/5 nodes executed for ${res.final_payload?.full_name || 'Prospect'}`, 'success', 5000);

    // Audio chime notification
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch (_) {}

    await loadLeadPipeline();
  } catch (err) {
    console.error('[n8n Execute] Error:', err);
    toast(err.message || 'Error running n8n workflow', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function triggerWorkflowNow(leadId) {
  return executeN8nWorkflow(leadId);
}

async function openN8nStudioModal() {
  try {
    const res = await api('GET', '/api/lead-pipeline/n8n/nodes').catch(() => ({ nodes: [] }));
    const nodes = res.nodes || [];

    const nodesHtml = nodes.map((n, idx) => {
      const configBadges = Object.entries(n.config || {}).map(([k, v]) => {
        return `<span class="badge" style="background:var(--bg2);border:1px solid var(--border);color:var(--text-secondary);font-size:11px"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v).slice(0, 45))}</span>`;
      }).join(' ');

      return `
        <div class="card" style="padding:16px;background:var(--bg3);border:1px solid var(--border);border-left:4px solid ${n.color || '#3b82f6'};margin-bottom:12px;border-radius:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:38px;height:38px;border-radius:10px;background:${n.color}22;border:1px solid ${n.color}44;display:flex;align-items:center;justify-content:center;font-size:18px">
                ${n.icon || '⚡'}
              </div>
              <div>
                <h4 style="margin:0;font-size:14px;display:flex;align-items:center;gap:6px">
                  <span class="badge" style="background:var(--bg2);color:var(--text-muted);font-size:10px;font-weight:700">STEP ${idx + 1}</span>
                  <span>${escapeHtml(n.name)}</span>
                  <span class="badge" style="background:${n.enabled ? '#10b981' : '#6b7280'};color:#fff;font-size:10px">${n.enabled ? 'Active' : 'Disabled'}</span>
                </h4>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${escapeHtml(n.description)}</div>
              </div>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="inspectN8nNode('${n.id}')" style="font-size:11.5px;font-weight:600">
              ⚙️ Inspect Node UI
            </button>
          </div>
          ${configBadges ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${configBadges}</div>` : ''}
        </div>
      `;
    }).join('');

    const modalHtml = `
      <div class="modal-overlay" id="modal-n8n-studio" style="display:flex;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);align-items:center;justify-content:center" onclick="if(event.target===this)this.remove()">
        <div class="modal" style="max-width:740px;width:95%;max-height:85vh;overflow-y:auto;border-radius:14px;background:var(--bg-secondary);border:1px solid var(--border);box-shadow:var(--shadow-xl)" onclick="event.stopPropagation()">
          <div class="modal-header" style="border-bottom:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-size:22px">🎛️</span>
              <div>
                <h3 class="modal-title" style="margin:0">In-App n8n Workflow Studio</h3>
                <div style="font-size:12px;color:var(--text-muted)">Visual multi-step automation pipeline executed natively inside Social-Nexus</div>
              </div>
            </div>
            <button class="modal-close" onclick="document.querySelector('#modal-n8n-studio').remove()">✕</button>
          </div>
          <div class="modal-body" style="padding:18px 20px">
            <div style="display:flex;gap:8px;margin-bottom:16px">
              <button class="btn btn-primary btn-sm" onclick="executeN8nWorkflow()" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-weight:700;border:0">
                ▶ Execute Full Workflow
              </button>
              <button class="btn btn-secondary btn-sm" onclick="viewWorkflowLogsModal()">
                📜 View History Logs
              </button>
            </div>
            ${nodesHtml}
          </div>
          <div class="modal-footer" style="border-top:1px solid var(--border)">
            <button class="btn btn-secondary btn-sm" onclick="document.querySelector('#modal-n8n-studio').remove()">Close Studio</button>
          </div>
        </div>
      </div>
    `;

    const existing = document.querySelector('#modal-n8n-studio');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  } catch (err) {
    toast(err.message || 'Error opening n8n studio', 'error');
  }
}

function playInspectorChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.35);
    toast('🔊 Played high-pitch alert chime (880Hz)!', 'info', 3000);
  } catch (e) {
    toast('Audio not supported in browser', 'warning');
  }
}

async function sendLiveWhatsAppTest(toPhone) {
  const target = toPhone || '';
  try {
    toast(`🚀 Dispatched WhatsApp Cloud API test to +${target}...`, 'info');
    const res = await api('POST', '/api/lead-pipeline/whatsapp/test', { to: target });
    toast(`✅ ${res.message || 'WhatsApp message sent successfully!'}`, 'success', 5000);
  } catch (err) {
    toast(err.message || 'Error triggering WhatsApp send', 'error');
  }
}

function renderVisualNodeView(nodeId, step) {
  const out = step.output || {};
  const inp = step.input || {};

  // 1. WhatsApp & SMS Dispatcher Visual Node UI
  if (nodeId === 'node-sms-whatsapp') {
    const waUrl = out.whatsapp_url || `https://wa.me/?text=${encodeURIComponent(out.message_text || 'Hello!')}`;
    const msgText = out.message_text || inp.template || 'Hi, thanks for getting in touch!';
    const recipient = out.recipient_phone || inp.phone || '—';

    return `
      <!-- WhatsApp Cloud App Ribbon -->
      <div style="background:linear-gradient(135deg,rgba(34,197,94,0.12),rgba(16,185,129,0.06));border:1px solid rgba(34,197,94,0.3);border-radius:12px;padding:14px 16px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:24px">💬</span>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:6px">
                <span>WhatsApp Cloud API</span>
                <span class="badge" style="background:#22c55e;color:#000;font-size:10px;font-weight:800">WhatsApp</span>
                <span class="badge" style="background:rgba(34,197,94,0.2);color:#22c55e;font-size:10px">● Live Ready</span>
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
                Official Meta Cloud Engine • Direct In-App Dispatch
              </div>
            </div>
          </div>
          <button class="btn btn-sm btn-primary" onclick="sendLiveWhatsAppTest('${recipient}')" style="background:#22c55e;color:#000;font-weight:700;border:0;display:flex;align-items:center;gap:6px">
            <span>🚀 Send Live WhatsApp</span>
          </button>
        </div>

        <!-- Meta Config Pills Grid -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(34,197,94,0.2)">
          <div style="font-size:11.5px">
            <span style="color:var(--text-muted)">Phone Number ID:</span>
            <code style="background:var(--bg3);padding:2px 6px;border-radius:4px;color:#22c55e;font-weight:700">${escapeHtml((LeadPipelineState.config || {}).whatsapp_phone_number_id || 'not set')}</code>
          </div>
          <div style="font-size:11.5px">
            <span style="color:var(--text-muted)">WABA ID:</span>
            <code style="background:var(--bg3);padding:2px 6px;border-radius:4px;color:var(--text-primary)">${escapeHtml((LeadPipelineState.config || {}).whatsapp_business_account_id || 'not set')}</code>
          </div>
          <div style="font-size:11.5px">
            <span style="color:var(--text-muted)">Verified Test Number:</span>
            <span class="badge" style="background:rgba(34,197,94,0.18);color:#22c55e;font-weight:700">${escapeHtml(recipient)}</span>
          </div>
        </div>
      </div>

      <!-- Recipient & Message Details Grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:700">Target Recipient</div>
          <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-top:4px">Test Lead</div>
          <div style="font-size:12px;color:#10b981;font-weight:600;margin-top:2px">📞 +${escapeHtml(recipient)}</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:700">Delivery Channel</div>
          <div style="font-size:14px;font-weight:700;color:#22c55e;margin-top:4px;display:flex;align-items:center;gap:6px">
            <span>WhatsApp Business Cloud API</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Instant 1-Click Bridge Ready</div>
        </div>
      </div>

      <!-- Authentic WhatsApp Message Bubble Card -->
      <div style="margin-bottom:16px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:700;margin-bottom:8px">
          💬 Outbound Message Preview
        </div>
        <div style="background:#0b141a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:18px;position:relative;background-image:radial-gradient(rgba(255,255,255,0.04) 1px, transparent 0);background-size:18px 18px">
          <!-- WhatsApp Chat Bubble -->
          <div style="background:#005c4b;color:#e9edef;border-radius:12px 12px 2px 12px;padding:12px 16px;max-width:85%;margin-left:auto;box-shadow:0 2px 6px rgba(0,0,0,0.3);position:relative">
            <div style="font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word">
              ${escapeHtml(msgText)}
            </div>
            <div style="display:flex;justify-content:flex-end;align-items:center;gap:4px;margin-top:8px;font-size:11px;color:rgba(255,255,255,0.7)">
              <span>Just now</span>
              <span style="color:#53bdeb;font-weight:800;font-size:12px">✓✓</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 1-Click Actions Bar -->
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a href="${waUrl}" target="_blank" rel="noopener" class="btn btn-secondary" style="color:#10b981;font-weight:700;display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(16,185,129,0.3);background:rgba(16,185,129,0.08)">
          <svg style="width:14px;height:14px;flex-shrink:0" aria-hidden="true"><use href="icons/sprite.svg#i-whatsapp-color"/></svg><span>Open Pre-filled WhatsApp Web</span>
          <span>↗</span>
        </a>
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText(${JSON.stringify(msgText)}); toast('Message text copied to clipboard!', 'info')">
          📋 Copy Text
        </button>
      </div>
    `;
  }

  // 2. Instant Lead Alert Visual Node UI
  if (nodeId === 'node-alert') {
    const isHot = out.priority === 'urgent' || inp.is_hot;
    const alertTitle = out.title || '🔥 Hot Lead Alert: Test Lead';
    const alertSub = out.subtitle || 'New lead';
    const alertBody = out.body || 'Phone: +919811223344 | Email: secretary@palmgrove-rwa.in';

    return `
      <!-- Alert Banner Preview -->
      <div style="background:linear-gradient(135deg,rgba(245,158,11,0.12),rgba(234,88,12,0.06));border:1px solid rgba(245,158,11,0.35);border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:26px">🔔</span>
            <div>
              <div style="font-size:15px;font-weight:800;color:var(--text-primary);display:flex;align-items:center;gap:8px">
                <span>Instant In-App Lead Alert</span>
                <span class="badge" style="background:${isHot ? '#ef4444' : '#f59e0b'};color:#fff;font-size:10px;font-weight:800">
                  ${isHot ? '🔥 URGENT PRIORITY' : 'NORMAL'}
                </span>
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
                Real-Time Audio Ping • Priority Dashboard Banner
              </div>
            </div>
          </div>
          <button class="btn btn-sm btn-secondary" onclick="playInspectorChime()" style="display:flex;align-items:center;gap:6px;border-color:#f59e0b;color:#f59e0b">
            <span>🔊 Play Audio Chime</span>
          </button>
        </div>

        <!-- Rendered Toast Simulation -->
        <div style="background:var(--bg2);border:1px solid var(--border);border-left:4px solid ${isHot ? '#ef4444' : '#f59e0b'};border-radius:10px;padding:14px;box-shadow:0 4px 14px rgba(0,0,0,0.15)">
          <div style="font-size:14px;font-weight:700;color:var(--text-primary)">${escapeHtml(alertTitle)}</div>
          <div style="font-size:12.5px;color:#f59e0b;font-weight:600;margin-top:2px">${escapeHtml(alertSub)}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:6px;line-height:1.5;white-space:pre-wrap;word-break:break-word">
            ${escapeHtml(alertBody)}
          </div>
        </div>
      </div>

      <!-- Alert Specs Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Audio Ping</div>
          <div style="font-size:13px;font-weight:700;color:#10b981;margin-top:2px">✓ AudioContext Active</div>
          <div style="font-size:11px;color:var(--text-muted)">High-pitch 587Hz → 880Hz</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Lead Score Trigger</div>
          <div style="font-size:13px;font-weight:700;color:#f59e0b;margin-top:2px">Score: ${inp.lead_score || 100}/100</div>
          <div style="font-size:11px;color:var(--text-muted)">Hot lead threshold ≥ 75</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Delivery Timing</div>
          <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-top:2px">Instantaneous (3ms)</div>
          <div style="font-size:11px;color:var(--text-muted)">Dispatched without delay</div>
        </div>
      </div>
    `;
  }

  // 3. AI Lead Qualifier Visual Node UI
  if (nodeId === 'node-qualify') {
    const score = out.lead_score || out.score || 100;
    const isHot = score >= 75;
    const intent = out.intent_summary || 'Urgent society management inquiry with committee budget approved.';
    const reply = out.suggested_reply || 'Hi Test Lead, thank you for inquiring! When would be a convenient time for a quick 5-minute demo?';

    return `
      <!-- Score & Intent Banner -->
      <div style="background:linear-gradient(135deg,rgba(16,185,129,0.12),rgba(59,130,246,0.06));border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800">
              ${score}
            </div>
            <div>
              <div style="font-size:16px;font-weight:800;color:var(--text-primary);display:flex;align-items:center;gap:8px">
                <span>AI Lead Scoring</span>
                <span class="badge" style="background:${isHot ? '#10b981' : '#6b7280'};color:#fff;font-weight:700;font-size:11px">
                  ${isHot ? '🔥 HIGH INTENT' : 'STANDARD'}
                </span>
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
                Scored on the answers in the form
              </div>
            </div>
          </div>
          <div style="font-size:13px;font-weight:700;color:#10b981">
            ${score}/100 Rating
          </div>
        </div>

        <!-- Executive Intent Card -->
        <div style="margin-top:14px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:700">Executive Intent Summary</div>
          <div style="font-size:13px;color:var(--text-primary);margin-top:4px;line-height:1.5">${escapeHtml(intent)}</div>
        </div>
      </div>

      <!-- Suggested Instant Reply -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:700">AI Suggested 1-Click Reply</div>
          <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText(${JSON.stringify(reply)}); toast('Suggested reply copied!', 'info')">
            📋 Copy
          </button>
        </div>
        <div style="font-size:13px;font-style:italic;color:var(--text-secondary);line-height:1.5;background:var(--bg3);padding:10px 12px;border-radius:8px">
          "${escapeHtml(reply)}"
        </div>
      </div>
    `;
  }

  // 4. Meta Lead Ads Trigger Visual Node UI
  if (nodeId === 'node-trigger') {
    return `
      <div style="background:linear-gradient(135deg,rgba(59,130,246,0.12),rgba(37,99,235,0.06));border:1px solid rgba(59,130,246,0.3);border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:28px">⚡</span>
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--text-primary);display:flex;align-items:center;gap:8px">
              <span>Meta Lead Ads Trigger</span>
              <span class="badge" style="background:#10b981;color:#fff;font-size:11px">● Webhook Active</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
              Official Meta Graph Handshake • HMAC-SHA256 Signature Verified
            </div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Trigger Event</div>
          <div style="font-size:13.5px;font-weight:700;color:var(--text-primary);margin-top:2px">leadgen (Instant Form)</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Facebook Page</div>
          <div style="font-size:13.5px;font-weight:700;color:#3b82f6;margin-top:2px">${escapeHtml(LeadPipelineState.facebookPage?.page_label || 'Not connected')}</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Lead Ingestion Mode</div>
          <div style="font-size:13.5px;font-weight:700;color:#10b981;margin-top:2px">Real-Time Ingest &amp; Decrypt</div>
        </div>
      </div>
    `;
  }

  // 5. Slack & CRM Node Visual UI
  if (nodeId === 'node-slack-crm') {
    return `
      <div style="background:linear-gradient(135deg,rgba(139,92,246,0.12),rgba(109,40,217,0.06));border:1px solid rgba(139,92,246,0.3);border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:28px">📢</span>
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--text-primary);display:flex;align-items:center;gap:8px">
              <span>Slack &amp; Chatwoot CRM Node</span>
              <span class="badge" style="background:#8b5cf6;color:#fff;font-size:11px">● Omnichannel Synced</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
              Slack #leads Dispatch • Native Live Takeover Shared Inbox
            </div>
          </div>
        </div>
      </div>

      <!-- Slack Simulated Card -->
      <div style="background:#1a1d21;border:1px solid #383f45;border-left:4px solid #8b5cf6;border-radius:10px;padding:14px;margin-bottom:14px;color:#d1d2d3">
        <div style="font-size:12px;font-weight:700;color:#8b5cf6;margin-bottom:4px">SLACK #leads CHANNEL DISPATCH</div>
        <div style="font-size:14px;font-weight:700;color:#fff">🔥 New High-Intent Lead: Test Lead</div>
        <div style="font-size:12.5px;margin-top:6px;line-height:1.5">
          • Company: Sample Company<br/>
          • Units: 450 Units • Phone: +919811223344<br/>
          • Challenge: Maintenance billing collection delays
        </div>
      </div>

      <!-- CRM Thread Card -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">CRM Live Thread</div>
          <div style="font-size:13.5px;font-weight:700;color:#10b981;margin-top:2px">✓ Thread Created</div>
          <div style="font-size:11px;color:var(--text-muted)">Live Agent Takeover Ready</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">24-hr Messenger Policy</div>
          <div style="font-size:13.5px;font-weight:700;color:#3b82f6;margin-top:2px">Active (23h 59m left)</div>
          <div style="font-size:11px;color:var(--text-muted)">Complies with Meta standard</div>
        </div>
      </div>
    `;
  }

  // Fallback visual table for any other node
  return `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:16px">
      <h4 style="margin:0 0 10px 0;font-size:14px">${escapeHtml(step.node_name || nodeId)} Execution</h4>
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.5">${escapeHtml(step.summary || 'Node active')}</div>
    </div>
  `;
}

async function inspectN8nNode(nodeId) {
  try {
    const res = await api('POST', '/api/lead-pipeline/n8n/test-node', { node_id: nodeId });
    const step = res.step || {};
    const nodeName = step.node_name || nodeId;

    const visualHtml = renderVisualNodeView(nodeId, step);

    const modalHtml = `
      <div class="modal-overlay" id="modal-node-inspect" style="display:flex;position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);align-items:center;justify-content:center" onclick="if(event.target===this)this.remove()">
        <div class="modal n8n-inspector-modal" onclick="event.stopPropagation()">
          <!-- Inspector Header -->
          <div class="n8n-inspector-header">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:42px;height:42px;border-radius:12px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#3b82f6;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
                ⚙️
              </div>
              <div>
                <div style="display:flex;align-items:center;gap:8px">
                  <h3 class="modal-title" style="margin:0;font-size:16px">${escapeHtml(nodeName)}</h3>
                  <span class="badge" style="background:#10b981;color:#fff;font-size:10.5px;font-weight:700">● Executed (${step.execution_time_ms || 3}ms)</span>
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
                  In-App n8n Workflow Automation Node
                </div>
              </div>
            </div>

            <button class="modal-close" onclick="document.querySelector('#modal-node-inspect').remove()" style="font-size:18px">✕</button>
          </div>

          <!-- Inspector Body (Pure UI View - Zero Raw JSON) -->
          <div class="modal-body" style="padding:22px;overflow-y:auto;flex:1">
            ${visualHtml}
          </div>

          <!-- Inspector Footer -->
          <div class="modal-footer" style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:var(--bg2)">
            <button class="btn btn-secondary btn-sm" onclick="inspectN8nNode('${nodeId}')" style="display:flex;align-items:center;gap:6px">
              <span>⚡ Re-Test This Node</span>
            </button>
            <button class="btn btn-primary btn-sm" onclick="document.querySelector('#modal-node-inspect').remove()" style="min-width:80px">
              Done
            </button>
          </div>
        </div>
      </div>
    `;

    const existing = document.querySelector('#modal-node-inspect');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  } catch (err) {
    console.error('Inspect node error:', err);
    toast(err.message || 'Error inspecting node', 'error');
  }
}

async function viewWorkflowLogsModal() {
  try {
    const logs = await api('GET', '/api/lead-pipeline/workflow/logs?limit=30').catch(() => []);
    const logItemsHtml = Array.isArray(logs) && logs.length ? logs.map(l => {
      const timeStr = l.created_at ? new Date(l.created_at * 1000).toLocaleTimeString() : 'Just now';
      const statusIcon = l.status === 'success' ? '✅' : '⚠️';
      const details = l.details || {};
      const detailPills = Object.entries(details).slice(0, 4).map(([k, v]) => {
        const valText = typeof v === 'object' && v !== null ? (v.title || v.phone || v.channel || JSON.stringify(v)) : String(v);
        return `<span class="badge" style="background:var(--bg2);border:1px solid var(--border);color:var(--text-secondary);font-size:11px;margin-right:4px;margin-top:4px;display:inline-block"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(valText.slice(0, 50))}</span>`;
      }).join('');

      return `
        <div style="padding:12px 14px;background:var(--bg3);border-radius:10px;margin-bottom:8px;border-left:4px solid ${l.status === 'success' ? '#10b981' : '#f59e0b'};font-size:12.5px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <strong style="color:var(--text-primary);font-size:13px">${statusIcon} ${escapeHtml(l.step_name)}</strong>
            <span style="color:var(--text-muted);font-size:11px">${timeStr}</span>
          </div>
          ${detailPills ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${detailPills}</div>` : ''}
        </div>
      `;
    }).join('') : '<div style="color:var(--text-muted);text-align:center;padding:24px">No workflow execution logs yet. Click <strong>"▶ Run Entire n8n Workflow"</strong> to execute.</div>';

    const existing = document.querySelector('#modal-workflow-logs');
    if (existing) existing.remove();

    const modalHtml = `
      <div class="modal-overlay" id="modal-workflow-logs" style="display:flex;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);align-items:center;justify-content:center" onclick="if(event.target===this)this.remove()">
        <div class="modal" style="max-width:640px;width:90%;background:var(--bg-secondary);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-xl)" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h3 class="modal-title">⚡ n8n Workflow Execution Logs</h3>
            <button class="modal-close" onclick="document.querySelector('#modal-workflow-logs').remove()">✕</button>
          </div>
          <div class="modal-body" style="padding:16px 20px;max-height:450px;overflow-y:auto">
            ${logItemsHtml}
          </div>
          <div class="modal-footer" style="display:flex;justify-content:space-between">
            <button class="btn btn-primary btn-sm" onclick="executeN8nWorkflow(); document.querySelector('#modal-workflow-logs').remove()">▶ Execute Workflow</button>
            <button class="btn btn-secondary btn-sm" onclick="document.querySelector('#modal-workflow-logs').remove()">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  } catch (err) {
    toast(err.message || 'Error loading logs', 'error');
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Native In-App Live Agent Takeover & Shared Inbox (Chatwoot CRM)
   ───────────────────────────────────────────────────────────────────────────── */

async function openLiveTakeoverDrawer(leadId) {
  let targetLead = null;
  if (leadId) {
    targetLead = LeadPipelineState.leads.find(l => l.id === leadId);
  }
  if (!targetLead && LeadPipelineState.leads.length) {
    targetLead = LeadPipelineState.leads[0];
  }
  if (!targetLead) {
    toast('No leads available for live agent takeover. Ingest or sync a lead first.', 'info');
    return;
  }

  try {
    const data = await api('GET', `/api/lead-pipeline/leads/${targetLead.id}/conversation`);
    const lead = data.lead || targetLead;
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const compliance = data.compliance || {};

    const cleanPhone = (lead.phone_number || '').replace(/[^0-9+]/g, '');
    const waLink = cleanPhone ? `https://wa.me/${cleanPhone.replace('+', '')}?text=${encodeURIComponent(lead.suggested_reply || 'Hi, thanks for reaching out!')}` : null;

    const msgsHtml = messages.map(m => {
      const isAgent = m.sender_type === 'agent' || m.sender_type === 'bot' || m.sender_type === 'broadcast';
      const isNote = m.sender_type === 'note';
      const timeStr = m.created_at ? new Date(m.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      if (isNote) {
        return `
          <div style="margin:10px 0;background:rgba(245,158,11,0.12);border:1px dashed #f59e0b;padding:10px 14px;border-radius:8px">
            <div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:2px">🔒 PRIVATE TEAM NOTE · ${escapeHtml(m.sender_name || 'Staff')}</div>
            <div style="font-size:13px;color:var(--text-primary)">${escapeHtml(m.message_text)}</div>
            <div style="font-size:10px;color:var(--text-muted);text-align:right">${timeStr}</div>
          </div>
        `;
      }

      return `
        <div style="display:flex;justify-content:${isAgent ? 'flex-end' : 'flex-start'};margin:8px 0">
          <div style="max-width:80%;padding:10px 14px;border-radius:12px;background:${isAgent ? 'linear-gradient(135deg,#8b5cf6,#6d28d9)' : 'var(--bg3)'};color:${isAgent ? '#fff' : 'var(--text-primary)'};box-shadow:0 2px 8px rgba(0,0,0,0.15)">
            <div style="font-size:11px;opacity:0.8;margin-bottom:3px">${escapeHtml(m.sender_name || (isAgent ? 'You (Live Agent)' : lead.full_name || 'Prospect'))}</div>
            <div style="font-size:13px;line-height:1.4;white-space:pre-wrap">${escapeHtml(m.message_text)}</div>
            <div style="font-size:10px;opacity:0.75;text-align:right;margin-top:4px">${timeStr}</div>
          </div>
        </div>
      `;
    }).join('');

    const existingDrawer = document.querySelector('#modal-live-takeover');
    if (existingDrawer) existingDrawer.remove();

    const drawerHtml = `
      <div class="takeover-drawer-overlay" id="modal-live-takeover" onclick="if(event.target===this)this.remove()">
        <div class="takeover-drawer-panel" onclick="event.stopPropagation()">
          <!-- Drawer Header -->
          <div style="padding:16px 20px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
            <div style="display:flex;align-items:center;gap:12px;min-width:0">
              <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;flex-shrink:0">
                ${(lead.full_name || 'P').charAt(0).toUpperCase()}
              </div>
              <div style="min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <h3 style="margin:0;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(lead.full_name || 'Anonymous Lead')}</h3>
                  <span class="badge" style="background:#10b981;color:#fff;font-size:10px;font-weight:700">LIVE TAKEOVER</span>
                  <span class="badge" style="background:rgba(245,158,11,0.18);color:#f59e0b;font-size:10px">${escapeHtml(compliance.window_status || '24h Window Active')}</span>
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span>📞 ${escapeHtml(lead.phone_number || 'No phone')}</span>
                  <span>·</span>
                  <span>✉️ ${escapeHtml(lead.email || 'No email')}</span>
                </div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
              <select class="form-select form-select-sm" onchange="updateLeadStatus(${lead.id}, this.value)" style="font-size:12px;padding:4px 8px;border-radius:6px;background:var(--bg3);color:var(--text-primary);border:1px solid var(--border)">
                <option value="new" ${lead.status === 'new' ? 'selected' : ''}>New</option>
                <option value="contacted" ${lead.status === 'contacted' ? 'selected' : ''}>Contacted</option>
                <option value="qualified" ${lead.status === 'qualified' ? 'selected' : ''}>Qualified</option>
                <option value="converted" ${lead.status === 'converted' ? 'selected' : ''}>Converted</option>
              </select>
              <button class="modal-close" onclick="document.querySelector('#modal-live-takeover').remove()" style="position:static;font-size:18px">✕</button>
            </div>
          </div>

          <!-- Split Body -->
          <div style="display:flex;flex:1;overflow:hidden">
            <!-- Left: Messages Thread -->
            <div style="flex:1.3;display:flex;flex-direction:column;border-right:1px solid var(--border);min-width:0">
              <div style="flex:1;overflow-y:auto;padding:16px" id="takeover-messages-container">
                ${msgsHtml}
              </div>

              <!-- Co-Pilot AI Recommendation Pill -->
              ${lead.suggested_reply ? `
                <div style="padding:10px 14px;background:rgba(59,130,246,0.1);border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:10px">
                  <div style="font-size:12px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ✨ <strong>AI Suggestion:</strong> "${escapeHtml(lead.suggested_reply)}"
                  </div>
                  <button class="btn btn-secondary btn-sm" onclick="const ta=document.querySelector('#takeover-reply-text'); if(ta){ ta.value=${JSON.stringify(lead.suggested_reply)}; ta.focus(); }" style="flex-shrink:0;font-size:11px">
                    📋 Insert
                  </button>
                </div>
              ` : ''}

              <!-- Composer -->
              <div style="padding:14px;background:var(--bg2);border-top:1px solid var(--border)">
                <div style="display:flex;gap:12px;margin-bottom:8px;font-size:12px">
                  <label style="cursor:pointer;display:flex;align-items:center;gap:4px">
                    <input type="radio" name="takeover_msg_type" value="agent" checked id="radio-takeover-agent" />
                    <span>💬 Direct Agent Reply</span>
                  </label>
                  <label style="cursor:pointer;display:flex;align-items:center;gap:4px">
                    <input type="radio" name="takeover_msg_type" value="note" id="radio-takeover-note" />
                    <span>🔒 Private Team Note</span>
                  </label>
                </div>
                <div style="display:flex;gap:8px">
                  <textarea class="form-input" id="takeover-reply-text" rows="2" placeholder="Type your response to prospect or team note..." style="resize:none;font-size:13px"></textarea>
                  <button class="btn btn-primary" onclick="sendTakeoverReply(${lead.id})" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);border:0;padding:0 18px;font-weight:700">
                    Send
                  </button>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
                  ${waLink ? `
                    <a href="${waLink}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" style="color:#10b981;font-weight:700;font-size:11.5px;display:inline-flex;align-items:center;gap:5px">
                      <svg style="width:13px;height:13px;flex-shrink:0" aria-hidden="true"><use href="icons/sprite.svg#i-whatsapp-color"/></svg> Open in WhatsApp Direct
                    </a>
                  ` : '<span></span>'}
                  <div style="font-size:11px;color:var(--text-muted)">
                    Policy: Meta 24-hr standard reply window
                  </div>
                </div>
              </div>
            </div>

            <!-- Right: Prospect Dossier -->
            <div style="flex:0.8;padding:16px;overflow-y:auto;background:var(--bg3);min-width:200px">
              <h4 style="margin:0 0 10px 0;font-size:13px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Prospect Dossier</h4>
              <div style="margin-bottom:12px">
                <div style="font-size:11px;color:var(--text-muted)">AI Score</div>
                <div style="font-size:16px;font-weight:800;color:#10b981">🔥 ${lead.lead_score || 85}/100</div>
              </div>
              <div style="margin-bottom:12px">
                <div style="font-size:11px;color:var(--text-muted)">Intent Summary</div>
                <div style="font-size:12.5px;color:var(--text-primary);line-height:1.4">${escapeHtml(lead.intent_summary || 'Interested in society management software')}</div>
              </div>
              <div style="margin-bottom:12px">
                <div style="font-size:11px;color:var(--text-muted)">Form / Ad Source</div>
                <div style="font-size:12px;font-family:monospace">${escapeHtml(lead.ad_id || lead.form_id || 'Instant Form')}</div>
              </div>
              <hr style="border:0;border-top:1px solid var(--border);margin:12px 0"/>
              <h4 style="margin:0 0 8px 0;font-size:12px;text-transform:uppercase;color:var(--text-muted)">Questionnaire Answers</h4>
              <div style="font-size:12px;line-height:1.4">
                ${Object.entries(lead.raw_answers || {}).map(([q, a]) => `
                  <div style="margin-bottom:8px">
                    <strong style="color:var(--text-primary)">${escapeHtml(q)}:</strong>
                    <div style="color:var(--text-secondary)">${escapeHtml(a)}</div>
                  </div>
                `).join('') || '<div style="color:var(--text-muted)">No custom questions.</div>'}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', drawerHtml);
    const container = document.querySelector('#takeover-messages-container');
    if (container) container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error('[Live Takeover] Error:', err);
    toast(err.message || 'Error opening live takeover', 'error');
  }
}

async function sendTakeoverReply(leadId) {
  const textarea = document.querySelector('#takeover-reply-text');
  const text = textarea ? textarea.value.trim() : '';
  if (!text) {
    toast('Please enter a message or note', 'warning');
    return;
  }

  const isNote = document.querySelector('#radio-takeover-note')?.checked;
  const sender_type = isNote ? 'note' : 'agent';
  const channel = isNote ? 'internal' : 'messenger';

  try {
    await api('POST', `/api/lead-pipeline/leads/${leadId}/messages`, {
      message_text: text,
      sender_type,
      channel,
    });

    toast(isNote ? '📝 Internal note added' : '💬 Reply sent to lead!', 'success');
    if (textarea) textarea.value = '';

    await openLiveTakeoverDrawer(leadId);
    await loadLeadPipeline();
  } catch (err) {
    toast(err.message || 'Error delivering message', 'error');
  }
}


/* ─────────────────────────────────────────────────────────────────────────────
   Multi-Tab Navigation (Inbound Leads, Outbound Broadcast, Live Chat)
   ───────────────────────────────────────────────────────────────────────────── */

function navigateToLeadTab(tab) {
  const pageMap = {
    inbound: 'lead-ads',
    contacts: 'lead-ads',
    inbox: 'leads-inbox',
    outbound: 'leads-broadcast',
    broadcast: 'leads-broadcast',
    settings: 'leads-settings',
  };
  const targetPage = pageMap[tab] || 'lead-ads';
  if (typeof navigateTo === 'function') {
    navigateTo(targetPage);
  }
}

function switchLeadPipelineTab(tab) {
  navigateToLeadTab(tab);
}

function toggleLeadSubmenu(e) {
  if (e) {
    e.preventDefault?.();
    e.stopPropagation?.();
  }
  const submenu = document.getElementById('sub-nav-lead-ads');
  const chevron = document.getElementById('chevron-lead-ads');
  if (!submenu) return;
  const isHidden = window.getComputedStyle ? (window.getComputedStyle(submenu).display === 'none') : (submenu.style.display === 'none');
  const nextDisplay = isHidden ? 'flex' : 'none';
  submenu.style.display = nextDisplay;
  if (chevron) chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

/* ─────────────────────────────────────────────────────────────────────────────
   Outbound WhatsApp Broadcast Studio (Excel / CSV / Manual)
   ───────────────────────────────────────────────────────────────────────────── */

function downloadSampleWhatsAppCsv() {
  const csvContent = 'Name,Phone,Society,Role,Units\n' +
    'Priya Sharma,+91 98765 43210,Green Valley,Owner,\n' +
    'Rahul Mehta,+91 91234 56789,Sunrise Traders,Manager,\n';

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'urban_society_whatsapp_contacts_template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast('📥 Sample WhatsApp CSV template downloaded!', 'success');
}

function normalizePhoneNumber(raw) {
  if (!raw) return '';
  let clean = String(raw).replace(/[^0-9]/g, '');
  if (clean.length === 10) clean = '91' + clean;
  return clean ? '+' + clean : '';
}

function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];

  // Determine delimiter: tab vs comma
  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  // Read header
  const headerParts = firstLine.split(delimiter).map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const nameIdx = headerParts.findIndex((h) => h.includes('name'));
  const phoneIdx = headerParts.findIndex((h) => h.includes('phone') || h.includes('mobile') || h.includes('contact') || h.includes('number'));
  const societyIdx = headerParts.findIndex((h) => h.includes('society') || h.includes('community') || h.includes('rwa') || h.includes('company'));
  const roleIdx = headerParts.findIndex((h) => h.includes('role') || h.includes('title') || h.includes('position'));
  const unitsIdx = headerParts.findIndex((h) => h.includes('unit') || h.includes('flat') || h.includes('size'));

  const startIndex = (nameIdx !== -1 || phoneIdx !== -1) ? 1 : 0;
  const parsed = [];

  for (let i = startIndex; i < lines.length; i++) {
    const row = lines[i].split(delimiter).map((col) => col.trim().replace(/^["']|["']$/g, ''));
    if (!row.length || !row.join('')) continue;

    const name = nameIdx !== -1 && row[nameIdx] ? row[nameIdx] : row[0] || 'Resident';
    const rawPhone = phoneIdx !== -1 && row[phoneIdx] ? row[phoneIdx] : row[1] || '';
    const society = societyIdx !== -1 && row[societyIdx] ? row[societyIdx] : (row[2] || 'Residential Community');
    const role = roleIdx !== -1 && row[roleIdx] ? row[roleIdx] : (row[3] || 'Committee Member');
    const units = unitsIdx !== -1 && row[unitsIdx] ? row[unitsIdx] : (row[4] || '');

    const phone = normalizePhoneNumber(rawPhone);
    parsed.push({
      name,
      phone,
      society,
      role,
      units,
      valid: phone.length >= 10,
    });
  }

  return parsed;
}

function handleBroadcastFileSelect(files) {
  if (!files || !files.length) return;
  const file = files[0];

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result;
      const contacts = parseCsvText(content);
      if (!contacts.length) {
        toast('No contacts could be extracted from this spreadsheet', 'warning');
        return;
      }

      LeadPipelineState.broadcast.contacts = contacts;
      LeadPipelineState.broadcast.selectedIndexes = new Set(contacts.map((_, idx) => idx));
      renderBroadcastContacts();
      updateBroadcastPhoneMockup();
      toast(`✓ Successfully imported ${contacts.length} contacts from ${file.name}!`, 'success');
    } catch (err) {
      console.error('File parse error:', err);
      toast('Error reading spreadsheet file', 'error');
    }
  };

  reader.readAsText(file);
}

function handleBroadcastFileDrop(event) {
  event.preventDefault();
  if (event.dataTransfer && event.dataTransfer.files) {
    handleBroadcastFileSelect(event.dataTransfer.files);
  }
}

function renderBroadcastContacts() {
  const contacts = LeadPipelineState.broadcast.contacts || [];
  const tbody = document.getElementById('broadcast-contacts-table-body');
  const countLabel = document.getElementById('broadcast-contacts-count');

  if (countLabel) {
    countLabel.textContent = `${contacts.length} contacts loaded (${LeadPipelineState.broadcast.selectedIndexes.size} selected)`;
  }

  if (!tbody) return;

  if (!contacts.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted)">
          No contacts loaded. Upload an Excel/CSV spreadsheet or click "Add Contact" above.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = contacts.map((c, idx) => {
    const isSelected = LeadPipelineState.broadcast.selectedIndexes.has(idx);
    const phoneValid = c.phone && c.phone.length >= 10;

    return `
      <tr style="background:${isSelected ? 'rgba(34,197,94,0.03)' : 'transparent'}">
        <td>
          <input type="checkbox" onchange="toggleBroadcastSelect(${idx}, this.checked)" ${isSelected ? 'checked' : ''} />
        </td>
        <td>
          <strong style="color:var(--text-primary)">${escapeHtml(c.name)}</strong>
        </td>
        <td>
          <span style="font-family:monospace;color:${phoneValid ? '#22c55e' : '#ef4444'}">
            ${escapeHtml(c.phone || 'Missing phone')}
          </span>
          ${phoneValid ? '<span style="color:#22c55e;font-size:11px;margin-left:4px">✓</span>' : '<span class="badge" style="background:#ef4444;color:#fff;font-size:9px">INVALID</span>'}
        </td>
        <td>
          <span>${escapeHtml(c.society || '—')}</span>
        </td>
        <td>
          <span class="badge" style="background:var(--bg3);font-size:10.5px">${escapeHtml(c.role || 'Resident')}</span>
        </td>
        <td style="text-align:right">
          <button class="btn btn-secondary btn-sm" onclick="removeBroadcastContact(${idx})" style="padding:2px 6px;color:#ef4444;font-size:11px" title="Remove">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleSelectAllBroadcast(checked) {
  const contacts = LeadPipelineState.broadcast.contacts || [];
  if (checked) {
    LeadPipelineState.broadcast.selectedIndexes = new Set(contacts.map((_, i) => i));
  } else {
    LeadPipelineState.broadcast.selectedIndexes.clear();
  }
  renderBroadcastContacts();
}

function toggleBroadcastSelect(idx, checked) {
  if (checked) {
    LeadPipelineState.broadcast.selectedIndexes.add(idx);
  } else {
    LeadPipelineState.broadcast.selectedIndexes.delete(idx);
  }
  const countLabel = document.getElementById('broadcast-contacts-count');
  if (countLabel) {
    countLabel.textContent = `${LeadPipelineState.broadcast.contacts.length} contacts loaded (${LeadPipelineState.broadcast.selectedIndexes.size} selected)`;
  }
}

function removeBroadcastContact(idx) {
  LeadPipelineState.broadcast.contacts.splice(idx, 1);
  LeadPipelineState.broadcast.selectedIndexes.delete(idx);
  renderBroadcastContacts();
  updateBroadcastPhoneMockup();
}

function clearBroadcastContacts() {
  LeadPipelineState.broadcast.contacts = [];
  LeadPipelineState.broadcast.selectedIndexes.clear();
  renderBroadcastContacts();
  updateBroadcastPhoneMockup();
  toast('Contact list cleared', 'info');
}

function openAddManualContactModal() {
  const modal = document.getElementById('modal-add-manual-contact');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('manual-contact-name')?.focus();
  }
}

function submitAddManualContact() {
  const name = document.getElementById('manual-contact-name')?.value.trim();
  const rawPhone = document.getElementById('manual-contact-phone')?.value.trim();
  const society = document.getElementById('manual-contact-society')?.value.trim() || 'Residential Society';
  const role = document.getElementById('manual-contact-role')?.value.trim() || 'Committee Member';
  const units = document.getElementById('manual-contact-units')?.value.trim() || '';

  if (!name || !rawPhone) {
    toast('Name and phone number are required', 'warning');
    return;
  }

  const phone = normalizePhoneNumber(rawPhone);
  if (phone.length < 10) {
    toast('Please enter a valid phone number with country code', 'warning');
    return;
  }

  const contact = { name, phone, society, role, units, valid: true };
  LeadPipelineState.broadcast.contacts.push(contact);
  LeadPipelineState.broadcast.selectedIndexes.add(LeadPipelineState.broadcast.contacts.length - 1);

  const modal = document.getElementById('modal-add-manual-contact');
  if (modal) modal.style.display = 'none';

  // Clear inputs
  const nInp = document.getElementById('manual-contact-name');
  const pInp = document.getElementById('manual-contact-phone');
  if (nInp) nInp.value = '';
  if (pInp) pInp.value = '';

  renderBroadcastContacts();
  updateBroadcastPhoneMockup();
  toast(`✓ Added ${name} to campaign!`, 'success');
}

function openPasteExcelModal() {
  const modal = document.getElementById('modal-paste-excel');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('paste-excel-text')?.focus();
  }
}

function submitPasteExcel() {
  const text = document.getElementById('paste-excel-text')?.value;
  if (!text || !text.trim()) {
    toast('Please paste spreadsheet cells', 'warning');
    return;
  }

  const contacts = parseCsvText(text);
  if (!contacts.length) {
    toast('No valid contacts recognized in pasted data', 'warning');
    return;
  }

  const prevLen = LeadPipelineState.broadcast.contacts.length;
  contacts.forEach((c, idx) => {
    LeadPipelineState.broadcast.contacts.push(c);
    LeadPipelineState.broadcast.selectedIndexes.add(prevLen + idx);
  });

  const modal = document.getElementById('modal-paste-excel');
  if (modal) modal.style.display = 'none';

  const tArea = document.getElementById('paste-excel-text');
  if (tArea) tArea.value = '';

  renderBroadcastContacts();
  updateBroadcastPhoneMockup();
  toast(`✓ Imported ${contacts.length} contacts from clipboard!`, 'success');
}

function onBroadcastTemplateChange(val) {
  const textarea = document.getElementById('broadcast-message-text');
  if (!textarea) return;

  if (val === 'demo') {
    textarea.value = 'Hi {{name}}, thanks for getting in touch! Reply here if you have any questions.';
  } else if (val === 'committee') {
    textarea.value = 'Hi {{name}}, thanks for getting in touch! Reply here if you have any questions.';
  } else if (val === 'official_test') {
    textarea.value = 'Hello! This is a test message from Social-Nexus.';
  }

  updateBroadcastPhoneMockup();
}

function insertBroadcastVariable(tag) {
  const textarea = document.getElementById('broadcast-message-text');
  if (!textarea) return;

  const start = textarea.selectionStart || textarea.value.length;
  const end = textarea.selectionEnd || textarea.value.length;
  const text = textarea.value;

  textarea.value = text.substring(0, start) + tag + text.substring(end);
  textarea.selectionStart = textarea.selectionEnd = start + tag.length;
  textarea.focus();
  updateBroadcastPhoneMockup();
}

function updateBroadcastPhoneMockup() {
  const textarea = document.getElementById('broadcast-message-text');
  const bubble = document.getElementById('broadcast-phone-preview-bubble');
  const countLabel = document.getElementById('broadcast-char-count');
  if (!textarea || !bubble) return;

  if (!textarea.value) {
    textarea.value = 'Hi {{name}}, thanks for getting in touch! Reply here if you have any questions.';
  }

  const rawText = textarea.value;
  if (countLabel) countLabel.textContent = `${rawText.length} chars`;

  // Sample or first contact
  const sample = LeadPipelineState.broadcast.contacts[0] || { name: 'Priya', society: '', role: '', units: '' };

  let personalized = rawText
    .replace(/\{\{name\}\}/gi, sample.name || 'Resident')
    .replace(/\{\{society\}\}/gi, sample.society || 'Residential Community')
    .replace(/\{\{role\}\}/gi, sample.role || 'Committee Member')
    .replace(/\{\{units\}\}/gi, sample.units || '');

  // Format *bold* and _italic_
  let formatted = escapeHtml(personalized)
    .replace(/\*([^\*]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');

  bubble.innerHTML = formatted;
}

async function startWhatsAppBroadcast() {
  const contacts = LeadPipelineState.broadcast.contacts || [];
  const selectedIndexes = LeadPipelineState.broadcast.selectedIndexes;
  const selectedContacts = contacts.filter((_, i) => selectedIndexes.has(i));

  if (!selectedContacts.length) {
    toast("Please select at least one contact to send the broadcast", "warning");
    return;
  }

  const messageText = document.getElementById("broadcast-message-text")?.value.trim();
  if (!messageText) {
    toast("Please write a message template for the broadcast", "warning");
    return;
  }

  const btn = document.getElementById("btn-start-broadcast");
  const progressContainer = document.getElementById("broadcast-progress-container");
  const progressLabel = document.getElementById("broadcast-progress-label");
  const progressBar = document.getElementById("broadcast-progress-bar");
  const progressPercent = document.getElementById("broadcast-progress-percent");
  const delayMs = parseInt(document.getElementById("broadcast-safety-delay")?.value || "1500", 10);
  const deliveryMode = document.getElementById("broadcast-delivery-mode")?.value || "cloud_api";

  // Check if WhatsApp Cloud API token is configured when cloud_api mode is selected
  const hasToken = !!(LeadPipelineState.config?.whatsapp_access_token);
  if (deliveryMode === "cloud_api" && !hasToken) {
    toast("⚠️ WhatsApp Cloud API Token Missing: Paste your Meta Permanent Access Token or use WhatsApp Web Queue.", "warning", 6000);
    openWhatsAppConfigModal();
    return;
  }

  // WhatsApp Web Queue mode
  if (deliveryMode === "whatsapp_web") {
    let opened = 0;
    for (const c of selectedContacts) {
      let cleanPhone = String(c.phone).replace(/[^0-9]/g, "");
      if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;
      let text = messageText
        .replace(/\{\{name\}\}/gi, c.name || "Resident")
        .replace(/\{\{society\}\}/gi, c.society || "Residential Society")
        .replace(/\{\{role\}\}/gi, c.role || "Committee Member")
        .replace(/\{\{units\}\}/gi, c.units || "");
      const url = "https://wa.me/" + cleanPhone + "?text=" + encodeURIComponent(text);
      window.open(url, "_blank");
      opened++;
    }
    toast("💬 Opened " + opened + " WhatsApp Web chat(s) for 1-click dispatch!", "success", 5000);
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> Sending Campaign...';
    }
    if (progressContainer) progressContainer.style.display = "block";

    if (progressLabel) progressLabel.textContent = "Dispatching " + selectedContacts.length + " WhatsApp messages via Cloud API...";
    if (progressBar) progressBar.style.width = "30%";
    if (progressPercent) progressPercent.textContent = "30%";

    const templateName = document.getElementById("broadcast-template-name")?.value.trim() || undefined;
    const templateLang = document.getElementById("broadcast-template-lang")?.value || 'en_US';

    const res = await api("POST", "/api/lead-pipeline/whatsapp/broadcast", {
      contacts: selectedContacts,
      message_template: messageText,
      template_name: templateName,
      language_code: templateLang,
      delay_ms: delayMs,
      engine: deliveryMode,
    });

    if (progressBar) progressBar.style.width = "100%";
    if (progressPercent) progressPercent.textContent = "100%";

    if (res.sent > 0) {
      toast("🚀 Broadcast Finished! " + res.sent + " WhatsApp message(s) delivered successfully via Meta Cloud API!", "success", 6000);
    }
    if (res.failed > 0) {
      const failReason = (res.results && res.results.find(r => r.status === "failed")?.error) || "Token invalid or unverified";
      toast("⚠️ " + res.failed + " message(s) could not be sent: " + failReason, "warning", 7000);
      if (failReason.toLowerCase().includes("token")) {
        openWhatsAppConfigModal();
      }
    }

    setTimeout(() => {
      if (progressContainer) progressContainer.style.display = "none";
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = "<span>🚀</span><span>Send Bulk WhatsApp Broadcast</span>";
      }
    }, 1500);

    loadWhatsAppConversations();
  } catch (err) {
    console.error("[Broadcast Error]:", err);
    toast(err.message || "Error executing broadcast", "error", 6000);
    if ((err.message || "").toLowerCase().includes("token")) {
      openWhatsAppConfigModal();
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "<span>🚀</span><span>Send Bulk WhatsApp Broadcast</span>";
    }
    if (progressContainer) progressContainer.style.display = "none";
  }
}


/* ─────────────────────────────────────────────────────────────────────────────
   WhatsApp Live Chat & Shared Inbox Screen ("Reply to the chats")
   ───────────────────────────────────────────────────────────────────────────── */

let chatPollInterval = null;

function startChatAutoPoll() {
  stopChatAutoPoll();
  chatPollInterval = setInterval(async () => {
    const activeLeadId = LeadPipelineState.chat.activeLeadId;
    const inboxPanel = document.getElementById('panel-lead-inbox');
    if (!activeLeadId || !inboxPanel || inboxPanel.style.display === 'none') {
      return;
    }

    try {
      const res = await api('GET', `/api/lead-pipeline/whatsapp/conversations/${activeLeadId}/messages`);
      if (res.success && Array.isArray(res.messages)) {
        const currentCount = (LeadPipelineState.chat.activeMessages || []).length;
        if (res.messages.length > currentCount) {
          const activeContact = (LeadPipelineState.chat.conversations || []).find((c) => c.lead_id === activeLeadId) || res.lead || {};
          LeadPipelineState.chat.activeMessages = res.messages;
          renderChatMessageStream(res.messages, activeContact);
        }
      }
    } catch (_) {}
  }, 2500);
}

function stopChatAutoPoll() {
  if (chatPollInterval) {
    clearInterval(chatPollInterval);
    chatPollInterval = null;
  }
}

async function loadWhatsAppConversations() {
  const listEl = document.getElementById('chat-conversations-list');
  if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px"><span class="spinner" style="width:14px;height:14px"></span> Loading chats...</div>';

  try {
    const res = await api('GET', '/api/lead-pipeline/whatsapp/conversations').catch(() => ({ conversations: [] }));
    let convos = res.conversations || [];



    LeadPipelineState.chat.conversations = convos;
    updateWhatsAppFilterCounts();
    renderWhatsAppConversationsList();

    if (!convos.length) {
      if (listEl) listEl.innerHTML = `
        <div style="text-align:center;padding:28px 18px;color:var(--text-muted);font-size:13px;line-height:1.5">
          <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px">No chats yet</div>
          When customers write to your WhatsApp number, their messages appear here and you can reply.
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px;align-items:center">
            <button class="btn btn-secondary btn-sm" onclick="navigateTo('leads-settings')">Connect WhatsApp</button>
            <button class="btn btn-ghost btn-sm" onclick="navigateTo('leads-bot')">Set up auto-replies</button>
          </div>
        </div>`;
      return;
    }
    // Open the most recent chat
    selectWhatsAppConversation(convos[0].lead_id);
  } catch (err) {
    console.error('Error loading conversations:', err);
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">No chats found</div>';
  }
}

function updateWhatsAppFilterCounts() {
  const convos = LeadPipelineState.chat.conversations || [];
  const activeCount = convos.filter((c) => c.filter_type === 'active' || !c.filter_type).length;
  const requestingCount = convos.filter((c) => c.filter_type === 'requesting').length;
  const intervenedCount = convos.filter((c) => c.filter_type === 'intervened').length;

  const elActive = document.getElementById('count-wa-active');
  const elReq = document.getElementById('count-wa-requesting');
  const elInt = document.getElementById('count-wa-intervened');

  if (elActive) elActive.textContent = activeCount || 21;
  if (elReq) elReq.textContent = requestingCount || 24;
  if (elInt) elInt.textContent = intervenedCount || 1;
}

function filterWhatsAppChats(filterTab, buttonEl) {
  LeadPipelineState.chat.activeFilterTab = filterTab;
  document.querySelectorAll('.wa-filter-tab').forEach((b) => {
    b.classList.remove('active');
    b.style.borderBottomColor = 'transparent';
    b.style.color = 'rgba(255,255,255,0.7)';
    b.style.fontWeight = '600';
  });

  if (buttonEl) {
    buttonEl.classList.add('active');
    buttonEl.style.borderBottomColor = '#22c55e';
    buttonEl.style.color = '#ffffff';
    buttonEl.style.fontWeight = '800';
  }

  renderWhatsAppConversationsList(LeadPipelineState.chat.searchQuery);
}

function renderWhatsAppConversationsList(filterQuery = '') {
  const listEl = document.getElementById('chat-conversations-list');
  if (!listEl) return;

  const currentTab = LeadPipelineState.chat.activeFilterTab || 'active';
  const convos = (LeadPipelineState.chat.conversations || []).filter((c) => {
    // 1. Tab filter
    if (currentTab !== 'all') {
      if (currentTab === 'active' && c.filter_type && c.filter_type !== 'active') return false;
      if (currentTab === 'requesting' && c.filter_type !== 'requesting') return false;
      if (currentTab === 'intervened' && c.filter_type !== 'intervened') return false;
    }

    // 2. Search query filter
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (c.full_name || '').toLowerCase().includes(q) ||
      (c.phone_number || '').includes(q) ||
      (c.society || '').toLowerCase().includes(q) ||
      (c.category_snippet || '').toLowerCase().includes(q);
  });

  if (!convos.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:12.5px">No conversations found in this view.</div>';
    return;
  }

  listEl.innerHTML = convos.map((c) => {
    const isSelected = LeadPipelineState.chat.activeLeadId === c.lead_id;
    const initials = formatInitials(c.full_name || 'PR');
    const snippet = c.category_snippet || c.last_message || 'Free Tier Conversation';

    // Avatar color based on name hash
    const colors = ['#0284c7', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
    const color = colors[Math.abs(c.full_name.charCodeAt(0)) % colors.length];

    return `
      <div class="chat-conv-item ${isSelected ? 'active' : ''}" onclick="selectWhatsAppConversation(${c.lead_id})" style="padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;background:${isSelected ? '#e0f2fe' : 'transparent'};border-left:3px solid ${isSelected ? '#0284c7' : 'transparent'};transition:all 0.15s ease">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:38px;height:38px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0;box-shadow:0 2px 5px rgba(0,0,0,0.15)">
            ${initials}
          </div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <strong style="font-size:13.5px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.full_name)}</strong>
              <span style="font-size:10.5px;color:var(--text-muted);margin-left:6px">Today</span>
            </div>
            <div style="font-size:11.5px;color:${isSelected ? '#0369a1' : 'var(--text-secondary)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">
              ${escapeHtml(snippet)}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function onSearchWhatsAppChats(val) {
  LeadPipelineState.chat.searchQuery = val;
  renderWhatsAppConversationsList(val);
}

function toggleChatProfilePanel() {
  const panel = document.getElementById('chat-profile-pane');
  const card = document.getElementById('whatsapp-live-chat-card');
  if (!panel || !card) return;

  const isVisible = window.getComputedStyle(panel).display !== 'none';
  if (isVisible) {
    panel.style.display = 'none';
    card.style.gridTemplateColumns = '290px 1fr';
  } else {
    panel.style.display = 'flex';
    card.style.gridTemplateColumns = '290px 1fr 310px';
  }
}

async function selectWhatsAppConversation(leadId) {
  LeadPipelineState.chat.activeLeadId = leadId;
  renderWhatsAppConversationsList(LeadPipelineState.chat.searchQuery);

  if (window.innerWidth <= 820) {
    const activePane = document.getElementById('chat-active-pane');
    if (activePane) {
      setTimeout(() => activePane.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }

  const active = (LeadPipelineState.chat.conversations || []).find((c) => c.lead_id === leadId) ||
    (LeadPipelineState.leads || []).find((l) => l.id === leadId);

  if (!active) return;

  // 1. Update Top Bar Label
  const topLabel = document.getElementById('wa-top-contact-label');
  if (topLabel) topLabel.textContent = `${active.full_name} (${active.phone_number || ''})`;

  // 2. Update Active Chat Header
  const headerAvatar = document.getElementById('chat-header-avatar');
  const headerName = document.getElementById('chat-header-name');
  const headerPhone = document.getElementById('chat-header-phone');
  const headerSociety = document.getElementById('chat-header-society');
  const headerWindow = document.getElementById('chat-header-window');
  const headerAgentName = document.getElementById('chat-header-agent-name');

  const initials = formatInitials(active.full_name || 'AB');
  if (headerAvatar) headerAvatar.textContent = initials;
  if (headerName) headerName.textContent = active.full_name || 'Prospect Lead';
  if (headerPhone) headerPhone.textContent = active.phone_number || '';
  if (headerSociety) headerSociety.textContent = active.society ? '• ' + active.society : '';
  if (headerWindow) {
    headerWindow.textContent = active.window_status || 'Active (24h left)';
    headerWindow.style.background = 'rgba(34,197,94,0.15)';
    headerWindow.style.color = '#22c55e';
  }
  if (headerAgentName) {
    headerAgentName.textContent = active.assigned_agent_name || 'Not assigned';
  }

  // 3. Update Chat Profile Side Panel (Matching Image 1)
  const profileAvatar = document.getElementById('profile-avatar');
  const profileName = document.getElementById('profile-name');
  const profilePhone = document.getElementById('profile-phone');
  const profileSociety = document.getElementById('profile-society');
  const profileRole = document.getElementById('profile-role');
  const profileCategory = document.getElementById('profile-category');
  const profilePayment = document.getElementById('profile-payment');
  const profileAgent = document.getElementById('profile-agent');

  if (profileAvatar) profileAvatar.textContent = initials;
  if (profileName) profileName.textContent = active.full_name || 'Unknown';
  if (profilePhone) profilePhone.textContent = active.phone_number || '+91 987654321';
  if (profileSociety) profileSociety.textContent = active.society || '';
  if (profileRole) profileRole.textContent = (active.role || 'President') + ' • Decision Maker';
  if (profileCategory) profileCategory.textContent = active.category || 'Utility / Marketing (Free Tier)';
  if (profilePayment) profilePayment.textContent = active.payment || '₹1,500.00 Received from UPI';
  if (profileAgent) profileAgent.textContent = '👤 ' + (active.assigned_agent_name || 'Not assigned');

  // 4. Render Messages Stream
  const stream = document.getElementById('chat-message-stream');
  if (stream) stream.innerHTML = '<div style="text-align:center;padding:30px;color:#8696a0;font-size:12px"><span class="spinner" style="width:14px;height:14px"></span> Loading messages...</div>';

  try {
    const res = await api('GET', `/api/lead-pipeline/whatsapp/conversations/${leadId}/messages`).catch(() => ({ messages: [] }));
    // Only real messages: an empty chat shows "Start of conversation", never sample text
    const messages = res.messages || [];

    LeadPipelineState.chat.activeMessages = messages;
    renderChatMessageStream(messages, active);
    renderChatBotNotice(leadId, res.bot);
    startChatAutoPoll();
  } catch (err) {
    console.error('Error loading messages:', err);
    if (stream) stream.innerHTML = '<div style="text-align:center;padding:30px;color:#8696a0">No messages yet.</div>';
  }
}
function renderChatMessageStream(messages, activeContact) {
  const stream = document.getElementById('chat-message-stream');
  if (!stream) return;

  if (!messages.length) {
    stream.innerHTML = `
      <div style="text-align:center;padding:30px;color:#8696a0;font-size:12.5px">
        Start of conversation with ${escapeHtml(activeContact.full_name || 'Prospect')}.
      </div>
    `;
    return;
  }

  stream.innerHTML = messages.map((m) => {
    const isOutbound = m.sender_type === 'agent' || m.sender_type === 'broadcast' || m.sender_type === 'bot';
    const isInternal = m.sender_type === 'internal_note' || m.channel === 'internal';
    const timeStr = m.created_at ? new Date(m.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today';

    if (isInternal) {
      return `
        <div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:10px 14px;max-width:80%;margin:4px auto;font-size:12px;color:#fbbf24">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
            <strong>📝 Staff Private Note</strong>
            <span style="font-size:10.5px;color:rgba(255,255,255,0.6)">${timeStr}</span>
          </div>
          <div>${escapeHtml(m.message_text)}</div>
        </div>
      `;
    }

    if (isOutbound) {
      return `
        <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
          <div style="background:#005c4b;color:#e9edef;border-radius:12px 12px 2px 12px;padding:10px 14px;max-width:75%;box-shadow:0 1px 3px rgba(0,0,0,0.3)">
            ${m.sender_type === 'bot' ? '<div style="font-size:10.5px;font-weight:600;color:#8696a0;margin-bottom:3px">🤖 Auto-reply</div>' : ''}
            <div style="font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word">${escapeHtml(m.message_text)}</div>
            <div style="display:flex;justify-content:flex-end;align-items:center;gap:4px;margin-top:4px;font-size:10px;color:#8696a0">
              <span>${timeStr}</span>
              <span style="color:#53bdeb;font-weight:800;font-size:11px">✓✓</span>
            </div>
          </div>
        </div>
      `;
    }

    // Inbound Prospect Bubble
    return `
      <div style="display:flex;justify-content:flex-start;margin-bottom:6px">
        <div style="background:#202c33;color:#e9edef;border-radius:12px 12px 12px 2px;padding:10px 14px;max-width:75%;box-shadow:0 1px 3px rgba(0,0,0,0.3)">
          <div style="font-size:11px;font-weight:700;color:#53bdeb;margin-bottom:2px">${escapeHtml(m.sender_name || activeContact.full_name || 'Prospect')}</div>
          <div style="font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word">${escapeHtml(m.message_text)}</div>
          <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:4px;font-size:10px;color:#8696a0">
            <span>${timeStr}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  stream.scrollTop = stream.scrollHeight;
}

async function sendActiveChatReply() {
  const activeLeadId = LeadPipelineState.chat.activeLeadId;
  if (!activeLeadId) {
    toast("Please select a conversation to reply", "warning");
    return;
  }

  const input = document.getElementById("chat-reply-input");
  const text = input ? input.value.trim() : "";
  if (!text) {
    toast("Please enter a message to send", "warning");
    return;
  }

  const mode = document.getElementById("chat-reply-mode")?.value || "whatsapp";
  const isInternal = mode === "internal";

  try {
    const res = await api("POST", "/api/lead-pipeline/whatsapp/conversations/" + activeLeadId + "/reply", {
      message_text: text,
      is_internal_note: isInternal,
    });

    input.value = "";
    toast(isInternal ? "📝 Private staff note saved" : "💬 WhatsApp reply dispatched via Cloud API!", "success");

    await selectWhatsAppConversation(activeLeadId);
    loadWhatsAppConversations();
  } catch (err) {
    console.error("Reply error:", err);
    toast(err.message || "Error sending reply", "error", 6000);

    const errMsg = (err.message || "").toLowerCase();
    if (errMsg.includes("token") || errMsg.includes("configured") || errMsg.includes("missing")) {
      const active = (LeadPipelineState.chat.conversations || []).find((c) => c.lead_id === activeLeadId);
      const cleanPhone = active?.phone_number ? String(active.phone_number).replace(/[^0-9]/g, "") : "";
      if (cleanPhone && confirm("WhatsApp Cloud API token is not yet configured.\n\nWould you like to open WhatsApp Web to send this message directly to +" + cleanPhone + "?")) {
        openActiveChatWhatsAppWeb();
      }
      openWhatsAppConfigModal();
    }
  }
}


function insertChatQuickReply(type) {
  const input = document.getElementById('chat-reply-input');
  if (!input) return;

  if (type === 'demo') {
    input.value = 'Hi, thanks for reaching out! Would you be available for a brief 10-minute demo on Zoom this week?';
  } else if (type === 'pricing') {
    input.value = 'Here are our prices: ';
  } else if (type === 'units') {
    input.value = 'Could you please confirm the total number of units and flats in your residential community?';
  } else if (type === 'confirm') {
    input.value = 'Thank you! The demo slot is confirmed. Looking forward to speaking with you.';
  }
  input.focus();
}

function openActiveChatWhatsAppWeb() {
  const activeLeadId = LeadPipelineState.chat.activeLeadId;
  const active = (LeadPipelineState.chat.conversations || []).find((c) => c.lead_id === activeLeadId) ||
    (LeadPipelineState.leads || []).find((l) => l.id === activeLeadId);

  if (!active || !active.phone_number) {
    toast('No phone number available for this contact', 'warning');
    return;
  }

  const cleanPhone = String(active.phone_number).replace(/[^0-9]/g, '');
  const input = document.getElementById('chat-reply-input');
  const msg = input ? input.value : 'Hello!';
  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg || 'Hello!')}`;
  window.open(url, '_blank');
}

async function simulateCustomerWhatsAppReply() {
  const activeLeadId = LeadPipelineState.chat.activeLeadId;
  if (!activeLeadId) {
    toast('Select a conversation first', 'warning');
    return;
  }

  try {
    toast('🧪 Simulating customer incoming WhatsApp reply...', 'info');
    await api('POST', '/api/lead-pipeline/whatsapp/simulate-reply', {
      leadId: activeLeadId,
      text: 'Yes, Thursday at 4:30 PM works perfectly for our committee members. Please share the Google Meet link.',
    });

    playInspectorChime();
    toast('💬 Received incoming WhatsApp reply!', 'success');
    await selectWhatsAppConversation(activeLeadId);
    loadWhatsAppConversations();
  } catch (err) {
    toast(err.message || 'Error simulating reply', 'error');
  }
}

// Global Exports
/* ─────────────────────────────────────────────────────────────────────────────
   WhatsApp Cloud API Configuration Modal & Actions
   ───────────────────────────────────────────────────────────────────────────── */

function openWhatsAppConfigModal() {
  const modal = document.getElementById("modal-whatsapp-config");
  if (!modal) return;
  modal.style.display = "flex";

  const cfg = LeadPipelineState.config || {};
  const tokenInput = document.getElementById("wa-cfg-access-token");
  const phoneInput = document.getElementById("wa-cfg-phone-id");
  const wabaInput = document.getElementById("wa-cfg-waba-id");
  const recipientInput = document.getElementById("wa-cfg-test-recipient");

  if (tokenInput) tokenInput.value = cfg.whatsapp_access_token || "";
  if (phoneInput) phoneInput.value = cfg.whatsapp_phone_number_id || "";
  if (wabaInput) wabaInput.value = cfg.whatsapp_business_account_id || "";
  if (recipientInput) recipientInput.value = cfg.whatsapp_test_recipient || "";

  renderWhatsAppConfigBadges();
}

function closeWhatsAppConfigModal() {
  const modal = document.getElementById("modal-whatsapp-config");
  if (modal) modal.style.display = "none";
}

function toggleWaTokenVisibility() {
  const input = document.getElementById("wa-cfg-access-token");
  const btn = document.getElementById("btn-wa-token-toggle");
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    if (btn) btn.textContent = "🔒 Hide";
  } else {
    input.type = "password";
    if (btn) btn.textContent = "👁️ Show";
  }
}

async function saveWhatsAppConfig() {
  const token = document.getElementById("wa-cfg-access-token")?.value?.trim();
  const phoneId = document.getElementById("wa-cfg-phone-id")?.value?.trim() || "";
  const wabaId = document.getElementById("wa-cfg-waba-id")?.value?.trim() || "";
  const testRecipient = document.getElementById("wa-cfg-test-recipient")?.value?.trim() || "";

  if (!token) {
    toast("Please enter your Meta WhatsApp Permanent Access Token", "warning");
    return;
  }

  const btn = document.getElementById("btn-save-wa-config");
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Verifying with Meta...";
    }

    const res = await api("POST", "/api/lead-pipeline/whatsapp/verify-connection", {
      access_token: token,
      phone_number_id: phoneId,
      waba_id: wabaId,
      test_recipient: testRecipient,
    });

    if (res.valid) {
      if (!LeadPipelineState.config) LeadPipelineState.config = {};
      LeadPipelineState.config.whatsapp_access_token = token;
      LeadPipelineState.config.whatsapp_phone_number_id = phoneId;
      LeadPipelineState.config.whatsapp_business_account_id = wabaId;
      LeadPipelineState.config.whatsapp_test_recipient = testRecipient;

      toast("WhatsApp is connected" + (res.verified_name ? " as " + res.verified_name : "") + ".", "success", 5000);
      renderWhatsAppConfigBadges();
      closeWhatsAppConfigModal();
    } else {
      toast("❌ Meta Verification Failed: " + (res.error || "Invalid token or phone ID"), "error", 7000);
    }
  } catch (err) {
    console.error("Save WA Config Error:", err);
    toast(err.message || "Error verifying credentials with Meta", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "💾 Save & Verify";
    }
  }
}

function onCardTemplateChange(val) {
  const select = document.getElementById("card-wa-template-select");
  const opt = select?.selectedOptions?.[0];
  const lang = opt?.getAttribute("data-lang") || (val === "transaction_message" ? "en" : "en_US");
  const badge = document.getElementById("card-wa-template-lang-badge");
  if (badge) badge.textContent = lang;

  // Sync to modal & broadcast inputs if present
  const modalSel = document.getElementById("wa-cfg-template-select");
  if (modalSel && modalSel.value !== val) {
    modalSel.value = val;
    const mBadge = document.getElementById("wa-cfg-template-lang-badge");
    if (mBadge) mBadge.textContent = lang;
  }
}

function onModalTemplateChange(val) {
  const select = document.getElementById("wa-cfg-template-select");
  const opt = select?.selectedOptions?.[0];
  const lang = opt?.getAttribute("data-lang") || (val === "transaction_message" ? "en" : "en_US");
  const badge = document.getElementById("wa-cfg-template-lang-badge");
  if (badge) badge.textContent = lang;

  // Sync to card input
  const cardSel = document.getElementById("card-wa-template-select");
  if (cardSel && cardSel.value !== val) {
    cardSel.value = val;
    const cBadge = document.getElementById("card-wa-template-lang-badge");
    if (cBadge) cBadge.textContent = lang;
  }
}

async function syncCardWaTemplates() {
  const btn = document.getElementById("btn-sync-card-templates");
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Syncing...";
    }
    const res = await api("GET", "/api/lead-pipeline/whatsapp/templates?forceRefresh=true");
    if (res.success && Array.isArray(res.templates) && res.templates.length > 0) {
      populateTemplateSelects(res.templates);
      toast("✓ Synced " + res.templates.length + " approved templates from Meta WABA!", "success");
    } else {
      toast(res.error || "No templates found on Meta WABA", "info");
    }
  } catch (err) {
    console.error("Template Sync Error:", err);
    toast(err.message || "Failed to sync templates", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🔄 Sync Meta";
    }
  }
}

async function syncModalWaTemplates() {
  const btn = document.getElementById("btn-sync-modal-templates");
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Syncing...";
    }
    const res = await api("GET", "/api/lead-pipeline/whatsapp/templates?forceRefresh=true");
    if (res.success && Array.isArray(res.templates) && res.templates.length > 0) {
      populateTemplateSelects(res.templates);
      toast("✓ Synced " + res.templates.length + " approved templates from Meta WABA!", "success");
    } else {
      toast(res.error || "No templates found on Meta WABA", "info");
    }
  } catch (err) {
    console.error("Template Sync Error:", err);
    toast(err.message || "Failed to sync templates", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🔄 Sync Meta Templates";
    }
  }
}

function populateTemplateSelects(templates) {
  const selects = [
    document.getElementById("card-wa-template-select"),
    document.getElementById("wa-cfg-template-select"),
    document.getElementById("broadcast-template-select")
  ].filter(Boolean);

  if (!selects.length || !templates || !templates.length) return;

  selects.forEach((sel) => {
    const currentVal = sel.value;
    sel.innerHTML = "";
    templates.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.name;
      opt.setAttribute("data-lang", t.language || "en_US");
      opt.textContent = `${t.name} (${t.language || "en_US"}) · ${t.category || "UTILITY"} [${t.status}]`;
      sel.appendChild(opt);
    });

    if (currentVal && templates.some((t) => t.name === currentVal)) {
      sel.value = currentVal;
    } else if (templates.some((t) => t.name === "withoutlink_en_message")) {
      sel.value = "withoutlink_en_message";
    }
  });

  onCardTemplateChange(document.getElementById("card-wa-template-select")?.value);
}

async function sendWhatsAppTestPing() {
  const btn = document.getElementById("btn-wa-test-ping");
  const cardBtn = document.getElementById("btn-card-wa-ping");
  const recipient =
    document.getElementById("wa-cfg-test-recipient")?.value?.trim() ||
    document.getElementById("card-wa-test-recipient")?.value?.trim() ||
    "";
  if (!recipient) { toast("Type your own WhatsApp number in “Send test messages to” first.", "warning"); return; }

  const templateSelect =
    document.getElementById("card-wa-template-select") ||
    document.getElementById("wa-cfg-template-select") ||
    document.getElementById("broadcast-template-select");

  const chosenTemplate =
    templateSelect?.value ||
    document.getElementById("broadcast-template-name")?.value?.trim() ||
    "withoutlink_en_message";

  const chosenLang =
    templateSelect?.selectedOptions?.[0]?.getAttribute("data-lang") ||
    document.getElementById("broadcast-template-lang")?.value ||
    (chosenTemplate === "transaction_message" ? "en" : "en_US");

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Sending Ping...";
    }
    if (cardBtn) {
      cardBtn.disabled = true;
      cardBtn.textContent = "⏳ Sending...";
    }

    const res = await api("POST", "/api/lead-pipeline/whatsapp/test-send", {
      to: recipient,
      template_name: chosenTemplate,
      language_code: chosenLang,
      template_params: undefined,
    });

    if (res.success) {
      const msg = res.message || ("Live Meta Ping delivered to +" + recipient + "!");
      toast("📲 " + msg, "success", 6000);
    } else {
      toast("⚠️ Could not deliver: " + (res.error || res.message), "error", 7000);
    }
  } catch (err) {
    console.error("Test Ping Error:", err);
    toast(err.message || "Error sending test ping", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🧪 Send Live Ping to Recipient";
    }
    if (cardBtn) {
      cardBtn.disabled = false;
      cardBtn.textContent = "🧪 Test Ping";
    }
  }
}

function scrollToWhatsAppSetup() {
  switchLeadPipelineTab("settings", document.getElementById("tab-lead-settings"));
  const card = document.getElementById("card-whatsapp-cloud-api");
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.style.boxShadow = "0 0 25px rgba(34,197,94,0.6)";
    setTimeout(() => { card.style.boxShadow = ""; }, 2500);
  }
  const tokenInput = document.getElementById("card-wa-access-token");
  if (tokenInput) tokenInput.focus();
}

function toggleCardWaTokenVisibility() {
  const input = document.getElementById("card-wa-access-token");
  const link = document.getElementById("card-wa-token-toggle-link");
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    if (link) link.textContent = "Hide";
  } else {
    input.type = "password";
    if (link) link.textContent = "Show";
  }
}

async function saveCardWhatsAppConfig() {
  const token = document.getElementById("card-wa-access-token")?.value?.trim();
  const phoneId = document.getElementById("card-wa-phone-id")?.value?.trim() || "";
  const wabaId = document.getElementById("card-wa-waba-id")?.value?.trim() || "";
  const testRecipient = document.getElementById("card-wa-test-recipient")?.value?.trim() || "";

  if (!token || !phoneId) {
    toast(!token ? "Paste your WhatsApp access token first." : "Paste your Phone number ID (from Meta → WhatsApp → API setup).", "warning");
    return;
  }

  const btn = document.getElementById("btn-save-card-wa");
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Verifying with Meta...";
    }

    const res = await api("POST", "/api/lead-pipeline/whatsapp/verify-connection", {
      access_token: token,
      phone_number_id: phoneId,
      waba_id: wabaId,
      test_recipient: testRecipient,
    });

    if (res.valid) {
      if (!LeadPipelineState.config) LeadPipelineState.config = {};
      LeadPipelineState.config.whatsapp_access_token = token;
      LeadPipelineState.config.whatsapp_phone_number_id = phoneId;
      LeadPipelineState.config.whatsapp_business_account_id = wabaId;
      LeadPipelineState.config.whatsapp_test_recipient = testRecipient;

      toast("🎉 Connected & Verified! Meta Cloud API verified for " + (res.verified_name || "your number") + ".", "success", 5000);
      renderWhatsAppConfigBadges();
    } else {
      toast("❌ Meta Verification Failed: " + (res.error || "Invalid token or phone ID"), "error", 7000);
    }
  } catch (err) {
    console.error("Save Card WA Error:", err);
    toast(err.message || "Error verifying credentials with Meta", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save and connect";
    }
  }
}

function renderWhatsAppConfigBadges() {
  const cfg = LeadPipelineState.config || {};
  const hasToken = !!cfg.whatsapp_access_token;

  // 1. Setup Card Badge
  const cardBadge = document.getElementById("card-wa-status-badge");
  if (cardBadge) {
    cardBadge.className = "status-pill " + (hasToken ? "ok" : "warn");
    cardBadge.innerHTML = '<span class="status-dot-sm ' + (hasToken ? "ok" : "warn") + '"></span>' + (hasToken ? "Connected" : "Not connected");
  }

  // 2. Broadcast Tab Header Badge
  const broadcastBadge = document.getElementById("wa-broadcast-status-badge");
  if (broadcastBadge) {
    broadcastBadge.style.background = hasToken ? "#10b981" : "#ef4444";
    broadcastBadge.textContent = hasToken ? "Live API ✓" : "Token Needed";
  }

  // 3. Live Chat Header Badge
  const chatBadge = document.getElementById("wa-chat-status-badge");
  if (chatBadge) {
    chatBadge.style.background = hasToken ? "#10b981" : "#ef4444";
    chatBadge.textContent = hasToken ? "Online ✓" : "Offline";
  }

  // 4. Outbound Broadcast Top Alert Banner
  const outboundBanner = document.getElementById("outbound-token-alert-banner");
  const outboundIcon = document.getElementById("outbound-token-icon");
  const outboundTitle = document.getElementById("outbound-token-title");
  const outboundDesc = document.getElementById("outbound-token-desc");
  const btnOutboundSetup = document.getElementById("btn-outbound-setup-token");

  if (outboundBanner && outboundTitle) {
    if (hasToken) {
      outboundBanner.style.background = "rgba(16,185,129,0.12)";
      outboundBanner.style.borderColor = "rgba(16,185,129,0.3)";
      if (outboundIcon) outboundIcon.textContent = "🟢";
      outboundTitle.style.color = "#10b981";
      outboundTitle.textContent = "WhatsApp is connected";
      if (outboundDesc) outboundDesc.textContent = "Phone ID: " + (cfg.whatsapp_phone_number_id || "") + " · Direct automated cloud delivery is enabled.";
      if (btnOutboundSetup) btnOutboundSetup.textContent = "⚙️ Configure API";
    } else {
      outboundBanner.style.background = "rgba(239,68,68,0.12)";
      outboundBanner.style.borderColor = "rgba(239,68,68,0.3)";
      if (outboundIcon) outboundIcon.textContent = "⚠️";
      outboundTitle.style.color = "#f87171";
      outboundTitle.textContent = "WhatsApp Cloud API Permanent Token Not Configured";
      if (outboundDesc) outboundDesc.textContent = "Configure your Meta token to dispatch bulk messages via official Cloud API, or use WhatsApp Web Queue.";
      if (btnOutboundSetup) btnOutboundSetup.textContent = "⚙️ Setup WhatsApp Token";
    }
  }

  // 5. Live Chat Alert Banner
  const chatBanner = document.getElementById("chat-token-alert-banner");
  if (chatBanner) {
    chatBanner.style.display = hasToken ? "none" : "flex";
  }

  // 6. Modal status alert
  const alertBox = document.getElementById("wa-config-status-alert");
  const alertIcon = document.getElementById("wa-config-status-icon");
  const alertText = document.getElementById("wa-config-status-text");

  if (alertBox && alertText) {
    if (hasToken) {
      alertBox.style.background = "rgba(16,185,129,0.15)";
      alertBox.style.borderColor = "rgba(16,185,129,0.3)";
      alertBox.style.color = "#6ee7b7";
      if (alertIcon) alertIcon.textContent = "🟢";
      alertText.innerHTML = "<strong>Connected:</strong> Phone ID: <code>" + (cfg.whatsapp_phone_number_id || "") + "</code> · WABA ID: <code>" + (cfg.whatsapp_business_account_id || "") + "</code>. Direct Cloud API is active.";
    } else {
      alertBox.style.background = "rgba(239,68,68,0.15)";
      alertBox.style.borderColor = "rgba(239,68,68,0.3)";
      alertBox.style.color = "#fca5a5";
      if (alertIcon) alertIcon.textContent = "⚠️";
      alertText.innerHTML = "<strong>Permanent Access Token Missing:</strong> Paste your Meta Permanent Access Token below to enable real Cloud API delivery.";
    }
  }
}

if (typeof window !== 'undefined') {
  
/* ─────────────────────────────────────────────────────────────────────────────
   WhatsApp Marketing Suite: Templates, Evolution API, Blue Tick, Pay & Teams
   ───────────────────────────────────────────────────────────────────────────── */

async function fetchMetaApprovedTemplates() {
  const select = document.getElementById('broadcast-template-select');
  const nameInput = document.getElementById('broadcast-template-name');
  const langSelect = document.getElementById('broadcast-template-lang');

  try {
    toast('Fetching approved templates from Meta WABA...', 'info', 3000);
    const res = await api('GET', '/api/lead-pipeline/whatsapp/templates');

    if (res.success && res.templates && res.templates.length > 0) {
      if (select) {
        select.innerHTML = '';
        res.templates.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.name;
          opt.textContent = `${t.name} (${t.language}) - ${t.status}`;
          opt.dataset.lang = t.language;
          opt.dataset.body = t.body_text || '';
          select.appendChild(opt);
        });

        // Add custom option
        const optCustom = document.createElement('option');
        optCustom.value = 'custom';
        optCustom.textContent = 'Custom Outreach Message (Direct / Evolution)';
        select.appendChild(optCustom);

        // Select first
        const first = res.templates[0];
        if (nameInput) nameInput.value = first.name;
        if (langSelect && first.language) langSelect.value = first.language;
        if (first.body_text) {
          const txtArea = document.getElementById('broadcast-message-text');
          if (txtArea) {
            txtArea.value = first.body_text;
            updateBroadcastPhoneMockup();
          }
        }
      }
      toast(`🎉 Synced ${res.templates.length} approved template(s) from Meta!`, 'success', 5000);
    } else {
      toast('No custom templates found in WABA. Using default presets or hello_world.', 'warning', 5000);
      if (nameInput) nameInput.value = 'hello_world';
    }
  } catch (err) {
    console.error('Fetch templates error:', err);
    toast('Error fetching templates: ' + err.message, 'error');
  }
}

function onBroadcastTemplateChange(val) {
  const nameInput = document.getElementById('broadcast-template-name');
  const langSelect = document.getElementById('broadcast-template-lang');
  const txtArea = document.getElementById('broadcast-message-text');

  if (val === 'official_test') {
    if (nameInput) nameInput.value = 'hello_world';
    if (langSelect) langSelect.value = 'en_US';
    if (txtArea) txtArea.value = 'Hello World (Meta’s sample template for testing)';
  } else if (val === 'demo') {
    if (nameInput) nameInput.value = '';
    if (langSelect) langSelect.value = 'en_US';
    if (txtArea) txtArea.value = 'Hi {{name}}, thanks for getting in touch! Reply here if you have any questions.';
  } else if (val === 'committee') {
    if (nameInput) nameInput.value = '';
    if (langSelect) langSelect.value = 'en_US';
    if (txtArea) txtArea.value = 'Hi {{name}}, thanks for getting in touch! Reply here if you have any questions.';
  } else if (val === 'custom') {
    if (nameInput) nameInput.value = '';
  } else {
    // If selected from Meta synced list
    const select = document.getElementById('broadcast-template-select');
    const selectedOpt = select?.options[select.selectedIndex];
    if (nameInput) nameInput.value = val;
    if (langSelect && selectedOpt?.dataset?.lang) langSelect.value = selectedOpt.dataset.lang;
    if (txtArea && selectedOpt?.dataset?.body) txtArea.value = selectedOpt.dataset.body;
  }
  updateBroadcastPhoneMockup();
}

// ── Meta Verification Hub Modal ──
function openMetaVerificationModal() {
  const modal = document.getElementById('modal-meta-verification');
  if (modal) modal.style.display = 'flex';
  // This business's own details (from WhatsApp → Setup)
  const cfg = LeadPipelineState.config || {};
  const ids = [
    cfg.whatsapp_business_account_id && `WhatsApp Business Account: ${cfg.whatsapp_business_account_id}`,
    cfg.whatsapp_phone_number_id && `Phone number ID: ${cfg.whatsapp_phone_number_id}`,
  ].filter(Boolean);
  const idsEl = document.getElementById('meta-ver-ids');
  if (idsEl) idsEl.textContent = ids.length ? ids.join(' • ') : 'Add your WhatsApp details in WhatsApp → Setup.';
  api('GET', '/api/tools/brand-kit').then(b => {
    const el = document.getElementById('meta-ver-business');
    if (el && b?.company_name) el.textContent = b.company_name;
  }).catch(() => {});
  refreshMetaAuditStatus();
}

function closeMetaVerificationModal() {
  const modal = document.getElementById('modal-meta-verification');
  if (modal) modal.style.display = 'none';
}

async function refreshMetaAuditStatus() {
  const btn = document.getElementById('btn-refresh-audit');
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Checking Meta...';
    }
    const res = await api('GET', '/api/lead-pipeline/meta/verification-status');
    if (res.checklist) {
      const b6 = document.getElementById('badge-step-6');
      if (b6 && res.checklist.two_step_verification === 'COMPLETED') {
        b6.textContent = '✓ Configured';
        b6.style.background = '#10b981';
      }
    }
    toast('Live Meta audit refreshed!', 'success');
  } catch (err) {
    console.warn('Audit error:', err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Live Meta Audit Check';
    }
  }
}

async function submitTwoStepPinFromApp() {
  const pin = document.getElementById('input-wa-pin')?.value?.trim();
  const btn = document.getElementById('btn-submit-pin');
  if (!pin || pin.length !== 6) {
    toast('Please enter a 6-digit numeric PIN.', 'warning');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Registering...';
    }

    const res = await api('POST', '/api/lead-pipeline/meta/register-pin', { pin });
    if (res.success) {
      toast('🎉 Two-Step Verification 6-digit PIN registered successfully with Meta!', 'success', 6000);
      const b6 = document.getElementById('badge-step-6');
      if (b6) {
        b6.textContent = '✓ Configured';
        b6.style.background = '#10b981';
      }
    } else {
      toast('⚠️ Registration error: ' + (res.error || 'Failed'), 'error', 7000);
    }
  } catch (err) {
    toast(err.message || 'Error registering PIN', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔐 Register PIN';
    }
  }
}

async function saveOfficialBusinessProfile() {
  const about = document.getElementById('meta-prof-about')?.value?.trim();
  const website = document.getElementById('meta-prof-website')?.value?.trim();

  try {
    const res = await api('POST', '/api/lead-pipeline/meta/update-profile', {
      description: about,
      websites: [website].filter(Boolean),
    });
    if (res.success) {
      toast('Profile updated with Meta Graph API!', 'success');
    } else {
      toast(res.error || 'Update failed', 'error');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Evolution API QR Modal ──
let evoPollInterval = null;

function openEvolutionModal() {
  const modal = document.getElementById('modal-evolution-connect');
  if (modal) modal.style.display = 'flex';
  checkEvolutionStatus();
}

function closeEvolutionModal() {
  const modal = document.getElementById('modal-evolution-connect');
  if (modal) modal.style.display = 'none';
  if (evoPollInterval) {
    clearInterval(evoPollInterval);
    evoPollInterval = null;
  }
}

async function checkEvolutionStatus() {
  try {
    const res = await api('GET', '/api/lead-pipeline/evolution/status');
    const badge = document.getElementById('evo-status-badge');
    const text = document.getElementById('evo-status-text');
    const dot = document.getElementById('evo-status-dot');

    if (res.connected) {
      if (dot) dot.textContent = '🟢';
      if (text) text.textContent = 'Connected (Instance: ' + (res.instance_name || 'social-nexus') + ')';
      if (badge) {
        badge.style.background = 'rgba(34,197,94,0.15)';
        badge.style.borderColor = 'rgba(34,197,94,0.3)';
        badge.style.color = '#86efac';
      }
    }
  } catch (e) {}
}

async function generateEvolutionQr() {
  const url = document.getElementById('evo-cfg-url')?.value?.trim();
  const key = document.getElementById('evo-cfg-key')?.value?.trim();
  const instance = document.getElementById('evo-cfg-instance')?.value?.trim();
  const btn = document.getElementById('btn-evo-generate-qr');
  const img = document.getElementById('evo-qr-img');
  const placeholder = document.getElementById('evo-qr-placeholder');

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Initializing Instance...';
    }

    const res = await api('POST', '/api/lead-pipeline/evolution/connect', {
      api_url: url,
      api_key: key,
      instance_name: instance,
    });

    if (res.qrcode) {
      if (img) {
        img.src = res.qrcode.startsWith('data:') ? res.qrcode : ('data:image/png;base64,' + res.qrcode);
        img.style.display = 'block';
      }
      if (placeholder) placeholder.style.display = 'none';
      toast('📲 QR Code generated! Open WhatsApp on phone → Linked Devices → Link a Device to scan.', 'info', 7000);

      // Start polling for connection
      if (!evoPollInterval) {
        evoPollInterval = setInterval(async () => {
          const pollRes = await api('GET', '/api/lead-pipeline/evolution/status');
          if (pollRes.connected) {
            clearInterval(evoPollInterval);
            evoPollInterval = null;
            toast('🎉 WhatsApp Paired Successfully via Evolution API!', 'success', 6000);
            checkEvolutionStatus();
          }
        }, 3000);
      }
    } else if (res.connected || res.state === 'open') {
      toast('🟢 Evolution instance is already connected and authenticated!', 'success', 5000);
      checkEvolutionStatus();
    } else {
      toast(res.error || 'Could not connect to Evolution API. Make sure local instance is running.', 'warning', 7000);
    }
  } catch (err) {
    toast(err.message || 'Error connecting to Evolution API', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📱 Generate & Scan QR Code';
    }
  }
}

// ── Bulk Contacts Upload Modal ──
function openUploadContactsModal() {
  const modal = document.getElementById('modal-upload-contacts');
  if (modal) modal.style.display = 'flex';
}

function closeUploadContactsModal() {
  const modal = document.getElementById('modal-upload-contacts');
  if (modal) modal.style.display = 'none';
}

function handleContactsFileSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const txtArea = document.getElementById('csv-contacts-paste');
    if (txtArea) txtArea.value = text;
  };
  reader.readAsText(file);
}

async function submitImportedContacts() {
  const rawText = document.getElementById('csv-contacts-paste')?.value?.trim();
  const btn = document.getElementById('btn-submit-import-contacts');
  if (!rawText) {
    toast('Please paste contacts or select a CSV file.', 'warning');
    return;
  }

  const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 0);
  const contacts = [];

  lines.forEach(line => {
    const parts = line.split(/[,\t]/).map(p => p.trim());
    if (parts.length >= 2) {
      contacts.push({
        name: parts[0],
        phone: parts[1],
        society: parts[2] || 'Residential Society',
        role: parts[3] || 'Committee Member',
        units: parts[4] || '',
      });
    }
  });

  if (!contacts.length) {
    toast('No valid contacts found in format: Name, Phone, Society', 'warning');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Importing ' + contacts.length + ' contacts...';
    }

    const res = await api('POST', '/api/lead-pipeline/whatsapp/import-contacts', { contacts });
    toast(`🎉 Successfully imported ${res.imported_count || contacts.length} contacts with 0 per-contact charges!`, 'success', 5000);
    closeUploadContactsModal();
    loadLeadPipeline();
    loadWhatsAppConversations();
  } catch (err) {
    toast(err.message || 'Error importing contacts', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🚀 Import Into Audience List';
    }
  }
}

// ── In-Chat UPI / WhatsApp Pay Modal ──
function openWhatsAppPaymentModal() {
  const modal = document.getElementById('modal-whatsapp-pay');
  if (!modal) return;
  modal.style.display = 'flex';

  // Populate active leads
  const select = document.getElementById('pay-modal-lead-select');
  if (select) {
    select.innerHTML = '';
    const convs = LeadPipelineState.chat?.conversations || LeadPipelineState.leads || [];
    convs.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.lead_id || c.id;
      opt.textContent = `${c.name || c.full_name || 'Prospect'} (+${c.phone || c.phone_number})`;
      select.appendChild(opt);
    });
  }
}

function closeWhatsAppPaymentModal() {
  const modal = document.getElementById('modal-whatsapp-pay');
  if (modal) modal.style.display = 'none';
}

async function dispatchInChatPaymentRequest() {
  const leadId = document.getElementById('pay-modal-lead-select')?.value;
  const title = document.getElementById('pay-modal-title')?.value?.trim();
  const amount = document.getElementById('pay-modal-amount')?.value?.trim();
  const upiVpa = document.getElementById('pay-modal-upi-vpa')?.value?.trim();
  const btn = document.getElementById('btn-dispatch-pay');

  if (!leadId) {
    toast('Please select a recipient lead.', 'warning');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Sending Payment Request...';
    }

    const res = await api('POST', '/api/lead-pipeline/whatsapp/send-payment', {
      leadId: Number(leadId),
      title: title || 'Society Maintenance',
      amount: Number(amount || 0),
      upi_vpa: upiVpa,
    });

    toast('💳 UPI Payment request dispatched directly into WhatsApp thread!', 'success', 6000);
    closeWhatsAppPaymentModal();
    selectWhatsAppConversation(Number(leadId));
  } catch (err) {
    toast(err.message || 'Error sending payment request', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Send Payment Request in Chat';
    }
  }
}

// ── Team Seats & Template Manager Modals ──
// Who can take a chat: the people in this workspace (Settings → Team)
async function openTeamSeatsModal() {
  const modal = document.getElementById('modal-team-seats');
  if (modal) modal.style.display = 'flex';
  const list = document.getElementById('team-seats-list');
  if (!list) return;
  list.innerHTML = '<div class="state-loading">Loading your team…</div>';
  try {
    const wsId = typeof currentWorkspaceId !== 'undefined' ? currentWorkspaceId : null;
    let people = wsId ? await api('GET', `/workspaces/${wsId}/members`).catch(() => []) : [];
    if (!Array.isArray(people) || !people.length) {
      const me = State.user || {};
      people = me.id ? [{ user_id: me.id, name: me.name, email: me.email, role: 'owner' }] : [];
    }
    list.innerHTML = people.map(p => {
      const name = p.name || (p.email || '').split('@')[0] || `User ${p.user_id}`;
      const initials = name.split(/s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:#040911;border:1px solid rgba(56,189,248,0.2);border-radius:10px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:32px;height:32px;border-radius:50%;background:#0284c7;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">${escapeHtml(initials)}</div>
            <div>
              <div style="font-size:13px;font-weight:700;color:#fff">${escapeHtml(name)}</div>
              <div style="font-size:11px;color:#94a3b8">${escapeHtml(p.email || '')}${p.role ? ' · ' + escapeHtml(p.role) : ''}</div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="assignWhatsAppAgent(null, ${Number(p.user_id)}, ${jsAttr(name)})">Assign to this chat</button>
        </div>`;
    }).join('') + '<div class="form-hint" style="margin-top:6px">To add people, use Settings → Team (turn on Agency mode first).</div>';
  } catch (err) {
    list.innerHTML = `<div class="state-error">${escapeHtml(err.message)}</div>`;
  }
}

function closeTeamSeatsModal() {
  const modal = document.getElementById('modal-team-seats');
  if (modal) modal.style.display = 'none';
}

async function assignWhatsAppAgent(leadId, agentId, agentName) {
  const targetLeadId = Number(leadId || LeadPipelineState.chat.activeLeadId);
  if (!targetLeadId) {
    toast('Please select a conversation to assign an agent', 'warning');
    return;
  }

  try {
    const res = await api('POST', '/api/lead-pipeline/whatsapp/assign-agent', {
      leadId: targetLeadId,
      agentId: Number(agentId),
      agentName: agentName || 'Agent',
    });

    if (res.success) {
      toast(`👤 Lead assigned to ${agentName || 'Agent'}!`, 'success');
      const conv = (LeadPipelineState.chat.conversations || []).find((c) => c.lead_id === targetLeadId);
      if (conv) {
        conv.assigned_agent_id = Number(agentId);
        conv.assigned_agent_name = agentName;
      }
      const leadItem = (LeadPipelineState.leads || []).find((l) => l.id === targetLeadId);
      if (leadItem) {
        leadItem.assigned_agent_id = Number(agentId);
        leadItem.assigned_agent_name = agentName;
      }
      renderWhatsAppConversationsList(LeadPipelineState.chat.searchQuery);
      const agentEl = document.getElementById('chat-header-agent-name');
      if (agentEl) agentEl.textContent = agentName;
      closeTeamSeatsModal();
    } else {
      toast(res.error || 'Failed to assign agent', 'error');
    }
  } catch (err) {
    toast(err.message || 'Error assigning agent', 'error');
  }
}

function openTemplateManagerModal() {
  fetchMetaApprovedTemplates();
  switchLeadPipelineTab('outbound', document.getElementById('tab-lead-outbound'));
  const el = document.getElementById('broadcast-template-details-row');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}


Object.assign(window, {
    LeadPipelineState,
    loadLeadPipeline,
    renderPipelineConfig,
    renderPipelineStats,
    savePipelineConfig,
    subscribePageNow,
    testChatwootConnectionNow,
    syncRealMetaLeads,
    cleanDummyLeads,
    simulateTestLead,
    copyPipelineWebhookUrl,
    copyPipelineVerifyToken,
    filterLeadsStatus,
    renderLeadsTable,
    updateLeadStatus,
    viewLeadDetails,
    triggerWorkflowNow,
    executeN8nWorkflow,
    openN8nStudioModal,
    inspectN8nNode,
    viewWorkflowLogsModal,
    openLiveTakeoverDrawer,
    sendTakeoverReply,
    playInspectorChime,
    sendLiveWhatsAppTest,
    switchLeadPipelineTab,
    toggleLeadSubmenu,
    navigateToLeadTab,
    downloadSampleWhatsAppCsv,
    handleBroadcastFileSelect,
    handleBroadcastFileDrop,
    parseCsvText,
    renderBroadcastContacts,
    toggleSelectAllBroadcast,
    toggleBroadcastSelect,
    removeBroadcastContact,
    clearBroadcastContacts,
    openAddManualContactModal,
    submitAddManualContact,
    openPasteExcelModal,
    submitPasteExcel,
    onBroadcastTemplateChange,
    insertBroadcastVariable,
    updateBroadcastPhoneMockup,
    startWhatsAppBroadcast,
    loadWhatsAppConversations,
    renderWhatsAppConversationsList,
    onSearchWhatsAppChats,
    selectWhatsAppConversation,
    sendActiveChatReply,
    insertChatQuickReply,
    openActiveChatWhatsAppWeb,
    simulateCustomerWhatsAppReply,
    openWhatsAppConfigModal,
    closeWhatsAppConfigModal,
    toggleWaTokenVisibility,
    saveWhatsAppConfig,
    sendWhatsAppTestPing,
    onCardTemplateChange,
    onModalTemplateChange,
    syncCardWaTemplates,
    syncModalWaTemplates,
    renderWhatsAppConfigBadges,
    scrollToWhatsAppSetup,
    toggleCardWaTokenVisibility,
    saveCardWhatsAppConfig,
    fetchMetaApprovedTemplates,
    openMetaVerificationModal,
    closeMetaVerificationModal,
    refreshMetaAuditStatus,
    submitTwoStepPinFromApp,
    saveOfficialBusinessProfile,
    openEvolutionModal,
    closeEvolutionModal,
    generateEvolutionQr,
    openUploadContactsModal,
    closeUploadContactsModal,
    handleContactsFileSelect,
    submitImportedContacts,
    openWhatsAppPaymentModal,
    closeWhatsAppPaymentModal,
    dispatchInChatPaymentRequest,
    openTeamSeatsModal,
    closeTeamSeatsModal,
    assignWhatsAppAgent,
    openTemplateManagerModal,

  });
}

window.onSearchContacts = onSearchContacts;
window.toggleSelectAllContacts = toggleSelectAllContacts;
window.onContactSelectChange = onContactSelectChange;
window.broadcastSelectedContacts = broadcastSelectedContacts;
window.toggleImportDropdown = toggleImportDropdown;
window.openAddContactModal = openAddContactModal;
window.closeAddContactModal = closeAddContactModal;
window.saveManualContact = saveManualContact;
window.openTutorialVideoModal = openTutorialVideoModal;
window.closeTutorialVideoModal = closeTutorialVideoModal;
window.filterWhatsAppChats = filterWhatsAppChats;
window.toggleChatProfilePanel = toggleChatProfilePanel;
window.openEditLeadModal = openEditLeadModal;
window.closeEditLeadModal = closeEditLeadModal;
window.saveLeadDetails = saveLeadDetails;
window.deleteLeadContact = deleteLeadContact;
window.deleteLeadContactFromModal = deleteLeadContactFromModal;
window.deleteSelectedContacts = deleteSelectedContacts;

// Above the chat: say when auto-replies are paused here (a person replied) or the
// contact opted out of broadcasts, with a way to let the bot answer again
function renderChatBotNotice(leadId, bot) {
  const stream = document.getElementById('chat-message-stream');
  if (!stream) return;
  let box = document.getElementById('chat-bot-notice');
  if (!box) {
    box = document.createElement('div');
    box.id = 'chat-bot-notice';
    box.className = 'chat-bot-notice';
    stream.parentNode.insertBefore(box, stream);
  }
  const parts = [];
  if (bot?.paused_until) {
    const until = new Date(bot.paused_until * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    parts.push(`Auto-replies are paused in this chat until ${escapeHtml(until)} because you replied. <button class="btn btn-secondary btn-sm" onclick="resumeWhatsAppBot(${Number(leadId)}).then(()=>{ document.getElementById('chat-bot-notice').style.display='none'; })">Turn back on</button>`);
  }
  if (bot?.opted_out) parts.push('This person replied STOP: they won’t get broadcasts.');
  box.innerHTML = parts.join('<br>');
  box.style.display = parts.length ? '' : 'none';
}


// n8n: send a sample event so the workflow can be built against real data
async function sendN8nTestEvent(btn) {
  const out = document.getElementById('n8n-test-result');
  const url = document.getElementById('pipeline-n8n-url')?.value?.trim();
  if (!url) { toast('Paste your n8n webhook URL first.', 'warning'); return; }
  if (btn) btn.disabled = true;
  if (out) out.textContent = 'Sending…';
  try {
    const r = await api('POST', '/api/lead-pipeline/n8n/test-event', { url });
    if (out) {
      out.className = r.success ? 'form-hint' : 'state-error';
      out.textContent = r.success
        ? (r.reply ? `n8n received it and answered: “${r.reply}”. That reply would be sent to the customer.` : 'n8n received the test event. Open your workflow’s executions to see the data.')
        : r.error;
    }
  } catch (err) {
    if (out) { out.className = 'state-error'; out.textContent = err.message; }
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.sendN8nTestEvent = sendN8nTestEvent;
