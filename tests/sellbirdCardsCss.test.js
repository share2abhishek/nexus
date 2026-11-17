// The Outreach window is always white. Its cards must have light backgrounds and text that can be
// read on them (they were dark cards with dark text: labels and empty states were invisible).
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const start = css.indexOf('Sellbird cards in the light Outreach window');
const block = start >= 0 ? css.slice(start) : '';

const lum = (hex) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// The declarations of the rule that starts with this selector text (e.g. ".a .b {")
const rule = (selector) => {
  const at = block.indexOf(`${selector} {`);
  if (at < 0) return '';
  return block.slice(block.indexOf('{', at) + 1, block.indexOf('}', at));
};
const prop = (selector, name) => {
  const m = rule(selector).match(new RegExp(`(?:^|[;\\s])${name}:\\s*(#[0-9a-fA-F]{6})`));
  return m ? m[1] : undefined;
};

test('the override for the light window exists', () => {
  expect(block).toContain('.sellbird-window-shell .sellbird-card {');
});

test('cards are light, with text that passes 4.5:1 on the card and on its header', () => {
  const card = prop('.sellbird-window-shell .sellbird-card', 'background');
  const header = prop('.sellbird-window-shell .sellbird-card-header', 'background');
  expect(lum(card)).toBeGreaterThan(0.9);
  expect(lum(header)).toBeGreaterThan(0.9);
  const texts = [
    ['.sellbird-window-shell .sellbird-card-title', header],
    ['.sellbird-window-shell .sellbird-card-body', card],
    ['.sellbird-window-shell .sellbird-card .form-label', card],
    ['.sellbird-window-shell .sellbird-card .form-hint', card],
    ['.sellbird-window-shell .sellbird-card .empty-title', card],
    ['.sellbird-window-shell .sellbird-card .divider', card],
  ];
  for (const [selector, bg] of texts) {
    const color = prop(selector, 'color');
    expect({ selector, color, readable: !!color && contrast(color, bg) >= 4.5 }).toEqual({ selector, color, readable: true });
  }
});

test('the window’s text colours are set for a white page (the empty-state text uses these)', () => {
  const vars = rule('.sellbird-window-shell');
  for (const n of ['--text-primary', '--text-secondary', '--text-muted']) {
    const m = vars.match(new RegExp(`${n}:\\s*(#[0-9a-fA-F]{6})`));
    expect(m).not.toBeNull();
    expect(contrast(m[1], '#ffffff')).toBeGreaterThanOrEqual(4.5);
  }
});
