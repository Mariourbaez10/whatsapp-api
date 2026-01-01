// ==========================================
// 🚀 CONFIGURACIÓN INICIAL Y PARCHES
// ==========================================
global.fetch = fetch;
global.crypto = require('crypto'); // Arregla error de Railway

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
// Aumentamos el límite para que quepan los audios pesados
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// --- LIMPIEZA DE EMERGENCIA AL INICIAR ---
// Si la carpeta auth existe, la borramos para generar un QR nuevo y fresco
if (fs.existsSync('./auth')) {
    console.log('🧹 Limpiando sesión anterior para evitar conflictos...');
    fs.rmSync('./auth', { recursive: true, force: true });
}

// ==========================================
// 🤖 LÓGICA DE WHATSAPP
// ==========================================
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();

  console.log(`🔥 Iniciando Bot (Baileys v${version.join('.')})`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false, // Usaremos qrcode-terminal
    browser: ['ColmadoBot', 'Chrome', '1.0'],
    connectTimeoutMs: 60000,
    generateHighQualityLinkPreview: true,
  });

  sock.ev.on('creds.update', saveCreds);

  // --- CONTROL DE CONEXIÓN ---
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
        console.log('\n👇 ESCANEA ESTE CÓDIGO QR RÁPIDO 👇\n');
        qrcode.generate(qr, { small: true });
        console.log('\nEsperando escaneo...\n');
    }

    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const statusCode = err?.output?.statusCode;
      const shouldReconnect = (err instanceof Boom) && statusCode !== DisconnectReason.loggedOut;

      console.error('❌ Conexión cerrada. Razón:', err?.message || err);

      if (shouldReconnect) {
          console.log('🔄 Reintentando conectar automáticamente...');
          startWhatsApp();
      } else {
          console.log('⛔ Sesión cerrada manualmente. Reiniciando proceso...');
          startWhatsApp();
      }
    }

    if (connection === 'open') {
        console.log('\n✅ ¡BOT CONECTADO Y LISTO PARA VENDER! 🚀\n');
    }
  });

  // --- PROCESAMIENTO DE MENSAJES ---
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid; // ID único del usuario (sirve para todos)
      const fromClean = remoteJid.replace('@s.whatsapp.net', '').split(':')[0]; // Número limpio

      let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      let audioBase64 = null;

      // 🎤 DETECTAR AUDIO (NOTA DE VOZ)
      if (msg.message.audioMessage) {
          console.log(`🎤 Nota de voz recibida de ${fromClean}... Descargando.`);
          try {
              const buffer = await downloadMediaMessage(
                  msg,
                  'buffer',
                  {},
                  { logger: pino({ level: 'silent' }) }
              );
              audioBase64 = buffer.toString('base64');
              text = "[NOTA_DE_VOZ]"; // Marcador para Python
          } catch (e) {
              console.error("⚠️ Error descargando audio:", e);
              return; 
          }
      }

      if (!text && !audioBase64) return; // Si no es texto ni audio, ignorar

      console.log(`📩 Enviando a Python (${fromClean}): ${text}`);

      // ⏳ TIMEOUT DE 60 SEGUNDOS (Para que Gemini tenga tiempo de pensar)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); 

      try {
        // ENVIAMOS A PYTHONANYWHERE
        const response = await fetch('https://MarioFeliz.pythonanywhere.com/webhook/whatsapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                from: fromClean, 
                text: text, 
                audio: audioBase64 // Enviamos el audio encriptado
            }),
            signal: controller.signal
        });

        const data = await response.json();

        // RESPONDEMOS AL CLIENTE
        if (data.reply) {
            await sock.sendMessage(remoteJid, { text: data.reply });
            console.log('✅ Respondido exitosamente.');
        }

      } catch (fetchError) {
          if (fetchError.name === 'AbortError') {
              console.error('⏳ Error: Python tardó demasiado (Timeout).');
          } else {
              console.error('❌ Error conectando con Python:', fetchError.message);
          }
      } finally {
          clearTimeout(timeoutId);
      }

    } catch (err) {
      console.error('❌ Error general procesando mensaje:', err);
    }
  });
}

// --- SERVIDOR WEB SIMPLE (Para que Railway no cierre el proceso) ---
app.get('/', (req, res) => res.send('🤖 Bot de WhatsApp Activo - Sistema POS'));

app.listen(PORT, () => {
  console.log('Servidor iniciado en puerto', PORT);
  startWhatsApp();
});
