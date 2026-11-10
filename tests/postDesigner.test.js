// Post designer (public/js/15-post-designer.js): pure helpers and wiring in Create post.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '15-post-designer.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Run the browser script with just enough globals to read its helpers
const ctx = { window: {}, document: { getElementById: () => null }, localStorage: { getItem: () => null, setItem() {} }, console };
vm.createContext(ctx);
vm.runInContext(`${src}\nthis.__t = { inkFor, hexToRgb, luminance, DESIGN_SIZES, DESIGN_TEMPLATES };`, ctx);
const t = ctx.__t;

describe('post designer', () => {
  test('text colour stays readable: dark text on light colours, white on dark', () => {
    expect(t.inkFor('#ffffff')).toBe('#111827');
    expect(t.inkFor('#fde047')).toBe('#111827'); // yellow
    expect(t.inkFor('#0f2338')).toBe('#ffffff'); // navy
    expect(t.inkFor('#7c2d12')).toBe('#ffffff'); // brown
  });

  test('a bad colour value falls back instead of breaking the drawing', () => {
    expect(t.hexToRgb('not-a-colour')).toEqual([15, 35, 56]);
    expect(t.hexToRgb('#ff8800')).toEqual([255, 136, 0]);
  });

  test('sizes match what the platforms expect, and every template has sample text', () => {
    expect(t.DESIGN_SIZES.square).toMatchObject({ w: 1080, h: 1080 });
    expect(t.DESIGN_SIZES.story).toMatchObject({ w: 1080, h: 1920 });
    expect(t.DESIGN_SIZES.wide.w / t.DESIGN_SIZES.wide.h).toBeCloseTo(1.91, 1);
    for (const tpl of Object.values(t.DESIGN_TEMPLATES)) expect(tpl.sample.headline).toBeTruthy();
  });

  test('Create post has the "Design a picture" button and loads the designer', () => {
    expect(html).toContain('onclick="openPostDesigner()"');
    expect(html).toContain('<script src="js/15-post-designer.js"></script>');
  });
});
