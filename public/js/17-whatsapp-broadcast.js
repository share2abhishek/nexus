// NexaDrip app — WhatsApp Outreach Broadcast Flow
// Complete 4-step wizard:
//   1. Contacts      Searchable table with checkboxes, date added, dedupe, tag filters & clear filter
//   2. Message       Meta template picker with fill-ins and live chat preview
//   3. Schedule      Send Now vs Date/Time scheduling + rate throttler + Multi-Number Sender Pool
//   4. Review & Send Summary checklist, test sender, and launch progress

const BC = {
  setup: null,
  templates: [],
  history: [],
  currentStep: 1,
  // Contacts & Audience state
  allContacts: [],
  selectedIds: new Set(),
  activeSource: 'all', // 'all' | 'tag' | 'manual' | 'spreadsheet'
  searchQuery: '',
  tagFilter: '',
  dateFilter: 'all',   // 'all' | 'today' | '7days' | '30days'
  dedupeActive: false, // Deduplicate contacts by phone number
  sortKey: 'name',
  sortAsc: true,
  // Multi-Number Sender Pool state
  savedNumbers: [],
  selectedNumberId: 'inbound',
  showAddNumberForm: false,
  // Message state
  template: null,
  params: [],
  text: '',
  title: '',
  // Schedule state
  timingMode: 'now', // 'now' | 'scheduled'
  scheduleDate: '',
  scheduleTime: '',
  sendRate: 60,
  // File audience
  fileContacts: [],
  fileName: '',
  // Runtime
  current: null,
  poll: null,
};

async function loadBroadcastPage() {
  const root = document.getElementById('bc-root');
  if (!root) return;
  root.innerHTML = '<div class="state-loading"><span class="spinner lg"></span><div>Loading WhatsApp Outreach…</div></div>';
  try {
    const [setup, tpl, history, leads, numbersRes] = await Promise.all([
      api('GET', '/api/lead-pipeline/whatsapp/broadcasts/setup').catch(() => ({})),
      api('GET', '/api/lead-pipeline/whatsapp/templates').catch(() => ({ templates: [] })),
      api('GET', '/api/lead-pipeline/whatsapp/broadcasts').catch(() => []),
      api('GET', '/api/lead-pipeline/leads?limit=500').catch(() => []),
      api('GET', '/api/lead-pipeline/whatsapp/broadcasts/numbers').catch(() => ({ numbers: [] })),
    ]);

    BC.setup = setup || {};
    BC.templates = (tpl.templates || []).filter(t => t.status === 'APPROVED');
    BC.history = Array.isArray(history) ? history : (history.broadcasts || []);
    BC.savedNumbers = numbersRes?.numbers || [];

    // Choose default number
    const defNum = BC.savedNumbers.find(n => n.is_default) || BC.savedNumbers[0];
    BC.selectedNumberId = defNum ? String(defNum.id) : 'inbound';
    BC.showAddNumberForm = false;

    // Extract contacts with phone
    const list = Array.isArray(leads) ? leads.filter(l => l.phone_number) : [];
    BC.allContacts = list;
    BC.selectedIds = new Set(list.map(c => c.id));
    BC.currentStep = 1;
    BC.activeSource = 'all';
    BC.searchQuery = '';
    BC.tagFilter = '';
    BC.dateFilter = 'all';
    BC.dedupeActive = false;
    BC.timingMode = 'now';
    BC.sendRate = 60;

    // Default template selection if any
    if (BC.pendingTemplate) {
      pickTemplate(BC.pendingTemplate.name, BC.pendingTemplate.language);
      BC.pendingTemplate = null;
    } else if (BC.templates.length) {
      pickTemplate(BC.templates[0].name, BC.templates[0].language);
    }

    renderBroadcastPage();
    refreshAudienceCount();
  } catch (err) {
    root.innerHTML = `<div class="state-error">Couldn’t load broadcasts: ${escapeHtml(err.message)} <button class="btn btn-secondary btn-sm" onclick="loadBroadcastPage()">Try again</button></div>`;
  }
}

function pickTemplate(name, language) {
  const t = BC.templates.find(x => x.name === name && (!language || x.language === language));
  BC.template = t || null;
  const n = t ? (t.body_text.match(/\{\{\d+\}\}/g) || []).length : 0;
  BC.params = Array.from({ length: n }, (_, i) => {
    const f = t.fields?.[i];
    return f?.key === 'name' || /name/i.test(f?.label || '') ? { source: 'name' } : { source: 'text', value: f?.example || '' };
  });
}

const bcEngineWeb = () => BC.setup?.engine === 'evolution';

// ══════════════════════════════════════════════════════════════
//  MAIN PAGE RENDERER
// ══════════════════════════════════════════════════════════════

