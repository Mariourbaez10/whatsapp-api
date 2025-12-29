const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { Boom } = require('@hapi/boom');
const express = require('express');
const pino = require('pino');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

let sock;

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['ColmadoBot', 'Chrome', '1.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 ESCANEA ESTE QR CON WHATSAPP:\n');
      console.log(qr);
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error instanceof Boom) &&
        lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;

      console.log('❌ Conexión cerrada. Reintentando...', shouldReconnect);
      if (shouldReconnect) startWhatsApp();
    }

    if (connection === 'open') {
      console.log('\n✅ WhatsApp CONECTADO CORRECTAMENTE\n');
    }
  });

  // ✅ AQUÍ ES DONDE VA ESTO
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid.replace('@s.whatsapp.net', '');
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text;

    if (!text) return;

    console.log('📩 Mensaje entrante:', from, text);

    try {
      const response = await fetch(
        'https://MarioFeliz.pythonanywhere.com/webhook/whatsapp',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: from,
            text: text
          })
        }
      );

      const data = await response.json();

      if (data.reply) {
        await sock.sendMessage(`${from}@s.whatsapp.net`, {
          text: data.reply
        });
      }
    } catch (err) {
      console.error('❌ Error enviando a Python:', err.message);
    }
  });
}

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('WhatsApp API activa 🚀');
});

// Enviar mensaje manual
app.post('/send', async (req, res) => {
  const { phone, message } = req.body;

  if (!sock) {
    return res.status(500).json({ error: 'WhatsApp no conectado' });
  }

  try {
    await sock.sendMessage(`${phone}@s.whatsapp.net`, { text: message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('Servidor iniciado en puerto', PORT);
  startWhatsApp();
});
