const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto'); // ← Agregado para generar tokens seguros
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ============================================================
// === TU LÓGICA ORIGINAL (INTACTA: Cupones, Registro, Login) ===
// ============================================================
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

// ============================================================
// === NUEVO: VINCULACIÓN AUTOMÁTICA CON ALEXA (OAUTH2) ===
// ============================================================
const CLIENT_ID = 'santaboot-alexa-client';
const CLIENT_SECRET = process.env.ALEXA_CLIENT_SECRET || 'Sb00t_7xK9mP2vL4nQ8wR5yT1cF6hJ3dG0aE';
const authCodes = new Map(); // Almacén temporal de códigos

// 1. Alexa redirige aquí al usuario para loguearse en tu web
router.get('/authorize', (req, res) => {
  const { response_type, client_id, redirect_uri, state } = req.query;
  if (client_id !== CLIENT_ID || response_type !== 'code') {
    return res.status(400).send('Configuración inválida');
  }
  const code = crypto.randomBytes(16).toString('hex');
  authCodes.set(code, { redirect_uri, state, expires: Date.now() + 300000 });
  // Maneja SITE_URL con o sin https://
const normalizedUrl = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
res.redirect(`${normalizedUrl}/login.html?code=${code}&state=${state}`);
});

// 2. Tu frontend llama aquí tras login exitoso (callback)
router.get('/authorize/callback', async (req, res) => {
  const { code, state, userId } = req.query;
  const stored = authCodes.get(code);
  if (!stored || stored.expires < Date.now()) return res.status(400).send('Sesión expirada');

  if (userId) {
    await supabase.from('profiles').update({ alexa_linked: true }).eq('id', userId);
  }
  authCodes.delete(code);
  res.redirect(`${stored.redirect_uri}?code=${code}&state=${state}`);
});

// 3. Alexa intercambia el código por un Access Token persistente
router.post('/token', async (req, res) => {
  const { grant_type, code, client_id, client_secret, redirect_uri } = req.body;
  if (grant_type !== 'authorization_code' || client_id !== CLIENT_ID || client_secret !== CLIENT_SECRET) {
    return res.status(401).json({ error: 'invalid_client' });
  }
  const stored = authCodes.get(code);
  if (!stored || stored.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant' });
  }
  const access_token = crypto.randomBytes(24).toString('hex');
  const refresh_token = crypto.randomBytes(24).toString('hex');
  await supabase.from('alexa_tokens').upsert({ code, access_token, refresh_token, used: true }, { onConflict: 'code' });
  authCodes.delete(code);
  res.json({ access_token, token_type: 'Bearer', expires_in: 3600, refresh_token });
});

module.exports = router;