function renderBroadcastPage() {
  const root = document.getElementById('bc-root');
  if (!root) return;
  const s = BC.setup || {};
  const tags = getAvailableTags();
  const hasActiveFilters = Boolean(BC.searchQuery || BC.tagFilter || BC.dateFilter !== 'all' || BC.dedupeActive);

  root.innerHTML = `
    <div style="max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:16px;padding-bottom:32px">

      <!-- Header -->
      <div style="display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--border,#e5e7eb)">
        <div style="width:36px;height:36px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        </div>
        <div>
          <h2 style="font-size:16px;font-weight:700;margin:0">WhatsApp Outreach</h2>
          <p style="font-size:12px;color:var(--text-secondary,#6b7280);margin:2px 0 0">Bulk campaigns · Audience broadcasts · Templates</p>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
          <button type="button" class="btn btn-secondary btn-sm" onclick="navigateTo('crm-pipeline'); switchCrmView('reports');" style="font-size:12px;display:flex;align-items:center;gap:5px" title="View detailed delivery, response, and conversion reports">
            <span>📊 Outreach Reports</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="bcResetAll()" style="font-size:12px">↺ Reset</button>
        </div>
      </div>

      <!-- Warnings -->
      ${!s.connected ? `<div class="callout callout-warn"><b>Connect WhatsApp first.</b> You can prepare the broadcast now. <button class="btn btn-secondary btn-sm" onclick="navigateTo('leads-settings')">Open WhatsApp setup</button></div>` : ''}
      ${s.licensed === false ? `<div class="callout callout-warn"><b>Sending broadcasts needs an active licence.</b> You can prepare everything now and send once it’s active. <button class="btn btn-secondary btn-sm" onclick="openSettings('license')">Open Licence</button></div>` : ''}

      <!-- Step Progress Bar (1 Contacts -> 2 Message -> 3 Schedule -> 4 Review & Send) -->
      <div style="display:flex;align-items:center;gap:0;margin:4px 0">
        <div style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="bcGoToStep(1)">
          <div id="bc-dot-1" style="width:28px;height:28px;border-radius:50%;background:#25D366;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">1</div>
          <span id="bc-lbl-1" style="font-size:13px;font-weight:600;color:#25D366">Contacts</span>
        </div>
        <div id="bc-line-1" style="flex:1;height:2px;background:var(--border,#e5e7eb);margin:0 10px"></div>

        <div style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="bcGoToStep(2)">
          <div id="bc-dot-2" style="width:28px;height:28px;border-radius:50%;background:var(--bg-secondary,var(--card-bg,#fff));border:2px solid var(--border,#e5e7eb);color:var(--text-secondary,#6b7280);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">2</div>
          <span id="bc-lbl-2" style="font-size:13px;font-weight:600;color:var(--text-secondary,#6b7280)">Message</span>
        </div>
        <div id="bc-line-2" style="flex:1;height:2px;background:var(--border,#e5e7eb);margin:0 10px"></div>

        <div style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="bcGoToStep(3)">
          <div id="bc-dot-3" style="width:28px;height:28px;border-radius:50%;background:var(--bg-secondary,var(--card-bg,#fff));border:2px solid var(--border,#e5e7eb);color:var(--text-secondary,#6b7280);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">3</div>
          <span id="bc-lbl-3" style="font-size:13px;font-weight:600;color:var(--text-secondary,#6b7280)">Schedule & Number</span>
        </div>
        <div id="bc-line-3" style="flex:1;height:2px;background:var(--border,#e5e7eb);margin:0 10px"></div>

        <div style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="bcGoToStep(4)">
          <div id="bc-dot-4" style="width:28px;height:28px;border-radius:50%;background:var(--bg-secondary,var(--card-bg,#fff));border:2px solid var(--border,#e5e7eb);color:var(--text-secondary,#6b7280);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">4</div>
          <span id="bc-lbl-4" style="font-size:13px;font-weight:600;color:var(--text-secondary,#6b7280)">Review & Send</span>
        </div>
      </div>

      <!-- ══════════════════════════════════════════════════════════ -->
      <!-- STEP 1: CONTACTS ("Who gets it")                           -->
      <!-- ══════════════════════════════════════════════════════════ -->
      <div id="bc-step-1" class="settings-section" style="background:var(--bg-card,var(--card-bg,#fff));border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <h3 style="font-size:14px;font-weight:700;margin:0">① Who gets it?</h3>
          <span id="bc-badge-count" style="font-size:11.5px;padding:3px 12px;border-radius:99px;background:#dcfce7;color:#15803d;font-weight:700">
            ${BC.selectedIds.size} selected
          </span>
        </div>

        <!-- Audience source selection pills -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn btn-sm" id="bc-pill-all" onclick="bcSetAudienceSource('all')"
            style="border-radius:99px;font-size:12px;font-weight:600;${BC.activeSource==='all'?'background:#25D366;color:#fff;border-color:#25D366':''}">
            ● All Contacts (${BC.allContacts.length})
          </button>
          
          <button type="button" class="btn btn-sm btn-secondary" id="bc-pill-tag" onclick="bcSetAudienceSource('tag')"
            style="border-radius:99px;font-size:12px;font-weight:600;${BC.activeSource==='tag'?'background:#25D366;color:#fff;border-color:#25D366':''}">
            🏷 By Tag
          </button>
          
          <button type="button" class="btn btn-sm btn-secondary" id="bc-pill-manual" onclick="bcSetAudienceSource('manual')"
            style="border-radius:99px;font-size:12px;font-weight:600;${BC.activeSource==='manual'?'background:#25D366;color:#fff;border-color:#25D366':''}">
            ☑ Select Manually
          </button>
          
          <label class="btn btn-sm btn-secondary" id="bc-pill-file"
            style="border-radius:99px;font-size:12px;font-weight:600;margin:0;cursor:pointer;${BC.activeSource==='spreadsheet'?'background:#25D366;color:#fff;border-color:#25D366':''}">
            📄 Spreadsheet
            <input type="file" id="bc-input-file" accept=".xlsx,.csv,text/csv" hidden onchange="bcOnFileUpload(this)" />
          </label>
        </div>

        <!-- Toolbar: Search + Previously Used Tags + Date Added + Dedupe + Delete Filter -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <!-- Search box -->
          <div style="position:relative;flex:1;min-width:180px">
            <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);opacity:.5;font-size:13px">🔍</span>
            <input type="text" id="bc-search-input" placeholder="Search by name, phone or tag…" value="${escapeHtml(BC.searchQuery)}"
              oninput="bcOnSearch(this.value)"
              class="form-input form-input-sm" style="padding-left:32px;font-size:12px;height:34px;border-radius:8px" />
          </div>

          <!-- Previously Used Tags Filter -->
          <select id="bc-filter-tag-select" onchange="bcOnTagFilterChange(this.value)" class="form-select form-select-sm"
            style="width:auto;min-width:130px;font-size:12px;height:34px;border-radius:8px">
            <option value="">🏷 All Tags</option>
            <optgroup label="Previously Used Tags">
              ${tags.map(t => `<option value="${escapeHtml(t)}" ${BC.tagFilter===t?'selected':''}>${escapeHtml(t)}</option>`).join('')}
            </optgroup>
          </select>

          <!-- Date Added Filter -->
          <select id="bc-filter-date-select" onchange="bcOnDateFilterChange(this.value)" class="form-select form-select-sm"
            style="width:auto;min-width:130px;font-size:12px;height:34px;border-radius:8px">
            <option value="all" ${BC.dateFilter==='all'?'selected':''}>📅 Date Added: All</option>
            <option value="today" ${BC.dateFilter==='today'?'selected':''}>Added Today</option>
            <option value="7days" ${BC.dateFilter==='7days'?'selected':''}>Added Last 7 Days</option>
            <option value="30days" ${BC.dateFilter==='30days'?'selected':''}>Added Last 30 Days</option>
          </select>

          <!-- Dedupe Toggle Button -->
          <button type="button" class="btn btn-sm ${BC.dedupeActive ? 'btn-primary' : 'btn-secondary'}" onclick="bcToggleDedupe()" id="bc-btn-dedupe"
            style="border-radius:8px;font-size:12px;font-weight:600;height:34px;${BC.dedupeActive ? 'background:#25D366;border-color:#25D366;color:#fff' : ''}"
            title="Deduplicate contacts with the same phone number">
            🔄 Dedupe ${BC.dedupeActive ? '(Active)' : ''}
          </button>

          <!-- Delete / Clear Filter Button -->
          <div id="bc-clear-filter-wrap" style="display:${hasActiveFilters ? 'inline-block' : 'none'}">
            <button type="button" class="btn btn-sm btn-ghost" onclick="bcClearAllFilters()"
              style="font-size:12px;color:#ef4444;font-weight:600;height:34px;padding:0 8px" title="Delete/clear all active filters">
              ✕ Clear filters
            </button>
          </div>
        </div>

        <!-- Quick Previously Used Tag Chips -->
        ${tags.length ? `
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px">
            <span style="color:var(--text-secondary,#6b7280);font-weight:600">Tags:</span>
            <button type="button" onclick="bcOnTagFilterChange('')" style="border:none;border-radius:99px;padding:2px 8px;font-size:10.5px;cursor:pointer;${!BC.tagFilter?'background:#25D366;color:#fff':'background:var(--border,#e5e7eb);color:inherit'}">All</button>
            ${tags.map(t => `
              <button type="button" onclick="bcOnTagFilterChange('${escapeHtml(t)}')"
                style="border:none;border-radius:99px;padding:2px 8px;font-size:10.5px;cursor:pointer;${BC.tagFilter===t?'background:#25D366;color:#fff':'background:var(--border,#e5e7eb);color:inherit'}">
                ${escapeHtml(t)}
              </button>
            `).join('')}
          </div>
        ` : ''}

        <!-- The Contacts Table (with Date Added column) -->
        <div style="border:1px solid var(--border,#e5e7eb);border-radius:10px;overflow:hidden">
          <div style="max-height:280px;overflow-y:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="position:sticky;top:0;background:var(--bg-card,var(--card-bg,#f9fafb));z-index:3;border-bottom:1px solid var(--border,#e5e7eb)">
                  <th style="padding:10px 12px;width:38px;text-align:left">
                    <input type="checkbox" id="bc-select-all-cb" onchange="bcToggleAllVisible(this.checked)"
                      style="width:14px;height:14px;accent-color:#25D366;cursor:pointer" />
                  </th>
                  <th onclick="bcSortTable('name')" style="padding:10px 12px;text-align:left;font-weight:600;color:var(--text-secondary,#6b7280);cursor:pointer;user-select:none;white-space:nowrap" id="bc-th-name">
                    Name ↕
                  </th>
                  <th onclick="bcSortTable('phone')" style="padding:10px 12px;text-align:left;font-weight:600;color:var(--text-secondary,#6b7280);cursor:pointer;user-select:none;white-space:nowrap" id="bc-th-phone">
                    Phone ↕
                  </th>
                  <th onclick="bcSortTable('tag')" style="padding:10px 12px;text-align:left;font-weight:600;color:var(--text-secondary,#6b7280);cursor:pointer;user-select:none;white-space:nowrap" id="bc-th-tag">
                    Tag ↕
                  </th>
                  <th onclick="bcSortTable('date')" style="padding:10px 12px;text-align:left;font-weight:600;color:var(--text-secondary,#6b7280);cursor:pointer;user-select:none;white-space:nowrap" id="bc-th-date">
                    Date Added ↕
                  </th>
                  <th style="padding:10px 12px;text-align:left;font-weight:600;color:var(--text-secondary,#6b7280);white-space:nowrap">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody id="bc-tbody">
                ${renderTableRowsHtml()}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Footer Info & Next button -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding-top:4px">
          <div style="font-size:11.5px;color:var(--text-secondary,#6b7280)">
            <span id="bc-showing-info">Showing ${getFilteredList().length} of ${BC.allContacts.length} contacts</span>
            ${BC.dedupeActive ? `<span style="margin-left:6px;color:#15803d;font-weight:600">· Deduplication active</span>` : ''}
            <span id="bc-skip-info" style="margin-left:8px;color:var(--text-secondary,#6b7280)"></span>
          </div>
          <button type="button" class="btn btn-primary btn-sm" onclick="bcNextStep(1)"
            style="background:#25D366;border-color:#25D366;color:#fff;font-weight:700;padding:7px 20px;border-radius:8px">
            Next: Message →
          </button>
        </div>
      </div>

      <!-- ══════════════════════════════════════════════════════════ -->
      <!-- STEP 2: MESSAGE                                            -->
      <!-- ══════════════════════════════════════════════════════════ -->
      <div id="bc-step-2" class="settings-section" style="display:none;background:var(--bg-card,var(--card-bg,#fff));border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:20px;flex-direction:column;gap:14px">
        <h3 style="font-size:14px;font-weight:700;margin:0">② Message</h3>
        <p style="font-size:12px;color:var(--text-secondary,#6b7280);margin:0">
          ${bcEngineWeb() ? 'Write any text. <code>{{name}}</code> becomes each person’s first name.' : 'WhatsApp only lets businesses start a conversation with a Meta-approved template.'}
        </p>

        ${bcEngineWeb() ? `
          <textarea class="form-textarea" id="bc-text" rows="5" maxlength="1000" placeholder="Hi {{name}}, …" oninput="BC.text=this.value;renderLivePreview()">${escapeHtml(BC.text)}</textarea>
        ` : `
          <div class="form-group" style="margin:0">
            <label class="form-label" style="font-weight:600;font-size:12px">Template</label>
            <select class="form-select" id="bc-template-select" onchange="bcOnTemplateSelected(this.value)">
              ${BC.templates.length ? BC.templates.map(t => `<option value="${escapeHtml(t.name)}|${escapeHtml(t.language)}" ${BC.template?.name === t.name ? 'selected' : ''}>${escapeHtml(tplTitle(t.name))} · ${escapeHtml(t.language)}</option>`).join('') : `
                <option value="promo">🎉 Promotional Offer</option>
                <option value="followup">🔁 Follow-Up Reminder</option>
                <option value="welcome">👋 Welcome Message</option>
                <option value="event">📅 Event Invitation</option>
              `}
            </select>
          </div>
          <div id="bc-params-box">${renderParamsForm()}</div>
        `}

        <!-- WhatsApp Chat Bubble Preview -->
        <div>
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px">Preview</label>
          <div style="background:#f0fdf4;border-radius:12px;padding:16px;display:flex;flex-direction:column;align-items:flex-start">
            <div id="bc-preview-bubble" style="background:#dcfce7;color:#166534;font-size:12.5px;line-height:1.6;padding:12px 16px;border-radius:14px;max-width:320px;white-space:pre-line;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
              <!-- Filled by renderLivePreview -->
            </div>
            <div style="font-size:10.5px;color:var(--text-secondary,#6b7280);margin-top:6px;padding-left:4px">
              🕐 Just now · <span style="color:#25D366;font-weight:600">✓✓ Delivered</span>
            </div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;padding-top:4px">
          <button type="button" class="btn btn-secondary btn-sm" onclick="bcPrevStep(2)">← Back</button>
          <button type="button" class="btn btn-primary btn-sm" onclick="bcNextStep(2)"
            style="background:#25D366;border-color:#25D366;color:#fff;font-weight:700;padding:7px 20px;border-radius:8px">
            Next: Schedule & Number →
          </button>
        </div>
      </div>

      <!-- ══════════════════════════════════════════════════════════ -->
      <!-- STEP 3: SCHEDULE & SENDER NUMBER                           -->
      <!-- ══════════════════════════════════════════════════════════ -->
      <div id="bc-step-3" class="settings-section" style="display:none;background:var(--bg-card,var(--card-bg,#fff));border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:20px;flex-direction:column;gap:16px">
        <h3 style="font-size:14px;font-weight:700;margin:0">③ Schedule & Sender Number</h3>

        <!-- When to send -->
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="font-size:12px;font-weight:600">When to send?</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div id="bc-timing-now" onclick="bcSetTiming('now')"
              style="border:2px solid #25D366;background:#f0fdf4;border-radius:12px;padding:14px;text-align:center;cursor:pointer;transition:all .15s">
              <div style="font-size:24px">⚡</div>
              <div style="font-size:13px;font-weight:700;margin-top:4px">Send Now</div>
              <div style="font-size:11px;color:var(--text-secondary,#6b7280)">Immediately when launched</div>
            </div>

            <div id="bc-timing-sched" onclick="bcSetTiming('scheduled')"
              style="border:2px solid var(--border,#e5e7eb);border-radius:12px;padding:14px;text-align:center;cursor:pointer;transition:all .15s">
              <div style="font-size:24px">📅</div>
              <div style="font-size:13px;font-weight:700;margin-top:4px">Schedule</div>
              <div style="font-size:11px;color:var(--text-secondary,#6b7280)">Pick date & time</div>
            </div>
          </div>

          <div id="bc-sched-inputs" style="display:none;gap:12px">
            <div style="flex:1">
              <label style="font-size:11.5px;font-weight:600;display:block;margin-bottom:4px">Date</label>
              <input type="date" id="bc-sched-date" class="form-input form-input-sm" style="height:34px;border-radius:8px" />
            </div>
            <div style="flex:1">
              <label style="font-size:11.5px;font-weight:600;display:block;margin-bottom:4px">Time</label>
              <input type="time" id="bc-sched-time" class="form-input form-input-sm" style="height:34px;border-radius:8px" />
            </div>
          </div>
        </div>

        <!-- ══ OUTBOUND BROADCAST NUMBER POOL (SAVED NUMBERS) ══ -->
        <div style="border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--bg-primary,#f8fafc)">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div>
              <div style="font-size:13px;font-weight:700">📱 Sender WhatsApp Number</div>
              <div style="font-size:11px;color:var(--text-secondary,#6b7280)">Select from your saved numbers or add a new dedicated number</div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="bcToggleAddNumberForm()" style="font-size:11.5px;font-weight:600">
              + Add New Number
            </button>
          </div>

          <!-- Saved Number Selector Dropdown -->
          <div style="display:flex;gap:10px;align-items:center">
            <div style="flex:1">
              <select id="bc-sender-number-select" class="form-select form-select-sm" onchange="bcOnSelectSenderNumber(this.value)" style="height:36px;font-size:12.5px;font-weight:600;border-radius:8px">
                ${renderSenderNumberOptionsHtml()}
              </select>
            </div>
            <button id="bc-delete-number-btn" type="button" class="btn btn-sm btn-ghost" onclick="bcDeleteCurrentNumber()" style="display:${canDeleteSelectedNumber() ? 'inline-block' : 'none'};color:#ef4444;font-size:12px;height:36px" title="Delete this saved number">
              🗑 Delete
            </button>
          </div>

          <!-- Active Selected Number Info Badge -->
          <div id="bc-selected-number-details" style="display:flex;align-items:center;justify-content:space-between;font-size:11.5px;color:var(--text-secondary,#6b7280);background:var(--bg-card,var(--card-bg,#fff));padding:10px 14px;border-radius:8px;border:1px solid var(--border,#e5e7eb);flex-wrap:wrap;gap:8px">
            ${renderSelectedNumberDetailsHtml()}
          </div>

          <!-- Add New Number Inline Box (Collapsible) -->
          <div id="bc-add-number-box" style="display:${BC.showAddNumberForm ? 'flex' : 'none'};flex-direction:column;gap:12px;padding:14px;border:1px dashed var(--accent-green,#25D366);border-radius:8px;background:var(--bg-card,var(--card-bg,#fff));margin-top:4px">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:12px;font-weight:700">Add a WhatsApp Outreach Number to your Pool</span>
              <button type="button" class="btn btn-sm btn-ghost" onclick="bcToggleAddNumberForm(false)" style="font-size:11px">✕ Close</button>
            </div>
            
            <div class="grid-2" style="margin:0">
              <div class="form-group" style="margin:0">
                <label class="form-label" style="font-size:11px;font-weight:600">Phone Number ID (Meta Cloud) <span style="color:#ef4444">*</span></label>
                <input class="form-input form-input-sm" id="bc-new-phone-id" placeholder="e.g. 104857291029384" style="height:34px;font-size:12px" />
              </div>
              <div class="form-group" style="margin:0">
                <label class="form-label" style="font-size:11px;font-weight:600">Display Phone Number <span style="color:#ef4444">*</span></label>
                <input class="form-input form-input-sm" id="bc-new-phone-num" placeholder="e.g. +91 98765 43210" style="height:34px;font-size:12px" />
              </div>
            </div>

            <div class="grid-2" style="margin:0">
              <div class="form-group" style="margin:0">
                <label class="form-label" style="font-size:11px;font-weight:600">Label / Name</label>
                <input class="form-input form-input-sm" id="bc-new-phone-label" placeholder="e.g. Campaign Outreach Line 2" style="height:34px;font-size:12px" />
              </div>
              <div style="display:flex;align-items:center;padding-top:16px">
                <label style="display:flex;align-items:center;gap:6px;font-size:11.5px;cursor:pointer">
                  <input type="checkbox" id="bc-new-phone-default" style="accent-color:#25D366" />
                  <span>Set as default for future broadcasts</span>
                </label>
              </div>
            </div>

            <!-- Inbound tracking toggle -->
            <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;cursor:pointer;margin-top:2px">
              <input type="checkbox" id="bc-new-phone-track" checked style="accent-color:#25D366;width:15px;height:15px;margin-top:2px" />
              <div>
                <b>Track inbound messages & replies received on this number</b>
                <div style="font-size:10.5px;color:var(--text-secondary,#6b7280);line-height:1.4">
                  Customer replies will be captured in Leads & CRM chats and automatically answered.
                </div>
              </div>
            </label>

            <!-- Custom auto-reply message input -->
            <div class="form-group" style="margin:2px 0 0">
              <label class="form-label" style="font-size:11px;font-weight:600">
                Custom Auto-Reply for this number (Optional)
                <span style="font-size:10.5px;font-weight:400;color:var(--text-secondary,#6b7280)">— Leave blank to use default AI Bot & Welcome rules</span>
              </label>
              <textarea class="form-textarea" id="bc-new-phone-autoreply" rows="2" placeholder="e.g. Hi {{name}}! Thanks for replying. Our team is reviewing your message and will get back to you shortly." style="font-size:11.5px;padding:6px 10px;resize:vertical"></textarea>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
              <button type="button" class="btn btn-secondary btn-sm" onclick="bcToggleAddNumberForm(false)" style="font-size:11px">Cancel</button>
              <button type="button" class="btn btn-primary btn-sm" onclick="bcSaveNewNumber(this)" style="background:#25D366;border-color:#25D366;color:#fff;font-size:11.5px;font-weight:600;padding:6px 16px">
                Save to My Numbers
              </button>
            </div>
          </div>
        </div>

        <!-- Send rate throttle -->
        <div style="border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:14px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
            <span style="font-weight:600">Send rate</span>
            <span id="bc-rate-lbl" style="color:var(--text-secondary,#6b7280);font-weight:600">${BC.sendRate} / hour</span>
          </div>
          <input type="range" min="10" max="300" step="10" value="${BC.sendRate}" oninput="BC.sendRate=this.value;document.getElementById('bc-rate-lbl').textContent=this.value+' / hour'"
            style="width:100%;accent-color:#25D366" />
          <p style="font-size:11px;color:var(--text-secondary,#6b7280);margin:6px 0 0">
            Slower rates keep delivery smooth and avoid spam flags. Recommended: ≤ 100/hr.
          </p>
        </div>

        <div style="display:flex;justify-content:space-between;padding-top:4px">
          <button type="button" class="btn btn-secondary btn-sm" onclick="bcPrevStep(3)">← Back</button>
          <button type="button" class="btn btn-primary btn-sm" onclick="bcNextStep(3)"
            style="background:#25D366;border-color:#25D366;color:#fff;font-weight:700;padding:7px 20px;border-radius:8px">
            Review & Send →
          </button>
        </div>
      </div>

      <!-- ══════════════════════════════════════════════════════════ -->
      <!-- STEP 4: REVIEW & SEND                                      -->
      <!-- ══════════════════════════════════════════════════════════ -->
      <div id="bc-step-4" class="settings-section" style="display:none;background:var(--bg-card,var(--card-bg,#fff));border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:20px;flex-direction:column;gap:14px">
        <h3 style="font-size:14px;font-weight:700;margin:0">④ Review & Launch</h3>

        <div id="bc-review-summary" style="border:1px solid var(--border,#e5e7eb);border-radius:10px;overflow:hidden;font-size:12.5px">
          <!-- Filled by buildReviewSummary() -->
        </div>

        <!-- Campaign title + Test Recipient -->
        <div class="grid-2" style="margin-top:4px">
          <div class="form-group" style="margin:0">
            <label class="form-label" style="font-size:12px;font-weight:600">Campaign Name (for your history)</label>
            <input class="form-input form-input-sm" id="bc-title" maxlength="120" value="${escapeHtml(BC.title)}" placeholder="e.g. Diwali offer — November" oninput="BC.title=this.value" style="height:34px;border-radius:8px" />
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label" style="font-size:12px;font-weight:600">Send a test to</label>
            <div class="wa-inline">
              <input class="form-input form-input-sm" id="bc-test-to" value="${escapeHtml(s.test_recipient || '')}" placeholder="Your WhatsApp number" style="height:34px;border-radius:8px" />
              <button type="button" class="btn btn-secondary btn-sm" id="bc-test-btn" onclick="bcSendTestNow(this)">Send test</button>
            </div>
          </div>
        </div>

        <!-- Pre-send checklist -->
        <div style="background:var(--bg-primary,#f8fafc);border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:14px">
          <p style="font-size:12px;font-weight:700;margin:0 0 6px">⚠️ Before you send</p>
          <ul style="font-size:11.5px;color:var(--text-secondary,#6b7280);margin:0;padding-left:18px;line-height:1.8">
            <li>Contacts who replied STOP are always excluded automatically.</li>
            <li>Ensure your WhatsApp Business account is active and connected.</li>
            <li>Templates must be approved by Meta before starting broadcasts.</li>
          </ul>
        </div>

        <div id="bc-progress-area"></div>

        <div style="display:flex;justify-content:space-between;padding-top:4px">
          <button type="button" class="btn btn-secondary btn-sm" onclick="bcPrevStep(4)">← Back</button>
          <button type="button" class="btn btn-primary" id="bc-launch-btn" onclick="bcLaunchCampaignNow()"
            style="background:#25D366;border-color:#25D366;color:#fff;font-weight:700;padding:8px 24px;border-radius:8px">
            🚀 Launch Campaign
          </button>
        </div>
      </div>

      <!-- Past Broadcasts History -->
      ${renderBcHistory()}

    </div>`;

  renderLivePreview();
  syncHeaderCheckbox();
  if (BC.current?.running) showBcProgress(BC.current);
}

