const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const dgram = require('dgram');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function sendWakeOnLan(mac, broadcastIP) {
  return new Promise((resolve, reject) => {
    const macBytes = mac.split(':').map(b => parseInt(b, 16));
    const packet = Buffer.alloc(102);
    for (let i = 0; i < 6; i++) packet[i] = 0xff;
    for (let i = 1; i <= 16; i++) {
      macBytes.forEach((b, j) => {
        packet[i * 6 + j] = b;
      });
    }
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.once('listening', () => socket.setBroadcast(true));
    socket.send(packet, 0, packet.length, 9, broadcastIP, (err) => {
      socket.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

router.post('/wake', async (req, res) => {
  console.log('📡 Petición recibida:', req.body);
  
  const { alexa_user_id, device_name } = req.body;
  
  if (!alexa_user_id) {
    return res.status(400).json({ error: 'Falta el ID de usuario' });
  }
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('alexa_user_id', alexa_user_id)
    .single();
    
  if (!profile) {
    return res.status(404).json({ error: 'Usuario no vinculado' });
  }
  
  const { data: devices } = await supabase
    .from('devices')
    .select('*')
    .eq('user_id', profile.id);
    
  if (!devices || devices.length === 0) {
    return res.status(404).json({ error: 'PC no encontrado' });
  }
  
  const device = devices[0];
  
  try {
    await sendWakeOnLan(device.mac_address, device.broadcast_ip || '255.255.255.255');
    res.json({ message: 'Señal enviada a ' + device.name + ' correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al enviar la señal: ' + err.message });
  }
});

module.exports = router;