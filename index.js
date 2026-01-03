const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Variable global de conexión
let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    console.log('🔄 Iniciando conexión...');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Desactivado para evitar errores
        browser: ["Colmado Brainy", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            // 👇 AQUÍ ESTÁ EL CAMBIO: SOLO GENERA EL LINK
            console.log('\n⚠️ ESCANEA EL CÓDIGO AQUÍ (Copia y pega en tu navegador):');
            console.log(`👉 https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
            console.log('\n');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ ¡CONECTADO A WHATSAPP!');
        }
    });
}

connectToWhatsApp();

// --- API PARA ENVIAR MENSAJES ---
app.post('/enviar-mensaje', async (req, res) => {
    try {
        const { numero, texto } = req.body;

        if (!sock) {
            return res.status(500).json({ error: 'Bot no conectado aún' });
        }

        const jid = numero.includes('@s.whatsapp.net') ? numero : `${numero}@s.whatsapp.net`;

        await sock.sendMessage(jid, { text: texto });
        console.log(`📤 Enviado a ${numero}`);
        
        res.json({ status: 'ok', mensaje: 'Enviado' });

    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});