// ══════════════════════════════════════════════════════════════
//  STEP NAVIGATION & CONTROLS
// ══════════════════════════════════════════════════════════════

function bcGoToStep(n) {
  if (n > BC.currentStep) return;
  BC.currentStep = n;
  updateStepViews();
}

function bcNextStep(from) {
  if (from === 1 && BC.selectedIds.size === 0) {
    return toast('Please select at least one contact to continue.', 'warning');
  }
  BC.currentStep = from + 1;
  if (BC.currentStep === 4) buildReviewSummary();
  updateStepViews();
}

function bcPrevStep(from) {
  BC.currentStep = from - 1;
  updateStepViews();
}

function updateStepViews() {
  for (let s = 1; s <= 4; s++) {
    const el = document.getElementById('bc-step-' + s);
    if (el) el.style.display = (s === BC.currentStep) ? 'flex' : 'none';

    const dot = document.getElementById('bc-dot-' + s);
    const lbl = document.getElementById('bc-lbl-' + s);
    if (!dot || !lbl) continue;

    if (s < BC.currentStep) {
      dot.style.background = '#25D366';
      dot.style.color = '#fff';
      dot.style.border = 'none';
      dot.textContent = '✓';
      lbl.style.color = '#25D366';
    } else if (s === BC.currentStep) {
      dot.style.background = '#25D366';
      dot.style.color = '#fff';
      dot.style.border = 'none';
      dot.textContent = s;
      lbl.style.color = '#25D366';
    } else {
      dot.style.background = 'var(--bg-secondary,var(--card-bg,#fff))';
      dot.style.color = 'var(--text-secondary,#6b7280)';
      dot.style.border = '2px solid var(--border,#e5e7eb)';
      dot.textContent = s;
      lbl.style.color = 'var(--text-secondary,#6b7280)';
    }
  }
}

