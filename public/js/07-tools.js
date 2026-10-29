// Social-Nexus app — More tools: SEO, ASO, email, ads, AI media, hashtags, UTM, templates, Ollama, brand kit.
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

// ─────────────────────────────────────────────────────────────────────────────
// SEO Tools
// ─────────────────────────────────────────────────────────────────────────────

function switchSeoTab(tab, btn) {
  document.querySelectorAll('.seo-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`seo-panel-${tab}`).style.display = '';
  document.querySelectorAll('.seo-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
  if (tab === 'tracked') loadTrackedKeywords();
}

async function generateMetaTags() {
  const btn = document.getElementById('btn-seo-meta');
  const out = document.getElementById('seo-meta-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing… (can take up to a minute)';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/seo/meta', {
      page_title: document.getElementById('seo-page-title').value,
      target_keyword: document.getElementById('seo-target-kw').value,
      url: document.getElementById('seo-url').value,
      page_content: document.getElementById('seo-content-summary').value,
    });
    out.innerHTML = `
      <div class="seo-result-group"><div class="seo-result-label">Meta Title <span class="badge badge-${data.meta_title?.length > 60 ? 'red' : 'green'}">${data.meta_title?.length || 0} chars</span></div>
        <div class="seo-result-value">${escapeHtml(data.meta_title || '')}</div>
        <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(data.meta_title || '')});toast('Copied!','success')" style="margin-top:6px">📋 Copy</button>
      </div>
      <div class="seo-result-group"><div class="seo-result-label">Meta Description <span class="badge badge-${data.meta_description?.length > 160 ? 'red' : 'green'}">${data.meta_description?.length || 0} chars</span></div>
        <div class="seo-result-value">${escapeHtml(data.meta_description || '')}</div>
        <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(data.meta_description || '')});toast('Copied!','success')" style="margin-top:6px">📋 Copy</button>
      </div>
      <div class="seo-result-group"><div class="seo-result-label">Focus Keywords</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${(data.focus_keywords || []).map(k => `<span class="badge badge-blue">${escapeHtml(k)}</span>`).join('')}</div>
      </div>
      <div class="seo-result-group"><div class="seo-result-label">Open Graph Title</div><div class="seo-result-value">${escapeHtml(data.og_title || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">OG Description</div><div class="seo-result-value">${escapeHtml(data.og_description || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">SEO Score</div>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:28px;font-weight:700;color:${data.seo_score >= 80 ? 'var(--accent-green)' : data.seo_score >= 60 ? 'var(--accent-orange)' : '#ef4444'}">${data.seo_score || 0}</div>
          <div style="font-size:12px;color:var(--text-muted)">/100</div>
        </div>
      </div>
      ${data.suggestions?.length ? `<div class="seo-result-group"><div class="seo-result-label">Suggestions</div>
        ${data.suggestions.map(s => `<div style="font-size:12px;color:var(--text-secondary);padding:4px 0;border-bottom:1px solid var(--border)">💡 ${escapeHtml(s)}</div>`).join('')}</div>` : ''}
      <div style="margin-top:16px"><button class="btn btn-secondary btn-sm" onclick="copyMetaTags()" style="width:100%">📋 Copy All as HTML</button></div>`;
    State.lastMetaTags = data;
    toast('Meta tags generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '🏷️ Generate Meta Tags'; }
}

function copyMetaTags() {
  const d = State.lastMetaTags;
  if (!d) return;
  const html = `<title>${d.meta_title}</title>\n<meta name="description" content="${d.meta_description}">\n<meta property="og:title" content="${d.og_title}">\n<meta property="og:description" content="${d.og_description}">`;
  navigator.clipboard.writeText(html);
  toast('HTML meta tags copied!', 'success');
}

async function researchKeywords() {
  const btn = document.getElementById('btn-kw-research');
  const out = document.getElementById('kw-results');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Researching…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/seo/keywords', {
      topic: document.getElementById('kw-topic').value,
      niche: document.getElementById('kw-niche').value,
      competitors: document.getElementById('kw-competitors').value,
    });
    let html = '';
    if (data.primary_keywords?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">🎯 Primary Keywords</div>${data.primary_keywords.map(k =>
        `<div class="kw-row"><span class="kw-term">${escapeHtml(k.keyword)}</span><span class="badge badge-${k.difficulty==='low'?'green':k.difficulty==='medium'?'orange':'red'}">${k.difficulty}</span><span class="badge badge-blue">${k.intent}</span><button class="btn btn-secondary btn-sm" onclick="addTrackedFromResearch(${jsAttr(k.keyword)})">+ Track</button></div>`).join('')}</div>`;
    }
    if (data.long_tail_keywords?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">📏 Long-tail Keywords</div>${data.long_tail_keywords.map(k =>
        `<div class="kw-row"><span class="kw-term">${escapeHtml(k.keyword)}</span><span class="badge badge-${k.difficulty==='low'?'green':k.difficulty==='medium'?'orange':'red'}">${k.difficulty}</span><button class="btn btn-secondary btn-sm" onclick="addTrackedFromResearch(${jsAttr(k.keyword)})">+ Track</button></div>`).join('')}</div>`;
    }
    if (data.questions?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">❓ Questions to Answer</div>${data.questions.map(q => `<div style="padding:5px 0;font-size:13px;border-bottom:1px solid var(--border)">• ${escapeHtml(q)}</div>`).join('')}</div>`;
    }
    if (data.content_ideas?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">💡 Content Ideas</div>${data.content_ideas.map(i => `<div style="padding:5px 0;font-size:13px;border-bottom:1px solid var(--border)">📝 ${escapeHtml(i)}</div>`).join('')}</div>`;
    }
    out.innerHTML = html || '<div style="padding:20px;color:var(--text-muted)">No results</div>';
    toast('Keyword research complete!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '🔑 Research Keywords'; }
}

