const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const VIP_CODES = {
  'SANTACRUZVIP': { days: 3650, description: 'Premium de por vida (~10 años)' },
  'FAMILIA7': { days: 7, description: 'Premium por 7 días' },
  'AMIGO30': { days: 30, description: 'Premium por 30 días' },
  'TESTER90': { days: 90, description: 'Premium por 90 días' },
  'PROMO1MES': { days: 30, description: 'Premium por 1 mes' },
  'BIENVENIDA7': { days: 7, description: 'Prueba premium 7 días' }
};

function getExpirationDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

router.post('/register', async (req, res) => {
  const { email, password, vipCode } = req.body;
  const upperCode = vipCode ? vipCode.toUpperCase() : null;
  const vipConfig = VIP_CODES[upperCode];
  let plan = 'free';
  let premiumUntil = null;
  let isVip = false;

  if (vipConfig) {
    plan = 'premium';
    premiumUntil = getExpirationDate(vipConfig.days);
    isVip = true;
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return res.status(400).json({ error: error.message });

  if (data.user) {
    const { error: profileError } = await supabase.from('profiles').insert([{
      id: data.user.id, email, plan, is_vip: isVip, premium_until: premiumUntil
    }]);
    if (profileError) console.error('Error al crear perfil:', profileError);
  }

  res.json({ message: vipConfig ? `✅ ${vipConfig.description}` : 'Registro exitoso', user: data.user });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ token: data.session.access_token, user: data.user });
});

router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Token inválido' });

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  let currentPlan = profile?.plan || 'free';
  let premiumUntil = profile?.premium_until || null;

  if (premiumUntil && new Date(premiumUntil) < new Date()) {
    currentPlan = 'free';
    await supabase.from('profiles').update({ plan: 'free', is_vip: false }).eq('id', user.id);
  }

  res.json({ id: user.id, email: user.email, plan: currentPlan, is_vip: profile?.is_vip || false, premium_until: premiumUntil });
});

router.post('/upgrade-to-premium', async (req, res) => {
  const { user_id } = req.body;
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user || user.id !== user_id) return res.status(401).json({ error: 'No autorizado' });
  await supabase.from('profiles').update({ plan: 'premium' }).eq('id', user_id);
  res.json({ message: 'Usuario actualizado a premium' });
});

module.exports = router;