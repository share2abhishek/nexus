// OAuth 1.0a request signing (X/Twitter). Used for X's media upload, where the
// "oauth" package can't send a file. For JSON and file bodies only the oauth_*
// values and the address's query string are signed, as the standard says.
const crypto = require('crypto');

const enc = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function authHeader(method, url, { consumerKey, consumerSecret, token, tokenSecret }, { nonce, timestamp } = {}) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const params = [...Object.entries(oauth), ...[...u.searchParams.entries()]]
    .map(([k, v]) => [enc(k), enc(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : (a[0] < b[0] ? -1 : 1)))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const base = [method.toUpperCase(), enc(`${u.origin}${u.pathname}`), enc(params)].join('&');
  const signature = crypto.createHmac('sha1', `${enc(consumerSecret)}&${enc(tokenSecret || '')}`).update(base).digest('base64');
  return 'OAuth ' + Object.entries({ ...oauth, oauth_signature: signature })
    .map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ');
}

module.exports = { authHeader };
