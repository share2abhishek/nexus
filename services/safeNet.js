// Server-side request forgery (SSRF) protection, in one place.
//
// When the server fetches a web address a user typed (a website to read, a webhook,
// an RSS feed ...) it must not be talked into calling things INSIDE its own network:
// the machine itself, the cloud metadata service (169.254.169.254), a database, an
// admin panel. Checking the address once and fetching later is not enough, because a
// name can point somewhere harmless when checked and somewhere private when fetched
// (DNS rebinding). So the check is done at the moment of connecting:
//   - `lookup` is the resolver the HTTP agents use: every address a name resolves to
//     is classified, and the connection is refused if any is private;
//   - addresses typed as IP numbers skip DNS, so those are checked up front
//     (guardHost) and again on every redirect (beforeRedirect).
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');

// Is this IP one a public website could never legitimately have?
function isPrivateIp(ip) {
  let v = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!v) return true;
  if (net.isIPv4(v)) {
    const [a, b, c] = v.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)          // carrier-grade NAT
      || (a === 169 && b === 254)                    // link-local, cloud metadata
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)           // IETF protocol assignments
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))       // benchmarking
      || a >= 224;                                   // multicast, reserved
  }
  if (net.isIPv6(v)) {
    if (v === '::' || v === '::1') return true;
    // IPv4 inside IPv6: ::ffff:127.0.0.1, ::ffff:7f00:1, and the 64:ff9b:: translation prefix
    const dotted = v.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateIp(dotted[1]);
    const hex = v.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (v.startsWith('::ffff:')) return true;         // any other mapped form: refuse
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v) || v.startsWith('2001:db8');
  }
  return true; // not an IP at all
}

// Names that mean "this computer" or "inside the network"
function isPrivateName(hostname) {
  const h = String(hostname || '').trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (net.isIP(h)) return isPrivateIp(h);
  // Numbers written other ways (2130706433, 0x7f.1, 017700000001): treat as private
  if (h.split('.').every((l) => /^(0x[0-9a-f]+|[0-9]+)$/i.test(l))) return true;
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')
    || h.endsWith('.lan') || h.endsWith('.home') || h.endsWith('.corp') || h === 'metadata' || !h.includes('.');
}

function guardHost(hostname) {
  if (isPrivateName(hostname)) {
    const e = new Error('Private or local addresses are not allowed.');
    e.code = 'EBLOCKED';
    throw e;
  }
}

// The resolver HTTP agents use: refuses a connection if ANY address is private
function lookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIP(addrs) }];
    if (!list.length || list.some((a) => isPrivateIp(a.address))) {
      const e = new Error('Private or local addresses are not allowed.');
      e.code = 'EBLOCKED';
      return callback(e);
    }
    if (options && options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const httpAgent = new http.Agent({ lookup, keepAlive: false });
const httpsAgent = new https.Agent({ lookup, keepAlive: false });

// Spread into an axios config:  axios.get(url, { ...safeOptions(), timeout: 10000 })
function safeOptions({ maxRedirects = 5 } = {}) {
  return {
    httpAgent, httpsAgent,
    proxy: false, // an environment proxy would make the connection somewhere we can't check
    maxRedirects,
    beforeRedirect: (opts) => guardHost(opts.hostname),
  };
}

// Throws unless the address is a public http(s) URL. Returns the parsed URL.
function assertPublicUrl(url, what = 'This address') {
  let u;
  try { u = new URL(String(url).trim()); } catch { throw new Error(`${what} isn’t a valid web address.`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`${what} must start with http:// or https://.`);
  if (u.username || u.password) throw new Error(`${what} can’t contain a user name or password.`);
  try { guardHost(u.hostname); } catch { throw new Error(`${what} must be a public website, not one on this computer or a private network.`); }
  return u;
}

// axios with the safe options added to every call. Methods are looked up when called (so
// tests that mock axios still see the calls); with no options it passes arguments through untouched.
function wrapAxios(base, extra) {
  const has = extra && Object.keys(extra).length > 0;
  const noBody = (m) => (url, config) => (has ? base[m](url, { ...extra, ...(config || {}) }) : base[m](url, config));
  const withBody = (m) => (url, data, config) => (has ? base[m](url, data, { ...extra, ...(config || {}) }) : base[m](url, data, config));
  return { get: noBody('get'), head: noBody('head'), delete: noBody('delete'), post: withBody('post'), put: withBody('put'), patch: withBody('patch') };
}

module.exports = { wrapAxios, isPrivateIp, isPrivateName, guardHost, lookup, safeOptions, assertPublicUrl, httpAgent, httpsAgent };
