// Monthly client report: a one-page summary an agency can send to its client as a
// PDF (opened in its own window; "Save as PDF" uses the print dialog).
// Uses the workspace's Brand Kit for the name, logo and colour.
const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NAMES = { linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', pinterest: 'Pinterest', twitter: 'X (Twitter)', google_business: 'Google Business' };
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw Object.assign(new Error('Choose a month (YYYY-MM).'), { status: 400 });
  const [y, m] = month.split('-').map(Number);
  // India time: the month starts at 00:00 IST
  const from = Math.floor(Date.UTC(y, m - 1, 1) / 1000) - 19800;
  const to = Math.floor(Date.UTC(y, m, 1) / 1000) - 19800;
  return { from, to, label: new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
}

async function monthlyData(db, workspaceId, month) {
  const { from, to, label } = monthRange(month);
  const posts = (await db('posts').where({ workspace_id: workspaceId }).where('created_at', '>=', from).where('created_at', '<', to)
    .whereNot('status', 'failed').orderBy('created_at', 'asc'))
    .map(p => ({ ...p, platforms: parse(p.platforms) || [], results: parse(p.results) || [] }));
  const ids = posts.map(p => p.id);
  const stats = ids.length ? await db('analytics').where({ workspace_id: workspaceId }).whereIn('post_id', ids) : [];

  const byPlatform = {};
  for (const p of posts) {
    for (const r of p.results.filter(r => r?.success)) {
      byPlatform[r.platform] = byPlatform[r.platform] || { posts: 0, likes: 0, comments: 0, shares: 0, impressions: 0, clicks: 0 };
      byPlatform[r.platform].posts++;
    }
  }
  const perPost = new Map();
  for (const s of stats) {
    const b = byPlatform[s.platform] || (byPlatform[s.platform] = { posts: 0, likes: 0, comments: 0, shares: 0, impressions: 0, clicks: 0 });
    for (const k of ['likes', 'comments', 'shares', 'impressions', 'clicks']) b[k] += Number(s[k] || 0);
    const e = perPost.get(s.post_id) || { engagement: 0, impressions: 0 };
    e.engagement += Number(s.likes || 0) + Number(s.comments || 0) + Number(s.shares || 0);
    e.impressions += Number(s.impressions || 0);
    perPost.set(s.post_id, e);
  }
  const totals = Object.values(byPlatform).reduce((t, b) => {
    for (const k of Object.keys(t)) t[k] += b[k];
    return t;
  }, { posts: 0, likes: 0, comments: 0, shares: 0, impressions: 0, clicks: 0 });
  totals.posts = posts.length;

  const top = posts.map(p => ({ ...p, ...(perPost.get(p.id) || { engagement: 0, impressions: 0 }) }))
    .sort((a, b) => b.engagement - a.engagement || b.impressions - a.impressions).slice(0, 5);

  const brand = await require('./brand').profile(workspaceId, db);
  const ws = await db('workspaces').where({ id: workspaceId }).first();
  const asOf = stats.reduce((m, s) => Math.max(m, Number(s.recorded_at) || 0), 0) || null;
  return { label, month, posts, byPlatform, totals, top, brand, workspaceName: ws?.name || '', asOf };
}

function renderHtml(d, { bestTimes = null } = {}) {
  const color = /^#[0-9a-f]{3,8}$/i.test(d.brand.primary_color || '') ? d.brand.primary_color : '#7c3aed';
  const name = d.brand.company_name || d.workspaceName || 'Your business';
  const logo = /^(https?:\/\/|\/api\/media-library\/\d+\/file|data:image\/)/.test(d.brand.logo_url || '') ? d.brand.logo_url : null;
  const rows = Object.entries(d.byPlatform).map(([p, b]) => `<tr><td>${esc(NAMES[p] || p)}</td><td>${b.posts}</td><td>${fmt(b.likes)}</td><td>${fmt(b.comments)}</td><td>${fmt(b.shares)}</td><td>${fmt(b.impressions)}</td></tr>`).join('');
  const hour = (h) => new Date(2000, 0, 1, h).toLocaleTimeString('en-IN', { hour: 'numeric' });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(name)} — ${esc(d.label)} report</title>
<style>
  body { font-family: Inter, "Segoe UI", Arial, sans-serif; color: #1f2937; margin: 0; background: #f3f4f6; }
  .page { max-width: 800px; margin: 24px auto; background: #fff; padding: 40px 48px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
  header { display: flex; align-items: center; justify-content: space-between; border-bottom: 4px solid ${color}; padding-bottom: 16px; }
  header img { max-height: 56px; max-width: 200px; }
  h1 { margin: 0; font-size: 24px; } h2 { font-size: 16px; color: ${color}; margin: 28px 0 10px; }
  .muted { color: #6b7280; font-size: 13px; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 20px; }
  .tile { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; } .tile b { display: block; font-size: 22px; color: ${color}; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; } th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; }
  th { background: #f9fafb; } .post { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; font-size: 13px; }
  .toolbar { max-width: 800px; margin: 16px auto 0; text-align: right; }
  .toolbar button { background: ${color}; color: #fff; border: 0; border-radius: 8px; padding: 10px 18px; font-size: 14px; cursor: pointer; }
  @media print { body { background: #fff; } .page { box-shadow: none; margin: 0; padding: 0; } .toolbar { display: none; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Save as PDF / Print</button></div>
<div class="page">
  <header><div><h1>${esc(name)}</h1><div class="muted">Social media report · ${esc(d.label)}</div></div>${logo ? `<img src="${esc(logo)}" alt="">` : ''}</header>
  <div class="tiles">
    <div class="tile"><b>${fmt(d.totals.posts)}</b>posts published</div>
    <div class="tile"><b>${fmt(d.totals.impressions)}</b>people reached</div>
    <div class="tile"><b>${fmt(d.totals.likes)}</b>likes</div>
    <div class="tile"><b>${fmt(d.totals.comments + d.totals.shares)}</b>comments &amp; shares</div>
  </div>
  <h2>By platform</h2>
  ${rows ? `<table><tr><th>Platform</th><th>Posts</th><th>Likes</th><th>Comments</th><th>Shares &amp; saves</th><th>Reach</th></tr>${rows}</table>` : '<p class="muted">No posts were published this month.</p>'}
  ${d.top.length ? `<h2>Best posts</h2>${d.top.map(p => `<div class="post"><div>${esc(String(p.content || '').slice(0, 220))}${String(p.content || '').length > 220 ? '…' : ''}</div><div class="muted">${new Date(p.created_at * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${p.results.filter(r => r?.success).map(r => esc(NAMES[r.platform] || r.platform)).join(', ')} · ${fmt(p.engagement)} engagements${p.impressions ? ` · ${fmt(p.impressions)} reached` : ''}</div></div>`).join('')}` : ''}
  ${bestTimes?.enough ? `<h2>Best times to post</h2><p>${bestTimes.slots.slice(0, 3).map(s => `${esc(s.weekday)} ${hour(s.hour)}`).join(' · ')} <span class="muted">(from your own results, India time)</span></p>` : ''}
  <p class="muted" style="margin-top:32px">Numbers come from the platforms${d.asOf ? `, as of ${new Date(d.asOf * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''} (press Refresh numbers in Analytics for the latest). LinkedIn and Google Business don't share numbers for these posts, so their posts are counted but not their reach.</p>
</div></body></html>`;
}

module.exports = { monthlyData, renderHtml, monthRange };
