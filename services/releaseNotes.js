// "What's new" in the app: the released sections of docs/RELEASE-NOTES.md, turned into safe HTML.
// Unreleased is never shown (it is not live yet). Sections meant for Radixile staff or for people installing the
// server ("Super Admin", "Upgrading ...") are left out for everyone else on the hosted edition.
// Only **bold** and `code` are rendered; everything else is escaped text, so the notes can never inject markup.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'docs', 'RELEASE-NOTES.md');
const STAFF_ONLY = /^(super admin|upgrading)/i;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// md: the whole file. Returns [{ version, date, sections: [{ title, staffOnly, items: [html] }] }], newest first.
function parse(md) {
  const lines = String(md).split('\r\n').join('\n').split('\n');
  const releases = [];
  let rel = null; let sec = null; let item = null;
  const flush = () => { if (item !== null && sec) sec.items.push(inline(item.trim())); item = null; };
  for (const line of lines) {
    const h2 = line.match(/^## (.+?)\s*$/);
    if (h2) {
      flush();
      const m = h2[1].match(/^(\d+\.\d+\.\d+)\s+—\s+(.+)$/);
      rel = m ? { version: m[1], date: m[2].trim(), sections: [] } : null; // "Unreleased" and anything else: skipped
      if (rel) releases.push(rel);
      sec = null;
      continue;
    }
    if (!rel) continue;
    const h3 = line.match(/^### (.+?)\s*$/);
    if (h3) { flush(); sec = { title: h3[1], staffOnly: STAFF_ONLY.test(h3[1]), items: [] }; rel.sections.push(sec); continue; }
    if (/^---\s*$/.test(line)) { flush(); continue; }
    if (!sec) { // text right under the version heading
      if (line.trim()) { sec = { title: '', staffOnly: false, items: [] }; rel.sections.push(sec); } else continue;
    }
    const bullet = line.match(/^\s{0,3}[-*] (.*)$/);
    if (bullet) { flush(); item = bullet[1]; continue; }
    if (!line.trim()) { flush(); continue; }
    item = item === null ? line : `${item} ${line.trim()}`; // continuation line or a plain paragraph
  }
  flush();
  for (const r of releases) r.sections = r.sections.filter((s) => s.items.length);
  return releases;
}

let cache = { mtime: 0, releases: [] };
function all() {
  const { mtimeMs } = fs.statSync(FILE);
  if (mtimeMs !== cache.mtime) cache = { mtime: mtimeMs, releases: parse(fs.readFileSync(FILE, 'utf8')) };
  return cache.releases;
}

// staff: may see staff-only sections. limit: how many releases.
function forViewer({ staff = false, limit = 10 } = {}) {
  return all().slice(0, limit).map((r) => ({
    version: r.version,
    date: r.date,
    sections: r.sections.filter((s) => staff || !s.staffOnly).map(({ title, items }) => ({ title, items })),
  })).filter((r) => r.sections.length);
}

module.exports = { parse, forViewer, inline };
