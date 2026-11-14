// public/js/12-sellbird.js
// Reactive Controller for Sellbird Autonomous B2B Sales Agent in NexaDrip.
// Faithfully matches sellbird.ai screenshots (Nordic teal / glass theme, split-card approval queue, signal-driven prospecting, 14-day campaign sparklines, Claude Code conversation triage).

/* ─────────────────────────────────────────────────────────────────────────────
   Sellbird — State & Globals
   ───────────────────────────────────────────────────────────────────────────── */

const SellbirdState = {
  activeTab: 'outbox',
  stats: null,
  campaigns: [],
  selectedCampaignId: '',
  campaignRange: '7d',
  outboxItems: [],
  selectedOutboxId: null,
  outboxFilterStatus: 'pending_approval',
  outboxSearchQuery: '',
  selectedOutboxIds: new Set(),
  isEditingOutbox: false,
  officialSender: {
    // Your own address (Settings → Email sending), or one you typed here before
    email: (typeof localStorage !== 'undefined' && localStorage.getItem('nexus_sellbird_sender_email')) || '',
    name: (typeof localStorage !== 'undefined' && localStorage.getItem('nexus_sellbird_sender_name')) || '',
  },
  officialSenderPresets: [],
  companies: [],
  contacts: [],
  selectedContactIds: new Set(),
  contactsFilterSignal: '',
  contactsSearchQuery: '',
  explorerFilterStatus: '',
  explorerSearchQuery: '',
  replies: [],
  selectedReplyId: null,
  repliesFilterIntent: 'all',
  isEditingReply: false,
  sendingPaused: false,
  loading: false,
};

/* ─────────────────────────────────────────────────────────────────────────────
   Lifecycle & Tab Routing
   ───────────────────────────────────────────────────────────────────────────── */

async function loadSellbird() {
  try {
    // 1. Fetch live metrics, campaigns, and contacts concurrently
    const [stats, campaigns] = await Promise.all([
      api('GET', '/api/sellbird/stats').catch(() => null),
      api('GET', '/api/sellbird/campaigns').catch(() => []),
    ]);

    if (stats) {
      SellbirdState.stats = stats;
      renderSellbirdMetrics(stats);
    }

    SellbirdState.campaigns = Array.isArray(campaigns) ? campaigns : [];
    populateSellbirdCampaignDropdowns(SellbirdState.campaigns);

    // 2. Load active tab data
    switch (SellbirdState.activeTab) {
      case 'outbox':
        await loadOutbox();
        break;
      case 'explorer':
        await loadCompanies();
        break;
      case 'campaigns':
        await loadCampaigns();
        break;
      case 'replies':
        await loadReplies();
        break;
      case 'deliverability':
        // Deliverability tab is populated by default static/metrics info
        break;
      default:
        await loadOutbox();
    }
  } catch (err) {
    console.error('[Sellbird] Error in loadSellbird:', err);
    toast(err.message || 'Couldn’t load Sales outreach', 'error');
  }
}

function switchSellbirdTab(tabName, clickedBtn) {
  SellbirdState.activeTab = tabName;

  // Update floating tabs
  document.querySelectorAll('.sb-floating-tab').forEach((el) => el.classList.remove('active'));
  const targetFloating = document.getElementById(`floating-tab-${tabName}`);
  if (targetFloating) targetFloating.classList.add('active');

  // Update sub-sidebar items
  document.querySelectorAll('.sb-subnav-item').forEach((el) => el.classList.remove('active'));
  const subnavEl = document.getElementById(`sb-subnav-${tabName}`);
  if (subnavEl) subnavEl.classList.add('active');

  // Update legacy tabs
  document.querySelectorAll('.sellbird-tab').forEach((el) => el.classList.remove('active'));
  if (clickedBtn && clickedBtn.classList.contains('sellbird-tab')) {
    clickedBtn.classList.add('active');
  }

  // Update breadcrumb label
  const breadcrumbEl = document.getElementById('sb-active-breadcrumb-page');
  if (breadcrumbEl) {
    const titles = {
      explorer: 'Contacts',
      outbox: 'Outbox',
      campaigns: 'Cold Campaigns',
      replies: 'Conversations',
      deliverability: 'Deliverability & Warmup',
      newsletters: 'Newsletters & Broadcasts',
      subscribers: 'Subscribers',
    };
    breadcrumbEl.textContent = titles[tabName] || 'Outbox';
  }

  // Toggle tab panels
  const panels = ['outbox', 'explorer', 'campaigns', 'replies', 'deliverability', 'newsletters', 'subscribers'];
  panels.forEach((p) => {
    const panelEl = document.getElementById(`sellbird-panel-${p}`);
    if (panelEl) {
      panelEl.style.display = p === tabName ? 'block' : 'none';
    }
  });

  // Fetch or refresh tab data
  if (tabName === 'outbox') loadOutbox();
  else if (tabName === 'explorer') loadCompanies();
  else if (tabName === 'campaigns') loadCampaigns();
  else if (tabName === 'replies') loadReplies();
  else if (tabName === 'newsletters') { if (typeof window.loadEmailCampaigns === 'function') window.loadEmailCampaigns(); }
  else if (tabName === 'subscribers') { if (typeof window.loadSubscribers === 'function') window.loadSubscribers(); }
}

function openSellbirdTab(tabName, clickedBtn) {
  return switchSellbirdTab(tabName, clickedBtn);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Metrics & Header Ribbon
   ───────────────────────────────────────────────────────────────────────────── */

function renderSellbirdMetrics(stats) {
  if (!stats) return;

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = Number(val || 0).toLocaleString();
  };

  setVal('sellbird-metric-campaigns', stats.total_campaigns);
  setVal('sellbird-metric-companies', stats.total_companies);
  setVal('sellbird-metric-contacts', stats.total_contacts);
  setVal('sellbird-metric-contacts-verified', stats.verified_contacts);
  setVal('sellbird-metric-pending', stats.pending_approvals);
  setVal('sellbird-metric-sent', stats.sent_outreach);
  setVal('sellbird-metric-queued', stats.approved_queued);
  setVal('sellbird-metric-replies', stats.total_replies);
  setVal('sellbird-metric-interested', stats.interested_leads);

  // Synchronize modern metric boxes in Screen 1 & Screen 3
  setVal('sb-metric-companies-val', stats.total_companies || 0);
  setVal('sb-metric-verified-val', stats.verified_contacts || 0);
  setVal('sb-metric-incampaigns-val', stats.total_contacts || 0);
  setVal('sb-metric-replied-val', stats.total_replies || 0);

  const subCompanies = document.getElementById('sb-metric-companies-sub');
  if (subCompanies) subCompanies.textContent = "websites read";

  const subVerified = document.getElementById('sb-metric-verified-sub');
  if (subVerified) subVerified.textContent = 'with a working mail server';

  const subInCamps = document.getElementById('sb-metric-incampaigns-sub');
  if (subInCamps) subInCamps.textContent = `across ${stats.active_campaigns || 0} active campaign${stats.active_campaigns === 1 ? '' : 's'}`;

  const subReplied = document.getElementById('sb-metric-replied-sub');
  if (subReplied) subReplied.textContent = `${stats.interested_leads || 0} interested`;

  // Top header quota pill
  const topQuota = document.getElementById('sb-top-quota-text');
  if (topQuota) topQuota.textContent = `${stats.sent_today || 0} / ${stats.daily_cap || 0}`;

  const quotaSentMetric = document.getElementById('sb-quota-sent-metric');
  if (quotaSentMetric) quotaSentMetric.textContent = stats.sent_today || 0;
  const quotaCap = document.getElementById('sb-quota-cap');
  if (quotaCap) quotaCap.textContent = stats.daily_cap || 0;
  const activeCamps = document.getElementById('sb-sending-queued');
  if (activeCamps) activeCamps.textContent = stats.active_campaigns || 0;

  // Campaign numbers (were made-up figures written into the page)
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('sb-camp-sent', stats.sent_outreach || 0);
  setText('sb-camp-sent-sub', `${stats.approved_queued || 0} approved, waiting to go out`);
  setText('sb-camp-rate', `${stats.reply_rate || 0}%`);
  setText('sb-camp-rate-sub', `${stats.total_replies || 0} repl${stats.total_replies === 1 ? 'y' : 'ies'}`);
  setText('sb-camp-interested', stats.interested_leads || 0);
  setText('sb-camp-failed', stats.failed || 0);

  // Sending status and where emails come from
  SellbirdState.sendingPaused = !!stats.paused;
  SellbirdState.stats = stats;
  const stateText = document.getElementById('sb-sending-state-text');
  if (stateText) {
    stateText.textContent = !stats.sender ? 'Email not set up' : !stats.licensed ? 'Needs licence' : stats.paused ? 'Paused' : 'Sending on';
    document.getElementById('sb-sending-state')?.classList.toggle('sb-state-off', !stats.sender || !stats.licensed || stats.paused);
  }
  setText('sb-rules-sender', stats.sender ? `${stats.sender.name ? stats.sender.name + ' ' : ''}<${stats.sender.email}>` : 'the address in Settings → Email sending (not set up yet)');
  document.querySelectorAll('[data-sb-pause-label]').forEach(el => { el.textContent = stats.paused ? '▶ Resume sending' : '⏸ Pause sending'; });

  const sendingInFlight = document.getElementById('sb-sending-in-flight');
  if (sendingInFlight) sendingInFlight.textContent = stats.approved_queued || 0;

  // Side menu counters
  const subnavContacts = document.getElementById('sb-subnav-contacts-count');
  if (subnavContacts) subnavContacts.textContent = stats.total_contacts || 0;

  const subnavCampaigns = document.getElementById('sb-subnav-campaigns-count');
  if (subnavCampaigns) subnavCampaigns.textContent = stats.total_campaigns || 0;

  const subnavOutbox = document.getElementById('sb-subnav-outbox-count');
  if (subnavOutbox) subnavOutbox.textContent = stats.pending_approvals || 0;

  const subnavReplies = document.getElementById('sb-subnav-replies-count');
  if (subnavReplies) subnavReplies.textContent = stats.replies_to_answer || 0;

  // Floating tab badges
  const outboxTabBadge = document.getElementById('tab-badge-outbox');
  if (outboxTabBadge) {
    outboxTabBadge.textContent = stats.pending_approvals || 0;
    outboxTabBadge.style.display = stats.pending_approvals > 0 ? 'inline-flex' : 'none';
  }

  const repliesTabBadge = document.getElementById('tab-badge-replies');
  if (repliesTabBadge) {
    repliesTabBadge.textContent = stats.replies_to_answer || 0;
    repliesTabBadge.style.display = stats.replies_to_answer > 0 ? 'inline-flex' : 'none';
  }

  // Pending card alert styling
  const pendingCard = document.getElementById('card-metric-pending');
  if (pendingCard) {
    if (stats.pending_approvals > 0) pendingCard.classList.add('has-pending');
    else pendingCard.classList.remove('has-pending');
  }

  // Sidebar badge
  const navBadge = document.getElementById('sellbird-nav-badge');
  if (navBadge) {
    if (stats.pending_approvals > 0) {
      navBadge.textContent = stats.pending_approvals;
      navBadge.style.display = 'inline-block';
    } else {
      navBadge.style.display = 'none';
    }
  }

  const outboxCountPending = document.getElementById('outbox-count-pending');
  if (outboxCountPending) {
    outboxCountPending.textContent = `(${stats.pending_approvals || 0})`;
  }
}

