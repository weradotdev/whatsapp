/**
 * WhatsApp Baileys service for Wera.
 * Exposes QR flow and send API keyed by session_id (e.g. project-1).
 *
 * GET /qr?session_id=project-1  -> JSON { qr?: string, connected?: boolean }
 * GET /status?session_id=project-1 -> JSON { connected: boolean }
 * POST /send -> body: { session_id, to, message }
 */

import express from 'express';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdir } from 'fs/promises';
const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(__dirname, 'auth_sessions');

const app = express();
app.use(express.json());

const sessions = new Map();

function getSessionId(req) {
  const id = req.query.session_id || req.body?.session_id;
  return id || 'default';
}

async function getOrCreateSocket(sessionId) {
  if (sessions.has(sessionId)) {
    const s = sessions.get(sessionId);
    if (s.socket) return s;
    sessions.delete(sessionId);
  }

  const authPath = join(AUTH_DIR, sessionId);
  await mkdir(authPath, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  const session = {
    socket,
    currentQr: null,
    connected: false,
  };
  sessions.set(sessionId, session);

  const baseUrl = (process.env.APP_URL || 'http://localhost:8000').replace(/\/$/, '');
  const callbackUrl = `${baseUrl}/api/whatsapp-callback`;
  const callbackToken = process.env.WHATSAPP_CALLBACK_TOKEN;

  async function notifyLaravel(payload) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (callbackToken) headers['X-Callback-Token'] = callbackToken;
      await fetch(callbackUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ session_id: sessionId, ...payload }),
      });
    } catch (err) {
      console.error('Callback error:', err.message);
    }
  }

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      session.currentQr = qr;
      session.connected = false;
      try {
        const dataUrl = await QRCode.toDataURL(qr);
        await notifyLaravel({ qr: dataUrl, connected: false });
      } catch (_) {
        await notifyLaravel({ qr: null, connected: false });
      }
    }
    if (connection === 'open') {
      session.connected = true;
      session.currentQr = null;
      await notifyLaravel({ qr: null, connected: true });
    }
    if (connection === 'close') {
      session.connected = false;
      await notifyLaravel({ qr: null, connected: false });
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.connectionReplaced) {
        sessions.delete(sessionId);
      }
    }
  });
  socket.ev.on('creds.update', saveCreds);

  const laravelUrl = baseUrl;
  socket.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type !== 'notify' || !laravelUrl) return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
      if (!text || typeof text !== 'string') continue;
      const trimmed = text.trim();
      if (!trimmed.toLowerCase().startsWith('wera')) continue;
      const from = msg.key.remoteJid;
      if (!from) continue;
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (callbackToken) headers['X-Callback-Token'] = callbackToken;
        const res = await fetch(`${laravelUrl.replace(/\/$/, '')}/api/whatsapp-incoming`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ session_id: sessionId, from, message: trimmed }),
        });
        const data = await res.json().catch(() => ({}));
        const reply = data.reply;
        if (reply) {
          await session.socket.sendMessage(from, { text: reply });
        }
      } catch (err) {
        console.error('Incoming message error:', err.message);
      }
    }
  });

  return session;
}

app.get('/qr', async (req, res) => {
  const sessionId = getSessionId(req);
  try {
    const session = await getOrCreateSocket(sessionId);
    if (session.connected) {
      return res.json({ connected: true });
    }
    if (session.currentQr) {
      const dataUrl = await QRCode.toDataURL(session.currentQr);
      return res.json({ qr: dataUrl, connected: false });
    }
    res.json({ qr: null, connected: false, message: 'Waiting for QR...' });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/qr/page', (req, res) => {
  const sessionId = getSessionId(req);
  res.set('Content-Type', 'text/html');
  res.send(`
<!DOCTYPE html>
<html>
<head><title>WhatsApp QR - ${sessionId}</title></head>
<body style="font-family:sans-serif;max-width:400px;margin:2rem auto;text-align:center">
  <h1>Scan QR with WhatsApp</h1>
  <p>Session: <code>${sessionId}</code></p>
  <div id="qr"></div>
  <p id="status">Loading...</p>
  <script>
    const sid = ${JSON.stringify(sessionId)};
    function poll() {
      fetch('/qr?session_id=' + encodeURIComponent(sid))
        .then(r => r.json())
        .then(d => {
          const qrEl = document.getElementById('qr');
          const statusEl = document.getElementById('status');
          if (d.connected) {
            qrEl.innerHTML = '';
            statusEl.textContent = 'Connected. You can close this page.';
            return;
          }
          if (d.qr) {
            qrEl.innerHTML = '<img src="' + d.qr + '" alt="QR" style="max-width:100%"/>';
            statusEl.textContent = 'Scan with your phone';
          } else {
            statusEl.textContent = d.message || 'Waiting for QR...';
          }
        });
    }
    poll();
    setInterval(poll, 4000);
  </script>
</body>
</html>`);
});

app.get('/status', async (req, res) => {
  const sessionId = getSessionId(req);
  const session = sessions.get(sessionId);
  res.json({ connected: !!session?.connected });
});

app.post('/send', async (req, res) => {
  const sessionId = getSessionId(req);
  const { to, message } = req.body || {};
  if (!to || !message) {
    return res.status(400).json({ error: 'Missing to or message' });
  }
  const session = sessions.get(sessionId);
  if (!session?.connected) {
    return res.status(503).json({ error: 'Session not connected', session_id: sessionId });
  }
  try {
    const jid = to.includes('@') ? to : to.replace(/\D/g, '') + '@s.whatsapp.net';
    await session.socket.sendMessage(jid, { text: message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`WhatsApp Baileys service listening on http://localhost:${PORT}`);
});
