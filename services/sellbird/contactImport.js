// services/sellbird/contactImport.js
// Reads a spreadsheet of people (CSV or Excel) for "Import contacts": finds the
// columns by their names, cleans each row and says why a row can't be used.
// Pure (no database, no network) so the preview and the real import agree.
const { readRows } = require('../bulkImport');
const { isValidEmailSyntax } = require('./contacts');

const MAX_ROWS = 300;

// Header names people really use -> our field
const COLUMNS = {
  name: ['name', 'full name', 'fullname', 'contact', 'contact name', 'person'],
  first: ['first name', 'firstname', 'first', 'given name'],
  last: ['last name', 'lastname', 'last', 'surname', 'family name'],
  email: ['email', 'e mail', 'email address', 'mail', 'work email'],
  role: ['role', 'title', 'job title', 'position', 'designation'],
  company: ['company', 'company name', 'organization', 'organisation', 'business', 'account'],
  website: ['website', 'domain', 'url', 'web', 'company website', 'site'],
  location: ['location', 'city', 'region', 'address', 'country'],
  industry: ['industry', 'sector', 'category'],
};

// Personal mailboxes: not a company's own domain
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'zoho.com', 'msn.com',
]);

const norm = (h) => String(h == null ? '' : h).trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
const cell = (row, i) => (i >= 0 ? String(row[i] == null ? '' : row[i]).trim() : '');

function findColumns(header) {
  const h = header.map(norm);
  const cols = {};
  for (const [field, names] of Object.entries(COLUMNS)) cols[field] = h.findIndex((x) => names.includes(x));
  return cols;
}

// "https://www.Acme.in/about" -> "acme.in"; "" when it isn't a website
function hostOf(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  const host = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
}

function titleCase(s) {
  return String(s || '').replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/**
 * @returns { rows: [{ line, ok, error?, contact? }], counts: { ok, failed, total }, truncated }
 * contact: { full_name, role, email, company, domain, location, industry }
 */
function parseContacts(buffer, fileName = '') {
  const all = readRows(buffer, fileName).filter((r) => r.some((c) => String(c == null ? '' : c).trim()));
  if (!all.length) throw new Error('The file is empty.');

  const cols = findColumns(all[0]);
  const hasHeader = cols.email >= 0 || cols.name >= 0 || cols.first >= 0;
  if (!hasHeader) throw new Error('Couldn’t find an “Email” column. Put the column names in the first row (Name, Email, Role, Company, Website).');
  if (cols.email < 0) throw new Error('Couldn’t find an “Email” column. Name it “Email”.');

  const body = all.slice(1);
  const rows = [];
  const seen = new Set();
  body.slice(0, MAX_ROWS).forEach((r, i) => {
    const line = i + 2; // the spreadsheet row number, header being row 1
    const email = cell(r, cols.email).toLowerCase().replace(/^mailto:/, '');
    const first = cell(r, cols.first);
    const last = cell(r, cols.last);
    let full_name = cell(r, cols.name) || [first, last].filter(Boolean).join(' ');

    if (!email) return rows.push({ line, ok: false, error: 'No email address.' });
    if (!isValidEmailSyntax(email)) return rows.push({ line, ok: false, error: `“${email}” isn’t a valid email address.` });
    if (seen.has(email)) return rows.push({ line, ok: false, error: 'Same email appears earlier in the file.' });
    seen.add(email);

    const emailDomain = email.split('@')[1];
    const domain = hostOf(cell(r, cols.website)) || (FREE_MAIL.has(emailDomain) ? '' : emailDomain);
    const company = cell(r, cols.company).slice(0, 120);
    if (!full_name) full_name = titleCase(email.split('@')[0].replace(/\d+/g, '')) || email;

    rows.push({
      line, ok: true,
      contact: {
        full_name: full_name.slice(0, 120),
        role: cell(r, cols.role).slice(0, 120),
        email,
        company: company || (domain ? titleCase(domain.split('.')[0]) : 'Individual contacts'),
        domain,
        location: cell(r, cols.location).slice(0, 120),
        industry: cell(r, cols.industry).slice(0, 120),
      },
    });
  });

  const ok = rows.filter((x) => x.ok).length;
  return { rows, counts: { ok, failed: rows.length - ok, total: rows.length }, truncated: body.length > MAX_ROWS };
}

// A file people can fill in
const TEMPLATE_CSV = 'Name,Email,Role,Company,Website,Location,Industry\n'
  + 'Asha Rao,asha@example.com,Founder,Example Interiors,example.com,Pune,Interior design\n'
  + 'Vikram Shah,vikram@sample.in,Operations Head,Sample Logistics,sample.in,Mumbai,Logistics\n';

module.exports = { parseContacts, hostOf, FREE_MAIL, MAX_ROWS, TEMPLATE_CSV };
