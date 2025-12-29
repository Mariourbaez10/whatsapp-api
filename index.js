const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');

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
}

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('WhatsApp API activa 🚀');
});

// Enviar mensaje
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
