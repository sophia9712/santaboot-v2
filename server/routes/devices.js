const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

router.post('/add', async (req, res) => {
  const { user_id, name, mac_address, ip_address } = req.body;
  const { data: profile } = await supabase.from('profiles').select('plan').eq('id', user_id).single();
  
  if (profile?.plan === 'free') {
    const { data: existing } = await supabase.from('devices').select('id').eq('user_id', user_id);
    if (existing && existing.length >= 1) return res.status(403).json({ error: 'Plan gratuito: solo 1 PC. Actualiza a Premium.' });
  }

  const { data, error } = await supabase.from('devices').insert([{ user_id, name, mac_address, ip_address }]);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'PC agregado correctamente', data });
});

router.get('/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { data, error } = await supabase.from('devices').select('*').eq('user_id', user_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:device_id', async (req, res) => {
  const { device_id } = req.params;
  const { error } = await supabase.from('devices').delete().eq('id', device_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'PC eliminado' });
});

module.exports = router;