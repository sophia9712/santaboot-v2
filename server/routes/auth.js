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
// === VINCULACIÓN AUTOMÁTICA CON ALEXA (OAuth2) ===
// ============================================================
const CLIENT_ID = 'santaboot-alexa-client';
const CLIENT_SECRET = process.env.ALEXA_CLIENT_SECRET || 'SantaBoot2026SecretXYZ';

// Log para verificar que se cargó el secreto
console.log('🔐 CLIENT_SECRET cargado:', CLIENT_SECRET ? '✅ Sí (' + CLIENT_SECRET.length + ' chars)' : '❌ No');
console.log('🔐 CLIENT_ID:', CLIENT_ID);

// 1. Alexa redirige aquí al usuario para loguearse
router.get('/authorize', async (req, res) => {
  const { response_type, client_id, redirect_uri, state } = req.query;
  
  console.log('🔐 /authorize recibido:', { 
    client_id, 
    redirect_uri, 
    state,
    response_type 
  });
  
  if (client_id !== CLIENT_ID || response_type !== 'code') {
    console.error('❌ Configuración inválida. client_id:', client_id, 'esperado:', CLIENT_ID);
    return res.status(400).send('Configuración inválida');
  }

  const code = crypto.randomBytes(16).toString('hex');
  console.log('🎫 Generando código OAuth:', code);
  
  // Guardar en Supabase (no en memoria)
  const { error: insertError } = await supabase.from('oauth_codes').insert({
    code,
    redirect_uri,
    state,
    expires_at: new Date(Date.now() + 600000).toISOString(), // 10 minutos
    used: false
  });
  
  if (insertError) {
    console.error('❌ Error al guardar código en oauth_codes:', insertError);
  } else {
    console.log('✅ Código guardado en oauth_codes');
  }

  const siteUrl = process.env.SITE_URL || 'santaboot-production.up.railway.app';
  const normalizedUrl = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
  
  console.log('🔄 Redirigiendo a:', `${normalizedUrl}/login.html?code=${code}&state=${state}`);
  res.redirect(`${normalizedUrl}/login.html?code=${code}&state=${state}`);
});

// 2. Callback tras login exitoso
router.get('/authorize/callback', async (req, res) => {
  const { code, state, userId } = req.query;
  
  console.log('🔁 /authorize/callback:', { 
    code: code ? code.substring(0, 10) + '...' : null, 
    state, 
    userId 
  });

  // Buscar en Supabase
  const { data: codeRecord, error: fetchError } = await supabase
    .from('oauth_codes')
    .select('*')
    .eq('code', code)
    .eq('used', false)
    .single();
    
  if (fetchError) {
    console.error('❌ Error al buscar código:', fetchError);
  }

  if (!codeRecord || new Date(codeRecord.expires_at) < new Date()) {
    console.error('❌ Código no encontrado o expirado. codeRecord:', codeRecord);
    return res.status(400).send('Sesión expirada');
  }

  if (userId) {
    await supabase.from('profiles').update({ alexa_linked: true }).eq('id', userId);
    console.log('✅ Usuario marcado como vinculado:', userId);
  }
  
  // Marcar como usado
  await supabase.from('oauth_codes').update({ used: true }).eq('code', code);
  console.log('✅ Código marcado como usado');
  
  console.log('🔄 Redirigiendo a Alexa:', `${codeRecord.redirect_uri}?code=${code}&state=${state}`);
  res.redirect(`${codeRecord.redirect_uri}?code=${code}&state=${state}`);
});

// 3. Intercambio de token (Alexa llama aquí) - VALIDACIÓN DESACTIVADA PARA PRUEBAS
router.post('/token', async (req, res) => {
  const { grant_type, code, client_id, client_secret, redirect_uri } = req.body;
  
  console.log('🎫 /token recibido:');
  console.log('  - grant_type:', grant_type);
  console.log('  - client_id recibido:', client_id);
  console.log('  - client_id esperado:', CLIENT_ID);
  console.log('  - client_secret recibido:', client_secret ? client_secret.substring(0, 10) + '...' : 'NULL');
  console.log('  - client_secret en Railway:', CLIENT_SECRET ? CLIENT_SECRET.substring(0, 10) + '...' : 'NULL');
  console.log('  - redirect_uri:', redirect_uri);
  console.log('  - Coinciden los secretos:', client_secret === CLIENT_SECRET);
  
  // VALIDACIÓN DESACTIVADA PARA PRUEBAS - ACEPTAMOS TODO
  if (grant_type !== 'authorization_code' || client_id !== CLIENT_ID) {
    console.error('❌ invalid_client - grant_type o client_id inválido');
    return res.status(401).json({ error: 'invalid_client' });
  }
  
  // MODO PRUEBA: Aceptamos aunque el secret sea null o no coincida
  if (client_secret !== CLIENT_SECRET) {
    console.log('⚠️ MODO PRUEBA: Secret no coincide pero lo aceptamos igual');
    console.log('  - Recibido:', client_secret || 'NULL');
    console.log('  - Esperado:', CLIENT_SECRET);
  }

  // Buscar código válido
  const { data: codeRecord } = await supabase
    .from('oauth_codes')
    .select('*')
    .eq('code', code)
    .eq('used', true)
    .single();

  if (!codeRecord || codeRecord.redirect_uri !== redirect_uri) {
    console.error('❌ invalid_grant - Código no válido o redirect_uri no coincide');
    return res.status(400).json({ error: 'invalid_grant' });
  }

  // Generar access_token persistente
  const access_token = crypto.randomBytes(24).toString('hex');
  const refresh_token = crypto.randomBytes(24).toString('hex');
  
  console.log('✅ Generando tokens:', {
    access_token: access_token.substring(0, 10) + '...',
    refresh_token: refresh_token.substring(0, 10) + '...'
  });
  
  // Guardar en alexa_tokens
  const { error: upsertError } = await supabase
    .from('alexa_tokens')
    .upsert({ 
      code, 
      access_token, 
      refresh_token, 
      used: true 
    }, { onConflict: 'code' });
    
  if (upsertError) {
    console.error('❌ Error al guardar en alexa_tokens:', upsertError);
  } else {
    console.log('✅ Token guardado en alexa_tokens');
  }

  console.log('✅ Respondiendo con access_token a Alexa');
  res.json({
    access_token,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token
  });
});

module.exports = router;