function encapeHtml(str) { return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

function addTrackedFromResearch(keyword) {
  document.getElementById('add-kw-input').value = keyword;
  switchSeoTab('tracked', document.querySelector('[data-tab="tracked"]'));
  addTrackedKeyword();
}

async function optimizeContent() {
  const btn = document.getElementById('btn-optimize');
  const out = document.getElementById('seo-opt-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Analyzing…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/seo/optimize', {
      content: document.getElementById('opt-content').value,
      target_keyword: document.getElementById('opt-keyword').value,
      content_type: document.getElementById('opt-type').value,
    });
    const scoreColor = data.seo_score >= 80 ? 'var(--accent-green)' : data.seo_score >= 60 ? 'var(--accent-orange)' : '#ef4444';
    out.innerHTML = `
      <div style="display:flex;gap:16px;margin-bottom:20px">
        <div style="text-align:center;background:var(--glass);border-radius:12px;padding:16px;flex:1"><div style="font-size:32px;font-weight:700;color:${scoreColor}">${data.seo_score}</div><div style="font-size:11px;color:var(--text-muted)">SEO Score</div></div>
        <div style="text-align:center;background:var(--glass);border-radius:12px;padding:16px;flex:1"><div style="font-size:32px;font-weight:700;color:var(--accent-blue)">${data.readability_score}</div><div style="font-size:11px;color:var(--text-muted)">Readability</div></div>
        <div style="text-align:center;background:var(--glass);border-radius:12px;padding:16px;flex:1"><div style="font-size:20px;font-weight:700;color:var(--text-primary)">${data.keyword_density}</div><div style="font-size:11px;color:var(--text-muted)">Keyword Density</div></div>
        <div style="text-align:center;background:var(--glass);border-radius:12px;padding:16px;flex:1"><div style="font-size:20px;font-weight:700;color:var(--text-primary)">${data.word_count}</div><div style="font-size:11px;color:var(--text-muted)">Words</div></div>
      </div>
      ${data.issues?.length ? `<div class="seo-result-group"><div class="seo-result-label">⚠️ Issues</div>${data.issues.map(i => `<div style="padding:5px 0;font-size:13px;color:${i.type==='error'?'#ef4444':'var(--accent-orange)'}">● ${escapeHtml(i.message)}</div>`).join('')}</div>` : ''}
      ${data.suggestions?.length ? `<div class="seo-result-group"><div class="seo-result-label">💡 Suggestions</div>${data.suggestions.map(s => `<div style="padding:5px 0;font-size:13px;color:var(--text-secondary);border-bottom:1px solid var(--border)">→ ${escapeHtml(s)}</div>`).join('')}</div>` : ''}
      ${data.suggested_headings?.length ? `<div class="seo-result-group"><div class="seo-result-label">📑 Suggested Structure</div>${data.suggested_headings.map(h => `<div style="padding:4px 0;font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(h)}</div>`).join('')}</div>` : ''}`;
    toast('Content analyzed!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '⚡ Analyze & Score'; }
}

async function loadTrackedKeywords() {
  const list = document.getElementById('tracked-kw-list');
  if (!list) return;
  try {
    const keywords = await api('GET', '/api/seo/keywords/tracked');
    if (!keywords.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">📍</div><div class="empty-title">No tracked keywords</div><div class="empty-desc">Add keywords to monitor your SEO rankings.</div></div>';
      return;
    }
    list.innerHTML = `<table class="analytics-table"><thead><tr><th>Keyword</th><th>Target URL</th><th>Position</th><th>Notes</th><th></th></tr></thead><tbody>
      ${keywords.map(k => `<tr>
        <td><strong>${escapeHtml(k.keyword)}</strong></td>
        <td style="font-size:12px;color:var(--text-muted)">${escapeHtml(k.url || '—')}</td>
        <td>${k.position ? `<span class="badge badge-${k.position <= 10 ? 'green' : k.position <= 30 ? 'orange' : 'red'}">#${k.position}</span>` : '—'}</td>
        <td style="font-size:12px">${escapeHtml(k.notes || '—')}</td>
        <td><button class="btn btn-danger btn-sm btn-icon" onclick="deleteTrackedKeyword(${k.id})" title="Remove">🗑</button></td>
      </tr>`).join('')}
    </tbody></table>`;
  } catch {}
}

async function addTrackedKeyword() {
  const kw = document.getElementById('add-kw-input').value.trim();
  const url = document.getElementById('add-kw-url')?.value.trim() || '';
  if (!kw) return toast('Please enter a keyword', 'warning');
  try {
    await api('POST', '/api/seo/keywords/tracked', { keyword: kw, url });
    document.getElementById('add-kw-input').value = '';
    if (document.getElementById('add-kw-url')) document.getElementById('add-kw-url').value = '';
    toast(`"${kw}" added to tracked keywords`, 'success');
    loadTrackedKeywords();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTrackedKeyword(id) {
  await api('DELETE', `/api/seo/keywords/tracked/${id}`);
  loadTrackedKeywords();
}

// ─────────────────────────────────────────────────────────────────────────────
// ASO (App Store Optimization)
// ─────────────────────────────────────────────────────────────────────────────

async function generateASO() {
  const btn = document.getElementById('btn-aso');
  const out = document.getElementById('aso-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing… (can take up to a minute)';
  out.innerHTML = '<div style="text-align:center;padding:60px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/seo/aso', {
      app_name: document.getElementById('aso-app-name').value,
      app_description: document.getElementById('aso-app-desc').value,
      category: document.getElementById('aso-category').value,
      platform: document.getElementById('aso-platform').value,
      competitors: document.getElementById('aso-competitors').value,
    });
    const copyBtn = (text) => `<button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="navigator.clipboard.writeText(${jsAttr(text)});toast('Copied!','success')">📋 Copy</button>`;
    let html = '';
    if (data.app_store) {
      html += `<div class="seo-result-group"><div class="seo-result-label" style="color:#0a66c2">🍎 App Store (iOS)</div>
        <div><b>Title:</b> <span class="badge badge-${data.app_store.title?.length > 30 ? 'red' : 'green'}">${data.app_store.title?.length} chars</span> ${escapeHtml(data.app_store.title || '')} ${copyBtn(data.app_store.title)}</div>
        <div style="margin-top:8px"><b>Subtitle:</b> ${escapeHtml(data.app_store.subtitle || '')} ${copyBtn(data.app_store.subtitle)}</div>
        <div style="margin-top:8px"><b>Keywords:</b> <span class="badge badge-${data.app_store.keywords?.length > 100 ? 'red' : 'green'}">${data.app_store.keywords?.length} chars</span><br><code style="font-size:11px">${escapeHtml(data.app_store.keywords || '')}</code> ${copyBtn(data.app_store.keywords)}</div>
        <div style="margin-top:8px"><b>Short Description:</b><br>${escapeHtml(data.app_store.short_description || '')} ${copyBtn(data.app_store.short_description)}</div>
        <details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:var(--accent-blue)">Full Description (click to expand)</summary><div style="font-size:12px;margin-top:8px;white-space:pre-wrap">${escapeHtml(data.app_store.description || '')}</div>${copyBtn(data.app_store.description)}</details>
      </div>`;
    }
    if (data.play_store) {
      html += `<div class="seo-result-group"><div class="seo-result-label" style="color:#34a853">🤖 Google Play Store</div>
        <div><b>Title:</b> <span class="badge badge-${data.play_store.title?.length > 50 ? 'red' : 'green'}">${data.play_store.title?.length} chars</span> ${escapeHtml(data.play_store.title || '')} ${copyBtn(data.play_store.title)}</div>
        <div style="margin-top:8px"><b>Short Description:</b> <span class="badge badge-${data.play_store.short_description?.length > 80 ? 'red' : 'green'}">${data.play_store.short_description?.length} chars</span><br>${escapeHtml(data.play_store.short_description || '')} ${copyBtn(data.play_store.short_description)}</div>
        <details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:var(--accent-blue)">Full Description</summary><div style="font-size:12px;margin-top:8px;white-space:pre-wrap">${escapeHtml(data.play_store.full_description || '')}</div>${copyBtn(data.play_store.full_description)}</details>
        ${data.play_store.keywords?.length ? `<div style="margin-top:8px"><b>Keywords:</b> ${data.play_store.keywords.map(k => `<span class="badge badge-blue">${escapeHtml(k)}</span>`).join(' ')}</div>` : ''}
      </div>`;
    }
    if (data.screenshots_suggestions?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">📸 Screenshot Ideas</div>${data.screenshots_suggestions.map((s, i) => `<div style="padding:4px 0;font-size:13px">${i+1}. ${escapeHtml(s)}</div>`).join('')}</div>`;
    }
    if (data.aso_tips?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">💡 ASO Tips</div>${data.aso_tips.map(t => `<div style="padding:4px 0;font-size:12px;color:var(--text-secondary)">✓ ${escapeHtml(t)}</div>`).join('')}</div>`;
    }
    out.innerHTML = html;
    toast('ASO listing generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '📱 Generate ASO Listing'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Email Marketing
// ─────────────────────────────────────────────────────────────────────────────

function switchEmailTab(tab, btn) {
  document.querySelectorAll('.email-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`email-panel-${tab}`).style.display = '';
  document.querySelectorAll('.email-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
}

function loadEmailPage() {
  loadCampaigns();
  loadSubscribers();
}

async function loadCampaigns() {
  const list = document.getElementById('campaigns-list');
  if (!list) return;
  try {
    const camps = await api('GET', '/api/email/campaigns');
    if (!camps.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">📨</div><div class="empty-title">No campaigns yet</div></div>';
      return;
    }
    list.innerHTML = camps.map(c => `
      <div class="scheduled-item" style="cursor:pointer" onclick="loadCampaignToEditor(${jsAttr(c)})">
        <div class="scheduled-content">
          <div class="scheduled-text"><strong>${escapeHtml(c.name)}</strong></div>
          <div style="font-size:12px;color:var(--text-muted)">${escapeHtml(c.subject)}</div>
          <div style="margin-top:4px;display:flex;gap:6px">
            <span class="badge badge-${c.status==='sent'?'green':'orange'}">${c.status}</span>
            ${c.sent_count ? `<span class="badge badge-blue">Sent to ${c.sent_count}</span>` : ''}
            <span class="tag">${new Date(c.created_at * 1000).toLocaleDateString()}</span>
          </div>
        </div>
        <button class="btn btn-danger btn-sm btn-icon" onclick="event.stopPropagation();deleteCampaign(${c.id})" title="Delete">🗑</button>
      </div>`).join('');
  } catch {}
}

function loadCampaignToEditor(c) {
  document.getElementById('camp-name').value = c.name;
  document.getElementById('camp-subject').value = c.subject;
  document.getElementById('camp-body').value = c.html_content || c.text_content || '';
  State.editingCampaignId = c.id;
  toast(`Loaded: ${c.name}`, 'info');
}

async function saveCampaign() {
  const name = document.getElementById('camp-name').value.trim();
  const subject = document.getElementById('camp-subject').value.trim();
  const body = document.getElementById('camp-body').value.trim();
  if (!name || !subject) { toast('Campaign name and subject are required', 'warning'); return null; }
  // Plain-text part for mail clients that don't show HTML
  const text = body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();
  try {
    if (State.editingCampaignId) {
      await api('PUT', `/api/email/campaigns/${State.editingCampaignId}`, { name, subject, html_content: body, text_content: text });
    } else {
      const res = await api('POST', '/api/email/campaigns', { name, subject, html_content: body, text_content: text });
      // Keep editing the saved campaign: later saves update it and Send can send it
      State.editingCampaignId = res.id;
    }
    toast('Campaign saved!', 'success');
    loadCampaigns();
    return State.editingCampaignId;
  } catch (err) { toast(err.message, 'error'); return null; }
}

async function sendCampaign() {
  const name = document.getElementById('camp-name').value.trim();
  const subject = document.getElementById('camp-subject').value.trim();
  const body = document.getElementById('camp-body').value.trim();
  if (!name || !subject || !body) return toast('Please fill in all campaign fields first', 'warning');
  if (!confirm(`Send "${name}" to all active subscribers?`)) return;
  const btn = document.getElementById('btn-send-camp');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
  try {
    // Always save first, so the latest subject/body edits are what gets sent
    const campId = await saveCampaign();
    if (!campId) return;
    const result = await api('POST', `/api/email/campaigns/${campId}/send`);
    toast(`Sent to ${result.sent} subscribers!`, 'success');
    State.editingCampaignId = null;
    loadCampaigns();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '📤 Send Now'; }
}

async function deleteCampaign(id) {
  if (!confirm('Delete this campaign?')) return;
  await api('DELETE', `/api/email/campaigns/${id}`);
  if (State.editingCampaignId === id) State.editingCampaignId = null;
  loadCampaigns();
}

async function loadSubscribers() {
  const list = document.getElementById('subscribers-list');
  const countEl = document.getElementById('sub-count');
  if (!list) return;
  try {
    const subs = await api('GET', '/api/email/subscribers');
    if (countEl) countEl.textContent = subs.length;
    if (!subs.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">👥</div><div class="empty-title">No subscribers yet</div></div>';
      return;
    }
    list.innerHTML = subs.map(s => `
      <div class="scheduled-item">
        <div class="scheduled-content">
          <div class="scheduled-text"><strong>${escapeHtml(s.email)}</strong>${s.name ? ` — ${escapeHtml(s.name)}` : ''}</div>
          <div style="display:flex;gap:6px;margin-top:4px">
            <span class="badge badge-${s.status==='active'?'green':'red'}">${s.status}</span>
            ${s.tags ? s.tags.split(',').map(t => `<span class="tag">${escapeHtml(t.trim())}</span>`).join('') : ''}
            <span class="tag">${new Date(s.created_at * 1000).toLocaleDateString()}</span>
          </div>
        </div>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteSubscriber(${s.id})" title="Remove">🗑</button>
      </div>`).join('');
  } catch {}
}

async function addSubscriber() {
  const email = document.getElementById('sub-email').value.trim();
  const name = document.getElementById('sub-name').value.trim();
  const tags = document.getElementById('sub-tags').value.trim();
  if (!email) return toast('Email is required', 'warning');
  try {
    await api('POST', '/api/email/subscribers', { email, name, tags });
    document.getElementById('sub-email').value = '';
    document.getElementById('sub-name').value = '';
    document.getElementById('sub-tags').value = '';
    toast(`${email} added!`, 'success');
    loadSubscribers();
  } catch (err) { toast(err.message, 'error'); }
}

async function bulkImportSubscribers() {
  const emails = document.getElementById('bulk-emails').value.trim();
  if (!emails) return toast('Please enter email addresses', 'warning');
  try {
    const result = await api('POST', '/api/email/subscribers/bulk', { emails });
    document.getElementById('bulk-emails').value = '';
    toast(`Imported ${result.added} of ${result.total} emails`, 'success');
    loadSubscribers();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteSubscriber(id) {
  await api('DELETE', `/api/email/subscribers/${id}`);
  loadSubscribers();
}

async function generateEmail() {
  const btn = document.getElementById('btn-gen-email');
  const out = document.getElementById('email-gen-output');
  const sendBtn = document.getElementById('btn-email-to-camp');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing… (can take up to a minute)';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/email/generate', {
      type: document.getElementById('email-gen-type').value,
      app_name: document.getElementById('email-gen-app').value,
      topic: document.getElementById('email-gen-topic').value,
      tone: document.getElementById('email-gen-tone').value,
    });
    State.lastGeneratedEmail = data;
    out.innerHTML = `
      <div class="seo-result-group"><div class="seo-result-label">Subject Line A</div><div style="font-size:14px;font-weight:600">${escapeHtml(data.subject)}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">Subject Line B (A/B Test)</div><div style="font-size:13px;color:var(--text-secondary)">${escapeHtml(data.subject_b || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">Preview Text</div><div style="font-size:12px;color:var(--text-muted)">${escapeHtml(data.preview_text || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">CTA Button</div><div><span class="badge badge-purple">${escapeHtml(data.cta_text || '')}</span></div></div>
      <details style="margin-top:12px"><summary style="cursor:pointer;font-size:13px;color:var(--accent-blue);font-weight:600">HTML Body (click to expand)</summary><div style="font-size:11px;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;margin-top:8px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow-y:auto">${escapeHtml(data.html_body || '')}</div></details>`;
    sendBtn.disabled = false;
    toast('Email generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '✨ Generate Email'; }
}

function sendGeneratedToCampaign() {
  const d = State.lastGeneratedEmail;
  if (!d) return;
  document.getElementById('camp-name').value = `${document.getElementById('email-gen-type').value} — ${new Date().toLocaleDateString()}`;
  document.getElementById('camp-subject').value = d.subject;
  document.getElementById('camp-body').value = d.html_body || d.text_body || '';
  State.editingCampaignId = null;
  switchEmailTab('campaigns', document.querySelector('[data-tab="campaigns"]'));
  toast('Email loaded into campaign editor', 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
// Ad Copy & Press Release
// ─────────────────────────────────────────────────────────────────────────────

function switchAdTab(tab, btn) {
  document.querySelectorAll('.adcopy-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`adcopy-panel-${tab}`).style.display = '';
  document.querySelectorAll('.adcopy-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
}

async function generateAdCopy() {
  const btn = document.getElementById('btn-gen-ad');
  const out = document.getElementById('ad-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing… (can take up to a minute)';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/tools/ad-copy', {
      product: document.getElementById('ad-product').value,
      target_audience: document.getElementById('ad-audience').value,
      usp: document.getElementById('ad-usp').value,
      goal: document.getElementById('ad-goal').value,
    });
    const copyBtn = (label, text) => `<button class="btn btn-secondary btn-sm" style="margin-top:4px" onclick="navigator.clipboard.writeText(${jsAttr(text||'')});toast('Copied!','success')">📋 ${label}</button>`;
    const g = data.google_ads || {};
    const m = data.meta_ads || {};
    let html = `<div class="seo-result-group"><div class="seo-result-label" style="color:#4285f4">🔵 Google Ads</div>
      <div style="background:rgba(66,133,244,0.1);border-radius:8px;padding:12px;font-size:13px">
        <div><b>H1:</b> ${escapeHtml(g.headline_1||'')} <span class="badge badge-${(g.headline_1||'').length>30?'red':'green'}">${(g.headline_1||'').length}</span></div>
        <div><b>H2:</b> ${escapeHtml(g.headline_2||'')} <span class="badge badge-${(g.headline_2||'').length>30?'red':'green'}">${(g.headline_2||'').length}</span></div>
        <div><b>H3:</b> ${escapeHtml(g.headline_3||'')} <span class="badge badge-${(g.headline_3||'').length>30?'red':'green'}">${(g.headline_3||'').length}</span></div>
        <div style="margin-top:8px"><b>D1:</b> ${escapeHtml(g.description_1||'')} <span class="badge badge-${(g.description_1||'').length>90?'red':'green'}">${(g.description_1||'').length}</span></div>
        <div><b>D2:</b> ${escapeHtml(g.description_2||'')} <span class="badge badge-${(g.description_2||'').length>90?'red':'green'}">${(g.description_2||'').length}</span></div>
      </div>
      ${copyBtn('Copy Headlines', [g.headline_1, g.headline_2, g.headline_3].join(' | '))}
      ${copyBtn('Copy Descriptions', [g.description_1, g.description_2].join(' | '))}
    </div>
    <div class="seo-result-group"><div class="seo-result-label" style="color:#1877f2">📘 Meta Ads (Facebook/Instagram)</div>
      <div style="background:rgba(24,119,242,0.1);border-radius:8px;padding:12px;font-size:13px">
        <div><b>Primary Text:</b> ${escapeHtml(m.primary_text||'')}</div>
        <div style="margin-top:6px"><b>Headline:</b> ${escapeHtml(m.headline||'')} | <b>CTA:</b> <span class="badge badge-blue">${escapeHtml(m.cta||'')}</span></div>
      </div>
      ${copyBtn('Copy Meta Ad', `${m.primary_text||''}\n\n${m.headline||''}`)}
    </div>`;
    if (data.variations?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">🔄 Variations</div>${data.variations.map(v => `<div style="background:var(--glass);border-radius:8px;padding:10px;margin-bottom:8px;font-size:13px"><b>${escapeHtml(v.headline||'')}</b><br>${escapeHtml(v.text||'')} ${copyBtn('Copy', `${v.headline||''}\n${v.text||''}`)}</div>`).join('')}</div>`;
    }
    if (data.target_keywords?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">🔑 Suggested Keywords</div><div style="display:flex;gap:6px;flex-wrap:wrap">${data.target_keywords.map(k => `<span class="badge badge-blue">${escapeHtml(k)}</span>`).join('')}</div></div>`;
    }
    out.innerHTML = html;
    toast('Ad copy generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '📣 Generate Ad Copy'; }
}

async function generatePressRelease() {
  const btn = document.getElementById('btn-gen-pr');
  const out = document.getElementById('pr-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/tools/press-release', {
      app_name: document.getElementById('pr-app').value,
      announcement: document.getElementById('pr-announcement').value,
      company_name: document.getElementById('pr-company').value,
      features: document.getElementById('pr-features').value,
      quote: document.getElementById('pr-quote').value,
    });
    State.lastPressRelease = data.content;
    out.innerHTML = `<div style="font-family:'Inter',sans-serif;font-size:13px;line-height:1.8;white-space:pre-wrap;color:var(--text-primary)">${escapeHtml(data.content)}</div>`;
    toast('Press release generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '📰 Generate Press Release'; }
}

function copyPressRelease() {
  if (State.lastPressRelease) { navigator.clipboard.writeText(State.lastPressRelease); toast('Press release copied!', 'success'); }
}

async function getBestTimes() {
  const btn = document.getElementById('btn-best-times');
  const out = document.getElementById('best-times-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Analyzing…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/tools/best-times', {
      industry: document.getElementById('bt-industry').value,
      audience: document.getElementById('bt-audience').value,
    });
    const icons = { linkedin: '🔵', facebook: '📘', instagram: '📸', twitter: '🐦', pinterest: '📌' };
    let html = '';
    for (const [platform, rec] of Object.entries(data.recommendations || {})) {
      html += `<div class="seo-result-group">
        <div class="seo-result-label">${icons[platform] || '📱'} ${platform.charAt(0).toUpperCase()+platform.slice(1)}</div>
        <div style="font-size:12px"><b>Best Days:</b> ${(rec.best_days||[]).join(', ')}</div>
        <div style="font-size:12px;margin-top:4px"><b>Best Times:</b> ${(rec.best_times||[]).map(t=>`<span class="badge badge-purple">${t}</span>`).join(' ')}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${escapeHtml(rec.tip||'')}</div>
        ${data.optimal_frequency?.[platform] ? `<div style="font-size:11px;margin-top:4px"><span class="badge badge-blue">Frequency: ${data.optimal_frequency[platform]}</span></div>` : ''}
      </div>`;
    }
    if (data.general_advice) html += `<div class="seo-result-group"><div class="seo-result-label">💡 General Strategy</div><div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(data.general_advice)}</div></div>`;
    out.innerHTML = html || '<div style="color:var(--text-muted);padding:20px">No data</div>';
    toast('Best times fetched!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '⏰ Get Best Times'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Media Creator
// ─────────────────────────────────────────────────────────────────────────────

function switchMediaTab(tab, btn) {
  document.querySelectorAll('.media-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`media-panel-${tab}`).style.display = '';
  document.querySelectorAll('.media-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');

  // Show relevant model bar
  const imgBar = document.getElementById('img-model-bar');
  const vidBar = document.getElementById('vid-model-bar');
  if (imgBar) imgBar.style.display = (tab === 'image') ? 'flex' : 'none';
  if (vidBar) vidBar.style.display = (tab === 'video') ? 'flex' : 'none';
}

async function enhanceImagePrompt() {
  const btn = document.getElementById('btn-enhance-prompt');
  const promptEl = document.getElementById('img-prompt');
  if (!promptEl.value.trim()) return toast('Enter a prompt first', 'warning');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const data = await api('POST', '/api/media/enhance-prompt', {
      prompt: promptEl.value, media_type: 'image', style: document.getElementById('img-style').value,
    });
    promptEl.value = data.enhanced_prompt || promptEl.value;
    if (data.negative_prompt) document.getElementById('img-negative').value = data.negative_prompt;
    toast('Prompt enhanced!', 'success');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '✨ Enhance Prompt'; }
}

async function generateImage() {
  const btn = document.getElementById('btn-gen-image');
  const out = document.getElementById('image-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generating…';
  out.innerHTML = '<div style="text-align:center;padding:60px"><span class="spinner lg"></span><div style="margin-top:16px;color:var(--text-muted);font-size:13px">Generating image (10-30s)…</div></div>';
  try {
    const data = await api('POST', '/api/media/generate-image', {
      prompt: document.getElementById('img-prompt').value,
      style: document.getElementById('img-style').value,
      negative_prompt: document.getElementById('img-negative').value,
      preferred_provider: ModelState.imageModel?.provider || null,
    });

    let imgEl;
    if (data.image_base64) {
      State.lastImageBase64 = data.image_base64;
      imgEl = `<img src="data:image/png;base64,${data.image_base64}" style="max-width:100%;border-radius:12px" />`;
    } else if (data.image_url) {
      State.lastImageUrl = data.image_url;
      imgEl = `<img src="${data.image_url}" style="max-width:100%;border-radius:12px" crossorigin="anonymous" />`;
    }
    out.innerHTML = imgEl || '<div style="color:#ef4444">No image returned</div>';
    document.getElementById('btn-dl-image').disabled = false;
    document.getElementById('btn-use-image').disabled = false;
    toast('Image generated!', 'success');
  } catch (err) {
    out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
    if (/No image generator/.test(err.message)) {
      out.innerHTML += `<div style="margin-top:12px"><button class="btn btn-secondary btn-sm" onclick="navigateTo('user-settings')">⚙️ Open My API Keys</button></div>`;
    }
    toast(err.message, 'error');
  }
  finally { btn.disabled = false; btn.innerHTML = '🖼️ Generate Image'; }
}

function downloadMedia(type) {
  if (type === 'image') {
    if (State.lastImageBase64) {
      const a = document.createElement('a');
      a.href = `data:image/png;base64,${State.lastImageBase64}`;
      a.download = `nexus-image-${Date.now()}.png`;
      a.click();
    } else if (State.lastImageUrl) {
      window.open(State.lastImageUrl, '_blank');
    }
  }
}

async function generateVideo() {
  const btn = document.getElementById('btn-gen-video');
  const out = document.getElementById('video-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Starting…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span><div style="margin-top:12px;color:var(--text-muted);font-size:13px">Starting video generation…</div></div>';
  try {
    const data = await api('POST', '/api/media/generate-video', {
      prompt: document.getElementById('vid-prompt').value,
      image_url: document.getElementById('vid-image').value || undefined,
      aspect_ratio: document.getElementById('vid-ratio').value,
    });
    out.innerHTML = `
      <div style="padding:20px;text-align:center">
        <div style="font-size:32px;margin-bottom:12px">🎬</div>
        <div style="font-weight:600;margin-bottom:8px">Video Generation Started</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Provider: ${data.provider} | Job: <code>${data.job_id}</code></div>
        <div class="badge badge-orange" style="font-size:12px">Processing — takes 30-120 seconds</div>
        <div style="margin-top:16px">
          <button class="btn btn-primary" onclick="pollVideoStatus(${jsAttr(data.provider)},${jsAttr(data.job_id)},this)" id="btn-poll-video">🔄 Check Status</button>
        </div>
        <div id="video-poll-result" style="margin-top:16px"></div>
      </div>`;
    toast('Video generation started!', 'success');
  } catch (err) {
    out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
    toast(err.message, 'error');
  }
  finally { btn.disabled = false; btn.innerHTML = '🎬 Generate Video'; }
}

async function pollVideoStatus(provider, jobId, btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Checking…';
  try {
    const data = await api('GET', `/api/media/video-status/${provider}/${jobId}`);
    const resultEl = document.getElementById('video-poll-result');
    if (data.done && data.video_url) {
      resultEl.innerHTML = `<div><div class="badge badge-green" style="font-size:12px;margin-bottom:12px">✅ Completed</div><br><video src="${data.video_url}" controls style="max-width:100%;border-radius:12px;margin-top:8px"></video><br><a href="${data.video_url}" download class="btn btn-primary btn-sm" style="margin-top:8px">⬇️ Download</a></div>`;
    } else if (data.status === 'failed') {
      resultEl.innerHTML = `<div class="badge badge-red">❌ Generation failed</div>`;
    } else {
      resultEl.innerHTML = `<div class="badge badge-orange">⏳ Still processing — check again in a few seconds</div>`;
      btn.disabled = false; btn.innerHTML = '🔄 Check Status';
    }
  } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.innerHTML = '🔄 Check Status'; }
}

async function generateAnimation() {
  const btn = document.getElementById('btn-gen-anim');
  const out = document.getElementById('animation-output');
  const imageData = document.getElementById('anim-image').value.trim();
  if (!imageData) return toast('Please provide an image (base64 or generate one first)', 'warning');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Starting…';
  out.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner lg"></span></div>';
  try {
    const payload = { motion_bucket_id: parseInt(document.getElementById('anim-motion').value) };
    if (imageData.startsWith('http')) { payload.image_url = imageData; }
    else { payload.image_base64 = imageData.replace(/^data:image\/\w+;base64,/, ''); }
    const data = await api('POST', '/api/media/generate-animation', payload);
    out.innerHTML = `
      <div style="text-align:center;padding:16px">
        <div class="badge badge-orange">⏳ Animation processing…</div>
        <div style="font-size:12px;color:var(--text-muted);margin:8px 0">Job ID: ${data.job_id}</div>
        <button class="btn btn-primary btn-sm" onclick="pollAnimationStatus(${jsAttr(data.job_id)},this)">🔄 Check Status</button>
        <div id="anim-poll-result" style="margin-top:12px"></div>
      </div>`;
    toast('Animation started!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:12px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '✨ Generate Animation'; }
}

async function pollAnimationStatus(jobId, btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const data = await api('GET', `/api/media/animation-status/${jobId}`);
    const r = document.getElementById('anim-poll-result');
    if (data.done && data.video_base64) {
      r.innerHTML = `<div class="badge badge-green">✅ Done</div><br><video src="data:video/mp4;base64,${data.video_base64}" autoplay loop muted style="max-width:100%;border-radius:12px;margin-top:8px"></video>`;
    } else {
      r.innerHTML = `<div class="badge badge-orange">⏳ Still processing</div>`;
      btn.disabled = false; btn.innerHTML = '🔄 Check Status';
    }
  } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.innerHTML = '🔄 Check'; }
}

async function generateCaption() {
  const btn = document.getElementById('btn-gen-caption');
  const out = document.getElementById('caption-output');
  const useBtn = document.getElementById('btn-caption-to-compose');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing…';
  out.innerHTML = '<div style="text-align:center;padding:30px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/media/generate-text-post', {
      image_description: document.getElementById('cap-description').value,
      platform: document.getElementById('cap-platform').value,
      tone: document.getElementById('cap-tone').value,
      include_hashtags: true,
    });
    State.lastCaption = data.caption;
    out.innerHTML = `
      <div class="seo-result-group"><div class="seo-result-label">Main Caption</div><div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${escapeHtml(data.caption || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">Short Version</div><div style="font-size:13px;color:var(--text-secondary)">${escapeHtml(data.short_caption || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">Hashtags</div><div style="font-size:12px;color:var(--accent-blue)">${escapeHtml(data.hashtags || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">CTA</div><div style="font-size:12px">${escapeHtml(data.cta || '')}</div></div>`;
    useBtn.disabled = false;
    toast('Caption generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '💬 Write Caption'; }
}

function sendCaptionToCompose() {
  if (!State.lastCaption) return;
  if (!startNewCompose({ text: State.lastCaption })) return;
  toast('Caption loaded into Compose', 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
// Hashtag Research
// ─────────────────────────────────────────────────────────────────────────────

async function researchHashtags() {
  const btn = document.getElementById('btn-hashtags');
  const out = document.getElementById('hashtag-output');
  const copyBtn = document.getElementById('btn-copy-hashtags');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Researching…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/tools/hashtags', {
      topic: document.getElementById('ht-topic').value,
      platform: document.getElementById('ht-platform').value,
      count: parseInt(document.getElementById('ht-count').value),
    });
    State.lastHashtags = data;
    const renderGroup = (label, tags) => tags?.length
      ? `<div class="seo-result-group"><div class="seo-result-label">${label}</div><div style="display:flex;flex-wrap:wrap;gap:6px">${tags.map(t=>`<span class="badge badge-blue" style="cursor:pointer" onclick="navigator.clipboard.writeText(${jsAttr(t)});toast('Copied!','success')">${escapeHtml(t)}</span>`).join('')}</div></div>` : '';
    const ht = data.hashtags || {};
    out.innerHTML = `
      ${renderGroup('🔥 High Volume', ht.high_volume)}
      ${renderGroup('📊 Medium Volume', ht.medium_volume)}
      ${renderGroup('🎯 Niche', ht.niche)}
      ${renderGroup('⚡ Trending', ht.trending)}
      ${data.recommended_mix ? `<div class="seo-result-group"><div class="seo-result-label">⭐ Recommended Mix</div><div style="font-size:13px;color:var(--accent-blue);word-break:break-all">${escapeHtml(data.recommended_mix)}</div><button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="navigator.clipboard.writeText(${jsAttr(data.recommended_mix||'')});toast('Copied!','success')">📋 Copy Mix</button></div>` : ''}
      ${data.instagram_set ? `<div class="seo-result-group"><div class="seo-result-label">📸 Instagram Set (30 tags)</div><div style="font-size:12px;color:var(--text-secondary);word-break:break-all">${escapeHtml(data.instagram_set)}</div><button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="navigator.clipboard.writeText(${jsAttr(data.instagram_set||'')});toast('Copied!','success')">📋 Copy IG Set</button></div>` : ''}
      ${data.tip ? `<div class="seo-result-group"><div class="seo-result-label">💡 Tip</div><div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(data.tip)}</div></div>` : ''}`;
    copyBtn.disabled = false;
    toast('Hashtags researched!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '#️⃣ Research Hashtags'; }
}

function copyHashtags() {
  const d = State.lastHashtags;
  if (!d) return;
  const all = Object.values(d.hashtags || {}).flat().join(' ');
  navigator.clipboard.writeText(all);
  toast('All hashtags copied!', 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
// UTM Builder
// ─────────────────────────────────────────────────────────────────────────────

function buildUTMLink() {
  const url = document.getElementById('utm-url').value.trim();
  const source = document.getElementById('utm-source').value.trim();
  const campaign = document.getElementById('utm-campaign').value.trim();
  if (!url || !source || !campaign) return toast('URL, source, and campaign are required', 'warning');

  const params = new URLSearchParams();
  ['utm-source','utm-medium','utm-campaign','utm-term','utm-content'].forEach(id => {
    const val = document.getElementById(id).value.trim();
    if (val) params.set(id.replace('-','_'), val);
  });

  const sep = url.includes('?') ? '&' : '?';
  const full = `${url}${sep}${params.toString()}`;
  State.lastUTMLink = full;

  document.getElementById('utm-result').innerHTML = `<a href="${escapeHtml(full)}" target="_blank" style="color:var(--accent-blue);word-break:break-all">${escapeHtml(full)}</a>`;
  document.getElementById('btn-copy-utm').disabled = false;
  document.getElementById('btn-save-utm').disabled = false;
}

function copyUTMLink() {
  if (State.lastUTMLink) { navigator.clipboard.writeText(State.lastUTMLink); toast('Link copied!', 'success'); }
}

async function saveUTMLink() {
  if (!State.lastUTMLink) return;
  try {
    await api('POST', '/api/tools/utm-links', {
      original_url: document.getElementById('utm-url').value.trim(),
      utm_source: document.getElementById('utm-source').value.trim(),
      utm_medium: document.getElementById('utm-medium').value.trim(),
      utm_campaign: document.getElementById('utm-campaign').value.trim(),
      utm_term: document.getElementById('utm-term').value.trim(),
      utm_content: document.getElementById('utm-content').value.trim(),
      label: document.getElementById('utm-label').value.trim(),
    });
    toast('UTM link saved!', 'success');
    loadUTMLinks();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadUTMLinks() {
  const list = document.getElementById('utm-links-list');
  if (!list) return;
  try {
    const links = await api('GET', '/api/tools/utm-links');
    if (!links.length) {
      list.innerHTML = '<div class="empty-state" style="padding:20px 0"><div class="empty-icon">🔗</div><div class="empty-title">No saved links</div></div>';
      return;
    }
    list.innerHTML = links.map(l => `
      <div class="scheduled-item">
        <div class="scheduled-content">
          <div class="scheduled-text">${l.label ? `<strong>${escapeHtml(l.label)}</strong> — ` : ''}<span class="badge badge-blue">${escapeHtml(l.utm_source||'')}</span> <span class="badge badge-purple">${escapeHtml(l.utm_campaign||'')}</span></div>
          <div style="font-size:11px;color:var(--text-muted);word-break:break-all;margin-top:4px">${escapeHtml((l.full_url||'').substring(0,80))}…</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-secondary btn-sm btn-icon" onclick="navigator.clipboard.writeText(${jsAttr(l.full_url||'')});toast('Copied!','success')" title="Copy">📋</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteUTMLink(${l.id})" title="Delete">🗑</button>
        </div>
      </div>`).join('');
  } catch {}
}

async function deleteUTMLink(id) {
  await api('DELETE', `/api/tools/utm-links/${id}`);
  loadUTMLinks();
}

// ─────────────────────────────────────────────────────────────────────────────
// Content Templates
// ─────────────────────────────────────────────────────────────────────────────

async function loadTemplates() {
  const list = document.getElementById('templates-list');
  if (!list) return;
  const filter = document.getElementById('tmpl-filter')?.value || '';
  try {
    const templates = await api('GET', `/api/tools/templates${filter ? `?type=${filter}` : ''}`);
    if (!templates.length) {
      list.innerHTML = '<div class="empty-state" style="padding:40px 0"><div class="empty-icon">🗂️</div><div class="empty-title">No templates yet</div><div class="empty-desc">Save your best posts as reusable templates.</div></div>';
      return;
    }
    list.innerHTML = templates.map(t => `
      <div class="scheduled-item" style="cursor:pointer" onclick="previewTemplate(${jsAttr(t)})">
        <div class="scheduled-content">
          <div class="scheduled-text"><strong>${escapeHtml(t.name)}</strong></div>
          <div style="display:flex;gap:6px;margin-top:4px">
            <span class="badge badge-purple">${t.type}</span>
            ${t.tags ? t.tags.split(',').map(tag => `<span class="tag">${escapeHtml(tag.trim())}</span>`).join('') : ''}
          </div>
        </div>
        <button class="btn btn-danger btn-sm btn-icon" onclick="event.stopPropagation();deleteTemplate(${t.id})" title="Delete">🗑</button>
      </div>`).join('');
  } catch {}
}

function previewTemplate(t) {
  document.getElementById('tmpl-preview-title').textContent = `📋 ${t.name}`;
  document.getElementById('tmpl-preview-content').textContent = t.content;
  document.getElementById('btn-use-tmpl').disabled = false;
  State.selectedTemplate = t.content;
}

function useTemplate() {
  if (!State.selectedTemplate) return;
  if (!startNewCompose({ text: State.selectedTemplate })) return;
  toast('Template loaded into Compose', 'success');
}

function openSaveTemplateModal() {
  const compose = document.getElementById('compose-content');
  if (compose?.value) document.getElementById('tmpl-save-content').value = compose.value;
  document.getElementById('save-template-modal').style.display = 'flex';
}

async function saveTemplate() {
  const name = document.getElementById('tmpl-save-name').value.trim();
  const content = document.getElementById('tmpl-save-content').value.trim();
  if (!name || !content) return toast('Name and content are required', 'warning');
  try {
    await api('POST', '/api/tools/templates', {
      name, content,
      type: document.getElementById('tmpl-save-type').value,
      tags: document.getElementById('tmpl-save-tags').value,
    });
    document.getElementById('save-template-modal').style.display = 'none';
    document.getElementById('tmpl-save-name').value = '';
    document.getElementById('tmpl-save-content').value = '';
    toast('Template saved!', 'success');
    if (State.currentPage === 'templates') loadTemplates();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  await api('DELETE', `/api/tools/templates/${id}`);
  loadTemplates();
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama / Local AI
// ─────────────────────────────────────────────────────────────────────────────

async function checkOllamaStatus() {
  const dot  = document.getElementById('ollama-status-dot');
  const text = document.getElementById('ollama-status-text');
  const installGuide = document.getElementById('ollama-install-guide');
  const modelsList   = document.getElementById('ollama-models-list');
  const modelsGrid   = document.getElementById('ollama-models-grid');
  const toggle       = document.getElementById('ollama-enabled-toggle');
  const toggleLabel  = document.getElementById('ollama-enabled-label');

  text.textContent = 'Checking…';
  try {
    const data = await api('GET', '/api/config/ollama/status');

    if (data.running) {
      dot.style.background = '#10b981';
      dot.style.boxShadow  = '0 0 8px #10b981';
      text.textContent = `✅ Ollama running — ${data.models.length} model${data.models.length !== 1 ? 's' : ''} downloaded`;
      installGuide.style.display = 'none';

      if (data.models.length) {
        modelsList.style.display = 'block';
        modelsGrid.innerHTML = data.models.map(m => {
          const sizeGB = m.size ? (m.size / 1e9).toFixed(1) + ' GB' : '';
          return `<span class="badge badge-purple" style="cursor:pointer" onclick="selectOllamaModel(${jsAttr(m.name)})">${escapeHtml(m.name)} ${sizeGB}</span>`;
        }).join('');

        // Auto-select current model in dropdown
        const sel = document.getElementById('ollama-model-select');
        if (sel && data.current) {
          const opt = Array.from(sel.options).find(o => o.value === data.current);
          if (opt) sel.value = data.current;
          else {
            const newOpt = new Option(data.current, data.current);
            sel.add(newOpt);
            sel.value = data.current;
          }
        }
      }
    } else {
      dot.style.background = '#ef4444';
      dot.style.boxShadow  = 'none';
      text.textContent = '❌ Ollama not running — follow the install guide below';
      installGuide.style.display = 'block';
      modelsList.style.display = 'none';
    }

    if (toggle) {
      toggle.checked = data.enabled;
      toggleLabel.textContent = data.enabled ? 'Enabled' : 'Disabled';
      toggleLabel.style.color  = data.enabled ? 'var(--accent-green)' : 'var(--text-muted)';
    }

    const urlInput = document.getElementById('ollama-base-url');
    if (urlInput && data.base) urlInput.value = data.base;

  } catch (err) {
    dot.style.background = '#ef4444';
    text.textContent = '❌ Cannot reach Ollama — install it first';
  }
}

function selectOllamaModel(name) {
  const sel = document.getElementById('ollama-model-select');
  if (!sel) return;
  const existing = Array.from(sel.options).find(o => o.value === name);
  if (!existing) { const o = new Option(name, name); sel.add(o); }
  sel.value = name;
  toast(`Model set to ${name}`, 'info');
}

async function saveOllamaSettings() {
  const enabled  = document.getElementById('ollama-enabled-toggle')?.checked;
  const model    = document.getElementById('ollama-model-select')?.value;
  const base_url = document.getElementById('ollama-base-url')?.value.trim();
  const label    = document.getElementById('ollama-enabled-label');

  try {
    await api('POST', '/api/config/ollama/enable', { enabled, model, base_url });
    if (label) { label.textContent = enabled ? 'Enabled' : 'Disabled'; label.style.color = enabled ? 'var(--accent-green)' : 'var(--text-muted)'; }
    toast(enabled ? `✅ Ollama enabled — using ${model}` : 'Ollama disabled — using cloud AI', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function pullOllamaModel() {
  const input    = document.getElementById('ollama-pull-input');
  const progress = document.getElementById('ollama-pull-progress');
  const btn      = document.getElementById('btn-pull-model');
  const model    = input.value.trim();
  if (!model) return toast('Enter a model name', 'warning');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  progress.style.display = 'block';
  progress.textContent = `Pulling ${model}…`;

  try {
    const response = await fetch(`/api/config/ollama/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.status === 'done') {
            progress.textContent = `✅ ${model} downloaded!`;
            toast(`${model} pulled successfully!`, 'success');
            input.value = '';
            checkOllamaStatus();
          } else if (data.status === 'error') {
            progress.textContent = `❌ Error: ${data.error || 'Pull failed'}`;
          } else if (data.completed && data.total) {
            const pct = Math.round((data.completed / data.total) * 100);
            progress.textContent = `⬇️ ${data.status} — ${pct}% (${(data.completed / 1e6).toFixed(0)}MB / ${(data.total / 1e6).toFixed(0)}MB)`;
          } else {
            progress.textContent = `⬇️ ${data.status || 'downloading'}…`;
          }
        } catch {}
      }
    }
  } catch (err) {
    progress.textContent = `❌ ${err.message}`;
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Pull';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand Kit
// ─────────────────────────────────────────────────────────────────────────────

async function loadBrandKit() {
  try {
    const kit = await api('GET', '/api/tools/brand-kit');
    if (!kit || !kit.company_name) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('brand-name', kit.company_name);
    set('brand-tagline', kit.tagline);
    set('brand-audience', kit.target_audience);
    set('brand-voice', kit.brand_voice);
    set('brand-logo', kit.logo_url);
    set('brand-primary-hex', kit.primary_color || '#7c3aed');
    set('brand-secondary-hex', kit.secondary_color || '#3b82f6');
    set('brand-accent-hex', kit.accent_color || '#06b6d4');
    if (document.getElementById('brand-primary-color')) document.getElementById('brand-primary-color').value = kit.primary_color || '#7c3aed';
    if (document.getElementById('brand-secondary-color')) document.getElementById('brand-secondary-color').value = kit.secondary_color || '#3b82f6';
    if (document.getElementById('brand-accent-color')) document.getElementById('brand-accent-color').value = kit.accent_color || '#06b6d4';
    if (kit.font_name) { const sel = document.getElementById('brand-font'); if (sel) sel.value = kit.font_name; }
    updateBrandPreview();
  } catch {}
}

async function saveBrandKit() {
  try {
    await api('POST', '/api/tools/brand-kit', {
      company_name: document.getElementById('brand-name').value,
      tagline: document.getElementById('brand-tagline').value,
      target_audience: document.getElementById('brand-audience').value,
      brand_voice: document.getElementById('brand-voice').value,
      logo_url: document.getElementById('brand-logo').value,
      primary_color: document.getElementById('brand-primary-hex').value,
      secondary_color: document.getElementById('brand-secondary-hex').value,
      accent_color: document.getElementById('brand-accent-hex').value,
      font_name: document.getElementById('brand-font').value,
    });
    toast('Brand kit saved!', 'success');
    updateBrandPreview();
  } catch (err) { toast(err.message, 'error'); }
}

function syncColorInput(type) {
  const hex = document.getElementById(`brand-${type}-hex`).value;
  const picker = document.getElementById(`brand-${type}-color`);
  if (picker && /^#[0-9a-fA-F]{6}$/.test(hex)) { picker.value = hex; }
  updateBrandPreview();
}

function updateBrandPreview() {
  const name = document.getElementById('brand-name')?.value || 'Your Brand';
  const tagline = document.getElementById('brand-tagline')?.value || 'Your tagline here';
  const primary = document.getElementById('brand-primary-hex')?.value || '#7c3aed';
  const secondary = document.getElementById('brand-secondary-hex')?.value || '#3b82f6';
  const accent = document.getElementById('brand-accent-hex')?.value || '#06b6d4';
  const logo = document.getElementById('brand-logo')?.value;

  const previewName = document.getElementById('preview-name');
  const previewTagline = document.getElementById('preview-tagline');
  const previewLogo = document.getElementById('preview-logo');
  const previewPalette = document.getElementById('preview-palette');

  if (previewName) previewName.textContent = name;
  if (previewTagline) previewTagline.textContent = tagline;
  if (previewLogo) {
    if (logo) previewLogo.innerHTML = `<img src="${escapeHtml(logo)}" style="width:40px;height:40px;border-radius:8px;object-fit:cover">`;
    else previewLogo.style.background = primary;
  }
  if (previewPalette) {
    previewPalette.innerHTML = `
      <div style="width:32px;height:32px;border-radius:6px;background:${escapeHtml(primary)}" title="Primary"></div>
      <div style="width:32px;height:32px;border-radius:6px;background:${escapeHtml(secondary)}" title="Secondary"></div>
      <div style="width:32px;height:32px;border-radius:6px;background:${escapeHtml(accent)}" title="Accent"></div>`;
  }
}
