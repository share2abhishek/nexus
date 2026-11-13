// Social-Nexus app — Local files and Analytics.
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

// ─────────────────────────────────────────────────────────────────────────────
// Local Files
// ─────────────────────────────────────────────────────────────────────────────

async function loadLocalFiles(targetListId = 'local-files-list') {
  const list = document.getElementById(targetListId);
  list.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner"></span></div>';

  try {
    const files = await api('GET', '/api/local/files');
    if (!files.length) {
      list.innerHTML = '<div class="empty-state" style="padding:20px 0"><div class="empty-icon">📂</div><div class="empty-title">No files found</div><div class="empty-desc">Add .txt, .md, .csv, or .json files to your CONTENT_FOLDER.</div></div>';
      return;
    }

    list.innerHTML = files.map(f => {
      const ext = f.ext.replace('.', '');
      const size = formatBytes(f.size);
      return `<div class="file-item" onclick="previewFile(${jsAttr(f.name)}, '${targetListId}')">
        <span class="file-ext-badge ${ext}">${ext}</span>
        <span class="file-name">${escapeHtml(f.name)}</span>
        <span class="file-size">${size}</span>
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
  }
}

// Small, safe Markdown → HTML for the file preview (headings, bold, italic, lists,
// links, code, rules). Escapes HTML first, so a local .md file can't inject markup.
function renderMarkdownPreview(md) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => /^https?:\/\//i.test(u)
      ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t));
  let html = '', list = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closeList(); html += '<hr>'; continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { closeList(); const n = m[1].length; html += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; continue; }
    if (line.trim() === '') { closeList(); continue; }
    closeList(); html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return html;
}

async function previewFile(name, sourceList) {
  if (sourceList === 'modal-file-list') {
    // In modal — import directly
    await importFileToCompose(name);
    return;
  }

  const titleEl = document.getElementById('file-preview-title');
  const contentEl = document.getElementById('file-preview-content');
  const actionsEl = document.getElementById('file-preview-actions');
  titleEl.textContent = `📄 ${name}`;
  contentEl.textContent = 'Loading…';

  try {
    const data = await api('GET', `/api/local/read?file=${encodeURIComponent(name)}`);
    if (data.type === 'image') {
      contentEl.innerHTML = `<img src="/api/local/read?file=${encodeURIComponent(name)}" style="max-width:100%;border-radius:8px" />`;
    } else if (/\.md$/i.test(name)) {
      // Markdown: show it rendered, not as raw # and ** symbols
      State.selectedFileContent = data.content;
      contentEl.innerHTML = `<div class="md-preview">${renderMarkdownPreview(data.content)}</div>`;
      actionsEl.style.display = 'block';
    } else {
      State.selectedFileContent = data.content;
      contentEl.textContent = data.content;
      actionsEl.style.display = 'block';
    }
  } catch (err) {
    contentEl.textContent = 'Error: ' + err.message;
  }
}

function useFileAsContent() {
  if (!State.selectedFileContent) return;
  if (!startNewCompose({ text: State.selectedFileContent })) return;
  toast('File content loaded into Compose', 'success');
}

function openFileBrowser() {
  document.getElementById('file-browser-modal').style.display = 'flex';
  loadLocalFiles('modal-file-list');
}

function closeFileBrowserModal(e) {
  if (!e || e.target === document.getElementById('file-browser-modal')) {
    document.getElementById('file-browser-modal').style.display = 'none';
  }
}

async function importFileToCompose(name) {
  try {
    const data = await api('GET', `/api/local/read?file=${encodeURIComponent(name)}`);
    if (data.content) {
      closeFileBrowserModal();
      if (!startNewCompose({ text: data.content })) return;
      toast(`Imported: ${name}`, 'success');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function importCSV() {
  const file = await askText({ title: 'Import from CSV', message: 'File name in your content folder:', value: 'schedule.csv' });
  if (!file) return;

  try {
    const data = await api('POST', `/api/local/import-csv?file=${encodeURIComponent(file)}`);
    toast(`Imported ${data.imported} posts from ${file}`, 'success');
    loadScheduled();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

async function loadAnalytics() {
  const monthInput = document.getElementById('report-month');
  if (monthInput && !monthInput.value) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    monthInput.value = `${yyyy}-${mm}`;
  }

  try {
    const data = await api('GET', '/api/analytics');
    const summary = Array.isArray(data?.summary) ? data.summary : [];
    
    const emptyHint = document.getElementById('analytics-empty-hint');
    if (emptyHint) {
      emptyHint.style.display = summary.length === 0 ? 'block' : 'none';
    }

    renderAnalyticsSummary(summary);
    renderAnalyticsCharts(summary);
    renderAnalyticsTable(summary);
  } catch (err) {
    toast(err.message, 'error');
  }
  loadBestTimes();
}

async function refreshAnalytics(btn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Fetching…';
  try {
    const r = await api('POST', '/api/analytics/refresh');
    toast(r.updated ? `Updated numbers for ${r.updated} post${r.updated === 1 ? '' : 's'}${r.failed ? ` (${r.failed} couldn\u2019t be read)` : ''}` : 'No published posts from the last 30 days to update yet.', r.failed && !r.updated ? 'warning' : 'success');
    loadAnalytics();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = label; }
}

async function loadBestTimes() {
  const el = document.getElementById('best-times-body');
  if (!el) return;
  try {
    const r = await api('GET', '/api/analytics/best-times');
    if (!r.enough) {
      el.innerHTML = `<div style="color:var(--text-muted);font-size:13px">Needs at least 5 published posts with numbers (you have ${r.posts}). Until then, a good start for Indian audiences: weekdays 12–2 pm and 7–9 pm.</div>`;
      return;
    }
    const hour = (h) => new Date(2000, 0, 1, h).toLocaleTimeString('en-IN', { hour: 'numeric' });
    el.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap">${r.slots.map((s, i) => `
      <div class="stat-card" style="min-width:140px;padding:12px">
        <div style="font-size:12px;color:var(--text-muted)">#${i + 1}</div>
        <div style="font-weight:700">${escapeHtml(s.weekday)} ${hour(s.hour)}</div>
        <div class="stat-sub">avg. ${s.average} engagement · ${s.posts} post${s.posts === 1 ? '' : 's'}</div>
      </div>`).join('')}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:8px">Based on ${r.posts} post results (India time). Engagement counts likes, comments ×2 and shares ×3.</div>`;
  } catch (err) {
    el.innerHTML = `<div style="color:var(--text-muted)">${escapeHtml(err.message)}</div>`;
  }
}

function renderAnalyticsSummary(summary) {
  const totals = summary.reduce((acc, row) => ({
    likes:       acc.likes       + (row.total_likes       || 0),
    comments:    acc.comments    + (row.total_comments    || 0),
    shares:      acc.shares      + (row.total_shares      || 0),
    impressions: acc.impressions + (row.total_impressions || 0),
  }), { likes: 0, comments: 0, shares: 0, impressions: 0 });

  setEl('ana-likes',       totals.likes.toLocaleString());
  setEl('ana-comments',    totals.comments.toLocaleString());
  setEl('ana-shares',      totals.shares.toLocaleString());
  setEl('ana-impressions', totals.impressions.toLocaleString());
}

function renderAnalyticsCharts(summary) {
  const platformColors = {
    linkedin:  '#0a66c2', facebook: '#1877f2', instagram: '#e1306c',
    pinterest: '#e60023', twitter:  '#1d9bf0',
  };

  const labels = summary.map(s => s.platform);
  const colors = labels.map(p => platformColors[p] || '#7c3aed');

  // Impressions Bar Chart
  const impressCtx = document.getElementById('chart-impressions').getContext('2d');
  if (State.charts.impressions) State.charts.impressions.destroy();
  State.charts.impressions = new Chart(impressCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Impressions',
        data: summary.map(s => s.total_impressions || 0),
        backgroundColor: colors.map(c => c + '99'),
        borderColor: colors,
        borderWidth: 2,
        borderRadius: 6,
      }],
    },
    options: chartOptions('Impressions'),
  });

  // Engagement Doughnut Chart
  const engCtx = document.getElementById('chart-engagement').getContext('2d');
  if (State.charts.engagement) State.charts.engagement.destroy();
  State.charts.engagement = new Chart(engCtx, {
    type: 'doughnut',
    data: {
      labels: ['Likes', 'Comments', 'Shares', 'Clicks'],
      datasets: [{
        data: [
          summary.reduce((a, s) => a + (s.total_likes || 0), 0),
          summary.reduce((a, s) => a + (s.total_comments || 0), 0),
          summary.reduce((a, s) => a + (s.total_shares || 0), 0),
          summary.reduce((a, s) => a + (s.total_clicks || 0), 0),
        ],
        backgroundColor: ['#7c3aed', '#3b82f6', '#06b6d4', '#10b981'],
        borderWidth: 0,
      }],
    },
    options: {
      ...chartOptions(),
      cutout: '65%',
    },
  });
}

function chartOptions(title) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } },
      },
      title: title ? {
        display: false,
      } : undefined,
    },
    scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
    },
  };
}

function renderAnalyticsTable(summary) {
  const tbody = document.getElementById('analytics-table-body');
  if (!summary.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">No analytics yet. Likes, comments and reach from your platforms will show here in a coming update.</td></tr>';
    return;
  }

  const platformIcons = { linkedin: '🔵', facebook: '📘', instagram: '📸', pinterest: '📌', twitter: '🐦' };

  tbody.innerHTML = summary.map(row => `
    <tr>
      <td>${platformIcons[row.platform] || ''} ${row.platform}</td>
      <td>${row.post_count}</td>
      <td>${(row.total_likes || 0).toLocaleString()}</td>
      <td>${(row.total_comments || 0).toLocaleString()}</td>
      <td>${(row.total_shares || 0).toLocaleString()}</td>
      <td>${(row.total_impressions || 0).toLocaleString()}</td>
      <td>${(row.total_clicks || 0).toLocaleString()}</td>
    </tr>`).join('');
}
