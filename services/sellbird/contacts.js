// services/sellbird/contacts.js
// Identifies decision-makers, resolves email patterns, and verifies deliverability via DNS MX records.

const dns = require('dns').promises;

// Check if domain has working mail servers (MX records) with a safe 3.5s timeout
async function verifyMxRecord(domain, timeoutMs = 3500) {
  if (!domain || typeof domain !== 'string') return false;
  const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');

  try {
    const resolvePromise = dns.resolveMx(cleanDomain);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('DNS resolution timeout')), timeoutMs)
    );

    const records = await Promise.race([resolvePromise, timeoutPromise]);
    // A single empty record ("null MX") means the domain takes no email
    return Array.isArray(records) && records.some((r) => r && r.exchange && r.exchange !== '.');
  } catch (err) {
    return false;
  }
}

function isValidEmailSyntax(email) {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(String(email || '').trim().toLowerCase());
}

// Predict common business email permutations
function predictEmailPatterns(firstName, lastName, domain) {
  const f = (firstName || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const l = (lastName || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const d = (domain || 'example.com').trim().toLowerCase().replace(/^www\./, '');

  if (!f) return [];
  if (!l) {
    return [
      `${f}@${d}`,
      `contact@${d}`,
      `info@${d}`,
    ];
  }

  return [
    `${f}.${l}@${d}`,
    `${f}@${d}`,
    `${f[0]}${l}@${d}`,
    `${f}_${l}@${d}`,
    `${l}.${f}@${d}`,
  ];
}

async function verifyContactEmail(email) {
  if (!isValidEmailSyntax(email)) {
    return { verified: false, status: 'invalid', reason: 'Malformed syntax' };
  }

  const domain = email.split('@')[1];
  const hasMx = await verifyMxRecord(domain);
  if (!hasMx) {
    return { verified: false, status: 'invalid', reason: 'No MX mail server found for domain' };
  }

  return { verified: true, status: 'verified', reason: 'Valid syntax and active MX mail server' };
}

// Extract prospective decision-maker names from text or heuristics
function extractProspectNames(text, domain) {
  const safeText = typeof text === 'string' ? text.slice(0, 5000) : '';
  const cleanDomain = (domain || 'Company').trim().split('.')[0] || 'Company';

  const roles = [
    'Founder',
    'Co-Founder',
    'CEO',
    'Managing Director',
    'Director',
    'President',
    'VP Sales',
    'Head of Operations',
    'Secretary',
    'Treasurer',
    'Property Manager',
  ];

  const found = [];
  // Look for patterns like "Name, Title" or "Title: Name"
  for (const role of roles) {
    const reg = new RegExp(`([A-Z][a-z]+ [A-Z][a-z]+)[,\\s\\|\\-–]+(?:is the )?${role}`, 'i');
    const m = safeText.match(reg);
    if (m && m[1]) {
      found.push({ full_name: m[1].trim(), role });
    }
  }

  if (!found.length) {
    // Fallback: Use domain-derived leadership title rather than synthetic person name
    const companyTitle = cleanDomain.charAt(0).toUpperCase() + cleanDomain.slice(1).toLowerCase();
    found.push({
      full_name: `${companyTitle} Leadership`,
      role: 'Decision Maker',
    });
  }

  return found;
}

module.exports = {
  verifyMxRecord,
  isValidEmailSyntax,
  predictEmailPatterns,
  verifyContactEmail,
  extractProspectNames,
};