// ══════════════════════════════════════════════════════════════
//  MULTI-NUMBER SENDER POOL & STORAGE
// ══════════════════════════════════════════════════════════════

function getSelectedSender() {
  const current = BC.savedNumbers.find(n => String(n.id) === String(BC.selectedNumberId));
  return current || BC.savedNumbers[0] || null;
}

function canDeleteSelectedNumber() {
  const current = getSelectedSender();
  return current && !current.is_inbound && current.id !== 'inbound';
}

function renderSenderNumberOptionsHtml() {
  if (!BC.savedNumbers.length) {
    const inbound = BC.setup?.inbound_phone || 'Default WhatsApp Number';
    return `<option value="inbound">📱 Inbound Number (${escapeHtml(inbound)})</option>`;
  }
  return BC.savedNumbers.map(n => {
    const isSel = String(n.id) === String(BC.selectedNumberId);
    const icon = n.is_inbound ? '📱' : '📢';
    const tag = n.is_inbound ? ' (Inbound)' : (n.is_default ? ' (Default)' : '');
    return `<option value="${escapeHtml(String(n.id))}" ${isSel ? 'selected' : ''}>
      ${icon} ${escapeHtml(n.label || n.display_number)} · ${escapeHtml(n.display_number)}${tag}
    </option>`;
  }).join('');
}

