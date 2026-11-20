// "What's new" page: the released notes (GET /api/release-notes), with a "New" badge in the menu until the person
// has opened the page since the last release. The server sends safe HTML (only <strong> and <code>).
(function () {
  const SEEN_KEY = 'nexus.whatsNewSeen';
  let data = null;

  async function fetchNotes() {
    if (data) return data;
    const res = await fetch('/api/release-notes', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status === 401 ? 'Sign in to see what’s new.' : 'Couldn’t load the release notes. Try again in a moment.');
    data = await res.json();
    return data;
  }

  const latest = (d) => (d && d.releases && d.releases[0] ? d.releases[0].version : null);

  function setBadge(show) {
    const b = document.getElementById('whats-new-badge');
    if (b) b.style.display = show ? '' : 'none';
  }

  function render(d) {
    const esc = window.escapeHtml || ((s) => String(s));
    const v = document.getElementById('whats-new-version');
    if (v) v.textContent = d.version;
    const list = document.getElementById('whats-new-list');
    if (!list) return;
    if (!d.releases.length) { list.innerHTML = '<div class="empty-state">No release notes yet.</div>'; return; }
    list.innerHTML = d.releases.map((r, i) => `
      <article class="card wn-release${i === 0 ? ' wn-latest' : ''}">
        <header class="wn-head">
          <h2 class="wn-version">Version ${esc(r.version)}</h2>
          <span class="wn-date">${esc(r.date)}</span>
          ${r.version === d.version ? '<span class="wn-current">You have this</span>' : ''}
        </header>
        ${r.sections.map((s) => `
          <section class="wn-section">
            ${s.title ? `<h3 class="wn-title">${esc(s.title)}</h3>` : ''}
            <ul class="wn-items">${s.items.map((html) => `<li>${html}</li>`).join('')}</ul>
          </section>`).join('')}
      </article>`).join('');
  }

  async function loadWhatsNew() {
    const list = document.getElementById('whats-new-list');
    try {
      const d = await fetchNotes();
      render(d);
      const v = latest(d);
      if (v) { try { localStorage.setItem(SEEN_KEY, v); } catch {} }
      setBadge(false);
    } catch (e) {
      if (list) list.innerHTML = `<div class="empty-state">${(window.escapeHtml || String)(e.message)}</div>`;
    }
  }

  // Show the badge when there is a release the person hasn't looked at (silent on any error, e.g. not signed in)
  async function checkBadge() {
    try {
      const v = latest(await fetchNotes());
      let seen = null; try { seen = localStorage.getItem(SEEN_KEY); } catch {}
      setBadge(!!v && v !== seen);
    } catch { data = null; }
  }

  window.loadWhatsNew = loadWhatsNew;
  window.addEventListener('load', () => setTimeout(checkBadge, 2500));
})();
