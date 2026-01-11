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
app.use(express.json({ limit: '50mb' }));

let sock;
// VARIABLE GLOBAL PARA EL ESTADO (Para PythonAnywhere)
let botStatus = { state: "INICIANDO", qr: null };

const PORT = process.env.PORT || 3000;

// --- LIMPIEZA DE EMERGENCIA AL INICIAR ---
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

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['ColmadoBot', 'Chrome', '1.0'],
    connectTimeoutMs: 60000,
    generateHighQualityLinkPreview: true,
  });

  sock.ev.on('creds.update', saveCreds);

  // --- CONTROL DE CONEXIÓN ---
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
        botStatus.state = "ESPERANDO_QR";
        botStatus.qr = qr; 
        console.log('\n👇 ESCANEA ESTE CÓDIGO QR 👇');
        qrcode.generate(qr, { small: true });
        
        console.log('\n⚠️ Link para ver QR en navegador:');
        console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
    }

    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const statusCode = err?.output?.statusCode;
      const shouldReconnect = (err instanceof Boom) && statusCode !== DisconnectReason.loggedOut;

      botStatus.state = "DESCONECTADO";
      botStatus.qr = null;
      console.error('❌ Conexión cerrada. Razón:', err?.message || err);

      if (shouldReconnect) {
          console.log('🔄 Reintentando conectar automáticamente...');
          startWhatsApp();
      } else {
          console.log('⛔ Sesión cerrada. Reiniciando proceso...');
          startWhatsApp();
      }
    }

    if (connection === 'open') {
        botStatus.state = "CONECTADO";
        botStatus.qr = null;
        console.log('\n✅ ¡BOT CONECTADO Y LISTO PARA VENDER! 🚀\n');
    }
  });

  // --- PROCESAMIENTO DE MENSAJES ---
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;
      const fromClean = remoteJid.replace('@s.whatsapp.net', '').split(':')[0];

      let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      let audioBase64 = null;
      let type = 'text'; 
      let locationData = null;

      if (msg.message.locationMessage) {
          type = 'location';
          locationData = {
              degreesLatitude: msg.message.locationMessage.degreesLatitude,
              degreesLongitude: msg.message.locationMessage.degreesLongitude
          };
      }
      else if (msg.message.audioMessage) {
          type = 'audio';
          try {
              const buffer = await downloadMediaMessage(
                  msg,
                  'buffer',
                  {},
                  { logger: pino({ level: 'silent' }) }
              );
              audioBase64 = buffer.toString('base64');
              text = "[NOTA_DE_VOZ]";
          } catch (e) {
              console.error("⚠️ Error descargando audio:", e);
              return; 
          }
      }

      if (!text && !audioBase64 && !locationData) return; 

      console.log(`📩 Enviando a Python (${fromClean}) | Tipo: ${type}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); 

      try {
        const response = await fetch('https://MarioFeliz.pythonanywhere.com/webhook/whatsapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                from: fromClean, 
                text: text, 
                audio: audioBase64,
                type: type,
                location: locationData
            }),
            signal: controller.signal
        });

        const data = await response.json();

        if (data.reply) {
            await sock.sendMessage(remoteJid, { text: data.reply });
            console.log('✅ Respondido exitosamente.');
        }

      } catch (fetchError) {
          console.error('❌ Error conectando con Python:', fetchError.message);
      } finally {
          clearTimeout(timeoutId);
      }

    } catch (err) {
      console.error('❌ Error general procesando mensaje:', err);
    }
  });
}

// ==========================================
// 🌐 RUTAS DEL SERVIDOR WEB
// ==========================================

app.get('/', (req, res) => res.send('🤖 Bot de WhatsApp Activo - Sistema POS'));

// RUTA PARA QUE PYTHONANYWHERE CONSULTE EL ESTADO
app.get('/estado-bot', (req, res) => {
    let qrUrl = null;
    if (botStatus.qr) {
        qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(botStatus.qr)}`;
    }
    res.json({
        estado: botStatus.state,
        qr_link: qrUrl
    });
});

app.post('/enviar-mensaje', async (req, res) => {
    try {
        const { numero, texto } = req.body;
        if (!sock) return res.status(500).json({ error: 'Bot no conectado' });

        const jid = numero.includes('@s.whatsapp.net') ? numero : `${numero}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: texto });
        res.json({ status: 'ok', mensaje: 'Enviado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
  console.log('Servidor iniciado en puerto', PORT);
  startWhatsApp();
});
