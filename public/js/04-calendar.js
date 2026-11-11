// Social-Nexus app — Calendar and the post drawer.
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

// ─────────────────────────────────────────────────────────────────────────────
// Content Calendar & Unified Content Model (Phase 1b)
// ─────────────────────────────────────────────────────────────────────────────

State.calendarView = 'week';
State.calendarEvents = [];
State.selectedContentItem = null;
State.userWorkspaces = [];

function changeCalendarView(view) {
  State.calendarView = view;
  ['week', 'month', 'agenda'].forEach(v => {
    const btn = document.getElementById(`view-btn-${v}`);
    if (btn) {
      if (v === view) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  // Adjust calendar-grid layout class
  const grid = document.getElementById('calendar-grid');
  if (grid) {
    grid.className = `calendar-grid ${view}-view`;
  }

  renderCalendar(State.calendarDate);
}

function navigateCalendar(dir) {
  const date = State.calendarDate;
  if (State.calendarView === 'week') {
    date.setDate(date.getDate() + dir * 7);
  } else {
    // Month or Agenda: navigate by month
    date.setMonth(date.getMonth() + dir);
  }
  State.calendarDate = date;
  renderCalendar(date);
}

// Backward compatibility helper
function changeMonth(dir) {
  navigateCalendar(dir);
}

async function renderCalendar(date) {
  if (!currentWorkspaceId) {
    const grid = document.getElementById('calendar-grid');
    if (grid) grid.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px">Please select a workspace context first.</div>';
    return;
  }

  // Calculate start/end of view
  let start, end;
  const year = date.getFullYear();
  const month = date.getMonth();

  if (State.calendarView === 'week') {
    start = new Date(date);
    start.setDate(date.getDate() - date.getDay());
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const formatOptions = { month: 'short', day: 'numeric' };
    document.getElementById('calendar-date-label').textContent = 
      `${start.toLocaleDateString('en', formatOptions)} – ${end.toLocaleDateString('en', formatOptions)}, ${start.getFullYear()}`;
  } else if (State.calendarView === 'month') {
    // Month view shows surrounding filler days (up to 42 cells)
    const firstOfMonth = new Date(year, month, 1);
    const startDay = firstOfMonth.getDay();
    start = new Date(year, month, 1 - startDay);
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setDate(start.getDate() + 41);
    end.setHours(23, 59, 59, 999);

    document.getElementById('calendar-date-label').textContent = 
      date.toLocaleDateString('en', { month: 'long', year: 'numeric' });
  } else {
    // Agenda: whole current month
    start = new Date(year, month, 1, 0, 0, 0);
    end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    document.getElementById('calendar-date-label').textContent = 
      `Agenda: ${date.toLocaleDateString('en', { month: 'long', year: 'numeric' })}`;
  }

  const from = Math.floor(start.getTime() / 1000);
  const to = Math.floor(end.getTime() / 1000);

  try {
    const events = await api('GET', `/api/content/calendar?from=${from}&to=${to}`);
    State.calendarEvents = events;
    renderCalendarData();
  } catch (err) {
    console.error('Error fetching calendar data:', err);
    toast('Error fetching calendar content items', 'error');
  }
}

function renderCalendarData() {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;

  const activeStatuses = Array.from(document.querySelectorAll('#calendar-filters input[type="checkbox"]:checked'))
    .map(el => el.value);

  const filteredEvents = State.calendarEvents.filter(e => activeStatuses.includes(e.status));

  if (State.calendarView === 'week') {
    renderWeekView(State.calendarDate, filteredEvents);
  } else if (State.calendarView === 'month') {
    renderMonthView(State.calendarDate, filteredEvents);
  } else {
    renderAgendaView(State.calendarDate, filteredEvents);
  }
  markCalendarFestivals();
}

const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Festivals on the calendar days shown (regional ones say where), with a quick
// way to write a post for them
async function markCalendarFestivals() {
  try {
    if (!State.festivals) State.festivals = (await api('GET', '/api/holidays')).all || [];
  } catch { return; }
  document.querySelectorAll('#calendar-grid [data-date]').forEach(cell => {
    cell.querySelectorAll('.calendar-festival').forEach(b => b.remove());
    const list = State.festivals.filter(h => h.date === cell.dataset.date);
    const num = cell.querySelector('.calendar-day-num');
    list.forEach(h => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'calendar-festival';
      b.textContent = `${h.emoji || '🎉'} ${h.name}`;
      b.title = [h.name, h.region ? `Mainly in ${h.region}` : 'All India', h.provisional ? 'Date may move by a day' : '', 'Click to write a post for it'].filter(Boolean).join(' · ');
      b.onclick = (ev) => { ev.stopPropagation(); writeFestivalPost(h); };
      num ? num.after(b) : cell.prepend(b);
    });
  });
}

function writeFestivalPost(h) {
  if (!startNewCompose()) return;
  const where = h.region ? ` It is mainly celebrated in ${h.region}.` : '';
  document.getElementById('compose-ai-prompt').value = `An engaging post for ${h.name} (${h.date}).${where} Warm, celebratory and relevant for Indian audiences.`;
  toast(`Write your ${h.name} post. Press "Write" to let AI draft it.`, 'info', 6000);
}

function renderWeekView(date, events) {
  const grid = document.getElementById('calendar-grid');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  // Find start of week
  const startOfWeek = new Date(date);
  startOfWeek.setDate(date.getDate() - date.getDay());

  let html = days.map(d => `<div class="calendar-day-label">${d}</div>`).join('');

  for (let i = 0; i < 7; i++) {
    const currentDay = new Date(startOfWeek);
    currentDay.setDate(startOfWeek.getDate() + i);
    const isToday = currentDay.toDateString() === today.toDateString();
    
    // Filter events for this specific date
    const dayEvents = events.filter(e => {
      const ed = e.scheduled_at ? new Date(e.scheduled_at * 1000) : new Date(e.created_at * 1000);
      return ed.toDateString() === currentDay.toDateString();
    });

    // Sort by scheduled time, then created time
    dayEvents.sort((a, b) => (a.scheduled_at || a.created_at) - (b.scheduled_at || b.created_at));

    html += `
      <div class="calendar-day ${isToday ? 'today' : ''}" data-date="${ymdLocal(currentDay)}" style="min-height: 250px">
        <div class="calendar-day-num" style="display:flex;justify-content:space-between;align-items:center">
          <span>${currentDay.getDate()}</span>
          <span style="font-size:10px;opacity:0.6">${currentDay.toLocaleDateString('en', {month:'short'})}</span>
        </div>
        <div style="margin-top:8px">
          ${dayEvents.map(e => {
            const timeLabel = e.scheduled_at 
              ? new Date(e.scheduled_at * 1000).toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit'}) 
              : 'Draft';
            const titleSnippet = escapeHtml(e.title || e.body.substring(0, 35) + (e.body.length > 35 ? '…' : ''));
            const platformIcons = e.platforms.map(p => PLATFORMS[p]?.icon || '').join('');
            return `
              <div class="calendar-event-card event-status-${e.status}" onclick="openContentDetail(${e.id})">
                <div style="font-weight:700;font-size:10px;display:flex;justify-content:space-between">
                  <span>${timeLabel}</span>
                  <span>${platformIcons}</span>
                </div>
                <div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${titleSnippet}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  grid.innerHTML = html;
}

function renderMonthView(date, events) {
  const grid = document.getElementById('calendar-grid');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  const year = date.getFullYear();
  const month = date.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const startDay = firstOfMonth.getDay();

  let html = days.map(d => `<div class="calendar-day-label">${d}</div>`).join('');

  // 42 cells total (6 weeks)
  const cellStartDate = new Date(year, month, 1 - startDay);

  for (let i = 0; i < 42; i++) {
    const currentDay = new Date(cellStartDate);
    currentDay.setDate(cellStartDate.getDate() + i);
    
    const isToday = currentDay.toDateString() === today.toDateString();
    const isOtherMonth = currentDay.getMonth() !== month;

    const dayEvents = events.filter(e => {
      const ed = e.scheduled_at ? new Date(e.scheduled_at * 1000) : new Date(e.created_at * 1000);
      return ed.toDateString() === currentDay.toDateString();
    });

    dayEvents.sort((a, b) => (a.scheduled_at || a.created_at) - (b.scheduled_at || b.created_at));

    html += `
      <div class="calendar-day ${isToday ? 'today' : ''} ${isOtherMonth ? 'other-month' : ''}" data-date="${ymdLocal(currentDay)}" style="min-height: 100px">
        <div class="calendar-day-num">${currentDay.getDate()}</div>
        <div style="margin-top:4px">
          ${dayEvents.map(e => {
            const titleSnippet = escapeHtml(e.title || e.body.substring(0, 15) + (e.body.length > 15 ? '…' : ''));
            const timeLabel = e.scheduled_at 
              ? new Date(e.scheduled_at * 1000).toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit', hour12:false}) 
              : 'D';
            return `
              <div class="calendar-event-card event-status-${e.status}" onclick="openContentDetail(${e.id})" style="padding:3px 6px;margin-bottom:2px;border-radius:4px;font-size:10px">
                <span style="font-weight:700;opacity:0.8">${timeLabel}: ${titleSnippet}</span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  grid.innerHTML = html;
}

function renderAgendaView(date, events) {
  const grid = document.getElementById('calendar-grid');
  if (!events.length) {
    grid.innerHTML = `
      <div class="empty-state" style="padding:40px 0">
        <div class="empty-icon">📅</div>
        <div class="empty-title">No content scheduled</div>
        <div class="empty-desc">Create content items or change the filter status to see items in the agenda.</div>
      </div>`;
    return;
  }

  // Sort events chronologically
  const sorted = [...events].sort((a, b) => (a.scheduled_at || a.created_at) - (b.scheduled_at || b.created_at));

  // Group events by date string
  const groups = {};
  sorted.forEach(e => {
    const d = e.scheduled_at ? new Date(e.scheduled_at * 1000) : new Date(e.created_at * 1000);
    const dateStr = d.toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (!groups[dateStr]) groups[dateStr] = [];
    groups[dateStr].push(e);
  });

  let html = '';
  Object.entries(groups).forEach(([dateLabel, dayEvents]) => {
    html += `
      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:#a78bfa;margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:4px">${dateLabel}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${dayEvents.map(e => {
            const timeLabel = e.scheduled_at 
              ? new Date(e.scheduled_at * 1000).toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit'}) 
              : 'Not scheduled (Draft)';
            const platformsText = e.platforms.map(p => (PLATFORMS[p]?.icon || '') + ' ' + (PLATFORMS[p]?.label || p)).join(', ');
            return `
              <div class="scheduled-item" style="cursor:pointer" onclick="openContentDetail(${e.id})">
                <div class="scheduled-time" style="min-width: 100px">
                  <div style="font-size:12px;font-weight:700;color:#a78bfa">${timeLabel}</div>
                </div>
                <div class="scheduled-content">
                  <div style="font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:4px">${escapeHtml(postTitle(e))}</div>
                  <div class="scheduled-text" style="-webkit-line-clamp: 2; line-clamp: 2; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden">${escapeHtml(e.body)}</div>
                  <div style="display:flex;gap:12px;align-items:center;margin-top:6px">
                    <span style="font-size:11px;color:var(--text-muted)">Channels: ${platformsText}</span>
                    <span class="badge event-status-${e.status}" style="font-size:9.5px;padding:2px 8px">${statusLabel(e.status)}</span>
                  </div>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openContentDetail(${e.id})">View Details</button>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  });

  grid.innerHTML = html;
}

// ── Role Gating & Permissions frontend helpers ───────────────────────────────

function getCurrentWorkspaceRole() {
  const current = State.userWorkspaces?.find(w => w.workspace_id === currentWorkspaceId);
  return current ? current.role : null;
}

function hasWorkspacePermission(permission) {
  const role = getCurrentWorkspaceRole();
  if (!role) return false;
  const permissions = {
    manager:  ['social.manage','members.manage','content.create','content.edit','content.submit',
               'content.approve','content.comment','content.publish','content.schedule',
               'content.view','analytics.view'],
    creator:  ['content.create','content.edit','content.submit','content.view','analytics.view'],
    reviewer: ['content.approve','content.comment','content.view','analytics.view'],
    client:   ['content.approve','content.comment','content.view','analytics.view'],
    analyst:  ['content.view','analytics.view'],
  };
  return permissions[role]?.includes(permission) || false;
}

// ── Slide-in Detail Panel Logic ──────────────────────────────────────────────

// Friendly names for content statuses and people (instead of "in_review" / "User #3")
// A post's title, or its first words when it has none
function postTitle(item) {
  if (item?.title) return item.title;
  const words = String(item?.body || '').replace(/\s+/g, ' ').trim();
  return words ? (words.length > 48 ? `${words.slice(0, 48).trim()}…` : words) : 'Untitled post';
}

const STATUS_LABELS = { draft: 'Draft', in_review: 'In review', approved: 'Approved', scheduled: 'Scheduled', publishing: 'Publishing…', published: 'Published', failed: 'Failed' };
const statusLabel = (s) => STATUS_LABELS[s] || s;

State.memberNames = {};
async function loadMemberNames() {
  if (!currentWorkspaceId) return;
  try {
    const members = await fetch(`/workspaces/${currentWorkspaceId}/members`).then(r => r.json());
    for (const m of members || []) State.memberNames[m.user_id] = m.name || m.email;
  } catch {}
}
function userLabel(id) {
  if (!id) return 'someone';
  if (State.user && String(State.user.id) === String(id)) return 'you';
  return State.memberNames[id] || 'a team member';
}

async function openContentDetail(itemId) {
  try {
    const [item] = await Promise.all([api('GET', `/api/content/${itemId}`), loadMemberNames()]);
    State.selectedContentItem = item;

    // Set panel info
    document.getElementById('detail-status-badge').textContent = statusLabel(item.status);
    document.getElementById('detail-status-badge').className = `badge event-status-${item.status}`;
    // Part of a repeating schedule?
    const badge = document.getElementById('detail-status-badge');
    badge.parentElement.querySelector('.series-chip')?.remove();
    if (item.series_id) {
      const chip = document.createElement('span');
      chip.className = 'series-chip';
      chip.style.marginLeft = '6px';
      chip.textContent = `🔁 ${REPEAT_LABEL[item.series_every] || 'Repeats'} · post ${item.series_index} of ${item.series_total}`;
      badge.after(chip);
    }
    document.getElementById('detail-title-label').textContent = postTitle(item);
    document.getElementById('detail-body-container').textContent = item.body;
    
    // Image Preview
    const imgContainer = document.getElementById('detail-image-container');
    const imgPreview = document.getElementById('detail-image-preview');
    if (item.image_url) {
      imgPreview.src = mediaSrc(item.image_url);
      imgContainer.style.display = 'block';
    } else {
      imgContainer.style.display = 'none';
      imgPreview.src = '';
    }

    // Error container
    const errContainer = document.getElementById('detail-error-container');
    if (item.status === 'failed' && item.error_message) {
      errContainer.textContent = `⚠️ Publish failed: ${item.error_message}`;
      errContainer.style.display = 'block';
    } else {
      errContainer.style.display = 'none';
    }
    // First comment: added, waiting, or why not
    const fcLines = (item.first_comments || []).map(c => {
      const name = PLATFORMS[c.platform]?.label || c.platform;
      if (c.status === 'done') return `✅ ${name}: first comment added.`;
      if (c.status === 'failed') return `⚠️ ${name}: first comment not added. ${c.error || ''}`;
      return `⏳ ${name}: first comment goes out ${new Date(c.due_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
    });
    if (!fcLines.length && item.options?.first_comment && ['scheduled', 'draft', 'approved', 'in_review'].includes(item.status)) {
      const d = Number(item.options.first_comment_delay || 0);
      fcLines.push(`💬 First comment: added ${d ? `${d >= 60 ? '1 hour' : `${d} min`} after the post` : 'right after the post'} (Facebook and Instagram).`);
    }
    let fcBox = document.getElementById('detail-first-comment');
    if (!fcBox) {
      fcBox = document.createElement('div');
      fcBox.id = 'detail-first-comment';
      fcBox.style.cssText = 'font-size:12.5px;line-height:1.6;margin-bottom:16px;color:var(--text-secondary)';
      errContainer.after(fcBox);
    }
    fcBox.innerHTML = fcLines.map(escapeHtml).join('<br>');
    fcBox.style.display = fcLines.length ? '' : 'none';

    // Channels
    const accountsContainer = document.getElementById('detail-accounts-list');
    accountsContainer.innerHTML = item.platforms.map(p => `
      <span class="badge badge-purple" style="display:inline-flex;align-items:center;gap:4px">
        <span>${PLATFORMS[p]?.icon || '🔗'}</span>
        <span>${PLATFORMS[p]?.label || p}</span>
      </span>
    `).join('');

    // Audit logs formatting
    const auditLogs = document.getElementById('detail-audit-logs');
    let auditHtml = `<div>📅 Created on ${new Date(item.created_at * 1000).toLocaleString()}</div>`;
    if (item.submitted_by) auditHtml += `<div>✍️ Created by ${escapeHtml(userLabel(item.submitted_by))}</div>`;
    if (item.reviewed_by) auditHtml += `<div>👀 Reviewed by ${escapeHtml(userLabel(item.reviewed_by))}</div>`;
    if (item.approved_by) auditHtml += `<div>✅ Approved by ${escapeHtml(userLabel(item.approved_by))}</div>`;
    if (item.scheduled_at) auditHtml += `<div>⏰ Scheduled for ${new Date(item.scheduled_at * 1000).toLocaleString()}</div>`;
    if (item.published_at) auditHtml += `<div>🚀 Published on ${new Date(item.published_at * 1000).toLocaleString()}</div>`;
    auditLogs.innerHTML = auditHtml;

    // Populate comments
    renderCommentsList(item.comments || []);

    // Render footer buttons dynamically based on roles
    renderDetailActionButtons(item);

    // Slide panel open
    renderApprovalBox(item);
    document.getElementById('content-detail-backdrop').classList.add('open');
    document.getElementById('content-detail-panel').classList.add('open');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function closeContentDetail() {
  document.getElementById('content-detail-backdrop').classList.remove('open');
  document.getElementById('content-detail-panel').classList.remove('open');
  State.selectedContentItem = null;
}

function renderCommentsList(comments) {
  const container = document.getElementById('detail-comments-list');
  if (!comments || comments.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12.5px;text-align:center;padding:12px 0">No comments yet.</div>';
    return;
  }
  container.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-header">
        <span class="comment-author">${escapeHtml(userLabel(c.user_id))}</span>
        <span>${new Date(c.created_at).toLocaleString()}</span>
      </div>
      <div class="comment-body">${escapeHtml(c.body)}</div>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

async function submitCommentDetail() {
  if (!State.selectedContentItem) return;
  const input = document.getElementById('detail-comment-input');
  const body = input.value.trim();
  if (!body) return;

  try {
    const comment = await api('POST', `/api/content/${State.selectedContentItem.id}/comments`, { body });
    if (!State.selectedContentItem.comments) State.selectedContentItem.comments = [];
    State.selectedContentItem.comments.push(comment);
    renderCommentsList(State.selectedContentItem.comments);
    input.value = '';
    toast('Comment added', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderDetailActionButtons(item) {
  const container = document.getElementById('detail-panel-actions');
  container.innerHTML = '';

  const canSubmit = hasWorkspacePermission('content.submit');
  const canApprove = hasWorkspacePermission('content.approve');
  const canSchedule = hasWorkspacePermission('content.schedule');
  const canEdit = hasWorkspacePermission('content.edit');

  const buttons = [];

  // People who may approve their own work schedule a draft in one step;
  // asking for review is only offered in Agency mode (or to those who can't approve)
  const selfApprove = canApprove && canSchedule;

  // Transition: Submit (draft -> in_review)
  if (item.status === 'draft' && canSubmit && (!selfApprove || isAgencyMode())) {
    buttons.push(`<button class="btn ${selfApprove ? 'btn-secondary' : 'btn-primary'}" onclick="transitionContentStatus(${item.id}, 'in_review')">📤 Ask for review</button>`);
  }

  // Transition: Approve/Reject (in_review -> approved / draft)
  if (item.status === 'in_review' && canApprove) {
    buttons.push(`<button class="btn btn-success" onclick="transitionContentStatus(${item.id}, 'approved')">✅ Approve</button>`);
    buttons.push(`<button class="btn btn-danger" onclick="transitionContentStatus(${item.id}, 'draft')">❌ Ask for changes</button>`);
  }

  // Transition: Cancel Approval (approved -> draft)
  if (item.status === 'approved' && canApprove) {
    buttons.push(`<button class="btn btn-danger" onclick="transitionContentStatus(${item.id}, 'draft')">↩️ Revoke Approval</button>`);
  }

  // Transition: Schedule (approved -> scheduled, or draft -> scheduled in one step)
  if ((item.status === 'approved' && canSchedule) || (item.status === 'draft' && selfApprove)) {
    buttons.push(`
      <div style="display:flex;align-items:center;gap:6px">
        <input type="datetime-local" class="form-input" id="detail-schedule-time" value="${toLocalInputValue(new Date(item.scheduled_at && item.scheduled_at * 1000 > Date.now() ? item.scheduled_at * 1000 : Date.now() + 3600000))}" title="${item.scheduled_at && item.scheduled_at * 1000 > Date.now() ? 'Suggested time from the author' : ''}" style="padding:6px 8px;font-size:12px;width:170px" />
        <button class="btn btn-primary" onclick="scheduleContentDetail(${item.id})">📅 Schedule</button>
      </div>`);
  }

  // Transition: Cancel Schedule (scheduled -> approved)
  if (item.status === 'scheduled' && canSchedule) {
    buttons.push(`<button class="btn btn-secondary" onclick="transitionContentStatus(${item.id}, 'approved')">📅 Unschedule</button>`);
  }

  // Stop a repeating schedule (removes its posts that haven't gone out yet)
  if (item.series_id && item.status === 'scheduled' && canSchedule) {
    buttons.push(`<button class="btn btn-secondary" onclick="stopSeries(${jsAttr(item.series_id)}, null).then(closeContentDetail)">⏹ Stop series</button>`);
  }

  // Retry a failed or missed post (goes out within about a minute)
  if (item.status === 'failed' && canSchedule) {
    buttons.push(`<button class="btn btn-primary" onclick="retryContentItem(${item.id})">🔁 Retry now</button>`);
  }

  // Edit / Delete
  if (canEdit) {
    if (['draft', 'in_review', 'failed'].includes(item.status)) {
      buttons.push(`<button class="btn btn-secondary btn-sm" onclick="openEditContentModal(${item.id})">✏️ Edit</button>`);
    }
    if (['draft', 'failed'].includes(item.status)) {
      buttons.push(`<button class="btn btn-danger btn-sm" onclick="deleteContentItem(${item.id})">🗑️ Delete</button>`);
    }
  }

  container.innerHTML = buttons.join('');
}

async function scheduleContentDetail(itemId) {
  const input = document.getElementById('detail-schedule-time');
  const dtStr = input?.value;
  if (!dtStr) return toast('Please select date and time', 'warning');
  
  const epoch = Math.floor(new Date(dtStr).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  if (epoch <= now) return toast('Schedule date must be in the future', 'warning');

  await transitionContentStatus(itemId, 'scheduled', epoch);
}

async function transitionContentStatus(itemId, toStatus, scheduled_at = null) {
  try {
    const body = { toStatus };
    if (scheduled_at) body.scheduled_at = scheduled_at;
    
    await api('PATCH', `/api/content/${itemId}/status`, body);
    const done = { in_review: 'Sent for review', approved: 'Approved', draft: 'Moved back to draft', scheduled: 'Scheduled', published: 'Published' };
    toast(done[toStatus] || 'Updated', 'success');
    
    await openContentDetail(itemId);
    renderCalendar(State.calendarDate);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function retryContentItem(itemId) {
  try {
    await api('PATCH', `/api/content/${itemId}/status`, { toStatus: 'scheduled', scheduled_at: Math.floor(Date.now() / 1000) + 60 });
    toast('Queued again: it will be posted within about a minute', 'success');
    await openContentDetail(itemId);
    renderCalendar(State.calendarDate);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteContentItem(itemId) {
  if (!confirm('Are you sure you want to permanently delete this content item?')) return;
  try {
    await api('DELETE', `/api/content/${itemId}`);
    toast('Content deleted successfully', 'success');
    closeContentDetail();
    renderCalendar(State.calendarDate);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Calendar → Create Post ────────────────────────────────────────────────────
// New posts and edits both happen in Create Post.
function openNewContentModal() {
  if (startNewCompose()) document.getElementById('compose-content').focus();
}

// Calendar "Edit": open the saved post in Create Post (same editor and AI tools)
async function openEditContentModal(itemId) {
  try {
    const item = await api('GET', `/api/content/${itemId}`);
    if (!['draft', 'in_review', 'failed'].includes(item.status)) {
      return toast(`This post is ${statusLabel(item.status).toLowerCase()}, so it can’t be edited.`, 'warning');
    }
    closeContentDetail();
    startEditCompose(item);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadHistory() {
  await Promise.all([loadPostHistory(), loadAIGenHistory()]);
}

async function loadPostHistory() {
  const list = document.getElementById('post-history-list');
  try {
    const posts = await api('GET', '/api/posts/history');
    if (!posts.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">📭</div><div class="empty-title">No posts yet</div></div>';
      return;
    }
    State.postsHistoryMap = {};
    posts.forEach(p => { State.postsHistoryMap[p.id] = p; });

    list.innerHTML = posts.map(post => {
      const platforms = Array.isArray(post.platforms) ? post.platforms : [];
      const date = new Date(post.created_at * 1000);
      const waText = encodeURIComponent(post.content?.substring(0, 1000) || '');
      return `
        <div class="history-item" style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:8px">
          <div class="history-content" style="white-space:pre-wrap;margin-bottom:8px;max-height:160px;overflow-y:auto">${escapeHtml(post.content)}</div>
          <div class="history-tags" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            ${platforms.map(p => `<span class="tag purple">${PLATFORMS[p]?.icon || ''} ${p}</span>`).join('')}
            <span class="tag">${date.toLocaleDateString()}</span>
            <span class="badge badge-${post.status === 'published' ? 'green' : 'orange'}">${post.status}</span>
            <div style="margin-left:auto;display:flex;gap:6px">
              <button class="btn btn-secondary btn-sm" onclick="copyPostHistory(${post.id})">📋 Copy</button>
              <a class="btn btn-sm" style="background:rgba(37,211,102,0.15);color:#25d366;border:1px solid rgba(37,211,102,0.3);text-decoration:none" href="https://api.whatsapp.com/send?text=${waText}" target="_blank">💬 WhatsApp</a>
              <button class="btn btn-primary btn-sm" onclick="openRepostModal(${post.id})">✏️ Edit & Repost</button>
            </div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
  }
}

async function loadAIGenHistory() {
  const list = document.getElementById('ai-gen-history-list');
  try {
    const history = await api('GET', '/api/history');
    if (!history.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">✨</div><div class="empty-title">No generations yet</div></div>';
      return;
    }
    State.aiHistoryMap = State.aiHistoryMap || {};
    history.forEach(h => { State.aiHistoryMap[h.id] = h; });

    list.innerHTML = history.map(h => `
      <div class="history-item" style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:8px">
        <div class="history-prompt" style="font-weight:600;font-size:12px;color:var(--text-muted);margin-bottom:4px">"${escapeHtml(h.prompt.substring(0, 100))}${h.prompt.length > 100 ? '…' : ''}"</div>
        <div class="history-content" style="white-space:pre-wrap;margin-bottom:8px;max-height:160px;overflow-y:auto">${escapeHtml(h.response)}</div>
        <div class="history-tags" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span class="tag blue">${escapeHtml(h.model || 'ai')}</span>
          <span class="tag">${h.tokens_used || '?'} tokens</span>
          <span class="tag">${new Date(h.created_at * 1000).toLocaleDateString()}</span>
          <div style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-secondary btn-sm" onclick="copyAIGenHistory(${h.id})">📋 Copy</button>
            <button class="btn btn-primary btn-sm" onclick="useAIGenHistory(${h.id})">✏️ Use in Compose</button>
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
  }
}

function useAIGenHistory(id) {
  const item = State.aiHistoryMap?.[id];
  if (!item || !item.response) return toast('Content not found', 'error');

  if (!startNewCompose({ text: item.response })) return;
  State.generatedContent = item.response;

  const genOut = document.getElementById('gen-output');
  if (genOut) genOut.textContent = item.response;
  closeAIHistory();
  toast('✅ Content loaded into Compose!', 'success');
}

function usePostHistory(id) {
  const post = State.postsHistoryMap?.[id];
  if (!post || !post.content) return toast('Post content not found', 'error');

  if (!startNewCompose({ text: post.content, image_url: post.image_url || '', platforms: Array.isArray(post.platforms) ? post.platforms : null })) return;
  toast('✅ Post copied to Compose ready for re-posting!', 'success');
}

function copyAIGenHistory(id) {
  const item = State.aiHistoryMap?.[id];
  if (!item || !item.response) return;
  navigator.clipboard.writeText(item.response);
  toast('📋 Copied to clipboard!', 'info');
}

function copyPostHistory(id) {
  const post = State.postsHistoryMap?.[id];
  if (!post || !post.content) return;
  navigator.clipboard.writeText(post.content);
  toast('📋 Copied to clipboard!', 'info');
}
