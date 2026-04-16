const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const wol = require('wake_on_lan'); // ⭐ NUEVO
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ============================================================
// === OBTENER USUARIO DESDE TOKEN ===
// ============================================================
async function getUserFromToken(accessToken) {
    const { data: tokenRecord } = await supabase
        .from('alexa_tokens')
        .select('code')
        .eq('access_token', accessToken)
        .single();
    if (!tokenRecord) return null;
    const { data: codeData } = await supabase
        .from('oauth_codes')
        .select('state')
        .eq('code', tokenRecord.code)
        .single();
    if (!codeData || !codeData.state) return null;
    try {
        const stateObj = JSON.parse(Buffer.from(codeData.state.split('.')[1], 'base64').toString());
        const userId = stateObj.userId;
        if (!userId) return null;
        const { data: profile } = await supabase
            .from('profiles')
            .select('id, email, plan, ip_address')
            .eq('id', userId)
            .single();
        return profile;
    } catch (e) {
        return null;
    }
}

// ============================================================
// === FUNCIÓN WOL CON IP DEL USUARIO ===
// ============================================================
function sendWakeOnLanToIP(mac, ip, callback) {
    if (!ip) {
        console.log('❌ No hay IP guardada para este usuario');
        return callback(new Error('No IP address'));
    }
    
    console.log(`📡 Enviando WOL a MAC ${mac} vía IP ${ip}`);
    
    // Intentar con puertos 9 y 7
    const ports = [9, 7];
    let attempts = 0;
    
    ports.forEach(port => {
        wol.wake(mac, { address: ip, port }, (err) => {
            attempts++;
            if (err) {
                console.log(`❌ Error WOL a ${ip}:${port} - ${err.message}`);
            } else {
                console.log(`✅ WOL enviado a ${ip}:${port}`);
            }
            if (attempts === ports.length && callback) callback();
        });
    });
}

// ============================================================
// === ENDPOINT PRINCIPAL ===
// ============================================================
router.post('/wake', async (req, res) => {
    try {
        const intent = req.body.request?.intent?.name;
        const slots = req.body.request?.intent?.slots || {};
        const deviceName = slots.DeviceName?.value;
        const accessToken = req.headers.authorization?.replace('Bearer ', '');
        
        console.log(`📢 Intent: ${intent}, DeviceName: ${deviceName}`);

        if (!accessToken) {
            return res.json({
                response: {
                    outputSpeech: { type: 'SSML', ssml: '<speak>Por favor, vincula tu cuenta en la app de Alexa.</speak>' }
                }
            });
        }

        const user = await getUserFromToken(accessToken);
        if (!user) {
            return res.json({
                response: {
                    outputSpeech: { type: 'SSML', ssml: '<speak>No reconocí tu cuenta. Vincúlala nuevamente.</speak>' }
                }
            });
        }

        const userId = user.id;

        // ============================================================
        // === LISTAR PCS ===
        // ============================================================
        if (intent === 'ListDevicesIntent') {
            const { data: devices } = await supabase
                .from('devices')
                .select('name')
                .eq('user_id', userId);

            if (!devices || devices.length === 0) {
                return res.json({
                    response: {
                        outputSpeech: { type: 'SSML', ssml: '<speak>No tienes PCs registrados. Agrega uno en el dashboard.</speak>' }
                    }
                });
            }

            const nombres = devices.map(d => d.name).join(', ');
            const mensaje = devices.length === 1 
                ? `Tienes un PC registrado: ${nombres}.`
                : `Tienes ${devices.length} PCs registrados: ${nombres}.`;

            return res.json({
                response: {
                    outputSpeech: { type: 'SSML', ssml: `<speak>${mensaje}</speak>` }
                }
            });
        }

        // ============================================================
        // === AYUDA ===
        // ============================================================
        if (intent === 'AMAZON.HelpIntent') {
            return res.json({
                response: {
                    outputSpeech: {
                        type: 'PlainText',
                        text: 'Bienvenido a SantaBoot. Di "enciende" y el nombre de tu PC para encenderlo. Por ejemplo: "enciende mi PC gamer". También puedes preguntar "qué PCs tengo" para ver tus dispositivos.'
                    },
                    shouldEndSession: false
                }
            });
        }

        // ============================================================
        // === ENCENDER PC (WakeDeviceIntent) ===
        // ============================================================
        if (intent === 'WakeDeviceIntent') {
            const { data: device } = await supabase
                .from('devices')
                .select('*')
                .eq('user_id', userId)
                .ilike('name', deviceName?.trim())
                .single();

            if (!device) {
                return res.json({
                    response: {
                        outputSpeech: { type: 'SSML', ssml: `<speak>No encontré "${deviceName}" en tus PCs registrados.</speak>` }
                    }
                });
            }

            // ⭐ NUEVO: Enviar WOL usando la IP guardada del usuario
            sendWakeOnLanToIP(device.mac_address, user.ip_address, () => {
                console.log(`✅ Proceso WOL completado para ${device.name}`);
            });

            return res.json({
                response: {
                    outputSpeech: { type: 'SSML', ssml: `<speak>✅ Señal enviada a ${device.name}. Tu PC debería encenderse en unos segundos.</speak>` }
                }
            });
        }

        // ============================================================
        // === RESPUESTA POR DEFECTO ===
        // ============================================================
        return res.json({
            response: {
                outputSpeech: {
                    type: 'PlainText',
                    text: 'No entendí ese comando. Di "enciende" y el nombre de tu PC, o "ayuda" para más opciones.'
                },
                shouldEndSession: false
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        return res.json({
            response: {
                outputSpeech: { type: 'SSML', ssml: '<speak>Ocurrió un error al procesar tu solicitud.</speak>' }
            }
        });
    }
});

router.get('/wake', (req, res) => {
    res.json({ message: 'SantaBoot API running. Usa POST para comandos.' });
});

module.exports = router;