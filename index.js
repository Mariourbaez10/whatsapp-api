const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const axios = require('axios'); // Necesario para hablar con Python

const app = express();
app.use(bodyParser.json());

// ==========================================
// 🔴 VARIABLE GLOBAL (SOLUCIÓN DEL ERROR)
// ==========================================
let sock; 

// CONFIGURACIÓN: URL DE TU PYTHON (Cerebro)
// Asegúrate que esta sea tu URL real de PythonAnywhere
const PYTHON_URL = 'https://MarioFeliz.pythonanywhere.com/webhook/whatsapp'; 

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    console.log('🔄 Iniciando conexión con WhatsApp...');

    // 🔴 ASIGNAMOS A LA VARIABLE GLOBAL (SIN 'const' NI 'let')
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n👇 ESCANEA ESTE CÓDIGO QR 👇');
            qrcode.generate(qr, { small: true });
            
            // Link de emergencia por si el QR sale deforme
            console.log('\n⚠️ SI EL QR SE VE MAL, COPIA ESTE LINK EN TU NAVEGADOR:');
            console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
            console.log('\n');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ ¡CONECTADO A WHATSAPP EXITOSAMENTE!');
        }
    });

    // ==========================================
    // 📩 ESCUCHAR MENSAJES Y MANDARLOS A PYTHON
    // ==========================================
    sock.ev.on('messages.upsert', async m => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && m.type === 'notify') {
                
                const remoto = msg.key.remoteJid;
                // Detectar si es texto o audio
                let texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
                let audio = null;

                // Si es Audio
                if (msg.message?.audioMessage) {
                    console.log("🎤 Audio recibido...");
                    // Aquí podrías implementar la descarga del audio si quisieras, 
                    // pero por ahora mandamos el objeto crudo o avisamos a Python.
                    // Para simplificar, asumimos que Python maneja texto o lógica de descarga futura.
                    // (Si necesitas descarga de audio avanzada en Node, avísame, 
                    // pero tu Python actual espera base64. Por ahora enviamos texto vacío para activar el flujo).
                    // NOTA: Para enviar audio real a Python se requiere más código de descarga aquí.
                    // Por ahora, dejemos que Python sepa que llegó algo.
                }

                console.log(`📩 Mensaje recibido de ${remoto}: ${texto}`);

                // ENVIAR A PYTHONANYWHERE (El Cerebro)
                if (texto || msg.message?.audioMessage) {
                    try {
                        // Descargar audio si es necesario (Lógica simplificada para texto)
                        // Si necesitas audio, la lógica de descarga iría aquí.
                        
                        const response = await axios.post(PYTHON_URL, {
                            from: remoto,
                            text: texto,
                            // audio: audio_base64 (Pendiente si usas audios desde Node)
                        });

                        const respuestaBot = response.data.reply;
                        
                        if (respuestaBot) {
                            await sock.sendMessage(remoto, { text: respuestaBot });
                            console.log(`🤖 Bot respondió: ${respuestaBot}`);
                        }

                    } catch (err) {
                        console.error('❌ Error conectando con Python:', err.message);
                    }
                }
            }
        } catch (e) {
            console.log("Error procesando mensaje:", e);
        }
    });
}

// Arrancar conexión
connectToWhatsApp();

// ==========================================
// 📤 API PARA QUE PYTHON ENVÍE MENSAJES (PUSH)
// ==========================================
app.post('/enviar-mensaje', async (req, res) => {
    try {
        const { numero, texto } = req.body;
        
        // Verificamos si sock existe y está conectado
        if (!sock) {
            console.log("❌ Intento de envío fallido: Bot desconectado.");
            return res.status(500).json({ error: 'Bot no conectado aún' });
        }

        // Formatear número (asegurar @s.whatsapp.net)
        const jid = numero.includes('@s.whatsapp.net') ? numero : `${numero}@s.whatsapp.net`;

        console.log(`📤 Intentando enviar a ${jid}: ${texto}`);
        await sock.sendMessage(jid, { text: texto });
        console.log(`✅ Mensaje enviado correctamente.`);
        
        res.json({ status: 'ok', mensaje: 'Enviado' });

    } catch (error) {
        console.error('❌ Error enviando mensaje push:', error);
        res.status(500).json({ error: error.message });
    }
});

// Mantener vivo el servidor web
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});
