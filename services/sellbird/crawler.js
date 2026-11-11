// services/sellbird/crawler.js
// Website crawler and buying signals extractor for Sellbird autonomous sales agent.

const axios = require('axios');

function cleanText(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMeta(html, name) {
  const reg1 = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const reg2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i');
  const reg3 = new RegExp(`<meta[^>]*property=["']og:${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m = html.match(reg1) || html.match(reg2) || html.match(reg3);
  return m ? cleanText(m[1]) : '';
}

function extractEmails(text) {
  if (typeof text !== 'string') return [];
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const clean = [];
  const seen = new Set();
  const ignore = ['example.com', 'sentry.io', 'wixpress.com', 'schema.org', 'domain.com'];

  for (const email of matches) {
    const lower = email.toLowerCase().replace(/^[0-9]+/, '');
    const domain = lower.split('@')[1];
    if (domain && !ignore.some((ig) => domain.includes(ig)) && !seen.has(lower)) {
      seen.add(lower);
      clean.push(lower);
    }
  }
  return clean;
}

function isPrivateOrLocalHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase().trim();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  // Check private IPv4 ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
  const parts = h.split('.').map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  }
  return false;
}

function extractSignals(html, text) {
  const signals = [];
  const lower = (text || '').toLowerCase();

  // Tech / Infrastructure Signals
  if (lower.includes('razorpay') || lower.includes('stripe') || lower.includes('payment gateway')) signals.push('Digital Payments Active');
  if (lower.includes('wordpress') || lower.includes('shopify') || lower.includes('react') || lower.includes('next.js')) signals.push('Modern Tech Stack');
  if (lower.includes('hiring') || lower.includes('careers') || lower.includes('open positions') || lower.includes('job openings')) signals.push('Actively Hiring / Growing');
  if (lower.includes('iso certified') || lower.includes('gdpr') || lower.includes('compliance') || lower.includes('mcs act')) signals.push('Statutory & Compliance Focused');
  if (lower.includes('society') || lower.includes('apartment') || lower.includes('resident') || lower.includes('gated community')) signals.push('Residential & Community Management');
  if (lower.includes('enterprise') || lower.includes('b2b') || lower.includes('custom solution')) signals.push('Enterprise B2B Buyer');

  // Value props & offerings
  const headings = [];
  if (typeof html === 'string') {
    const hMatches = html.matchAll(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi);
    for (const h of hMatches) {
      const t = cleanText(h[1]);
      if (t && t.length > 10 && t.length < 120 && !headings.includes(t)) {
        headings.push(t);
        if (headings.length >= 6) break;
      }
    }
  }

  return {
    detected_signals: signals.length ? signals : ['Active Business Website', 'Potential ICP Fit'],
    key_headings: headings,
  };
}

async function crawlWebsite(targetUrl) {
  let hostname = 'unknown';
  try {
    if (!targetUrl || typeof targetUrl !== 'string') {
      return {
        success: false,
        url: '',
        domain: 'invalid',
        title: 'Invalid URL',
        description: 'URL target cannot be empty.',
        emails: [],
        buying_signals: { signals: ['Invalid Target'], headlines: [], snippet: '' },
      };
    }

    let url = targetUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    const parsed = new URL(url);
    hostname = parsed.hostname.replace(/^www\./, '');

    // SSRF & Private host protection
    if (isPrivateOrLocalHost(hostname)) {
      return {
        success: false,
        url,
        domain: hostname,
        title: hostname,
        description: 'Access to private or local network hosts is restricted for security.',
        emails: [],
        buying_signals: {
          signals: ['Host Restricted'],
          headlines: [],
          snippet: 'Access to private network address was blocked.',
        },
      };
    }

    const res = await axios.get(url, {
      timeout: 12000,
      maxContentLength: 5 * 1024 * 1024, // 5MB cap to protect memory
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Sellbird/2.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      maxRedirects: 5,
      // A website must not send us on to a private or local address
      beforeRedirect: (opts) => { if (isPrivateOrLocalHost(opts.hostname)) throw new Error('Redirect to a private address was blocked'); },
    });

    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? cleanText(titleMatch[1]) : hostname;
    const description = extractMeta(html, 'description') || extractMeta(html, 'title') || '';
    const bodyText = cleanText(html);
    const emails = extractEmails(html);
    const { detected_signals, key_headings } = extractSignals(html, bodyText);

    return {
      success: true,
      url,
      domain: hostname,
      title,
      description,
      emails,
      buying_signals: {
        signals: detected_signals,
        headlines: key_headings,
        snippet: bodyText.slice(0, 1500),
      },
    };
  } catch (err) {
    return {
      success: false,
      url: targetUrl,
      domain: hostname,
      title: hostname,
      description: 'Website could not be reached directly.',
      emails: [],
      buying_signals: {
        signals: ['Domain Identified'],
        headlines: [],
        snippet: err.message,
      },
    };
  }
}

module.exports = { crawlWebsite, cleanText, extractEmails, isPrivateOrLocalHost };
