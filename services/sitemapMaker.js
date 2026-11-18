// Sitemap maker (Website SEO): builds a sitemap.xml for a website, to download and
// upload to the site. It lists only addresses that open (final address, after
// redirects) on one host. Pages the person types in are trusted as given, because
// a script-built site answers "OK" for any address and can't be checked from here.
const seoCheck = require('./seoCheck');
const { discoverPages } = require('./seoAutopilot');
const { statusOf } = require('./seoSiteChecks');

const MAX_URLS = 200;
const MAX_CHECKED = 40;

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const strip = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return null; } };

// Typed lines: a full address on the site, or a path like /pricing
function parseExtra(lines, origin) {
  const out = [];
  for (const raw of Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/)) {
    const line = String(raw).trim();
    if (!line) continue;
    try {
      const u = /^https?:\/\//i.test(line) ? new URL(line) : new URL(line.startsWith('/') ? line : `/${line}`, origin);
      if (u.origin !== new URL(origin).origin) continue; // another site: leave out
      const href = strip(u.href);
      if (href && !out.includes(href)) out.push(href);
    } catch { /* not an address */ }
  }
  return out.slice(0, MAX_URLS);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

function toXml(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${xmlEscape(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

async function makeSitemap(siteUrl, { extra = [] } = {}) {
  const home = seoCheck.normaliseUrl(siteUrl);
  // The address the site really uses (after redirects), so the sitemap names one host
  const first = await seoCheck.fetchText(home, { timeout: 30000 });
  if (first.status >= 400) throw new Error(`The home page answers ${first.status}, so a sitemap can’t be made yet.`);
  // Name the host the site itself calls its main one (its canonical), when that is only www or non-www
  let mainUrl = first.finalUrl;
  try {
    const canon = seoCheck.readHtml(first.body, first.finalUrl).canonical;
    const bare = (h) => h.replace(/^www\./, '');
    if (canon && hostOf(canon) !== hostOf(mainUrl) && bare(hostOf(canon)) === bare(hostOf(mainUrl))) mainUrl = canon;
  } catch { /* keep the address that answered */ }
  const origin = new URL(mainUrl).origin;
  const siteHost = hostOf(mainUrl);

  // Addresses on the same site (www or not) are listed under the main host
  const bareHost = (h) => h.replace(/^www\./, '');
  const toMain = (u) => { try { const x = new URL(u); if (bareHost(x.hostname) !== bareHost(siteHost)) return null; x.hostname = siteHost; x.hash = ''; return x.href; } catch { return null; } };

  const typed = parseExtra(extra, origin);
  const found = (await discoverPages(first.finalUrl, MAX_CHECKED)).filter((u) => toMain(u)); // same site only

  const skipped = [];
  const urls = [];
  const add = (u) => { if (u && !urls.includes(u) && urls.length < MAX_URLS) urls.push(u); };
  add(`${origin}/`);
  for (const u of typed) add(u);

  // Found addresses: keep those that open, at their final address
  const toCheck = found.filter((u) => !urls.includes(toMain(u))).slice(0, MAX_CHECKED);
  const checked = await mapLimit(toCheck, 4, async (u) => ({ u, s: await statusOf(u) }));
  for (const { u, s } of checked) {
    if (s.status >= 200 && s.status < 300) {
      const final = toMain(s.finalUrl || u);
      if (final) add(final);
      else skipped.push({ url: u, why: 'sends visitors to another website' });
    } else skipped.push({ url: u, why: s.status ? `answers ${s.status}` : (s.error || 'does not open') });
  }

  const scriptBuilt = found.length <= 1 && !typed.length;
  return {
    xml: toXml(urls),
    urls,
    count: urls.length,
    skipped,
    host: siteHost,
    // A script-built site shows no links to follow: say how to add the pages
    note: scriptBuilt
      ? 'Only the home page could be found because this website builds its pages with JavaScript. Type your page addresses (one per line, such as /blog or /pricing) and make it again.'
      : null,
  };
}

module.exports = { makeSitemap, parseExtra, toXml };