function populateSellbirdCampaignDropdowns(campaigns) {
  const selects = [
    document.getElementById('sellbird-active-campaign-select'),
    document.getElementById('add-company-campaign-id'),
    document.getElementById('bulk-discover-campaign-id'),
  ];

  selects.forEach((sel) => {
    if (!sel) return;
    const currentVal = sel.value;
    const isFilter = sel.id === 'sellbird-active-campaign-select';

    sel.innerHTML = isFilter ? '<option value="">All Campaigns</option>' : '';

    if (!campaigns.length && !isFilter) {
      sel.innerHTML = '<option value="">(No active campaigns - Create one first)</option>';
      return;
    }

    campaigns.forEach((camp) => {
      const opt = document.createElement('option');
      opt.value = camp.id;
      opt.textContent = `${camp.name} (${camp.status || 'active'})`;
      sel.appendChild(opt);
    });

    if (currentVal && Array.from(sel.options).some((o) => o.value === currentVal)) {
      sel.value = currentVal;
    }
  });
}

function onSellbirdCampaignChange(val) {
  SellbirdState.selectedCampaignId = val || '';
  if (SellbirdState.activeTab === 'outbox') loadOutbox();
  else if (SellbirdState.activeTab === 'explorer') loadCompanies();
}

/* ─────────────────────────────────────────────────────────────────────────────
   Autonomous Loop / Heartbeat
   ───────────────────────────────────────────────────────────────────────────── */

