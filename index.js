global.fetch = fetch;

const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode-terminal'); // <--- LIBRERÍA NUEVA

const app = express();
app.use(express.json({ limit: '50mb' })); 

const PORT = process.env.PORT || 3000;

let sock;

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true, // <--- ESTO MUESTRA EL QR AUTOMÁTICAMENTE
    browser: ['ColmadoBot', 'Chrome', '1.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Si sale el QR, lo pintamos bonito
    if (qr) {
        console.log('\n📱 ESCANEA ESTE QR AHORA:\n');
        qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error instanceof Boom) &&
        lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Desconectado. Reintentando...', shouldReconnect);
      if (shouldReconnect) startWhatsApp();
    }

    if (connection === 'open') console.log('\n✅ WhatsApp CONECTADO CORRECTAMENTE\n');
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;
      const fromClean = remoteJid.replace('@s.whatsapp.net', '').split(':')[0];

      let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      let audioBase64 = null;

      const audioMsg = msg.message.audioMessage;
      
      if (audioMsg) {
        console.log("🎤 Nota de voz recibida de:", fromClean);
        try {
            const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                { logger: pino({ level: 'silent' }) }
            );
            audioBase64 = buffer.toString('base64');
            text = "[NOTA_DE_VOZ]";
        } catch (e) {
            console.error("Error descargando audio:", e);
            return;
        }
      }

      if (!text && !audioBase64) return;

      console.log('📩 Mensaje de:', fromClean, '| Texto:', text);

      // TIMEOUT DE 60 SEGUNDOS
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
              audio: audioBase64 
            }),
            signal: controller.signal
          }
        );

        const data = await response.json();

        if (data.reply) {
          await sock.sendMessage(remoteJid, { text: data.reply });
          console.log('✅ Respondido a:', fromClean);
        }

      } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
            console.error('⏳ Python tardó mucho (Timeout).');
        } else {
            console.error('❌ Error conexión Python:', fetchError.message);
        }
      } finally {
        clearTimeout(timeoutId);
      }

    } catch (err) {
      console.error('❌ Error general:', err);
    }
  });
}

app.get('/', (req, res) => res.send('WhatsApp API activa 🚀'));
app.listen(PORT, () => {
  console.log('Servidor iniciado en puerto', PORT);
  startWhatsApp();
});
