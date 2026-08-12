// Génère le QR code de l'accueil du site (et celui de l'admin en prime).
// Sortie : assets/qr-home.png + assets/qr-admin.png + assets/qr-home.svg + assets/qr-admin.svg
import QRCode from 'qrcode';
import { mkdir } from 'node:fs/promises';

await mkdir('assets', { recursive: true });

const HOME_URL  = 'https://xapicup.github.io/xapi-cup/';
const ADMIN_URL = 'https://xapicup.github.io/xapi-cup/admin.html';
const VIEWER_URL = 'https://xapicup.github.io/xapi-cup/viewer.html';

const opts = {
  errorCorrectionLevel: 'H',
  margin: 2,
  width: 600,
  color: {
    dark: '#0f5132',   // vert basque
    light: '#ffffff',
  },
};

await QRCode.toFile('assets/qr-home.png',    HOME_URL,    opts);
await QRCode.toFile('assets/qr-admin.png',   ADMIN_URL,   { ...opts, color: { dark: '#c1272d', light: '#ffffff' } });
await QRCode.toFile('assets/qr-viewer.png',  VIEWER_URL,  opts);

// SVG aussi (vectoriel, plus joli pour impression)
const svgOpts = { ...opts, type: 'svg' };
await QRCode.toFile('assets/qr-home.svg',    HOME_URL,    svgOpts);
await QRCode.toFile('assets/qr-admin.svg',   ADMIN_URL,   { ...svgOpts, color: { dark: '#c1272d', light: '#ffffff' } });
await QRCode.toFile('assets/qr-viewer.svg',  VIEWER_URL,  svgOpts);

console.log('✅ QR codes générés :');
console.log('  assets/qr-home.png    →', HOME_URL);
console.log('  assets/qr-admin.png   →', ADMIN_URL);
console.log('  assets/qr-viewer.png  →', VIEWER_URL);
console.log('  + versions SVG vectorielles');
