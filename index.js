// --- PARCHE DE COMPATIBILIDAD (CRUCIAL PARA RAILWAY) ---
global.fetch = fetch;
global.crypto = require('crypto'); // <--- ESTO ARREGLA EL ERROR "crypto not defined"
// -------------------------------------------------------

const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// --- LIMPIEZA DE EMERGENCIA ---
if (fs.existsSync('./auth')) {
    console.log('🗑️ Borrando sesión corrupta para generar nuevo QR...');
    fs.rmSync('./auth', { recursive: true, force: true });
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();

  console.log(`🤖 Iniciando Baileys v${version.join('.')}`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['ColmadoBot', 'Chrome', '1.0'],
    connectTimeoutMs: 60000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
        console.log('\n⚠️ ESCANEA ESTE CÓDIGO AHORA:\n');
        qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const statusCode = err?.output?.statusCode;
      const shouldReconnect = (err instanceof Boom) && statusCode !== DisconnectReason.loggedOut;

      console.error('❌ Desconectado. Razón:', err?.message || err);
      
      if (shouldReconnect) {
          console.log('🔄 Reintentando conexión...');
          startWhatsApp();
      } else {
          console.log('⛔ Sesión cerrada. Se reiniciará...');
          startWhatsApp(); // Forzamos reinicio incluso si se cierra
      }
    }

    if (connection === 'open') {
        console.log('\n✅ ¡CONECTADO Y LISTO! 🚀\n');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;
      const fromClean = remoteJid.replace('@s.whatsapp.net', '').split(':')[0];

      let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      let audioBase64 = null;

      // Detectar Audio (Nota de voz)
      if (msg.message.audioMessage) {
          try {
              const buffer = await downloadMediaMessage(
                  msg,
                  'buffer',
                  {}, 
                  { logger: pino({ level: 'silent' }) }
              );
              audioBase64 = buffer.toString('base64');
              text = "[NOTA_DE_VOZ]";
              console.log("🎤 Audio recibido de:", fromClean);
          } catch (e) {
              console.error("Error audio:", e);
          }
      }

      if (!text && !audioBase64) return;

      console.log('📩 Mensaje de:', fromClean);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); 

      try {
        const response = await fetch('https://MarioFeliz.pythonanywhere.com/webhook/whatsapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: fromClean, text: text, audio: audioBase64 }),
            signal: controller.signal
        });
        const data = await response.json();
        if (data.reply) {
            await sock.sendMessage(remoteJid, { text: data.reply });
            console.log('✅ Respondido.');
        }
      } catch (err) {
          console.error('❌ Error Python:', err.message);
      } finally {
          clearTimeout(timeoutId);
      }
    } catch (err) {
      console.error('❌ Error upsert:', err);
    }
  });
}

app.get('/', (req, res) => res.send('Bot Activo 🟢'));
app.listen(PORT, () => {
  console.log('Servidor iniciado en puerto', PORT);
  startWhatsApp();
});
