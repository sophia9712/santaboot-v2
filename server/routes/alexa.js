const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const dgram = require('dgram');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function sendWakeOnLan(mac, broadcastIP = '255.255.255.255') {
  return new Promise((resolve, reject) => {
    try {
      const macBytes = mac.split(/[:\-]/).map(b => parseInt(b, 16));
      if (macBytes.length !== 6) throw new Error('MAC inválida');
      
      const packet = Buffer.alloc(102);
      for (let i = 0; i < 6; i++) packet[i] = 0xff;
      for (let i = 1; i <= 16; i++) {
        macBytes.forEach((b, j) => { packet[i * 6 + j] = b; });
      }

      const socket = dgram.createSocket('udp4');
      socket.once('error', reject);
      socket.once('listening', () => socket.setBroadcast(true));
      
      socket.send(packet, 0, packet.length, 9, broadcastIP, (err) => {
        socket.close();
        if (err) reject(err); 
        else resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

router.post('/wake', async (req, res) => {
  try {
    const deviceName = req.body.request?.intent?.slots?.DeviceName?.value;
    const accessToken = req.headers.authorization?.replace('Bearer ', '');

    if (!accessToken) {
      return res.json({
        response: {
          outputSpeech: { type: 'SSML', ssml: '<speak>Por favor, vincula tu cuenta en la app de Alexa.</speak>' }
        }
      });
    }

    const { data: tokenRecord } = await supabase
      .from('alexa_tokens')
      .select('user_id')
      .eq('access_token', accessToken)
      .single();

    if (!tokenRecord) {
      return res.json({
        response: {
          outputSpeech: { type: 'SSML', ssml: '<speak>No reconocí tu cuenta. Vincúlala nuevamente en la app de Alexa.</speak>' }
        }
      });
    }

    const { data: device } = await supabase
      .from('devices')
      .select('*')
      .eq('user_id', tokenRecord.user_id)
      .ilike('name', deviceName?.trim())
      .single();

    if (!device) {
      return res.json({
        response: {
          outputSpeech: { type: 'SSML', ssml: `<speak>No encontré "${deviceName}" en tus PCs registrados.</speak>` }
        }
      });
    }

    await sendWakeOnLan(device.mac_address, device.broadcast_ip || '255.255.255.255');

    return res.json({
      response: {
        outputSpeech: { type: 'SSML', ssml: `<speak>✅ Señal enviada a ${device.name}. Tu PC debería encenderse en unos segundos.</speak>` }
      }
    });
  } catch (error) {
    console.error('❌ Error Alexa:', error);
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