function renderSelectedNumberDetailsHtml() {
  const sender = getSelectedSender();
  if (!sender) {
    return `<span>No sender number selected</span>`;
  }
  const trackText = sender.track_replies !== 0 && sender.track_replies !== false
    ? `<span style="color:#15803d;font-weight:600">● Inbound Replies Tracked in Leads & CRM</span>`
    : `<span style="color:#9ca3af">● Replies not tracked</span>`;
  const typeText = sender.is_inbound
    ? `<span style="background:var(--border,#e5e7eb);padding:2px 8px;border-radius:99px;font-weight:600">Main Inbound Line</span>`
    : `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:99px;font-weight:600">Dedicated Outreach Line</span>`;
  const autoReplyInfo = sender.auto_reply_text
    ? `<span style="background:rgba(59,130,246,0.12);color:#2563eb;padding:2px 8px;border-radius:99px;font-weight:600;font-size:11px">💬 Custom Auto-Reply Active</span>`
    : `<span style="background:rgba(34,197,94,0.12);color:#15803d;padding:2px 8px;border-radius:99px;font-weight:600;font-size:11px">🤖 Shared AI Bot / Welcome Active</span>`;

  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${typeText}
      <span>Phone ID: <code style="font-size:11px">${escapeHtml(sender.phone_number_id || '—')}</code></span>
      ${autoReplyInfo}
    </div>
    <div>${trackText}</div>
  `;
}

function bcOnSelectSenderNumber(val) {
  BC.selectedNumberId = val;
  const selEl = document.getElementById('bc-sender-number-select');
  if (selEl) selEl.value = val;
  const detailsEl = document.getElementById('bc-selected-number-details');
  if (detailsEl) detailsEl.innerHTML = renderSelectedNumberDetailsHtml();

  // Update delete button visibility
  const delBtn = document.getElementById('bc-delete-number-btn');
  if (delBtn) delBtn.style.display = canDeleteSelectedNumber() ? 'inline-block' : 'none';
}

function bcToggleAddNumberForm(show) {
  BC.showAddNumberForm = show !== undefined ? show : !BC.showAddNumberForm;
  const box = document.getElementById('bc-add-number-box');
  if (box) box.style.display = BC.showAddNumberForm ? 'flex' : 'none';
}

async function bcSaveNewNumber(btn) {
  const phoneId = document.getElementById('bc-new-phone-id')?.value?.trim();
  const phoneNum = document.getElementById('bc-new-phone-num')?.value?.trim();
  const label = document.getElementById('bc-new-phone-label')?.value?.trim();
  const isDefault = document.getElementById('bc-new-phone-default')?.checked;
  const track = document.getElementById('bc-new-phone-track')?.checked;
  const autoReply = document.getElementById('bc-new-phone-autoreply')?.value?.trim() || null;

  if (!phoneId) return toast('Please enter the Phone Number ID from Meta.', 'warning');
  if (!phoneNum) return toast('Please enter the Display Phone Number.', 'warning');

  if (btn) btn.disabled = true;
  try {
    const res = await api('POST', '/api/lead-pipeline/whatsapp/broadcasts/numbers', {
      phone_number_id: phoneId,
      display_number: phoneNum,
      label: label || phoneNum,
      track_replies: track,
      is_default: isDefault,
      auto_reply_text: autoReply,
    });

    toast('New sender number added to your pool!', 'success');

    // Reload numbers list
    const numbersRes = await api('GET', '/api/lead-pipeline/whatsapp/broadcasts/numbers').catch(() => ({ numbers: [] }));
    BC.savedNumbers = numbersRes?.numbers || [];
    BC.selectedNumberId = String(res.number?.id || phoneId);
    BC.showAddNumberForm = false;

    // Refresh UI
    const selEl = document.getElementById('bc-sender-number-select');
    if (selEl) selEl.innerHTML = renderSenderNumberOptionsHtml();
    bcOnSelectSenderNumber(BC.selectedNumberId);
    bcToggleAddNumberForm(false);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function bcDeleteCurrentNumber() {
  const current = getSelectedSender();
  if (!current || current.is_inbound) return;
  if (!(await askConfirm(`Remove ${current.display_number} from your sender numbers pool?`, 'Remove'))) return;

  try {
    await api('DELETE', `/api/lead-pipeline/whatsapp/broadcasts/numbers/${current.id}`);
    toast('Number removed from pool', 'info');
    
    // Reload numbers list
    const numbersRes = await api('GET', '/api/lead-pipeline/whatsapp/broadcasts/numbers').catch(() => ({ numbers: [] }));
    BC.savedNumbers = numbersRes?.numbers || [];
    BC.selectedNumberId = 'inbound';

    const selEl = document.getElementById('bc-sender-number-select');
    if (selEl) selEl.innerHTML = renderSenderNumberOptionsHtml();
    bcOnSelectSenderNumber(BC.selectedNumberId);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  CONTACT TABLE, DATE ADDED & DEDUPE LOGIC
// ══════════════════════════════════════════════════════════════

function getContactTag(c) {
  if (c.tag) return c.tag;
  try {
    const t = JSON.parse(c.tags_json || '[]');
    if (Array.isArray(t) && t.length) return t[0];
  } catch {}
  return 'Lead';
}

function getAvailableTags() {
  const set = new Set();
  (BC.setup?.tags || []).forEach(t => { if (t.tag) set.add(t.tag); });
  for (const c of BC.allContacts) {
    set.add(getContactTag(c));
  }
  ['Lead', 'Customer', 'VIP', 'CTWA Lead'].forEach(t => set.add(t));
  return [...set].sort();
}

function formatContactDate(timestamp) {
  if (!timestamp) return '—';
  const ms = timestamp > 1e11 ? timestamp : timestamp * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getFilteredList() {
  let list = [...BC.allContacts];

  // 1. Dedupe filter (deduplicate contacts with the same phone number)
  if (BC.dedupeActive) {
    const seen = new Set();
    const deduped = [];
    for (const c of list) {
      const cleanPhone = String(c.phone_number || '').replace(/[^0-9]/g, '').slice(-10);
      if (!cleanPhone || !seen.has(cleanPhone)) {
        if (cleanPhone) seen.add(cleanPhone);
        deduped.push(c);
      }
    }
    list = deduped;
  }

  // 2. Search query filter
  const q = (BC.searchQuery || '').toLowerCase().trim();
  if (q) {
    list = list.filter(c => {
      const nameM = (c.full_name || '').toLowerCase().includes(q);
      const phoneM = (c.phone_number || '').includes(q);
      const tag = getContactTag(c).toLowerCase();
      return nameM || phoneM || tag.includes(q);
    });
  }

  // 3. Tag filter
  if (BC.tagFilter) {
    list = list.filter(c => getContactTag(c) === BC.tagFilter);
  }

  // 4. Date Added filter
  if (BC.dateFilter && BC.dateFilter !== 'all') {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    list = list.filter(c => {
      if (!c.created_at) return true;
      const contactTime = c.created_at > 1e11 ? c.created_at : c.created_at * 1000;
      const diff = now - contactTime;
      if (BC.dateFilter === 'today') return diff <= dayMs;
      if (BC.dateFilter === '7days') return diff <= 7 * dayMs;
      if (BC.dateFilter === '30days') return diff <= 30 * dayMs;
      return true;
    });
  }

  // 5. Sorting
  const sk = BC.sortKey;
  list.sort((a, b) => {
    let va = '', vb = '';
    if (sk === 'name') { va = (a.full_name || '').toLowerCase(); vb = (b.full_name || '').toLowerCase(); }
    else if (sk === 'phone') { va = (a.phone_number || '').toLowerCase(); vb = (b.phone_number || '').toLowerCase(); }
    else if (sk === 'tag') { va = getContactTag(a).toLowerCase(); vb = getContactTag(b).toLowerCase(); }
    else if (sk === 'date') { va = a.created_at || 0; vb = b.created_at || 0; }
    const res = va < vb ? -1 : va > vb ? 1 : 0;
    return BC.sortAsc ? res : -res;
  });

  return list;
}

function renderTableRowsHtml() {
  const list = getFilteredList();
  if (!list.length) {
    return `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-secondary,#6b7280)">No contacts found matching your filters.</td></tr>`;
  }

  const avColors = ['#25D366','#128C7E','#059669','#0891b2','#7c3aed','#db2777','#ea580c'];
  const tagStyles = {
    'VIP': 'background:#fce7f3;color:#9d174d',
    'Customer': 'background:#fef9c3;color:#854d0e',
    'Lead': 'background:#dbeafe;color:#1e40af',
    'CTWA Lead': 'background:#dbeafe;color:#1e40af',
  };

  return list.map((c, i) => {
    const isSelected = BC.selectedIds.has(c.id);
    const tag = getContactTag(c);
    const tagStyle = tagStyles[tag] || 'background:#f3f4f6;color:#374151';
    const initials = (c.full_name || 'U').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const avBg = avColors[(c.full_name || '').charCodeAt(0) % avColors.length];
    const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)';
    const dateFormatted = formatContactDate(c.created_at);

    return `
      <tr style="background:${rowBg};transition:background .15s" onmouseenter="this.style.background='rgba(37,211,102,0.08)'" onmouseleave="this.style.background='${rowBg}'">
        <td style="padding:9px 12px;border-bottom:1px solid var(--border,#e5e7eb)">
          <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="bcToggleOneContact(${c.id}, this.checked)"
            style="width:14px;height:14px;accent-color:#25D366;cursor:pointer" />
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid var(--border,#e5e7eb)">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:26px;height:26px;border-radius:50%;background:${avBg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">
              ${escapeHtml(initials)}
            </div>
            <span style="font-weight:600">${escapeHtml(c.full_name || '—')}</span>
          </div>
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid var(--border,#e5e7eb);color:var(--text-secondary,#6b7280)">
          ${escapeHtml(c.phone_number || '—')}
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid var(--border,#e5e7eb)">
          <span style="font-size:10.5px;padding:2px 8px;border-radius:99px;font-weight:600;${tagStyle}">
            ${escapeHtml(tag)}
          </span>
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid var(--border,#e5e7eb);color:var(--text-secondary,#6b7280);white-space:nowrap">
          ${escapeHtml(dateFormatted)}
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid var(--border,#e5e7eb)">
          <span style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:${isSelected ? '#15803d' : '#9ca3af'}">
            <span style="width:7px;height:7px;border-radius:50%;background:${isSelected ? '#25D366' : '#d1d5db'};display:inline-block"></span>
            ${isSelected ? 'Selected' : 'Excluded'}
          </span>
        </td>
      </tr>`;
  }).join('');
}

