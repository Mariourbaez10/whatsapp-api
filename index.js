global.fetch = fetch;

const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage // <--- IMPORTANTE: Nueva herramienta
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const express = require('express');
const pino = require('pino');

const app = express();
app.use(express.json({ limit: '50mb' })); // <--- Aumentamos límite para audios pesados

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

    if (qr) console.log('\n📱 ESCANEA ESTE QR:\n', qr);

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error instanceof Boom) &&
        lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startWhatsApp();
    }

    if (connection === 'open') console.log('\n✅ WhatsApp CONECTADO\n');
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;
      const fromClean = remoteJid.replace('@s.whatsapp.net', '').split(':')[0];

      // 1. DETECTAR TIPO DE MENSAJE
      let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      let audioBase64 = null;

      // Si es una nota de voz (audioMessage)
      const audioMsg = msg.message.audioMessage;
      
      if (audioMsg) {
        console.log("🎤 Nota de voz recibida de:", fromClean);
        try {
            // Descargar el audio
            const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                { logger: pino({ level: 'silent' }) }
            );
            // Convertir a base64 para enviar a Python
            audioBase64 = buffer.toString('base64');
            text = "[NOTA_DE_VOZ]"; // Texto marcador
        } catch (e) {
            console.error("Error descargando audio:", e);
            return;
        }
      }

      if (!text && !audioBase64) return;

      console.log('📩 Enviando a Python:', fromClean);

      // 2. TIMEOUT (60s porque el audio tarda más)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); 

      try {
        const response = await fetch(
          'https://MarioFeliz.pythonanywhere.com/webhook/whatsapp',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: fromClean,
              text: text,
              audio: audioBase64 // <--- Enviamos el audio aquí
            }),
            signal: controller.signal
          }
        );

        const data = await response.json();

        if (data.reply) {
          await sock.sendMessage(remoteJid, { text: data.reply });
          console.log('✅ Respondido.');
        }

      } catch (fetchError) {
        console.error('❌ Error conexión Python:', fetchError.message);
      } finally {
        clearTimeout(timeoutId);
      }

    } catch (err) {
      console.error('❌ Error general:', err);
    }
  });
}

app.get('/', (req, res) => res.send('WhatsApp Audio Ready 🎤'));
app.listen(PORT, () => {
  console.log('Servidor iniciado en puerto', PORT);
  startWhatsApp();
});
