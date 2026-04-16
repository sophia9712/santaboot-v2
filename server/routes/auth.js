const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ============================================================
// === TU LÓGICA ORIGINAL (VIP, Registro, Login) - INTACTA ===
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
// === VINCULACIÓN AUTOMÁTICA CON ALEXA (OAuth2) - CORREGIDO ===
// ============================================================
const CLIENT_ID = 'santaboot-alexa-client';
const CLIENT_SECRET = process.env.ALEXA_CLIENT_SECRET || 'Sb00t_7xK9mP2vL4nQ8wR5yT1cF6hJ3dG0aE';

// 1. Alexa redirige aquí al usuario para loguearse
router.get('/authorize', async (req, res) => {
  const { response_type, client_id, redirect_uri, state } = req.query;
  
  console.log('🔐 /authorize:', { client_id, redirect_uri, state });
  
  if (client_id !== CLIENT_ID || response_type !== 'code') {
    return res.status(400).send('Configuración inválida');
  }

  const code = crypto.randomBytes(16).toString('hex');
  
  // ✅ GUARDAR EN SUPABASE (no en memoria)
  await supabase.from('oauth_codes').insert({
    code,
    redirect_uri,
    state,
    expires_at: new Date(Date.now() + 300000).toISOString(), // 5 min
    used: false
  });

  const siteUrl = process.env.SITE_URL || 'santaboot-production.up.railway.app';
  const normalizedUrl = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
  
  console.log('🔄 Redirigiendo a login con code:', code);
  res.redirect(`${normalizedUrl}/login.html?code=${code}&state=${state}`);
});

// 2. Callback tras login exitoso
router.get('/authorize/callback', async (req, res) => {
  const { code, state, userId } = req.query;
  
  console.log('🔁 /authorize/callback:', { code, state, userId });

  // ✅ BUSCAR EN SUPABASE (no en Map)
  const {  codeRecord } = await supabase
    .from('oauth_codes')
    .select('*')
    .eq('code', code)
    .eq('used', false)
    .single();

  if (!codeRecord || new Date(codeRecord.expires_at) < new Date()) {
    console.error('❌ Código no encontrado o expirado');
    return res.status(400).send('Sesión expirada');
  }

  if (userId) {
    await supabase.from('profiles').update({ alexa_linked: true }).eq('id', userId);
  }
  
  // Marcar como usado
  await supabase.from('oauth_codes').update({ used: true }).eq('code', code);
  
  console.log('✅ Redirigiendo a Alexa con code:', code);
  res.redirect(`${codeRecord.redirect_uri}?code=${code}&state=${state}`);
});

// 3. Intercambio de token (Alexa llama aquí)
router.post('/token', async (req, res) => {
  const { grant_type, code, client_id, client_secret, redirect_uri } = req.body;
  
  console.log('🎫 /token:', { grant_type, client_id });
  
  if (grant_type !== 'authorization_code' || client_id !== CLIENT_ID || client_secret !== CLIENT_SECRET) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  // Buscar código válido
  const {  codeRecord } = await supabase
    .from('oauth_codes')
    .select('*')
    .eq('code', code)
    .eq('used', true) // Ya fue usado en el callback
    .single();

  if (!codeRecord || codeRecord.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  // Generar access_token persistente
  const access_token = crypto.randomBytes(24).toString('hex');
  const refresh_token = crypto.randomBytes(24).toString('hex');
  
  // Guardar en alexa_tokens
  await supabase
    .from('alexa_tokens')
    .upsert({ 
      code, 
      access_token, 
      refresh_token, 
      used: true 
    }, { onConflict: 'code' });

  console.log('✅ Token generado:', access_token.substring(0, 10) + '...');

  res.json({
    access_token,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token
  });
});

module.exports = router;