function bcRefreshTable() {
  const tbody = document.getElementById('bc-tbody');
  if (tbody) tbody.innerHTML = renderTableRowsHtml();
  const showing = document.getElementById('bc-showing-info');
  if (showing) {
    showing.textContent = `Showing ${getFilteredList().length} of ${BC.allContacts.length} contacts`;
  }
  const badge = document.getElementById('bc-badge-count');
  if (badge) {
    badge.textContent = `${BC.selectedIds.size} selected`;
    badge.style.background = BC.selectedIds.size ? '#dcfce7' : '#fee2e2';
    badge.style.color = BC.selectedIds.size ? '#15803d' : '#b91c1c';
  }

  // Update clear filters visibility
  const hasActiveFilters = Boolean(BC.searchQuery || BC.tagFilter || BC.dateFilter !== 'all' || BC.dedupeActive);
  const clearWrap = document.getElementById('bc-clear-filter-wrap');
  if (clearWrap) clearWrap.style.display = hasActiveFilters ? 'inline-block' : 'none';

  syncHeaderCheckbox();
}

function bcToggleOneContact(id, checked) {
  if (checked) BC.selectedIds.add(id);
  else BC.selectedIds.delete(id);
  BC.activeSource = 'manual';
  updatePillStyles();
  bcRefreshTable();
  refreshAudienceCount();
}

function bcToggleAllVisible(checked) {
  const visible = getFilteredList();
  for (const c of visible) {
    if (checked) BC.selectedIds.add(c.id);
    else BC.selectedIds.delete(c.id);
  }
  BC.activeSource = 'manual';
  updatePillStyles();
  bcRefreshTable();
  refreshAudienceCount();
}

function syncHeaderCheckbox() {
  const cb = document.getElementById('bc-select-all-cb');
  if (!cb) return;
  const visible = getFilteredList();
  if (!visible.length) { cb.checked = false; cb.indeterminate = false; return; }
  const count = visible.filter(c => BC.selectedIds.has(c.id)).length;
  cb.checked = count === visible.length;
  cb.indeterminate = count > 0 && count < visible.length;
}

function bcOnSearch(val) {
  BC.searchQuery = val;
  bcRefreshTable();
}

function bcOnTagFilterChange(tag) {
  BC.tagFilter = tag;
  const sel = document.getElementById('bc-filter-tag-select');
  if (sel) sel.value = tag;
  bcRefreshTable();
}

function bcOnDateFilterChange(val) {
  BC.dateFilter = val;
  bcRefreshTable();
}

function bcToggleDedupe() {
  BC.dedupeActive = !BC.dedupeActive;
  const btn = document.getElementById('bc-btn-dedupe');
  if (btn) {
    if (BC.dedupeActive) {
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
      btn.style.background = '#25D366';
      btn.style.borderColor = '#25D366';
      btn.style.color = '#fff';
      btn.textContent = '🔄 Dedupe (Active)';
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
      btn.textContent = '🔄 Dedupe';
    }
  }
  bcRefreshTable();
}

function bcClearAllFilters() {
  BC.searchQuery = '';
  BC.tagFilter = '';
  BC.dateFilter = 'all';
  BC.dedupeActive = false;

  const searchInput = document.getElementById('bc-search-input');
  if (searchInput) searchInput.value = '';
  const tagSelect = document.getElementById('bc-filter-tag-select');
  if (tagSelect) tagSelect.value = '';
  const dateSelect = document.getElementById('bc-filter-date-select');
  if (dateSelect) dateSelect.value = 'all';

  const dedupeBtn = document.getElementById('bc-btn-dedupe');
  if (dedupeBtn) {
    dedupeBtn.classList.remove('btn-primary');
    dedupeBtn.classList.add('btn-secondary');
    dedupeBtn.style.background = '';
    dedupeBtn.style.borderColor = '';
    dedupeBtn.style.color = '';
    dedupeBtn.textContent = '🔄 Dedupe';
  }

  bcRefreshTable();
  toast('All filters cleared', 'info');
}

function bcSortTable(key) {
  if (BC.sortKey === key) BC.sortAsc = !BC.sortAsc;
  else { BC.sortKey = key; BC.sortAsc = true; }

  ['name','phone','tag','date'].forEach(k => {
    const el = document.getElementById('bc-th-' + k);
    if (el) {
      const titles = { name: 'Name', phone: 'Phone', tag: 'Tag', date: 'Date Added' };
      el.textContent = titles[k] + (BC.sortKey === k ? (BC.sortAsc ? ' ↑' : ' ↓') : ' ↕');
    }
  });

  bcRefreshTable();
}

function bcSetAudienceSource(src) {
  BC.activeSource = src;
  if (src === 'all') {
    BC.selectedIds = new Set(BC.allContacts.map(c => c.id));
    BC.tagFilter = '';
    const sel = document.getElementById('bc-filter-tag-select');
    if (sel) sel.value = '';
  } else if (src === 'tag') {
    const tags = getAvailableTags();
    if (tags.length) {
      BC.tagFilter = tags[0];
      const sel = document.getElementById('bc-filter-tag-select');
      if (sel) sel.value = tags[0];
      BC.selectedIds = new Set(BC.allContacts.filter(c => getContactTag(c) === tags[0]).map(c => c.id));
    }
  }
  updatePillStyles();
  bcRefreshTable();
  refreshAudienceCount();
}

function updatePillStyles() {
  const pills = {
    'all': document.getElementById('bc-pill-all'),
    'tag': document.getElementById('bc-pill-tag'),
    'manual': document.getElementById('bc-pill-manual'),
    'spreadsheet': document.getElementById('bc-pill-file'),
  };
  Object.entries(pills).forEach(([k, el]) => {
    if (!el) return;
    const isAct = BC.activeSource === k;
    if (isAct) {
      el.style.background = '#25D366';
      el.style.borderColor = '#25D366';
      el.style.color = '#fff';
    } else {
      el.style.background = '';
      el.style.borderColor = '';
      el.style.color = '';
    }
  });
}

