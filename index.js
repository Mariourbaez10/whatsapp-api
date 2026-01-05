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
let sock;

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
        console.log('\n👇 ESCANEA ESTE CÓDIGO QR 👇');
        qrcode.generate(qr, { small: true });
        
        console.log('\n⚠️ ¿EL CÓDIGO SE VE DEFORME? ⚠️');
        console.log('Copia y pega este link en tu navegador para ver el QR perfecto:');
        console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
        console.log('\n');
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

      const remoteJid = msg.key.remoteJid;
      const fromClean = remoteJid.replace('@s.whatsapp.net', '').split(':')[0];

      // VARIABLES PARA ENVIAR A PYTHON
      let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      let audioBase64 = null;
      let type = 'text'; // Por defecto es texto
      let locationData = null; // Para guardar latitud/longitud

      // 1. DETECTAR UBICACIÓN (GPS)
      if (msg.message.locationMessage) {
          type = 'location';
          locationData = {
              degreesLatitude: msg.message.locationMessage.degreesLatitude,
              degreesLongitude: msg.message.locationMessage.degreesLongitude
          };
          console.log(`📍 Ubicación recibida de ${fromClean}`);
      }
      // 2. DETECTAR AUDIO (NOTA DE VOZ)
      else if (msg.message.audioMessage) {
          type = 'audio';
          console.log(`🎤 Nota de voz recibida de ${fromClean}... Descargando.`);
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

      // Si no hay texto, ni audio, ni ubicación, ignoramos
      if (!text && !audioBase64 && !locationData) return; 

      console.log(`📩 Enviando a Python (${fromClean}) | Tipo: ${type}`);

      // ⏳ TIMEOUT DE 60 SEGUNDOS
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); 

      try {
        // ENVIAMOS A PYTHONANYWHERE CON LOS DATOS NUEVOS
        const response = await fetch('https://MarioFeliz.pythonanywhere.com/webhook/whatsapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                from: fromClean, 
                text: text, 
                audio: audioBase64,
                type: type,           // Enviamos el tipo (text, audio, location)
                location: locationData // Enviamos las coordenadas (si existen)
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

// --- SERVIDOR WEB SIMPLE ---
app.get('/', (req, res) => res.send('🤖 Bot de WhatsApp Activo - Sistema POS'));

app.listen(PORT, () => {
  console.log('Servidor iniciado en puerto', PORT);
  startWhatsApp();
});

app.post('/enviar-mensaje', async (req, res) => {
    try {
        const { numero, texto } = req.body;
        
        if (!sock) {
            return res.status(500).json({ error: 'Bot no conectado aún' });
        }

        const jid = numero.includes('@s.whatsapp.net') ? numero : `${numero}@s.whatsapp.net`;

        await sock.sendMessage(jid, { text: texto });
        console.log(`📤 Mensaje enviado a ${numero} desde el sistema.`);
        
        res.json({ status: 'ok', mensaje: 'Enviado' });

    } catch (error) {
        console.error('❌ Error enviando mensaje push:', error);
        res.status(500).json({ error: error.message });
    }
});
