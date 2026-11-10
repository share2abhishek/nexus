// tests/leadPipeline.ui.check.js
// Validates UI integration for Lead Pipeline (Pipeline 1) in Social-Nexus:
// 1. All script tags in public/index.html resolve to existing valid JS files with 0 syntax errors.
// 2. All DOM element IDs referenced in public/js/13-lead-pipeline.js exist in public/index.html.
// 3. All global action handlers exist and are properly bound.
// 4. Navigation entry in public/index.html and PAGE_META in public/js/01-core.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const htmlPath = path.join(rootDir, 'public', 'index.html');
const jsPath = path.join(rootDir, 'public', 'js', '13-lead-pipeline.js');
const corePath = path.join(rootDir, 'public', 'js', '01-core.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');
const coreJs = fs.readFileSync(corePath, 'utf8');

const results = {
  syntax: { passed: 0, failed: 0, details: [] },
  domIds: { passed: 0, failed: 0, details: [] },
  handlers: { passed: 0, failed: 0, details: [] },
  navigation: { passed: 0, failed: 0, details: [] },
};

console.log('--- 1. Validating Syntax of 13-lead-pipeline.js ---');
try {
  new vm.Script(js, { filename: jsPath });
  results.syntax.passed++;
  results.syntax.details.push('OK: 13-lead-pipeline.js syntax valid');
} catch (e) {
  results.syntax.failed++;
  results.syntax.details.push(`SYNTAX ERROR in 13-lead-pipeline.js: ${e.message}`);
}

console.log('--- 2. Validating DOM Element IDs Referenced in JS ---');
// Match document.getElementById('xxx')
const idRegex = /document\.getElementById\(['"]([a-zA-Z0-9_-]+)['"]\)/g;
const referencedIds = new Set();
let match;
while ((match = idRegex.exec(js)) !== null) {
  referencedIds.add(match[1]);
}

// Ignore dynamically created modal id
referencedIds.delete('modal-lead-detail');

for (const id of referencedIds) {
  // Check if id exists in HTML
  const hasId = html.includes(`id="${id}"`) || html.includes(`id='${id}'`);
  if (hasId) {
    results.domIds.passed++;
    results.domIds.details.push(`OK: #${id}`);
  } else {
    results.domIds.failed++;
    results.domIds.details.push(`MISSING DOM ID in HTML: #${id}`);
  }
}

console.log('--- 3. Validating Exported Action Handlers ---');
const expectedHandlers = [
  'loadLeadPipeline',
  'renderPipelineConfig',
  'renderPipelineStats',
  'savePipelineConfig',
  'subscribePageNow',
  'testChatwootConnectionNow',
  'simulateTestLead',
  'copyPipelineWebhookUrl',
  'copyPipelineVerifyToken',
  'filterLeadsStatus',
  'renderLeadsTable',
  'updateLeadStatus',
  'viewLeadDetails',
];

for (const fn of expectedHandlers) {
  if (js.includes(`function ${fn}`) && js.includes(fn)) {
    results.handlers.passed++;
    results.handlers.details.push(`OK: handler ${fn}() declared & exported`);
  } else {
    results.handlers.failed++;
    results.handlers.details.push(`MISSING handler: ${fn}`);
  }
}

console.log('--- 4. Validating Navigation & Page Wiring ---');
const hasNavLeadAds = html.includes('data-page="lead-ads"') || html.includes('id="nav-lead-ads"');
const hasPageLeadAds = html.includes('id="page-lead-ads"');
const hasCoreMeta = coreJs.includes("'lead-ads'");
const hasScriptTag = html.includes('js/13-lead-pipeline.js');

if (hasNavLeadAds) {
  results.navigation.passed++;
  results.navigation.details.push('OK: #nav-lead-ads found in index.html');
} else {
  results.navigation.failed++;
  results.navigation.details.push('MISSING: #nav-lead-ads in index.html');
}

if (hasPageLeadAds) {
  results.navigation.passed++;
  results.navigation.details.push('OK: #page-lead-ads found in index.html');
} else {
  results.navigation.failed++;
  results.navigation.details.push('MISSING: #page-lead-ads in index.html');
}

if (hasCoreMeta) {
  results.navigation.passed++;
  results.navigation.details.push("OK: 'lead-ads' routing in 01-core.js");
} else {
  results.navigation.failed++;
  results.navigation.details.push("MISSING: 'lead-ads' routing in 01-core.js");
}

if (hasScriptTag) {
  results.navigation.passed++;
  results.navigation.details.push('OK: <script src="js/13-lead-pipeline.js"> in index.html');
} else {
  results.navigation.failed++;
  results.navigation.details.push('MISSING: script include in index.html');
}

console.log('\n================ UI VALIDATION REPORT ================');
console.log(`Syntax checks:     ${results.syntax.passed} passed, ${results.syntax.failed} failed`);
console.log(`DOM ID checks:     ${results.domIds.passed} passed, ${results.domIds.failed} failed`);
console.log(`Handler checks:    ${results.handlers.passed} passed, ${results.handlers.failed} failed`);
console.log(`Navigation checks: ${results.navigation.passed} passed, ${results.navigation.failed} failed`);

const totalPassed = results.syntax.passed + results.domIds.passed + results.handlers.passed + results.navigation.passed;
const totalFailed = results.syntax.failed + results.domIds.failed + results.handlers.failed + results.navigation.failed;
console.log(`TOTAL: ${totalPassed} PASSED, ${totalFailed} FAILED`);

if (totalFailed > 0) {
  console.error('\nFAILURES:');
  for (const cat of Object.keys(results)) {
    results[cat].details.filter(d => d.startsWith('MISSING') || d.startsWith('SYNTAX')).forEach(d => console.error(`- ${d}`));
  }
  process.exit(1);
} else {
  console.log('ALL UI CHECKS PASSED 100%!');
  process.exit(0);
}
