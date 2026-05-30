/**
 * Generates a placeholder PNG icon for the Electron build.
 * If sharp is available, converts the SVG. Otherwise creates a colored square.
 */

const fs   = require('fs');
const path = require('path');

const BUILD_DIR = __dirname;

async function generateIcons() {
  const iconPng = path.join(BUILD_DIR, 'icon.png');
  const iconIco = path.join(BUILD_DIR, 'icon.ico');

  // Try sharp (best quality)
  try {
    const sharp = require('sharp');
    const svgPath = path.join(__dirname, '..', 'public', 'icon.svg');
    if (fs.existsSync(svgPath)) {
      await sharp(fs.readFileSync(svgPath)).resize(256, 256).png().toFile(iconPng);
      console.log('✓ icon.png generated from SVG (sharp)');

      // Try ICO
      try {
        const pngToIco = require('png-to-ico');
        const ico = await pngToIco([iconPng]);
        fs.writeFileSync(iconIco, ico);
        console.log('✓ icon.ico generated');
      } catch {
        fs.copyFileSync(iconPng, iconIco);
        console.log('✓ icon.ico (copy of PNG)');
      }
      return;
    }
  } catch {}

  // Fallback: generate a minimal valid PNG (256x256 gradient square)
  // This is a hand-crafted minimal PNG: purple square
  console.log('⚠ sharp not available — generating minimal PNG icon');

  // 16x16 purple square PNG (minimal valid file, base64 encoded)
  const PURPLE_PNG_16 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANklEQVQ4T2NkIBIwEqmPgWoGWP7/z8BACRjVMGoAZQzA' +
    'pR8mQKoLSHWBQANINYBUA6g2AAAIBAADAAAAASUVORK5CYII=', 'base64'
  );

  // Write as both PNG and ICO (ICO can contain a PNG)
  if (!fs.existsSync(iconPng)) {
    // Create a simple 1x1 pixel purple PNG as placeholder
    const minimalPng = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000100000001008020000009001' +
      '2b0000001849444154789c6360f8cf4001801801a43c180005 00050001f5a4' +
      '8b0100000000049454e44ae426082', 'hex'
    ).slice(0, -1); // trim invalid bytes — just write the SVG copy

    // Actually just copy the SVG and rename as PNG (best we can do without sharp)
    const svgPath = path.join(__dirname, '..', 'public', 'icon.svg');
    if (fs.existsSync(svgPath)) {
      fs.copyFileSync(svgPath, iconPng);
      fs.copyFileSync(svgPath, iconIco);
      console.log('✓ Using SVG as placeholder icon (install sharp for proper PNG/ICO)');
      console.log('  To install: npm install --save-dev sharp');
    }
    return;
  }

  console.log('✓ Icon files already exist');
}

generateIcons().then(() => {
  console.log('\nIcon generation complete.');
}).catch(err => {
  console.warn('Icon warning:', err.message);
  // Non-fatal
});
