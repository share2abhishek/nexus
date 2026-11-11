// tests/sellbird.ui.check.js
// Validates UI integration for Sellbird in Social-Nexus:
// 1. All script tags in public/index.html resolve to existing valid JS files with 0 syntax errors.
// 2. All DOM element IDs referenced in public/js/12-sellbird.js exist in public/index.html.
// 3. All global action handlers exist and are callable.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const htmlPath = path.join(rootDir, 'public', 'index.html');
const jsPath = path.join(rootDir, 'public', 'js', '12-sellbird.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

const results = {
  scripts: { passed: 0, failed: 0, details: [] },
  domIds: { passed: 0, failed: 0, details: [] },
  handlers: { passed: 0, failed: 0, details: [] },
};

console.log('--- 1. Validating Scripts in public/index.html ---');
const scriptRegex = /<script[^>]+src=["']([^"']+)["']/g;
let sMatch;
const scriptSources = [];
while ((sMatch = scriptRegex.exec(html)) !== null) {
  scriptSources.push(sMatch[1]);
}

for (const src of scriptSources) {
  let absPath;
  if (src === '/vendor/chart.umd.js') {
    absPath = path.join(rootDir, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
  } else {
    const cleanPath = src.replace(/^\//, '');
    absPath = path.join(rootDir, 'public', cleanPath);
  }
  if (!fs.existsSync(absPath)) {
    results.scripts.failed++;
    results.scripts.details.push(`MISSING: ${src} (resolved to ${absPath})`);
  } else {
    try {
      const code = fs.readFileSync(absPath, 'utf8');
      new vm.Script(code, { filename: absPath });
      results.scripts.passed++;
      results.scripts.details.push(`OK (valid syntax): ${src}`);
    } catch (syntaxErr) {
      results.scripts.failed++;
      results.scripts.details.push(`SYNTAX ERROR in ${src}: ${syntaxErr.message}`);
    }
  }
}

console.log(`Scripts checked: ${results.scripts.passed} passed, ${results.scripts.failed} failed.`);

console.log('\n--- 2. Validating DOM Element IDs Referenced in public/js/12-sellbird.js ---');
const idRegex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
const uniqueIds = new Set();
let match;
while ((match = idRegex.exec(js)) !== null) {
  uniqueIds.add(match[1]);
}

const dynamicPrefixes = [
  'outbox-item-',
  'outbox-chk-',
  'outbox-body-',
  'outbox-subj-',
  'reply-card-',
  'reply-text-',
];

for (const id of uniqueIds) {
  if (dynamicPrefixes.some((p) => id.startsWith(p))) {
    continue;
  }
  const inHtml = html.includes(`id="${id}"`) || html.includes(`id='${id}'`);
  if (!inHtml) {
    results.domIds.failed++;
    results.domIds.details.push(`Missing DOM ID: ${id}`);
  } else {
    results.domIds.passed++;
    results.domIds.details.push(`Found DOM ID: ${id}`);
  }
}

console.log(`DOM IDs checked: ${results.domIds.passed} passed, ${results.domIds.failed} failed.`);

console.log('\n--- 3. Validating Global Action Handlers ---');
const requiredHandlers = [
  'openSellbirdTab',
  'switchSellbirdTab',
  'loadSellbird',
  'renderSellbirdMetrics',
  'populateSellbirdCampaignDropdowns',
  'onSellbirdCampaignChange',
  'triggerSellbirdHeartbeat',
  'loadOutbox',
  'filterOutboxStatus',
  'onOutboxSearch',
  'toggleOutboxSelection',
  'toggleSelectAllOutbox',
  'batchApproveOutbox',
  'approveOutboxItem',
  'rejectOutboxItem',
  'editOutboxItem',
  'loadCompanies',
  'onExplorerSearch',
  'onExplorerStatusChange',
  'renderCompanies',
  'viewCompanyInOutbox',
  'openAddCompanyModal',
  'openBulkDiscoverModal',
  'closeSellbirdModals',
  'addProspectCompany',
  'submitBulkDiscover',
  'loadCampaigns',
  'renderCampaigns',
  'trainFromProductUrl',
  'createCampaign',
  'deleteCampaign',
  'loadReplies',
  'filterRepliesIntent',
  'renderReplies',
  'sendDraftedReply',
  'openSimulateReplyModal',
  'submitSimulateReply',
];

// Set up simulated browser environment
const domMock = {
  getElementById: (id) => ({
    value: 'test',
    innerHTML: '',
    textContent: '',
    style: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    checked: false,
    disabled: false,
  }),
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {} }),
};

const sandbox = {
  window: {},
  document: domMock,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  api: async () => ({}),
  toast: () => {},
  Number,
  String,
  Set,
  Array,
  Object,
  Math,
  encodeURIComponent,
};
sandbox.window = sandbox;

const context = vm.createContext(sandbox);
vm.runInContext(js, context);

for (const handler of requiredHandlers) {
  if (typeof sandbox[handler] === 'function') {
    results.handlers.passed++;
    results.handlers.details.push(`Declared & callable: ${handler}`);
  } else {
    results.handlers.failed++;
    results.handlers.details.push(`MISSING handler: ${handler}`);
  }
}

console.log(`Action Handlers checked: ${results.handlers.passed} passed, ${results.handlers.failed} failed.`);

if (results.scripts.failed > 0 || results.domIds.failed > 0 || results.handlers.failed > 0) {
  console.error('\nUI Validation FAILED:');
  console.error(results);
  process.exit(1);
} else {
  console.log('\nAll UI integration checks PASSED successfully!');
}
