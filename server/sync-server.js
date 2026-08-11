// ================================================================
// Xapi Cup — Mini-serveur de synchronisation (optionnel)
// ================================================================
//
// Ce serveur permet à plusieurs machines du même réseau local
// (ex : 1 PC admin + 1 écran TV + 1 smartphone sur le site)
// de partager le même état de tournoi EN TEMPS RÉEL.
//
// Sans ce serveur, la synchro fonctionne DÉJÀ :
//   - Entre onglets du même navigateur (localStorage)
//
// Avec ce serveur, la synchro marche entre TOUTES les machines
// connectées en HTTP au serveur (typiquement le jour du tournoi).
//
// UTILISATION :
//   1. Sur un PC du tournoi : `npm run start-node` ou `node server/sync-server.js`
//   2. Sur les autres machines (TV, tablette, tel), ouvrir
//      http://IP-DU-PC:8765/  → la synchro démarre toute seule.
//
// Node 22+ requis (utilise les API WebSocket natives).
// ================================================================

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT || '8765', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

// ---------- HTTP : fichiers statiques ----------
const httpServer = createServer(async (req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = normalize(join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 — Not found: ' + urlPath);
  }
});

// ---------- WebSocket : broadcast des updates ----------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsClients = new Set();

function parseFrame(buf) {
  // Lit une frame texte WS (client → serveur : payload masqué)
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  if (opcode === 0x8) return { opcode: 'close' };
  if (opcode === 0x9) return { opcode: 'ping' };
  if (opcode === 0x1) {
    let payloadStart = 2;
    const len = buf[1] & 0x7f;
    let payloadLen = len;
    if (len === 126) {
      payloadLen = buf.readUInt16BE(2);
      payloadStart = 4;
    } else if (len === 127) {
      payloadLen = Number(buf.readBigUInt64BE(2));
      payloadStart = 10;
    }
    const masked = (buf[1] & 0x80) !== 0;
    if (masked) payloadStart += 4;
    const payload = buf.slice(payloadStart, payloadStart + payloadLen);
    if (masked) {
      const maskKey = buf.slice(payloadStart - 4, payloadStart);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4];
      }
    }
    return { opcode: 'text', payload: payload.toString('utf8') };
  }
  return null;
}

function makeTextFrame(text) {
  const data = Buffer.from(text, 'utf8');
  const len = data.length;
  let header;
  // SPEC WS : le serveur ne doit PAS masquer les frames sortantes.
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

httpServer.on('upgrade', (req, socket, head) => {
  if (req.headers['upgrade'] !== 'websocket') {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  const client = { socket, alive: true };
  wsClients.add(client);
  console.log(`[WS] +1 client (total: ${wsClients.size})`);

  socket.on('data', (buf) => {
    const frame = parseFrame(buf);
    if (!frame) return;
    if (frame.opcode === 'close') { socket.end(); return; }
    if (frame.opcode === 'ping') {
      socket.write(Buffer.from([0x8a, 0])); // pong
      return;
    }
    if (frame.opcode === 'text') {
      // Broadcast le payload DÉCODÉ (re-encodé proprement, non masqué)
      const out = makeTextFrame(frame.payload);
      for (const c of wsClients) {
        if (c.socket.writable) c.socket.write(out);
      }
    }
  });
  socket.on('close', () => { wsClients.delete(client); console.log(`[WS] -1 client (total: ${wsClients.size})`); });
  socket.on('error', () => wsClients.delete(client));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  const nets = networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  console.log(`\n⚽  Xapi Cup — serveur démarré !`);
  console.log(`   Local   :  http://localhost:${PORT}/`);
  ips.forEach((ip) => console.log(`   Réseau  :  http://${ip}:${PORT}/`));
  console.log(`\n   WebSocket de sync actif sur ws://*:${PORT}/`);
  console.log(`   Ctrl+C pour arrêter.\n`);
});
