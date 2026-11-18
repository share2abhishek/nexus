// The website chat widget must keep working on host pages that fight it: focus-trapping modals,
// inert / aria-hidden pop-ups, pointer-events:none on <body>, page keyboard shortcuts, phone keyboards.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'webchat-widget.js'), 'utf8');

describe('webchat widget guards against the host page', () => {
  test('is valid JavaScript', () => { expect(() => new Function(src)).not.toThrow(); });
  test('focus and key events inside the chat never reach the page (capture on window)', () => {
    expect(src).toMatch(/\['focus', 'focusin', 'blur', 'focusout', 'keydown', 'keyup', 'keypress'\]/);
    expect(src).toMatch(/stopImmediatePropagation/);
  });
  test('removes inert / aria-hidden that a pop-up puts on the chat', () => {
    expect(src).toMatch(/MutationObserver/);
    expect(src).toMatch(/attributeFilter: \['inert', 'aria-hidden'\]/);
  });
  test('page styles cannot switch the chat off', () => {
    expect(src).toMatch(/\.snc-btn,\.snc-panel,\.snc-panel \*\{pointer-events:auto!important\}/);
    expect(src).toMatch(/user-select:text!important/);
  });
  test('refocuses the box once if focus is stolen, and fits above the phone keyboard', () => {
    expect(src).toMatch(/addEventListener\('pointerdown'/);
    expect(src).toMatch(/visualViewport/);
  });
});