async function bcOnFileUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const res = await fetch('/api/lead-pipeline/whatsapp/broadcasts/read-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Couldn’t read file.');

    BC.fileContacts = data.contacts;
    BC.fileName = file.name;
    BC.activeSource = 'spreadsheet';
    BC.allContacts = data.contacts.map((c, idx) => ({ id: 500000 + idx, full_name: c.name || 'Spreadsheet ' + (idx + 1), phone_number: c.phone, tag: 'Spreadsheet', created_at: Math.floor(Date.now() / 1000) }));
    BC.selectedIds = new Set(BC.allContacts.map(c => c.id));

    updatePillStyles();
    bcRefreshTable();
    refreshAudienceCount();
    toast(`Loaded ${data.contacts.length} contacts from ${file.name}`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  MESSAGE, PREVIEW & TIMING
// ══════════════════════════════════════════════════════════════

const SAMPLE_TEMPLATES = {
  promo:    "🎉 Hi {{name}}!\n\nExclusive deal just for you: get 20% OFF on your next order.\n\nTap below to claim before it expires!\n\n[Claim Offer]  [Stop promotions]",
  followup: "👋 Hey {{name}},\n\nJust checking in! We noticed you haven't heard from us in a while.\n\nWe'd love to reconnect — anything we can help with?\n\n[Reply Here]",
  welcome:  "🌟 Welcome, {{name}}!\n\nThank you for joining us. We're excited to have you on board.\n\nExplore our latest updates and get started today!\n\n[Get Started]",
  event:    "📅 Hi {{name}},\n\nYou're invited to our exclusive event!\n📍 Date: Dec 15, 2026 | 6 PM IST\n\nJoin us for insights, networking & announcements.\n\n[RSVP Now]",
};

function renderParamsForm() {
  const t = BC.template;
  if (!t) {
    return `<div style="display:flex;gap:10px;margin-top:8px">
      <div style="flex:1">
        <label class="form-hint" style="font-size:11px"><code>{{name}}</code> fallback</label>
        <input class="form-input form-input-sm" id="bc-var-name" placeholder="Friend" value="Friend" oninput="renderLivePreview()" style="height:32px;border-radius:6px" />
      </div>
    </div>`;
  }
  if (!BC.params.length) return '<div class="form-hint">This template has no fill-ins.</div>';
  return BC.params.map((p, i) => {
    const label = t.fields?.[i]?.label || `Fill-in ${i + 1}`;
    return `
      <div class="form-group bc-param" data-i="${i}" style="margin:8px 0 0">
        <label class="form-label" style="font-size:11.5px"><code>{{${i + 1}}}</code> ${escapeHtml(label)}</label>
        <div class="wa-inline">
          <select class="form-select bc-param-src" onchange="bcOnParamSrcChange(${i}, this.value)" style="max-width:200px;font-size:12px;height:32px">
            <option value="name" ${p.source === 'name' ? 'selected' : ''}>Each person’s first name</option>
            <option value="text" ${p.source === 'text' ? 'selected' : ''}>The same text for everyone</option>
          </select>
          <input class="form-input bc-param-val" id="bc-param-val-${i}" value="${escapeHtml(p.value || '')}" placeholder="Type it here"
            oninput="BC.params[${i}].value=this.value;renderLivePreview()"
            style="font-size:12px;height:32px;${p.source === 'name' ? 'display:none' : ''}" maxlength="200" />
        </div>
      </div>`;
  }).join('');
}

function bcOnParamSrcChange(i, src) {
  BC.params[i].source = src;
  const input = document.getElementById('bc-param-val-' + i);
  if (input) input.style.display = src === 'name' ? 'none' : 'block';
  renderLivePreview();
}

function bcOnTemplateSelected(val) {
  if (val.includes('|')) {
    const [name, lang] = val.split('|');
    pickTemplate(name, lang);
  } else {
    BC.template = { name: val, isSample: true };
  }
  const box = document.getElementById('bc-params-box');
  if (box) box.innerHTML = renderParamsForm();
  renderLivePreview();
}

function renderLivePreview() {
  const bubble = document.getElementById('bc-preview-bubble');
  if (!bubble) return;
  const firstName = 'Priya';

  if (bcEngineWeb()) {
    const text = (BC.text || '').replace(/\{\{\s*name\s*\}\}/gi, firstName);
    bubble.textContent = text || 'Hi Priya, write your message above to see preview here.';
    return;
  }

  const t = BC.template;
  if (!t || t.isSample) {
    const key = t?.name || 'promo';
    const raw = SAMPLE_TEMPLATES[key] || SAMPLE_TEMPLATES.promo;
    const nameVal = document.getElementById('bc-var-name')?.value || 'Priya';
    bubble.textContent = raw.replace(/\{\{name\}\}/g, nameVal);
    return;
  }

  let body = t.body_text || '';
  BC.params.forEach((p, i) => {
    const val = p.source === 'name' ? firstName : (p.value || `[fill-in ${i + 1}]`);
    body = body.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), val);
  });

  bubble.textContent = body || 'Choose a template to see it here.';
}

function bcSetTiming(mode) {
  BC.timingMode = mode;
  const nowCard = document.getElementById('bc-timing-now');
  const schedCard = document.getElementById('bc-timing-sched');
  const inputs = document.getElementById('bc-sched-inputs');

  if (mode === 'now') {
    if (nowCard) { nowCard.style.borderColor = '#25D366'; nowCard.style.background = '#f0fdf4'; }
    if (schedCard) { schedCard.style.borderColor = 'var(--border,#e5e7eb)'; schedCard.style.background = 'transparent'; }
    if (inputs) inputs.style.display = 'none';
  } else {
    if (schedCard) { schedCard.style.borderColor = '#25D366'; schedCard.style.background = '#f0fdf4'; }
    if (nowCard) { nowCard.style.borderColor = 'var(--border,#e5e7eb)'; nowCard.style.background = 'transparent'; }
    if (inputs) inputs.style.display = 'flex';
  }
}

// ══════════════════════════════════════════════════════════════
//  AUDIENCE PAYLOAD & COUNT
// ══════════════════════════════════════════════════════════════

function getAudiencePayload() {
  if (BC.activeSource === 'spreadsheet') {
    return { type: 'list', contacts: BC.fileContacts };
  }
  // Selected subset of contacts
  const selected = BC.allContacts.filter(c => BC.selectedIds.has(c.id));
  return { type: 'list', contacts: selected.map(c => ({ name: c.full_name || '', phone: c.phone_number })) };
}

let bcCountTimer = null;
function refreshAudienceCount() {
  clearTimeout(bcCountTimer);
  bcCountTimer = setTimeout(async () => {
    const skipEl = document.getElementById('bc-skip-info');
    try {
      const payload = getAudiencePayload();
      const r = await api('POST', '/api/lead-pipeline/whatsapp/broadcasts/audience', { audience: payload });
      BC.count = r;

      const left = [];
      if (r.skipped?.opted_out) left.push(`${r.skipped.opted_out} replied STOP`);
      if (r.skipped?.invalid) left.push(`${r.skipped.invalid} without a valid number`);
      if (r.skipped?.duplicate) left.push(`${r.skipped.duplicate} listed twice`);

      if (skipEl) {
        skipEl.textContent = left.length ? `· Left out: ${left.join(', ')}.` : '';
      }
    } catch (err) {
      if (skipEl) skipEl.textContent = err.message;
    }
  }, 250);
}

// ══════════════════════════════════════════════════════════════
//  REVIEW & LAUNCH
// ══════════════════════════════════════════════════════════════

function buildReviewSummary() {
  const container = document.getElementById('bc-review-summary');
  if (!container) return;

  const totalRecipients = BC.selectedIds.size;
  const excludedCount = BC.allContacts.length - totalRecipients;
  const tmplTitle = bcEngineWeb() ? 'Custom text' : (BC.template?.name ? (tplTitle(BC.template.name) || BC.template.name) : 'Promotional Offer');
  const dateVal = document.getElementById('bc-sched-date')?.value;
  const timeVal = document.getElementById('bc-sched-time')?.value;
  const when = BC.timingMode === 'now' ? '⚡ Immediately' : `📅 ${dateVal || 'Date'} at ${timeVal || 'Time'}`;

  const sender = getSelectedSender();
  const senderInfo = sender
    ? `${escapeHtml(sender.label || sender.display_number)} (${escapeHtml(sender.display_number)}) · ${sender.track_replies ? '<span style="color:#15803d;font-weight:600">✓ Inbound Replies Tracked</span>' : 'Replies Untracked'}`
    : 'Main Inbound Number';

  const rows = [
    ['Recipients', `<b>${totalRecipients}</b> contacts selected`],
    ['Excluded', `${excludedCount} contacts`],
    ['Sender WhatsApp', senderInfo],
    ['Template', tmplTitle],
    ['Send timing', when],
    ['Send rate', `${BC.sendRate} messages / hour`],
  ];

  container.innerHTML = rows.map(([label, val], idx) => `
    <div style="display:flex;justify-content:space-between;padding:10px 14px;${idx < rows.length - 1 ? 'border-bottom:1px solid var(--border,#e5e7eb)' : ''}">
      <span style="color:var(--text-secondary,#6b7280)">${label}</span>
      <span>${val}</span>
    </div>
  `).join('');
}