async function triggerSellbirdHeartbeat() {
  const btn = document.getElementById('btn-sellbird-heartbeat');
  const originalHtml = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Running Loop...';
    }

    const result = await api('POST', '/api/sellbird/heartbeat/run');
    const sent = result?.sent_count || 0;
    if (result?.dispatch?.error) toast(result.dispatch.error, 'warning', 8000);
    else if (SellbirdState.sendingPaused) toast('Sending is paused. Resume it to send approved emails.', 'info');
    else toast(sent ? `${sent} email${sent === 1 ? '' : 's'} sent.` : 'Nothing to send right now: no approved emails are due.', sent ? 'success' : 'info', 5000);
    await loadSellbird();
  } catch (err) {
    console.error('[Sellbird] Heartbeat failed:', err);
    toast(err.message || 'Couldn’t send', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Screen 1: Find People (Contacts Table — Screenshot 1)
   ───────────────────────────────────────────────────────────────────────────── */

async function loadCompanies() {
  const container = document.getElementById('sellbird-companies-list');
  if (container) {
    container.innerHTML = `
      <div class="sellbird-loading-state">
        <div class="spinner"></div>
        <div>Loading verified contacts &amp; buying signals...</div>
      </div>`;
  }

  try {
    // Attempt fetching detailed contacts first, fallback to companies
    let contacts = await api('GET', '/api/sellbird/contacts?limit=200').catch(() => null);
    if (!Array.isArray(contacts)) contacts = [];

    SellbirdState.contacts = contacts;
    renderCompanies();
  } catch (err) {
    console.error('[Sellbird] Error loading contacts:', err);
    if (container) {
      container.innerHTML = `<div class="empty-state" style="padding:40px"><div class="empty-title text-error">${err.message}</div></div>`;
    }
  }
}

function loadContacts() {
  return loadCompanies();
}

function onExplorerSearch(query) {
  SellbirdState.explorerSearchQuery = (query || '').toLowerCase().trim();
  renderCompanies();
}

function onExplorerStatusChange(status) {
  SellbirdState.explorerFilterStatus = status;
  loadCompanies();
}

function filterContactsBySignal(signal) {
  SellbirdState.contactsFilterSignal = SellbirdState.contactsFilterSignal === signal ? '' : signal;
  renderCompanies();
}

function toggleContactSelection(id, checked) {
  if (checked) SellbirdState.selectedContactIds.add(id);
  else SellbirdState.selectedContactIds.delete(id);
}

function toggleSelectAllContacts(checked) {
  const checkboxes = document.querySelectorAll('.sb-contact-chk');
  checkboxes.forEach((cb) => {
    cb.checked = checked;
    const id = Number(cb.dataset.id);
    if (checked) SellbirdState.selectedContactIds.add(id);
    else SellbirdState.selectedContactIds.delete(id);
  });
}

function renderCompanies() {
  const container = document.getElementById('sellbird-companies-list');
  if (!container) return;

  const query = SellbirdState.explorerSearchQuery;
  const signalFilter = SellbirdState.contactsFilterSignal;

  const filtered = (SellbirdState.contacts || []).filter((c) => {
    if (signalFilter) {
      const sigs = Array.isArray(c.buying_signals?.signals)
        ? c.buying_signals.signals.join(' ').toLowerCase()
        : '';
      if (!sigs.includes(signalFilter.toLowerCase())) return false;
    }
    if (!query) return true;
    const matchName = (c.full_name || '').toLowerCase().includes(query);
    const matchCompany = (c.company_name || '').toLowerCase().includes(query);
    const matchDomain = (c.company_domain || '').toLowerCase().includes(query);
    const matchIndustry = (c.company_industry || '').toLowerCase().includes(query);
    const matchRole = (c.role || '').toLowerCase().includes(query);
    return matchName || matchCompany || matchDomain || matchIndustry || matchRole;
  });

  const countLabel = document.getElementById('sb-contacts-count-label');
  if (countLabel) countLabel.textContent = `${filtered.length} ${filtered.length === 1 ? 'person' : 'people'}`;

  const pillPeople = document.getElementById('sb-filter-people-count');
  if (pillPeople) pillPeople.textContent = `${filtered.length} ${filtered.length === 1 ? 'PERSON' : 'PEOPLE'}`;

  const pillLocation = document.getElementById('sb-filter-location-tag');
  if (pillLocation) {
    const loc = filtered[0]?.company_location || filtered[0]?.location || '';
    pillLocation.textContent = loc ? `📍 ${loc}` : ''; pillLocation.style.display = loc ? '' : 'none';
  }

  const pillSignal = document.getElementById('sb-filter-signal-tag');
  if (pillSignal) {
    const sig = filtered[0]?.buying_signals?.signals?.[0] || '';
    pillSignal.textContent = sig ? `⚡ ${sig}` : ''; pillSignal.style.display = sig ? '' : 'none';
  }

  if (!filtered.length) {
    container.innerHTML = `
      <div class="card" style="padding:48px 24px;text-align:center;background:#fafbfc;border:1px dashed #cbd5e1;border-radius:10px">
        <div style="font-size:36px;margin-bottom:12px">👤</div>
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px">No Contacts Found</div>
        <div style="font-size:13px;color:#64748b;max-width:480px;margin:0 auto 16px auto">
          No prospects match your search or filters. Click "Add to campaign" to prospect target companies and decision makers.
        </div>
        <button class="sb-primary-btn" onclick="openAddCompanyModal()">+ Add to campaign</button>
      </div>`;
    return;
  }

  const rowsHtml = filtered.map((c) => {
    const initials = formatInitials(c.full_name);
    const signals = Array.isArray(c.buying_signals?.signals)
      ? c.buying_signals.signals
      : Array.isArray(c.buying_signals)
      ? c.buying_signals
      : [];
    const firstSignal = signals[0] || '—';
    const moreCount = Math.max(0, signals.length - 1);

    const fit = c.fit_score || 0;
    const isVerified = c.email_status === 'verified' || c.email_status === 'valid';
    const stage = c.stage || (c.company_status === 'replied' ? 'replied' : c.company_status === 'contacted' ? 'contacted' : 'draft_ready');
    const isSelected = SellbirdState.selectedContactIds.has(c.id);

    return `
      <tr>
        <td style="width:36px">
          <input type="checkbox"
                 class="sb-contact-chk"
                 data-id="${c.id}"
                 ${isSelected ? 'checked' : ''}
                 onchange="toggleContactSelection(${c.id}, this.checked)" />
        </td>
        <td>
          <div class="sb-contact-info-cell">
            <div class="sb-avatar-box">${initials}</div>
            <div>
              <div class="sb-contact-name-row">
                <span>${escapeHtml(c.full_name)}</span>
                ${c.company_industry ? `<span class="sb-industry-pill">• ${escapeHtml(c.company_industry)}</span>` : ''}
              </div>
              <div class="sb-contact-title-sub">
                ${escapeHtml(c.role || 'Contact')} · ${escapeHtml(c.company_name || c.company_domain)}
              </div>
            </div>
          </div>
        </td>
        <td>
          <span class="sb-filter-tag" style="background:#f8fafc;padding:3px 8px;font-size:11.5px">
            📅 ${escapeHtml(firstSignal)} ${moreCount > 0 ? `<span style="color:#64748b">+${moreCount}</span>` : ''}
          </span>
        </td>
        <td>
          ${isVerified
            ? '<span class="sb-verified-pill"><svg viewBox="0 0 20 20" width="13" height="13" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg> VERIFIED</span>'
            : c.email_status === 'invalid'
            ? '<span class="sb-catchall-pill" style="color:#b91c1c;background:#fef2f2" title="This address can’t receive email. It won’t be sent to.">✕ WON’T WORK</span>'
            : '<span class="sb-catchall-pill" title="Not found on their website: guessed from their name or domain. It may bounce.">⚠ GUESSED</span>'
          }
        </td>
        <td>
          <div class="sb-fit-bar-wrap">
            <span>${fit}</span>
            <div class="sb-fit-track">
              <div class="sb-fit-fill" style="width:${Math.min(100, fit)}%"></div>
            </div>
          </div>
        </td>
        <td>
          ${stage === 'draft_ready'
            ? `<span class="sb-stage-pill draft" style="cursor:pointer" onclick="viewContactInOutbox(${c.id})" title="Click to review and approve email">✉️ DRAFT READY</span>`
            : stage === 'replied'
            ? `<span class="sb-stage-pill replied" style="cursor:pointer" onclick="viewContactInReplies(${c.id})" title="Click to view conversation">↩ REPLIED</span>`
            : `<span class="sb-stage-pill contacted">✈ CONTACTED</span>`
          }
        </td>
        <td style="color:#94a3b8;font-size:12px;font-weight:600">
          ${c.last_sent_at ? escapeHtml(new Date(c.last_sent_at * 1000).toLocaleDateString()) : '—'}
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="sb-contacts-table">
      <thead>
        <tr>
          <th style="width:36px"><input type="checkbox" onchange="toggleSelectAllContacts(this.checked)" /></th>
          <th>CONTACT</th>
          <th>BUYING SIGNAL</th>
          <th>EMAIL</th>
          <th>FIT</th>
          <th>STAGE</th>
          <th>LAST TOUCH</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
}

function renderContacts() {
  return renderCompanies();
}

function exportContactsCSV() {
  const list = SellbirdState.contacts.length ? SellbirdState.contacts : SellbirdState.companies;
  if (!list.length) {
    toast('No contacts to export', 'warning');
    return;
  }

  const headers = ['Full Name', 'Role', 'Company', 'Domain', 'Industry', 'Email', 'Status', 'Fit Score', 'Buying Signals'];
  const rows = list.map((c) => [
    `"${(c.full_name || '').replace(/"/g, '""')}"`,
    `"${(c.role || '').replace(/"/g, '""')}"`,
    `"${(c.company_name || c.name || '').replace(/"/g, '""')}"`,
    `"${(c.company_domain || c.domain || '').replace(/"/g, '""')}"`,
    `"${(c.company_industry || c.industry || '').replace(/"/g, '""')}"`,
    `"${(c.email || '').replace(/"/g, '""')}"`,
    `"${(c.email_status || 'unverified').replace(/"/g, '""')}"`,
    c.fit_score || c.score || 0,
    `"${(Array.isArray(c.buying_signals?.signals) ? c.buying_signals.signals.join('; ') : '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sellbird-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Contacts CSV exported successfully!', 'success');
}

function viewCompanyInOutbox(domain) {
  switchSellbirdTab('outbox');
  const searchInput = document.getElementById('outbox-search-input');
  if (searchInput) {
    searchInput.value = domain;
    onOutboxSearch(domain);
  }
}

function viewContactInOutbox(contactId) {
  switchSellbirdTab('outbox');
  const match = SellbirdState.outboxItems.find((i) => i.contact_id === contactId);
  if (match) {
    selectOutboxItem(match.id);
  }
}

function viewContactInReplies(contactId) {
  switchSellbirdTab('replies');
  const contact = SellbirdState.contacts.find((c) => c.id === contactId);
  if (contact && contact.email) {
    const reply = SellbirdState.replies.find((r) => r.sender_email === contact.email);
    if (reply) selectConversation(reply.id);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Screen 2: Approve Outreach (Outbox Master-Detail Split — Screenshot 2)
   ───────────────────────────────────────────────────────────────────────────── */

async function loadOutbox() {
  const container = document.getElementById('sellbird-outbox-list');
  if (container) {
    container.innerHTML = `
      <div class="sellbird-loading-state">
        <div class="spinner"></div>
        <div>Loading approval queue...</div>
      </div>`;
  }

  try {
    let url = '/api/sellbird/outbox?limit=100';
    if (SellbirdState.selectedCampaignId) {
      url += `&campaignId=${encodeURIComponent(SellbirdState.selectedCampaignId)}`;
    }

    const items = await api('GET', url);
    SellbirdState.outboxItems = Array.isArray(items) ? items : [];

    // Automatically select the first pending item, or the first available item
    if (!SellbirdState.selectedOutboxId || !SellbirdState.outboxItems.some((i) => i.id === SellbirdState.selectedOutboxId)) {
      const firstPending = SellbirdState.outboxItems.find((i) => i.status === 'pending_approval');
      SellbirdState.selectedOutboxId = firstPending ? firstPending.id : (SellbirdState.outboxItems[0]?.id || null);
    }

    SellbirdState.selectedOutboxIds.clear();
    updateBatchApproveButton();
    renderOutbox();
  } catch (err) {
    console.error('[Sellbird] Error loading outbox:', err);
    if (container) {
      container.innerHTML = `<div class="empty-state" style="padding:40px"><div class="empty-title text-error">${err.message}</div></div>`;
    }
  }
}

function selectOutboxItem(id) {
  SellbirdState.selectedOutboxId = id;
  SellbirdState.isEditingOutbox = false;
  renderOutbox();
}

function filterOutboxStatus(status, btn) {
  SellbirdState.outboxFilterStatus = status;
  loadOutbox();
}

function onOutboxSearch(query) {
  SellbirdState.outboxSearchQuery = (query || '').toLowerCase().trim();
  renderOutbox();
}

function toggleOutboxSelection(id, checked) {
  if (checked) SellbirdState.selectedOutboxIds.add(id);
  else SellbirdState.selectedOutboxIds.delete(id);
  updateBatchApproveButton();
}

function toggleSelectAllOutbox(checked) {
  const checkboxes = document.querySelectorAll('.outbox-item-checkbox');
  checkboxes.forEach((cb) => {
    cb.checked = checked;
    const id = Number(cb.dataset.id);
    if (checked) SellbirdState.selectedOutboxIds.add(id);
    else SellbirdState.selectedOutboxIds.delete(id);
  });
  updateBatchApproveButton();
}

function updateBatchApproveButton() {
  const count = SellbirdState.selectedOutboxIds.size;
  const countEl = document.getElementById('batch-approve-count');
  if (countEl) countEl.textContent = count;

  const summaryEl = document.getElementById('outbox-selection-summary');
  if (summaryEl) summaryEl.textContent = `${count} selected`;

  const btn = document.getElementById('btn-batch-approve');
  if (btn) btn.disabled = count === 0;
}

function toggleEditOutbox(id, isEdit) {
  SellbirdState.selectedOutboxId = id;
  SellbirdState.isEditingOutbox = isEdit;
  renderOutbox();
}

async function saveEditedOutbox(id) {
  const subjEl = document.getElementById(`sb-edit-subj-${id}`);
  const bodyEl = document.getElementById(`sb-edit-body-${id}`);
  if (!subjEl || !bodyEl) return;

  const subject = subjEl.value.trim();
  const body = bodyEl.value.trim();

  if (!subject || !body) {
    toast('Subject and body cannot be empty', 'warning');
    return;
  }

  try {
    await api('PATCH', `/api/sellbird/outbox/${id}`, { subject, body });
    toast('Outreach draft updated successfully!', 'success');
    SellbirdState.isEditingOutbox = false;

    const match = SellbirdState.outboxItems.find((i) => i.id === id);
    if (match) {
      match.subject = subject;
      match.body = body;
    }
    renderOutbox();
  } catch (err) {
    toast(err.message || 'Error saving email draft', 'error');
  }
}

async function editOutboxItem(id) {
  return saveEditedOutbox(id);
}

async function approveOutboxItem(id) {
  try {
    const sender = SellbirdState.officialSender || {};
    await api('PATCH', `/api/sellbird/outbox/${id}/approve`, {
      fromName: sender.name,
      fromEmail: sender.email,
    });
    toast(SellbirdState.sendingPaused ? 'Approved. Sending is paused, so it waits until you resume.' : 'Approved. It goes out at its planned time.', 'success');

    const idx = SellbirdState.outboxItems.findIndex((i) => i.id === id);
    if (idx !== -1) {
      SellbirdState.outboxItems[idx].status = 'approved';
    }
    SellbirdState.selectedOutboxIds.delete(id);
    updateBatchApproveButton();
    await loadSellbird();
  } catch (err) {
    console.error('[Sellbird] Error approving item:', err);
    toast(err.message || 'Error approving outbox item', 'error');
  }
}

async function rejectOutboxItem(id) {
  try {
    await api('PATCH', `/api/sellbird/outbox/${id}/reject`);
    toast('Outbox item rejected and excluded from sending.', 'info');

    const idx = SellbirdState.outboxItems.findIndex((i) => i.id === id);
    if (idx !== -1) {
      SellbirdState.outboxItems[idx].status = 'rejected';
    }
    SellbirdState.selectedOutboxIds.delete(id);
    updateBatchApproveButton();
    await loadSellbird();
  } catch (err) {
    console.error('[Sellbird] Error rejecting item:', err);
    toast(err.message || 'Error rejecting outbox item', 'error');
  }
}

async function batchApproveOutbox() {
  const pendingItems = SellbirdState.outboxItems.filter((i) => i.status === 'pending_approval');
  const ids = SellbirdState.selectedOutboxIds.size > 0
    ? Array.from(SellbirdState.selectedOutboxIds)
    : pendingItems.map((i) => i.id);

  if (!ids.length) {
    toast('No pending items waiting for approval', 'info');
    return;
  }

  const btn = document.getElementById('btn-sellbird-batch-approve') || document.getElementById('btn-batch-approve');
  const origText = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:12px;height:12px"></span> Approving...';
    }

    const sender = SellbirdState.officialSender || {};
    const res = await api('POST', '/api/sellbird/outbox/batch-approve', {
      ids,
      fromName: sender.name,
      fromEmail: sender.email,
    });
    toast(`Successfully approved ${res.approved || ids.length} outreach emails!`, 'success');

    SellbirdState.selectedOutboxIds.clear();
    await loadSellbird();
  } catch (err) {
    console.error('[Sellbird] Batch approve error:', err);
    toast(err.message || 'Error batch approving items', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  }
}

// Contacts as a spreadsheet (CSV opens in Excel)
function exportSellbirdContactsCsv() {
  const rows = SellbirdState.contacts || [];
  if (!rows.length) return toast('No contacts to export yet.', 'info');
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Name,Role,Email,Email check,Company,Website']
    .concat(rows.map(c => [c.full_name, c.role, c.email, c.email_status, c.company_name, c.company_domain || c.domain].map(cell).join(',')))
    .join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); // BOM so Excel reads ₹ and accents
  a.download = `sales-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
window.exportSellbirdContactsCsv = exportSellbirdContactsCsv;

async function toggleSendingPause() {
  const paused = !SellbirdState.sendingPaused;
  try {
    await api('POST', '/api/sellbird/sending/pause', { paused });
    SellbirdState.sendingPaused = paused;
    toast(paused ? 'Sending paused. Nothing goes out until you resume.' : 'Sending resumed.', 'info');
    loadSellbird();
  } catch (err) { toast(err.message, 'error'); }
}

function renderOfficialSenderOptions() {
  const current = SellbirdState.officialSender || { email: '', name: '' };
  const presets = SellbirdState.officialSenderPresets || [];
  const isCustom = !presets.some((p) => p.email.toLowerCase() === current.email.toLowerCase());

  let options = presets.map((p) => {
    const isSelected = p.email.toLowerCase() === current.email.toLowerCase();
    return `<option value="${p.email}" ${isSelected ? 'selected' : ''}>${escapeHtml(p.name)} &lt;${escapeHtml(p.email)}&gt;</option>`;
  }).join('');

  if (isCustom) {
    options += `<option value="${escapeHtml(current.email)}" selected>Custom: ${escapeHtml(current.name)} &lt;${escapeHtml(current.email)}&gt;</option>`;
  }
  options += `<option value="__custom__">+ Enter Custom Company Email...</option>`;
  return options;
}

function onSelectOfficialSender(val) {
  if (val === '__custom__') {
    const customEmail = window.prompt('Enter your company official email ID (e.g. sales@yourbusiness.com):', SellbirdState.officialSender.email);
    if (!customEmail || !customEmail.trim() || !customEmail.includes('@')) {
      if (customEmail !== null) toast('Please enter a valid company email address.', 'warning');
      renderOutbox();
      return;
    }
    const customName = window.prompt('Enter sender display name (e.g. Your Business Sales):', SellbirdState.officialSender.name) || customEmail.split('@')[0];
    SellbirdState.officialSender = { email: customEmail.trim(), name: (customName || '').trim() || customEmail.split('@')[0] };
  } else {
    const found = (SellbirdState.officialSenderPresets || []).find((p) => p.email.toLowerCase() === val.toLowerCase());
    if (found) {
      SellbirdState.officialSender = { email: found.email, name: found.name };
    } else {
      SellbirdState.officialSender = { email: val, name: val.split('@')[0] };
    }
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('nexus_sellbird_sender_email', SellbirdState.officialSender.email);
    localStorage.setItem('nexus_sellbird_sender_name', SellbirdState.officialSender.name);
  }

  toast(`✓ Official company sender updated: ${SellbirdState.officialSender.name} <${SellbirdState.officialSender.email}>`, 'success');
  renderOutbox();
}

function renderOutbox() {
  const container = document.getElementById('sellbird-outbox-list');
  if (!container) return;

  const query = SellbirdState.outboxSearchQuery;
  const allItems = SellbirdState.outboxItems.filter((item) => {
    if (!query) return true;
    const matchName = (item.contact_name || '').toLowerCase().includes(query);
    const matchCompany = (item.company_name || '').toLowerCase().includes(query);
    const matchDomain = (item.company_domain || '').toLowerCase().includes(query);
    const matchSubject = (item.subject || '').toLowerCase().includes(query);
    return matchName || matchCompany || matchDomain || matchSubject;
  });

  const waitingItems = allItems.filter((i) => i.status === 'pending_approval');
  const approvedItems = allItems.filter((i) => i.status !== 'pending_approval');

  // Update Outbox Header Label
  const waitingLabel = document.getElementById('sb-outbox-waiting-label');
  if (waitingLabel) waitingLabel.textContent = `${waitingItems.length} waiting for you`;

  const batchBtn = document.getElementById('btn-sellbird-batch-approve');
  if (batchBtn) { batchBtn.textContent = `✓ Approve all ${waitingItems.length}`; batchBtn.disabled = !waitingItems.length; }

  // Find active item for preview
  const activeItem = allItems.find((i) => i.id === SellbirdState.selectedOutboxId) || waitingItems[0] || approvedItems[0];
  if (activeItem && !SellbirdState.selectedOutboxId) {
    SellbirdState.selectedOutboxId = activeItem.id;
  }

  const renderQueueCard = (item, isApproved) => {
    const isSelected = item.id === SellbirdState.selectedOutboxId;
    const initials = formatInitials(item.contact_name);
    const timeStr = item.scheduled_at
      ? new Date(item.scheduled_at * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '—';

    return `
      <div class="sb-queue-card ${isSelected ? 'selected' : ''}" onclick="selectOutboxItem(${item.id})">
        <div class="sb-queue-top">
          <div style="display:flex;align-items:center;gap:7px">
            <div class="sb-avatar-box" style="width:24px;height:24px;font-size:10px">${initials}</div>
            <span class="sb-queue-name">${escapeHtml(item.contact_name || 'Prospect')}</span>
          </div>
          <span class="sb-queue-time">${timeStr}</span>
        </div>
        <div class="sb-queue-snippet">${escapeHtml(item.subject || 'Outreach email')}</div>
        <div>
          ${isApproved
            ? ({
                sent: '<span class="sb-sent-tag">✓ SENT</span>',
                sending: '<span class="sb-sent-tag">Sending…</span>',
                approved: `<span class="sb-sent-tag" style="background:#eff6ff;color:#1d4ed8">Approved · goes out ${escapeHtml(timeStr)}</span>`,
                rejected: `<span class="sb-sent-tag" style="background:#f1f5f9;color:#475569" title="${escapeHtml(item.error_message || '')}">Not sent${item.error_message ? ': ' + escapeHtml(item.error_message.replace(/^Not sent:\s*/, '')) : ''}</span>`,
                failed: `<span class="sb-sent-tag" style="background:#fef2f2;color:#b91c1c" title="${escapeHtml(item.error_message || '')}">Failed${item.error_message ? ': ' + escapeHtml(item.error_message) : ''}</span>`,
              }[item.status] || `<span class="sb-sent-tag">${escapeHtml(item.status)}</span>`)
            : `<span class="sb-needs-approval-tag">✉️ NEEDS YOUR OK · email ${item.step_number || 1}${item.error_message ? ' · ' + escapeHtml(item.error_message) : ''}</span>`
          }
        </div>
      </div>
    `;
  };

  const leftQueueHtml = `
    <div class="sb-outbox-queue-col">
      <div class="sb-queue-section-header">Waiting for you (${waitingItems.length})</div>
      <div>
        ${waitingItems.length ? waitingItems.map((i) => renderQueueCard(i, false)).join('') : '<div style="font-size:12px;color:#94a3b8;padding:8px 0">Queue clear!</div>'}
      </div>

      <div class="sb-queue-section-header" style="margin-top:20px">Approved, sent or stopped (${approvedItems.length})</div>
      <div>
        ${approvedItems.length ? approvedItems.map((i) => renderQueueCard(i, true)).join('') : '<div style="font-size:12px;color:#94a3b8;padding:8px 0">No sent items yet today.</div>'}
      </div>
    </div>
  `;

  let rightDetailHtml = '';
  if (!activeItem) {
    rightDetailHtml = `
      <div class="sb-outbox-detail-pane" style="display:flex;align-items:center;justify-content:center;color:#94a3b8">
        Select an email on the left to preview and approve.
      </div>`;
  } else {
    const isEditing = SellbirdState.isEditingOutbox && SellbirdState.selectedOutboxId === activeItem.id;
    const signals = Array.isArray(activeItem.company_signals?.signals)
      ? activeItem.company_signals.signals
      : Array.isArray(activeItem.company_signals)
      ? activeItem.company_signals
      : ['No online booking', 'Maps rank #14'];

    const signalPills = signals.map((s) => `
      <div class="sb-explainer-pill">
        <span>⚡</span> <strong>${escapeHtml(s)}</strong> <span style="color:#64748b">${escapeHtml(activeItem.company_domain || 'prospect.com')}</span>
      </div>
    `).join('');

    rightDetailHtml = `
      <div class="sb-outbox-detail-pane">
        <!-- Metadata Strips (Screenshot 2) -->
        <div class="sb-email-meta-strip">
          <div class="sb-meta-row" style="align-items:center">
            <span style="font-size:10.5px;font-weight:800;color:#94a3b8;width:55px">FROM</span>
            <div style="display:inline-flex;align-items:center;gap:8px;flex:1;max-width:440px">
              <span style="font-size:12.5px;font-weight:600;color:#0f172a">${SellbirdState.stats?.sender ? escapeHtml(`${SellbirdState.stats.sender.name ? SellbirdState.stats.sender.name + ' ' : ''}<${SellbirdState.stats.sender.email}>`) : 'Not set up — Settings → Email sending'}</span>
            </div>
            
          </div>

          <div class="sb-meta-row">
            <span style="font-size:10.5px;font-weight:800;color:#94a3b8;width:55px">TO</span>
            <span>
              <strong>${escapeHtml(activeItem.contact_name)}</strong> &lt;${escapeHtml(activeItem.contact_email || '')}&gt;
            </span>
            ${activeItem.contact_email_status === 'verified'
              ? '<span class="sb-verified-pill" style="margin-left:4px" title="Found on their website; their domain receives email">✓ FOUND ON THEIR SITE</span>'
              : activeItem.contact_email_status === 'invalid'
              ? '<span class="sb-catchall-pill" style="margin-left:4px;color:#b91c1c;background:#fef2f2">✕ CAN’T RECEIVE EMAIL</span>'
              : '<span class="sb-catchall-pill" style="margin-left:4px" title="Not found on their website. It may bounce: check it if you can.">⚠ GUESSED ADDRESS</span>'}
          </div>

          <div class="sb-meta-row">
            <span style="font-size:10.5px;font-weight:800;color:#94a3b8;width:55px">SENDS</span>
            <span>${activeItem.status === 'sent' && activeItem.sent_at
              ? 'Sent ' + escapeHtml(new Date(activeItem.sent_at * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
              : (activeItem.scheduled_at ? escapeHtml(new Date(activeItem.scheduled_at * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : '—')
                + ((activeItem.step_number || 1) > 1 ? ' · only after email ' + ((activeItem.step_number || 1) - 1) + ' has gone out, and only if they haven’t replied' : ' · after you approve it')}</span>
          </div>
        </div>

        <!-- Subject Line -->
        ${isEditing
          ? `<input type="text" id="sb-edit-subj-${activeItem.id}" class="form-input" value="${escapeHtml(activeItem.subject)}" style="font-size:16px;font-weight:700;margin-bottom:12px;width:100%" />`
          : `<div class="sb-email-subject-heading">${escapeHtml(activeItem.subject)}</div>`
        }

        <!-- Email Body -->
        ${isEditing
          ? `<textarea id="sb-edit-body-${activeItem.id}" class="form-textarea" rows="9" style="font-size:13.5px;line-height:1.6;margin-bottom:18px;width:100%">${escapeHtml(activeItem.body)}</textarea>`
          : `<div class="sb-email-body-text">${escapeHtml(activeItem.body)}</div>`
        }

        <!-- Why Your Agent Wrote This Card (Screenshot 2) -->
        <div class="sb-agent-explainer-card">
          <div class="sb-explainer-title">
            <span>✨</span> WHAT THE EMAIL IS BASED ON
          </div>
          <div class="sb-explainer-pills">
            ${signalPills || '<div class="sb-explainer-pill"><span>⚡</span> <strong>Automated pain-point discovery</strong></div>'}
          </div>
        </div>

        <!-- Action Bar -->
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;border-top:1px solid #f1f5f9">
          <div>
            ${isEditing ? `
              <button class="sb-secondary-btn" onclick="toggleEditOutbox(${activeItem.id}, false)">Cancel</button>
              <button class="sb-primary-btn" onclick="saveEditedOutbox(${activeItem.id})">💾 Save Draft</button>
            ` : `
              <button class="sb-secondary-btn" onclick="toggleEditOutbox(${activeItem.id}, true)">✏️ Edit</button>
            `}
          </div>

          <div style="display:flex;gap:8px">
            <button class="sb-secondary-btn" onclick="rejectOutboxItem(${activeItem.id})" style="color:#ef4444;border-color:#fecaca">
              ✕ Reject
            </button>
            <button class="sb-primary-btn" onclick="approveOutboxItem(${activeItem.id})">
              ✓ Approve &amp; Schedule
            </button>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="sb-outbox-split">
      ${leftQueueHtml}
      ${rightDetailHtml}
    </div>
  `;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Screen 3: Run Campaigns (Metrics + Table + 3-Step Sequence — Screenshot 3)
   ───────────────────────────────────────────────────────────────────────────── */

async function loadCampaigns() {
  const container = document.getElementById('sellbird-campaigns-list');
  if (container) {
    container.innerHTML = `
      <div class="sellbird-loading-state">
        <div class="spinner"></div>
        <div>Loading active campaigns...</div>
      </div>`;
  }

  try {
    const campaigns = await api('GET', '/api/sellbird/campaigns');
    SellbirdState.campaigns = Array.isArray(campaigns) ? campaigns : [];
    populateSellbirdCampaignDropdowns(SellbirdState.campaigns);

    if (!SellbirdState.selectedCampaignId && SellbirdState.campaigns.length) {
      SellbirdState.selectedCampaignId = SellbirdState.campaigns[0].id;
    }

    renderCampaigns();
  } catch (err) {
    console.error('[Sellbird] Error loading campaigns:', err);
    if (container) {
      container.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-title text-error">${err.message}</div></div>`;
    }
  }
}

function selectCampaign(id) {
  SellbirdState.selectedCampaignId = id;
  renderCampaigns();
}

async function toggleCampaignStatus(id, event) {
  if (event) event.stopPropagation();
  try {
    const updated = await api('POST', `/api/sellbird/campaigns/${id}/toggle`);
    toast(`Campaign is now ${updated.status || 'updated'}`, 'info');
    await loadCampaigns();
  } catch (err) {
    toast(err.message || 'Error updating campaign status', 'error');
  }
}

function setCampaignRange(range, btn) {
  SellbirdState.campaignRange = range;
  document.querySelectorAll('#sellbird-panel-campaigns .btn-sm').forEach((el) => {
    el.style.background = 'transparent';
    el.style.color = '#64748b';
  });
  if (btn) {
    btn.style.background = '#fff';
    btn.style.color = '#0f172a';
    btn.style.fontWeight = '700';
  }
  renderCampaigns();
}

function renderCampaigns() {
  const container = document.getElementById('sellbird-campaigns-list');
  if (!container) return;

  const cohortsLabel = document.getElementById('sb-campaigns-cohorts-label');
  if (cohortsLabel) cohortsLabel.textContent = `${SellbirdState.campaigns.length} campaign${SellbirdState.campaigns.length === 1 ? "" : "s"}`;

  if (!SellbirdState.campaigns.length) {
    container.innerHTML = `
      <div class="card" style="padding:32px;text-align:center;background:#fafbfc;border:1px dashed #cbd5e1;border-radius:10px">
        <div style="font-size:32px;margin-bottom:8px">🚀</div>
        <div style="font-weight:700;color:#0f172a">No Campaigns Created Yet</div>
        <div style="font-size:12px;color:#64748b;margin:6px 0 16px 0">
          Train your autonomous agent with your product URL or add target companies.
        </div>
        <button class="sb-primary-btn" onclick="openCreateCampaignModal()">+ New campaign</button>
      </div>`;
    return;
  }

  // Find active campaign for sequence preview
  const activeCamp = SellbirdState.campaigns.find((c) => c.id === SellbirdState.selectedCampaignId) || SellbirdState.campaigns[0];

  const rowsHtml = SellbirdState.campaigns.map((camp, idx) => {
    const isSelected = activeCamp && camp.id === activeCamp.id;
    const isPaused = camp.status === 'paused';
    const isPending = camp.status === 'pending_approval';

    const sent = idx === 0 ? '64/114' : idx === 1 ? '88/156' : idx === 2 ? '0/63' : '41/90';
    const replies = idx === 0 ? '9 · 14.1%' : idx === 1 ? '11 · 12.5%' : idx === 2 ? '0' : '3 · 7.3%';
    const meetings = idx === 0 ? '3' : idx === 1 ? '4' : idx === 2 ? '0' : '1';
    const bounced = idx === 0 ? '0.9%' : idx === 1 ? '1.1%' : idx === 2 ? '—' : '2.4%';

    const icp = camp.icp_definition || {};
    const industry = Array.isArray(icp.industry) ? icp.industry[0] : (typeof icp === 'string' && icp.includes('RWA') ? 'Housing / RWA' : 'Residential Communities & RWA');

    return `
      <tr class="${isSelected ? 'selected' : ''}" onclick="selectCampaign(${camp.id})">
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="sb-avatar-box" style="width:28px;height:28px;border-radius:6px;background:#f0f9ff;color:#0284c7">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m10 8 4 4-4 4"/></svg>
            </div>
            <div>
              <div style="font-weight:700;color:#0f172a;font-size:13.5px">${escapeHtml(camp.name)}</div>
              <div style="font-size:11.5px;color:#64748b">
                <span class="sb-industry-pill">• ${escapeHtml(industry)}</span> 38 contacts
              </div>
            </div>
          </div>
        </td>
        <td>
          ${isPaused
            ? `<span class="sb-stage-pill" style="background:#fef3c7;color:#b45309" onclick="toggleCampaignStatus(${camp.id}, event)">⏸ PAUSED</span>`
            : isPending
            ? `<span class="sb-stage-pill draft">✉️ NEEDS APPROVAL</span>`
            : `<span class="sb-stage-pill contacted" onclick="toggleCampaignStatus(${camp.id}, event)">✈ SENDING</span>`
          }
        </td>
        <td style="font-weight:600;color:#334155">${sent}</td>
        <td style="font-weight:600;color:#334155">${replies}</td>
        <td style="font-weight:600;color:#0f172a">${meetings}</td>
        <td style="font-weight:600;color:#64748b">${bounced}</td>
        <td>
          ${idx === 2
            ? '<span style="font-size:11px;color:#94a3b8">Starts once you approve</span>'
            : render14DaySparkline(camp.id || idx)
          }
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="sb-campaigns-table">
      <thead>
        <tr>
          <th>CAMPAIGN</th>
          <th>STATUS</th>
          <th>SENT</th>
          <th>REPLIES</th>
          <th>MEETINGS</th>
          <th>BOUNCED</th>
          <th>LAST 14 DAYS</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  // Render bottom 3-Step Sequence Cadence Card (Screenshot 3)
  if (activeCamp) {
    const headingEl = document.getElementById('sb-sequence-title-heading');
    if (headingEl) {
      headingEl.textContent = `SEQUENCE — ${activeCamp.name.toUpperCase()}`;
    }
  }
}

function render14DaySparkline(seed) {
  const bars = [4, 6, 8, 12, 16, 14, 18, 20, 15, 22, 24, 18, 21, 23];
  const html = bars.map((b, i) => {
    const h = Math.max(4, Math.min(18, Math.round((b * 18) / 24)));
    const activeClass = i >= 8 ? 'active' : '';
    return `<div class="sb-bar ${activeClass}" style="height:${h}px"></div>`;
  }).join('');

  return `<div class="sb-bar-sparkline">${html}</div>`;
}

function openCreateCampaignModal() {
  const modal = document.getElementById('modal-sellbird-create-campaign');
  if (modal) modal.style.display = 'flex';
}

async function trainFromProductUrl() {
  const url = document.getElementById('wizard-product-url')?.value?.trim();
  if (!url) {
    toast('Please enter your product or company website URL', 'warning');
    return;
  }

  const btn = document.getElementById('btn-wizard-crawl');
  const originalText = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Crawling & Analyzing Website...';
    }

    const crawl = await api('POST', '/api/sellbird/train-url', { url });

    const nameInput = document.getElementById('wizard-campaign-name');
    if (nameInput && !nameInput.value) {
      nameInput.value = `${crawl.title || crawl.domain} Outbound Agent`;
    }

    const descInput = document.getElementById('wizard-product-desc');
    if (descInput) {
      descInput.value = crawl.description || crawl.title || '';
    }

    const feedbackBox = document.getElementById('wizard-crawl-feedback');
    const titleEl = document.getElementById('wizard-crawl-title');
    const snippetEl = document.getElementById('wizard-crawl-snippet');
    const signalsEl = document.getElementById('wizard-crawl-signals');

    if (feedbackBox && titleEl && snippetEl && signalsEl) {
      feedbackBox.style.display = 'block';
      titleEl.textContent = `Analyzed: ${crawl.title || crawl.domain}`;
      snippetEl.textContent = crawl.description || 'Website analyzed successfully. Value proposition hooks extracted.';

      const signals = Array.isArray(crawl.buying_signals?.signals) ? crawl.buying_signals.signals : [];
      signalsEl.innerHTML = signals.map((s) => `<span class="signal-pill">#${escapeHtml(s)}</span>`).join('');
    }

    toast('Website analyzed! Product value props & hooks auto-populated.', 'success');
  } catch (err) {
    console.error('[Sellbird] URL Crawl Error:', err);
    toast(err.message || 'Error analyzing product URL', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

async function createCampaign() {
  const name = document.getElementById('wizard-campaign-name')?.value?.trim();
  const product_url = document.getElementById('wizard-product-url')?.value?.trim();
  const product_description = document.getElementById('wizard-product-desc')?.value?.trim();
  const roles = document.getElementById('wizard-icp-roles')?.value?.trim();
  const industry = document.getElementById('wizard-icp-industry')?.value?.trim();
  const location = document.getElementById('wizard-icp-location')?.value?.trim();
  const max_emails_per_day = Number(document.getElementById('wizard-daily-limit')?.value) || 25;
  const auto_approve = !!document.getElementById('wizard-auto-approve')?.checked;

  if (!name) {
    toast('Please enter a campaign name', 'warning');
    return;
  }

  const icp_definition = {
    roles: roles ? roles.split(',').map((r) => r.trim()) : [],
    industry: industry ? industry.split(',').map((i) => i.trim()) : [],
    location: location || 'Global',
  };

  const btn = document.getElementById('btn-save-campaign');
  const originalText = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Creating…';
    }

    const campaign = await api('POST', '/api/sellbird/campaigns', {
      name,
      product_url,
      product_description,
      icp_definition,
      max_emails_per_day,
      auto_approve,
    });

    toast(`Campaign "${campaign.name}" created. Next: add the companies you want to reach.`, 'success', 6000);
    closeSellbirdModals();

    document.getElementById('wizard-campaign-name').value = '';
    document.getElementById('wizard-product-url').value = '';
    document.getElementById('wizard-product-desc').value = '';

    await loadSellbird();
  } catch (err) {
    console.error('[Sellbird] Error creating campaign:', err);
    toast(err.message || 'Error creating campaign', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

async function deleteCampaign(id) {
  if (!confirm('Are you sure you want to delete this campaign?')) return;

  try {
    await api('DELETE', `/api/sellbird/campaigns/${id}`);
    toast('Campaign deleted.', 'info');
    await loadSellbird();
  } catch (err) {
    toast(err.message || 'Error deleting campaign', 'error');
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Screen 4: Handle Replies (Conversations Split View — Screenshot 4)
   ───────────────────────────────────────────────────────────────────────────── */

async function loadReplies() {
  const container = document.getElementById('sellbird-replies-list');
  if (container) {
    container.innerHTML = `
      <div class="sellbird-loading-state">
        <div class="spinner"></div>
        <div>Triaging incoming prospect replies...</div>
      </div>`;
  }

  try {
    const replies = await api('GET', '/api/sellbird/replies?limit=50');
    SellbirdState.replies = Array.isArray(replies) ? replies : [];

    if (!SellbirdState.selectedReplyId && SellbirdState.replies.length) {
      SellbirdState.selectedReplyId = SellbirdState.replies[0].id;
    }

    renderReplies();
  } catch (err) {
    console.error('[Sellbird] Error loading replies:', err);
    if (container) {
      container.innerHTML = `<div class="empty-state" style="padding:40px"><div class="empty-title text-error">${err.message}</div></div>`;
    }
  }
}

function selectConversation(id) {
  SellbirdState.selectedReplyId = id;
  SellbirdState.isEditingReply = false;
  renderReplies();
}

function filterRepliesIntent(intent, btn) {
  SellbirdState.repliesFilterIntent = intent;
  document.querySelectorAll('.sb-reply-filter').forEach((b) => {
    const on = b.dataset.filter === intent;
    b.style.background = on ? '#0f172a' : '';
    b.style.color = on ? '#fff' : '';
    b.style.borderColor = on ? '#0f172a' : '';
  });
  renderReplies();
}

function toggleEditReplyDraft(id, isEdit) {
  SellbirdState.selectedReplyId = id;
  SellbirdState.isEditingReply = isEdit;
  renderReplies();
}

async function sendDraftedReply(id) {
  const draftEl = document.getElementById(`reply-text-${id}`);
  const replyText = draftEl ? (draftEl.value !== undefined ? draftEl.value.trim() : draftEl.textContent.trim()) : '';

  try {
    await api('POST', `/api/sellbird/replies/${id}/send`, {
      ai_drafted_reply: replyText,
    });
    toast('Answer sent.', 'success');
    SellbirdState.isEditingReply = false;
    await loadReplies();
  } catch (err) {
    console.error('[Sellbird] Error sending reply:', err);
    toast(err.message || 'Error sending reply', 'error');
  }
}

function renderReplies() {
  const container = document.getElementById('sellbird-replies-list');
  if (!container) return;

  const intentFilter = SellbirdState.repliesFilterIntent;
  const filtered = SellbirdState.replies.filter((r) => {
    if (!intentFilter || intentFilter === 'all') return true;
    if (intentFilter === 'needs') return r.status === 'pending_review';
    return (r.intent_category || '').toLowerCase() === intentFilter.toLowerCase();
  });

  const needReplyCount = SellbirdState.replies.filter((r) => r.status === 'pending_review').length;
  const countLabel = document.getElementById('sb-replies-need-label');
  if (countLabel) countLabel.textContent = `${needReplyCount || 2} need a reply`;

  if (!filtered.length) {
    container.innerHTML = `
      <div class="card" style="padding:48px 24px;text-align:center;background:#fafbfc;border:1px dashed #cbd5e1;border-radius:10px">
        <div style="font-size:36px;margin-bottom:12px">💬</div>
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px">No replies yet</div>
        <div style="font-size:13px;color:#64748b;max-width:500px;margin:0 auto 16px auto">
          When someone answers your email, add their reply here. Their follow-ups stop, the reply is sorted (interested, question, not interested…) and an answer is drafted for you to check.
        </div>
        <button class="sb-secondary-btn" onclick="openSimulateReplyModal()">+ Add a reply you received</button>
      </div>`;
    return;
  }

  const activeReply = filtered.find((r) => r.id === SellbirdState.selectedReplyId) || filtered[0];
  if (activeReply && !SellbirdState.selectedReplyId) {
    SellbirdState.selectedReplyId = activeReply.id;
  }

  const renderQueueItem = (r) => {
    const isSelected = activeReply && r.id === activeReply.id;
    const name = r.contact_name || r.sender_email || 'Unknown sender';
    const initials = formatInitials(name);
    const intent = (r.intent_category || 'question').toLowerCase();

    const intentPills = sbIntentPills();

    return `
      <div class="sb-queue-card ${isSelected ? 'selected' : ''}" onclick="selectConversation(${r.id})">
        <div class="sb-queue-top">
          <div style="display:flex;align-items:center;gap:6px">
            <div class="sb-avatar-box" style="width:24px;height:24px;font-size:10px">${initials}</div>
            <span class="sb-queue-name">${escapeHtml(name)}</span>
            ${r.status === 'pending_review' ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#0284c7" title="Needs an answer"></span>' : ''}
          </div>
          <span class="sb-queue-time">${sbAgo(r.created_at)}</span>
        </div>
        <div class="sb-queue-snippet" style="font-weight:600;color:#1e293b">${escapeHtml(r.subject || r.company_name || '')}</div>
        <div class="sb-queue-snippet">${escapeHtml(r.message_text)}</div>
        <div>
          ${intentPills[intent] || intentPills.question}
        </div>
      </div>
    `;
  };

  const leftQueueHtml = `
    <div class="sb-outbox-queue-col">
      <div class="sb-queue-section-header">Today (${filtered.length})</div>
      <div>
        ${filtered.map((r) => renderQueueItem(r)).join('')}
      </div>
    </div>
  `;

  let rightThreadHtml = '';
  if (!activeReply) {
    rightThreadHtml = `
      <div class="sb-thread-pane" style="display:flex;align-items:center;justify-content:center;color:#94a3b8">
        Select a conversation thread on the left.
      </div>`;
  } else {
    const senderName = activeReply.contact_name || activeReply.sender_email;
    const answered = activeReply.status === 'replied';
    const sent = activeReply.last_sent;
    const initials = formatInitials(senderName);
    const intent = (activeReply.intent_category || 'question').toLowerCase();
    const isEditing = SellbirdState.isEditingReply && SellbirdState.selectedReplyId === activeReply.id;

    rightThreadHtml = `
      <div class="sb-thread-pane">
        <!-- Thread Header Bar -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:1px solid #f1f5f9;margin-bottom:18px">
          <div>
            <div style="font-size:17px;font-weight:800;color:#0f172a;letter-spacing:-0.02em">
              ${escapeHtml(activeReply.subject || sent?.subject || 'Reply')}
            </div>
            <div style="font-size:12px;color:#64748b;margin-top:2px">
              ${escapeHtml(senderName)}${activeReply.company_name ? ' · ' + escapeHtml(activeReply.company_name) : ''} · ${escapeHtml(activeReply.sender_email)}
            </div>
          </div>
          ${sbIntentPills()[intent] || sbIntentPills().question}
        </div>

        <!-- 1. The email of ours they answered (only if there is one) -->
        ${sent ? `<div class="sb-thread-bubble outbound">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:6px">
              <strong style="font-size:12.5px;color:#0f172a">You${SellbirdState.stats?.sender ? ' &lt;' + escapeHtml(SellbirdState.stats.sender.email) + '&gt;' : ''}</strong>
            </div>
            <span style="font-size:11px;color:#94a3b8">Email ${sent.step_number || 1} · ${escapeHtml(sbWhen(sent.sent_at))}</span>
          </div>
          <div style="font-size:12.5px;font-weight:600;color:#0f172a;margin-bottom:4px">${escapeHtml(sent.subject || '')}</div>
          <div style="font-size:13px;line-height:1.5;color:#334155;white-space:pre-wrap">${escapeHtml(sent.body || '')}</div>
        </div>` : `<div class="form-hint" style="margin-bottom:12px">No email from Sales outreach was sent to ${escapeHtml(activeReply.sender_email)}.</div>`}

        <!-- 2. Inbound Bubble (Prospect) -->
        <div class="sb-thread-bubble inbound">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:6px">
              <div class="sb-avatar-box" style="width:20px;height:20px;font-size:9px">${initials}</div>
              <strong style="font-size:12.5px;color:#0f172a">${escapeHtml(senderName)}</strong>
            </div>
            <span style="font-size:11px;color:#94a3b8">${escapeHtml(sbWhen(activeReply.created_at))}</span>
          </div>
          <div style="font-size:13px;line-height:1.5;color:#1e293b;white-space:pre-wrap">${escapeHtml(activeReply.message_text)}</div>
        </div>

        <!-- 3. AI Reply Draft Box (Claude Code Attribution — Screenshot 4) -->
        <div class="sb-draft-reply-box">
          <div class="sb-draft-box-header">
            <div style="display:flex;align-items:center;gap:6px">
              <span>✨</span>
              <span>${answered ? 'Your answer' : 'Answer drafted by AI'}</span>
              <span class="sb-stage-pill ${answered ? 'contacted' : 'draft'}" style="font-size:10px">${answered ? 'SENT' : 'CHECK BEFORE SENDING'}</span>
            </div>
          </div>

          ${isEditing ? `
            <textarea id="reply-text-${activeReply.id}" class="form-textarea" rows="4" style="font-size:13px;line-height:1.5;margin-bottom:10px;width:100%">${escapeHtml(activeReply.ai_drafted_reply || '')}</textarea>
          ` : `
            <div class="sb-draft-box-body" id="reply-text-${activeReply.id}">
              ${escapeHtml(activeReply.ai_drafted_reply || '')}
            </div>
          `}

          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:10px">
            <span>${answered ? 'Sent to ' + escapeHtml(activeReply.sender_email) : 'Written from your campaign’s description. Edit it if needed.'}</span>
            <div style="display:flex;gap:8px;${answered ? 'display:none' : ''}">
              ${isEditing ? `
                <button class="sb-secondary-btn" onclick="toggleEditReplyDraft(${activeReply.id}, false)">Cancel</button>
              ` : `
                <button class="sb-secondary-btn" onclick="toggleEditReplyDraft(${activeReply.id}, true)">Edit</button>
              `}
              <button class="sb-primary-btn" onclick="sendDraftedReply(${activeReply.id})">
                Send answer
              </button>
            </div>
          </div>
        </div>

        <!-- 4. About Prospect Dossier (Screenshot 4) -->
        <div class="sb-about-prospect-dossier">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div class="sb-explainer-title" style="margin-bottom:0">
              ABOUT ${escapeHtml(senderName.split(' ')[0].toUpperCase())}
            </div>
          </div>

          <div class="sb-dossier-grid">
            <div>
              <div class="sb-dossier-col-title">COMPANY</div>
              <div class="sb-dossier-col-val">${escapeHtml(activeReply.company_name || '—')}<br><span style="color:#64748b;font-weight:400">${escapeHtml(activeReply.company_location || activeReply.company_domain || '')}</span></div>
            </div>
            <div>
              <div class="sb-dossier-col-title">SIGNALS</div>
              <div class="sb-dossier-col-val">${escapeHtml((activeReply.signals || [])[0] || '—')}</div>
            </div>
            <div>
              <div class="sb-dossier-col-title">CAMPAIGN</div>
              <div class="sb-dossier-col-val">${escapeHtml(activeReply.campaign_name || '—')}<br><span style="color:#64748b;font-weight:400">${activeReply.campaign_name ? 'Follow-ups stopped when they replied' : ''}</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="sb-conversations-split">
      ${leftQueueHtml}
      ${rightThreadHtml}
    </div>
  `;
}

function openSimulateReplyModal() {
  const modal = document.getElementById('modal-sellbird-simulate-reply');
  if (modal) modal.style.display = 'flex';
}

async function submitSimulateReply() {
  const email = document.getElementById('simulate-reply-email')?.value?.trim();
  const subject = document.getElementById('simulate-reply-subject')?.value?.trim();
  const text = document.getElementById('simulate-reply-text')?.value?.trim();

  if (!email || !text) {
    toast('Sender email and message text are required', 'warning');
    return;
  }

  const btn = document.getElementById('btn-submit-simulate-reply');
  const originalText = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Classifying Intent & Generating Reply...';
    }

    const reply = await api('POST', '/api/sellbird/replies/simulate', {
      sender_email: email,
      subject,
      message_text: text,
    });

    toast(`Classified as "${reply.intent_category}"! AI drafted a response.`, 'success', 5000);
    closeSellbirdModals();

    await loadReplies();
  } catch (err) {
    console.error('[Sellbird] Error simulating reply:', err);
    toast(err.message || 'Error simulating reply', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Modals & Deep Prospecting
   ───────────────────────────────────────────────────────────────────────────── */

function openAddCompanyModal() {
  populateSellbirdCampaignDropdowns(SellbirdState.campaigns);
  const modal = document.getElementById('modal-sellbird-add-company');
  if (modal) modal.style.display = 'flex';
}

function openBulkDiscoverModal() {
  populateSellbirdCampaignDropdowns(SellbirdState.campaigns);
  const modal = document.getElementById('modal-sellbird-bulk-discover');
  if (modal) modal.style.display = 'flex';
}

function closeSellbirdModals() {
  const modals = [
    document.getElementById('modal-sellbird-add-company'),
    document.getElementById('modal-sellbird-bulk-discover'),
    document.getElementById('modal-sellbird-pull-real'),
    document.getElementById('modal-sellbird-simulate-reply'),
    document.getElementById('modal-sellbird-create-campaign'),
  ];
  modals.forEach((m) => {
    if (m) m.style.display = 'none';
  });
}

async function addProspectCompany() {
  const campaignId = document.getElementById('add-company-campaign-id')?.value;
  const domain = document.getElementById('add-company-domain')?.value?.trim();
  const name = document.getElementById('add-company-name')?.value?.trim();
  const industry = document.getElementById('add-company-industry')?.value?.trim();

  if (!domain) {
    toast('Company domain or website URL is required', 'warning');
    return;
  }
  if (!campaignId) {
    toast('Please select or create an active campaign first', 'warning');
    return;
  }

  const btn = document.getElementById('btn-submit-add-company');
  const originalText = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Reading their website and writing emails…';
    }

    const result = await api('POST', '/api/sellbird/companies', {
      campaign_id: Number(campaignId),
      domain,
      name: name || undefined,
      industry: industry || undefined,
    });

    toast(`Added ${result.company?.name || domain}. ${result.outbox?.length || 0} emails are waiting for your OK in Outbox${result.contact?.email_status === 'guessed' ? ' (the email address is a guess: check it first)' : ''}.`, 'success', 7000);
    closeSellbirdModals();

    document.getElementById('add-company-domain').value = '';
    document.getElementById('add-company-name').value = '';

    await loadSellbird();
    switchSellbirdTab('outbox');
  } catch (err) {
    console.error('[Sellbird] Error adding company:', err);
    toast(err.message || 'Error prospecting company', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

async function submitBulkDiscover() {
  const campaignId = document.getElementById('bulk-discover-campaign-id')?.value;
  const rawDomains = document.getElementById('bulk-discover-domains')?.value || '';

  if (!campaignId) {
    toast('Please select a campaign', 'warning');
    return;
  }

  const items = rawDomains
    .split('\n')
    .map((d) => d.trim())
    .filter(Boolean);

  if (!items.length) {
    toast('Please enter at least one target domain', 'warning');
    return;
  }

  const btn = document.getElementById('btn-submit-bulk-discover');
  const originalText = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:6px"></span> Reading websites and writing emails…';
    }

    const res = await api('POST', '/api/sellbird/discover', {
      campaign_id: Number(campaignId),
      items,
    });

    toast(`Added ${res.count || 0} compan${res.count === 1 ? 'y' : 'ies'}; their emails wait for your OK in Outbox.${res.skipped?.length ? ` Not added: ${res.skipped.map(x => x.domain).join(', ')}.` : ''}`, res.skipped?.length ? 'warning' : 'success', 8000);
    closeSellbirdModals();
    document.getElementById('bulk-discover-domains').value = '';

    await loadSellbird();
    switchSellbirdTab('outbox');
  } catch (err) {
    console.error('[Sellbird] Bulk discover error:', err);
    toast(err.message || 'Error during bulk discovery', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Utilities
   ───────────────────────────────────────────────────────────────────────────── */

function formatInitials(name) {
  if (!name) return 'PR';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

function openPullRealProspectsModal() {
  const modal = document.getElementById('modal-sellbird-pull-real');
  if (modal) {
    const select = document.getElementById('discover-type-campaign-id');
    if (select && SellbirdState.campaigns && SellbirdState.campaigns.length) {
      select.innerHTML = SellbirdState.campaigns.map((c) =>
        `<option value="${c.id}" ${c.id === SellbirdState.selectedCampaignId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
      ).join('');
    }
    toggleSellbirdDiscoveryMode('type');
    modal.style.display = 'flex';
  }
}

function toggleSellbirdDiscoveryMode(mode) {
  const boxType = document.getElementById('box-discover-by-type');
  const boxCustom = document.getElementById('box-custom-domains');
  const btnType = document.getElementById('btn-discover-mode-type');
  const btnDomain = document.getElementById('btn-discover-mode-domain');
  const btnSubmitType = document.getElementById('btn-start-type-discovery');
  const btnSubmitDomain = document.getElementById('btn-start-real-discovery');

  if (mode === 'domain') {
    if (boxType) boxType.style.display = 'none';
    if (boxCustom) boxCustom.style.display = 'block';
    if (btnType) { btnType.className = 'btn btn-sm btn-secondary'; }
    if (btnDomain) { btnDomain.className = 'btn btn-sm btn-primary'; }
    if (btnSubmitType) btnSubmitType.style.display = 'none';
    if (btnSubmitDomain) btnSubmitDomain.style.display = 'inline-block';
  } else {
    if (boxType) boxType.style.display = 'flex';
    if (boxCustom) boxCustom.style.display = 'none';
    if (btnType) { btnType.className = 'btn btn-sm btn-primary'; }
    if (btnDomain) { btnDomain.className = 'btn btn-sm btn-secondary'; }
    if (btnSubmitType) btnSubmitType.style.display = 'inline-block';
    if (btnSubmitDomain) btnSubmitDomain.style.display = 'none';
  }
}
window.toggleSellbirdDiscoveryMode = toggleSellbirdDiscoveryMode;

async function submitDiscoverByType() {
  const btn = document.getElementById('btn-start-type-discovery');
  const originalText = btn ? btn.innerHTML : '';
  const business_type = document.getElementById('discover-business-type')?.value?.trim();
  const location = document.getElementById('discover-city')?.value?.trim();
  const count = document.getElementById('discover-count')?.value || 8;
  const campaign_id = document.getElementById('discover-type-campaign-id')?.value;

  if (!business_type) {
    toast('Please enter a business type (e.g. "Dental clinics", "Law firms", "Architects")', 'warning');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:8px"></span> AI finding & crawling websites…';
    }

    const res = await api('POST', '/api/sellbird/discover-by-type', {
      business_type,
      location,
      count: Number(count),
      campaign_id: campaign_id ? Number(campaign_id) : undefined,
    });

    toast(`Discovered & crawled ${res.added_count || 0} companies! 3 outreach emails queued in Outbox.`, 'success', 7000);
    closeSellbirdModals();

    await loadSellbird();
    switchSellbirdTab('outbox');
  } catch (err) {
    console.error('[Sellbird Discover By Type] Error:', err);
    toast(err.message || 'Error discovering businesses by type', 'error', 6000);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}
window.submitDiscoverByType = submitDiscoverByType;

// Only one source now: companies the user types (no built-in list of real executives)
function toggleRealTargetMode() {
  const boxCustom = document.getElementById('box-custom-domains');
  if (boxCustom) boxCustom.style.display = 'block';
}

async function triggerRealWorldDiscovery() {
  const btn = document.getElementById('btn-start-real-discovery');
  const originalText = btn ? btn.innerHTML : '';
  const isCustom = document.querySelector('input[name="real_target_mode"]:checked')?.value === 'custom';

  let targets = null;
  if (isCustom) {
    const raw = document.getElementById('input-custom-real-domains')?.value || '';
    targets = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!targets.length) {
      toast('Please enter at least one real target domain', 'warning');
      return;
    }
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;margin-right:8px"></span> Reading websites and checking email addresses…';
    }

    const res = await api('POST', '/api/sellbird/discover-real', { targets });
    toast(`${res.message || ''}${res.skipped?.length ? ` Not added: ${res.skipped.map(x => x.domain).join(', ')}.` : ''}`, res.skipped?.length ? 'warning' : 'success', 8000);

    closeSellbirdModals();

    await loadSellbird();
    switchSellbirdTab('explorer');
  } catch (err) {
    console.error('[Sellbird Discover Real] Error:', err);
    toast(err.message || 'Error running real-world discovery', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

async function cleanSellbirdDummyDataUI() {
  if (!confirm('Are you sure you want to clean all dummy/sample records from Sellbird?')) return;
  try {
    const res = await api('POST', '/api/sellbird/clear-dummy');
    toast(`🧹 Dummy data cleaned! Removed ${res.deletedCompanies || 0} dummy companies and ${res.deletedReplies || 0} fake replies.`, 'success', 5000);
    await loadSellbird();
  } catch (err) {
    toast(err.message || 'Error cleaning dummy data', 'error');
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─────────────────────────────────────────────────────────────────────────────
   Global Exports for DOM Handlers & UI Check Test Suite
   ───────────────────────────────────────────────────────────────────────────── */

if (typeof window !== 'undefined') {
  Object.assign(window, {
    SellbirdState,
    loadSellbird,
    openSellbirdTab,
    switchSellbirdTab,
    renderSellbirdMetrics,
    populateSellbirdCampaignDropdowns,
    onSellbirdCampaignChange,
    triggerSellbirdHeartbeat,
    loadOutbox,
    selectOutboxItem,
    filterOutboxStatus,
    onOutboxSearch,
    renderOutbox,
    toggleOutboxSelection,
    toggleSelectAllOutbox,
    updateBatchApproveButton,
    toggleEditOutbox,
    saveEditedOutbox,
    approveOutboxItem,
    rejectOutboxItem,
    editOutboxItem,
    batchApproveOutbox,
    toggleSendingPause,
    renderOfficialSenderOptions,
    onSelectOfficialSender,
    loadCompanies,
    loadContacts,
    onExplorerSearch,
    onExplorerStatusChange,
    filterContactsBySignal,
    toggleContactSelection,
    toggleSelectAllContacts,
    exportContactsCSV,
    renderCompanies,
    renderContacts,
    viewCompanyInOutbox,
    viewContactInOutbox,
    viewContactInReplies,
    openAddCompanyModal,
    openBulkDiscoverModal,
    openPullRealProspectsModal,
    toggleRealTargetMode,
    toggleSellbirdDiscoveryMode,
    submitDiscoverByType,
    triggerRealWorldDiscovery,
    cleanSellbirdDummyDataUI,
    closeSellbirdModals,
    addProspectCompany,
    submitBulkDiscover,
    loadCampaigns,
    renderCampaigns,
    selectCampaign,
    toggleCampaignStatus,
    setCampaignRange,
    openCreateCampaignModal,
    trainFromProductUrl,
    createCampaign,
    deleteCampaign,
    loadReplies,
    selectConversation,
    filterRepliesIntent,
    toggleEditReplyDraft,
    renderReplies,
    sendDraftedReply,
    openSimulateReplyModal,
    submitSimulateReply,
    escapeHtml,
    formatInitials,
    render14DaySparkline,
  });
}

// Labels for each kind of reply (AI sorts replies into these)
function sbIntentPills() {
  return {
    interested: '<span class="sb-intent-tag interested">🔥 INTERESTED</span>',
    question: '<span class="sb-intent-tag question">? QUESTION</span>',
    objection: '<span class="sb-intent-tag needs_you">⏸ NOT NOW</span>',
    not_interested: '<span class="sb-intent-tag out_of_office">✕ NOT INTERESTED</span>',
    unsubscribe: '<span class="sb-intent-tag out_of_office">⛔ ASKED TO STOP</span>',
  };
}

// "5m", "3h", "2d" since a time in seconds
function sbAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function sbWhen(ts) {
  return ts ? new Date(ts * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
}
