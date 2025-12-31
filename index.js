global.fetch = fetch;

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

  // ✅ LÓGICA DE MENSAJES CORREGIDA
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      // 1. Guardamos el ID original exacto para responder sin errores
      const remoteJid = msg.key.remoteJid;

      // 2. Limpiamos el número solo para enviarlo a Python (Base de datos)
      const fromClean = remoteJid.replace('@s.whatsapp.net', '').split(':')[0];

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text;

      if (!text) return;

      console.log('📩 Mensaje de:', fromClean, '| Texto:', text);

      // 3. CONFIGURAR TIMEOUT (60 SEGUNDOS)
      // Esto evita que Railway corte la conexión si Gemini piensa mucho
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 segundos

      try {
        const response = await fetch(
          'https://MarioFeliz.pythonanywhere.com/webhook/whatsapp',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: fromClean, // Enviamos el numero limpio a Python
              text: text
            }),
            signal: controller.signal // Conectamos el Timeout
          }
        );

        const data = await response.json();

        if (data.reply) {
          // 4. RESPONDEMOS AL JID ORIGINAL (Más seguro para desconocidos)
          await sock.sendMessage(remoteJid, {
            text: data.reply
          });
          console.log('✅ Respondido a:', fromClean);
        }

      } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
          console.error('⏳ ERROR: Python tardó demasiado (Timeout 60s).');
        } else {
          console.error('❌ Error conexión Python:', fetchError.message);
        }
      } finally {
        clearTimeout(timeoutId); // Limpiamos el reloj
      }

    } catch (err) {
      console.error('❌ Error general en upsert:', err);
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
    // Reconstrucción simple para envíos manuales
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