async function bcSendTestNow(btn) {
  const to = document.getElementById('bc-test-to')?.value?.trim();
  if (!to) return toast('Type your own number first.', 'warning');
  const sender = getSelectedSender();
  btn.disabled = true;
  try {
    const msg = {
      ...getBroadcastMessage(),
      sender_phone_number_id: sender?.is_inbound ? null : sender?.phone_number_id,
      sender_number: sender?.display_number || null,
    };
    const r = await api('POST', '/api/lead-pipeline/whatsapp/broadcasts/test', {
      to,
      message: msg,
      sender_phone_number_id: sender?.is_inbound ? null : sender?.phone_number_id,
    });
    toast(`Test sent to ${r.to}! Check your WhatsApp.`, 'success');
  } catch (err) {
    toast(err.message, 'error', 7000);
  } finally {
    btn.disabled = false;
  }
}

function getBroadcastMessage() {
  if (bcEngineWeb()) return { text: BC.text };
  const t = BC.template;
  if (!t || t.isSample) {
    return {
      template: {
        name: t?.name || 'promo_offer',
        language: 'en',
        body: SAMPLE_TEMPLATES[t?.name || 'promo'],
        var_count: 1,
        params: [{ source: 'name' }]
      }
    };
  }
  return {
    template: {
      name: t.name,
      language: t.language,
      body: t.body_text,
      var_count: BC.params.length,
      params: BC.params
    }
  };
}

async function bcLaunchCampaignNow() {
  const n = BC.selectedIds.size;
  if (!n) return toast('Please select at least one contact.', 'warning');
  if (!(await askConfirm(`Launch WhatsApp broadcast to ${n} ${n === 1 ? 'person' : 'people'} now?`, 'Launch'))) return;

  const btn = document.getElementById('bc-launch-btn');
  btn.disabled = true;
  try {
    const sender = getSelectedSender();
    const payload = {
      title: BC.title || `Broadcast ${new Date().toLocaleDateString('en-IN')}`,
      audience: getAudiencePayload(),
      message: {
        ...getBroadcastMessage(),
        sender_phone_number_id: sender?.is_inbound ? null : sender?.phone_number_id,
        sender_number: sender?.display_number || null,
      },
    };
    const b = await api('POST', '/api/lead-pipeline/whatsapp/broadcasts', payload);
    BC.current = b;
    showBcProgress(b);
    pollBroadcast(b.id);
  } catch (err) {
    toast(err.message, 'error', 7000);
    btn.disabled = false;
  }
}

function showBcProgress(b) {
  const area = document.getElementById('bc-progress-area');
  if (!area) return;
  const done = (b.sent_count || 0) + (b.failed_count || 0);
  const pct = b.total_recipients ? Math.round((done / b.total_recipients) * 100) : 0;
  const finished = !b.running && b.status !== 'sending';
  const failures = b.results?.failures || [];

  area.innerHTML = `
    <div style="border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:14px;margin-top:12px;background:var(--bg-card,#fff)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b>${finished ? (b.status === 'stopped' ? 'Stopped' : 'Campaign Completed!') : 'Sending campaign…'}</b>
        <span>${b.sent_count || 0} sent${b.failed_count ? ` · ${b.failed_count} failed` : ''} · ${b.total_recipients} total</span>
      </div>
      <div style="height:8px;background:var(--border,#e5e7eb);border-radius:99px;overflow:hidden">
        <div style="height:100%;background:#25D366;width:${pct}%;transition:width .4s"></div>
      </div>
      ${!finished ? `<div style="font-size:11px;color:var(--text-secondary,#6b7280);margin-top:8px">Sending in background. You can leave this page anytime.</div>` : ''}
      ${failures.length ? `
        <details style="margin-top:8px;font-size:12px"><summary>Not sent (${failures.length})</summary>
          <ul style="padding-left:16px;margin:4px 0">${failures.map(f => `<li><b>${escapeHtml(f.name || '+' + f.phone)}</b>: ${escapeHtml(f.error)}</li>`).join('')}</ul>
        </details>
      ` : ''}
    </div>`;

  const btn = document.getElementById('bc-launch-btn');
  if (btn) btn.disabled = !finished;
}

function pollBroadcast(id) {
  clearInterval(BC.poll);
  BC.poll = setInterval(async () => {
    try {
      const b = await api('GET', `/api/lead-pipeline/whatsapp/broadcasts/${id}`);
      BC.current = b;
      showBcProgress(b);
      if (!b.running && b.status !== 'sending') {
        clearInterval(BC.poll);
        toast(`Broadcast complete: ${b.sent_count} sent!`, 'success', 7000);
        BC.history = await api('GET', '/api/lead-pipeline/whatsapp/broadcasts').then(r => r.broadcasts || r).catch(() => BC.history);
        renderBcHistoryHtml();
      }
    } catch {}
  }, 1500);
}

function renderBcHistory() {
  if (!BC.history.length) return '';
  return `
    <div class="settings-section" id="bc-history-wrap" style="background:var(--bg-card,var(--card-bg,#fff));border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:20px;margin-top:14px">
      <div class="settings-section-header" style="margin-bottom:12px">
        <h3 style="font-size:14px;font-weight:700;margin:0">Past Broadcasts</h3>
      </div>
      <div id="bc-history-list">
        ${renderBcHistoryHtml()}
      </div>
    </div>`;
}

function renderBcHistoryHtml() {
  const label = { completed: ['ok', 'Sent'], sending: ['warn', 'Sending…'], stopped: ['warn', 'Stopped'], failed: ['bad', 'Not sent'] };
  return (BC.history || []).slice(0, 10).map(b => {
    const [tone, text] = label[b.status] || ['off', b.status];
    const senderDisplay = b.sender_number ? ` · From: ${escapeHtml(b.sender_number)}` : '';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border,#e5e7eb);font-size:12px">
        <div>
          <div style="font-weight:600">${escapeHtml(b.title || 'Untitled Campaign')}</div>
          <div style="font-size:11px;color:var(--text-secondary,#6b7280)">
            ${new Date(b.created_at * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · ${b.template_name ? escapeHtml(tplTitle(b.template_name)) : 'Custom text'}${senderDisplay}
          </div>
        </div>
        <div style="text-align:right">
          <span style="font-weight:600">${b.sent_count || 0}</span> sent${b.failed_count ? ` · <span style="color:#ef4444">${b.failed_count} failed</span>` : ''}
          <span class="status-pill ${tone}" style="margin-left:8px">${text}</span>
        </div>
      </div>`;
  }).join('');
}

function bcResetAll() {
  BC.selectedIds = new Set(BC.allContacts.map(c => c.id));
  BC.currentStep = 1;
  BC.activeSource = 'all';
  BC.searchQuery = '';
  BC.tagFilter = '';
  BC.dateFilter = 'all';
  BC.dedupeActive = false;
  BC.timingMode = 'now';
  BC.sendRate = 60;
  renderBroadcastPage();
  refreshAudienceCount();
}

// ══════════════════════════════════════════════════════════════
//  EXPORTS TO GLOBAL WINDOW
// ══════════════════════════════════════════════════════════════

window.loadBroadcastPage = loadBroadcastPage;
window.bcResetAll = bcResetAll;
window.bcGoToStep = bcGoToStep;
window.bcNextStep = bcNextStep;
window.bcPrevStep = bcPrevStep;
window.bcSetAudienceSource = bcSetAudienceSource;
window.bcOnSearch = bcOnSearch;
window.bcOnTagFilterChange = bcOnTagFilterChange;
window.bcOnDateFilterChange = bcOnDateFilterChange;
window.bcToggleDedupe = bcToggleDedupe;
window.bcClearAllFilters = bcClearAllFilters;
window.bcSortTable = bcSortTable;
window.bcToggleOneContact = bcToggleOneContact;
window.bcToggleAllVisible = bcToggleAllVisible;
window.bcOnFileUpload = bcOnFileUpload;
window.bcOnTemplateSelected = bcOnTemplateSelected;
window.bcOnParamSrcChange = bcOnParamSrcChange;
window.bcSetTiming = bcSetTiming;
window.bcOnSelectSenderNumber = bcOnSelectSenderNumber;
window.bcToggleAddNumberForm = bcToggleAddNumberForm;
window.bcSaveNewNumber = bcSaveNewNumber;
window.bcDeleteCurrentNumber = bcDeleteCurrentNumber;
window.bcSendTestNow = bcSendTestNow;
window.bcLaunchCampaignNow = bcLaunchCampaignNow;
