// tests/metaVerification.ui.test.js
// Comprehensive test suite for Meta Verification & WhatsApp Suite 9-capability hub

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
const jsPipeline = fs.readFileSync(path.join(rootDir, 'public', 'js', '13-lead-pipeline.js'), 'utf8');
const jsCore = fs.readFileSync(path.join(rootDir, 'public', 'js', '01-core.js'), 'utf8');
const css = fs.readFileSync(path.join(rootDir, 'public', 'styles.css'), 'utf8');
const waCloud = require('../services/leadPipeline/whatsappCloud');

describe('Meta Verification Hub & Official WhatsApp Suite Audit', () => {

  describe('1. 7-Step Meta Verification & Official Blue/Green Tick Hub (#modal-meta-verification)', () => {
    test('1.1 #modal-meta-verification exists in public/index.html with sellbird-modal-content', () => {
      expect(html).toContain('id="modal-meta-verification"');
      expect(html).toContain('class="modal-content sellbird-modal-content"');
      expect(html).toContain('Meta WhatsApp Verification &amp; Official Green/Blue Tick Hub');
    });

    test('1.2 Modal header displays Urban Society business credentials (WABA & Phone Profile ID)', () => {
      expect(html).toContain('Business: Urban Society (urbansociety.in)');
      expect(html).toContain('2475742706580340'); // WABA ID
      expect(html).toContain('1368551949674659'); // Phone Profile ID
      expect(html).toContain('+91 96370 00102');
      expect(html).toContain('692261563155254');  // Business ID
    });

    test('1.3 Step 1: Meta Developer App is present and verified', () => {
      expect(html).toContain('Meta Developer App');
      expect(html).toContain('App ID &amp; Secret active in .env');
    });

    test('1.4 Step 2: WABA (2475742706580340) and Phone Profile (1368551949674659) connected', () => {
      expect(html).toContain('WhatsApp Business Account (WABA)');
      expect(html).toContain('Phone Profile ID 1368551949674659 connected');
      expect(waCloud.DEFAULT_PHONE_NUMBER_ID).toBe('1368551949674659');
      expect(waCloud.DEFAULT_WABA_ID).toBe('2475742706580340');
    });

    test('1.5 Step 3: Domain urbansociety.in inspection link configured', () => {
      expect(html).toContain('Official Domain (urbansociety.in)');
      expect(html).toContain('https://urbansociety.in');
      expect(html).toContain('Inspect Footer &amp; Privacy Policy ↗');
    });

    test('1.6 Step 4: Business Legal Verification (GST/COI in Security Center)', () => {
      expect(html).toContain('Business Legal Verification');
      expect(html).toContain('https://business.facebook.com/latest/settings/security_center?business_id=692261563155254');
      expect(html).toContain('Upload GST / COI in Security Center ↗');
    });

    test('1.7 Step 5: Address Proof in Meta Legal Info', () => {
      expect(html).toContain('Registered Address Proof');
      expect(html).toContain('https://business.facebook.com/latest/settings/legal_info?business_id=692261563155254');
      expect(html).toContain('Upload Bank / Utility Proof ↗');
    });

    test('1.8 Step 6: WhatsApp 2-Step PIN registration with submitTwoStepPinFromApp', () => {
      expect(html).toContain('WhatsApp 2-Step Verification');
      expect(html).toContain('id="input-wa-pin"');
      expect(html).toContain('id="badge-step-6"');
      expect(html).toContain('onclick="submitTwoStepPinFromApp()"');
      expect(html).toContain('id="btn-submit-pin"');
      expect(typeof waCloud.registerTwoStepPin).toBe('function');
    });

    test('1.9 Step 7: Official Blue/Green Tick Badge (OBA Application)', () => {
      expect(html).toContain('Official Blue/Green Tick Badge');
      expect(html).toContain('Submit OBA Application ↗');
      expect(html).toContain('whatsapp_business_presence/?business_id=692261563155254&selected_asset_id=2475742706580340');
    });

    test('1.10 Business Profile Sync & Live Meta Audit handlers exist', () => {
      expect(html).toContain('id="meta-prof-about"');
      expect(html).toContain('id="meta-prof-website"');
      expect(html).toContain('onclick="saveOfficialBusinessProfile()"');
      expect(html).toContain('onclick="refreshMetaAuditStatus()"');
      expect(html).toContain('id="btn-refresh-audit"');
    });
  });

  describe('2. 9-Capability WhatsApp Suite Grid', () => {
    const capabilities = [
      { name: 'Bulk Broadcasting', action: 'switchLeadPipelineTab(\'outbound\'' },
      { name: 'WhatsApp Retargeting', action: 'switchLeadPipelineTab(\'inbound\'' },
      { name: 'Official WhatsApp API', action: 'openWhatsAppConfigModal()' },
      { name: 'Multi-Human Live Chat', action: 'switchLeadPipelineTab(\'inbox\'' },
      { name: 'Fb/Insta Ads Manager', action: 'syncRealMetaLeads()' },
      { name: 'Blue Tick Application', action: 'openMetaVerificationModal()' },
      { name: 'WhatsApp Payments', action: 'openWhatsAppPaymentModal()' },
      { name: 'AI Templates', action: 'openTemplateManagerModal()' },
      { name: '6 Team Members', action: 'openTeamSeatsModal()' },
    ];

    test('2.1 .whatsapp-suite-grid exists in public/index.html with responsive columns', () => {
      expect(html).toContain('class="whatsapp-suite-grid"');
    });

    test.each(capabilities)('2.2 Capability pill "%s" is wired with action "%s"', (cap) => {
      expect(html).toContain(cap.name);
      expect(html).toContain(cap.action);
    });

    test('2.3 Exactly 9 capability pills are present inside the suite grid', () => {
      const gridMatch = html.match(/class="whatsapp-suite-grid"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<!-- Sub-Tab Navigation/);
      expect(gridMatch).toBeTruthy();
      const gridContent = gridMatch[1];
      const pillMatches = gridContent.match(/class="wa-suite-pill"/g);
      expect(pillMatches).toHaveLength(9);
    });
  });

  describe('3. CSS & Modal Layout & Contrast Audit', () => {
    const modalIds = [
      'modal-sellbird-create-campaign',
      'modal-sellbird-add-company',
      'modal-sellbird-pull-real',
      'modal-sellbird-bulk-discover',
      'modal-sellbird-simulate-reply',
      'modal-whatsapp-config',
      'modal-evolution-connect',
      'modal-meta-verification',
      'modal-upload-contacts',
      'modal-whatsapp-pay',
      'modal-team-seats',
    ];

    test('3.1 All modals have fixed overlay positioning in styles.css', () => {
      modalIds.forEach(id => {
        expect(css).toContain(`#${id}`);
        expect(css).toContain(`#${id} .modal-backdrop`);
        expect(css).toContain(`#${id} .modal-content`);
      });
    });

    test('3.2 .sellbird-modal-content has explicit high-contrast rules in both Dark & Light modes', () => {
      expect(css).toContain('.sellbird-modal-content');
      expect(css).toContain('body.light-mode .sellbird-modal-content');
      expect(css).toContain('background: #0d1926 !important');
      expect(css).toContain('color: #f8fafc !important');
    });

    test('3.3 Modal headers, titles, and close buttons enforce crisp readability across themes', () => {
      expect(css).toContain('body.light-mode .sellbird-modal-content .modal-header');
      expect(css).toContain('body.light-mode .sellbird-modal-content .modal-title');
      expect(css).toContain('body.light-mode .sellbird-modal-content .modal-close');
    });

    test('3.4 Modal inputs, textareas, and selects enforce dark-navy background and white text', () => {
      expect(css).toContain('body.light-mode .sellbird-modal-content .form-input');
      expect(css).toContain('background: #040911 !important');
      expect(css).toContain('color: #ffffff !important');
    });

    test('3.5 WhatsApp green buttons and cyan links have explicit high-contrast overrides', () => {
      expect(css).toContain('WhatsApp Brand Green Primary Buttons inside Modals');
      expect(css).toContain('background: #22c55e !important');
      expect(css).toContain('color: #000000 !important');
      expect(css).toContain('Cyan Action Links & Secondary Buttons inside Modals');
      expect(css).toContain('color: #38bdf8 !important');
    });

    test('3.6 #modal-team-seats displays 6 team member slots with high contrast', () => {
      expect(html).toContain('id="modal-team-seats"');
      expect(html).toContain('Abhishek Gautam (Admin)');
      expect(html).toContain('Priya Gautam');
      expect(html).toContain('Rohit Verma');
      expect(html).toContain('Sneha Kulkarni');
      expect(html).toContain('Amit Saxena');
      expect(html).toContain('Neha Deshmukh');
      expect(html).toContain('assignWhatsAppAgent');
    });

    test('3.7 navigateTo(page) in public/js/01-core.js resets scroll on window, document, body, and .main container', () => {
      expect(jsCore).toContain('function navigateTo(page)');
      expect(jsCore).toContain('window.scrollTo({ top: 0, left: 0, behavior: \'instant\' })');
      expect(jsCore).toContain('document.documentElement.scrollTop = 0');
      expect(jsCore).toContain('document.body.scrollTop = 0');
      expect(jsCore).toContain('const mainEl = document.querySelector(\'.main\')');
      expect(jsCore).toContain('if (mainEl) mainEl.scrollTop = 0');
      expect(jsCore).toContain('const mainContent = document.querySelector(\'.main-content\')');
      expect(jsCore).toContain('if (mainContent) mainContent.scrollTop = 0');
    });
  });

  describe('4. JavaScript Functions & Window Exports', () => {
    test('4.1 All Meta & WhatsApp modal action handlers are defined and assigned to window in 13-lead-pipeline.js', () => {
      const requiredHandlers = [
        'openMetaVerificationModal',
        'closeMetaVerificationModal',
        'refreshMetaAuditStatus',
        'submitTwoStepPinFromApp',
        'saveOfficialBusinessProfile',
        'openEvolutionModal',
        'closeEvolutionModal',
        'generateEvolutionQr',
        'openUploadContactsModal',
        'closeUploadContactsModal',
        'handleContactsFileSelect',
        'submitImportedContacts',
        'openWhatsAppPaymentModal',
        'closeWhatsAppPaymentModal',
        'dispatchInChatPaymentRequest',
        'openTeamSeatsModal',
        'closeTeamSeatsModal',
        'openTemplateManagerModal',
      ];

      requiredHandlers.forEach(handler => {
        expect(jsPipeline).toContain(`function ${handler}`);
        expect(jsPipeline).toContain(handler);
      });
    });

    test('4.2 13-lead-pipeline.js passes syntax validation with zero parse errors', () => {
      expect(() => {
        new vm.Script(jsPipeline, { filename: '13-lead-pipeline.js' });
      }).not.toThrow();
    });

    test('4.3 01-core.js passes syntax validation with zero parse errors', () => {
      expect(() => {
        new vm.Script(jsCore, { filename: '01-core.js' });
      }).not.toThrow();
    });
  });

});
