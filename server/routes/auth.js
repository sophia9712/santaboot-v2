const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ============================================================
// === RATE LIMITING (Protección contra ataques) ===
// ============================================================
const rateLimit = new Map();

function checkRateLimit(ip, limit = 10, windowMs = 60000) {
  const now = Date.now();
  const key = ip;
  
  if (!rateLimit.has(key)) {
    rateLimit.set(key, [now]);
    return true;
  }
  
  const requests = rateLimit.get(key).filter(time => now - time < windowMs);
  
  if (requests.length >= limit) {
    return false;
  }
  
  requests.push(now);
  rateLimit.set(key, requests);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of rateLimit.entries()) {
    const validTimes = times.filter(time => now - time < 60000);
    if (validTimes.length === 0) {
      rateLimit.delete(ip);
    } else {
      rateLimit.set(ip, validTimes);
    }
  }
}, 3600000);

// ============================================================
// === VIP CODES ===
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
// === OAUTH PARA ALEXA ===
// ============================================================
const CLIENT_ID = 'santaboot-alexa-client';
const CLIENT_SECRET = process.env.ALEXA_CLIENT_SECRET || 'SantaBoot2026SecretXYZ';

const ALLOWED_REDIRECT_URIS = [
  'https://layla.amazon.com/api/skill/link/M20X07RJHC3DO9',
  'https://alexa.amazon.com/api/skill/link/M20X07RJHC3DO9',
  'https://alexa.amazon.co.jp/api/skill/link/M20X07RJHC3DO9',
  'https://pitanqui.amazon.com/api/skill/link/M20X07RJHC3DO9'
];

console.log('🔐 CLIENT_SECRET cargado:', CLIENT_SECRET ? '✅ Sí (' + CLIENT_SECRET.length + ' chars)' : '❌ No');
console.log('🔐 CLIENT_ID:', CLIENT_ID);

// 1. Authorize
router.get('/authorize', async (req, res) => {
  const { response_type, client_id, redirect_uri, state } = req.query;
  
  console.log('🔐 /authorize recibido:', { client_id, redirect_uri });
  
  if (client_id !== CLIENT_ID || response_type !== 'code') {
    return res.status(400).send('Configuración inválida');
  }
  
  if (!ALLOWED_REDIRECT_URIS.includes(redirect_uri)) {
    console.error('❌ redirect_uri no permitido:', redirect_uri);
    return res.status(400).send('redirect_uri no permitido');
  }

  const code = crypto.randomBytes(16).toString('hex');
  console.log('🎫 Generando código OAuth:', code);
  
  const { error: insertError } = await supabase.from('oauth_codes').insert({
    code,
    redirect_uri,
    state,
    expires_at: new Date(Date.now() + 600000).toISOString(),
    used: false
  });
  
  if (insertError) {
    console.error('❌ Error al guardar código:', insertError);
    return res.status(500).send('Error interno');
  }

  const siteUrl = process.env.SITE_URL || 'santaboot-production.up.railway.app';
  const normalizedUrl = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
  
  res.redirect(`${normalizedUrl}/login.html?code=${code}&state=${state}`);
});

// 2. Callback
router.get('/authorize/callback', async (req, res) => {
  const { code, state, userId } = req.query;
  
  console.log('🔁 /authorize/callback:', { 
    code: code ? code.substring(0, 10) + '...' : null, 
    userId 
  });

  const { data: codeRecord, error: fetchError } = await supabase
    .from('oauth_codes')
    .select('*')
    .eq('code', code)
    .eq('used', false)
    .single();
    
  if (fetchError || !codeRecord || new Date(codeRecord.expires_at) < new Date()) {
    console.error('❌ Código no encontrado o expirado');
    return res.status(400).send('Sesión expirada');
  }

  if (userId) {
    await supabase.from('profiles').update({ alexa_linked: true }).eq('id', userId);
    console.log('✅ Usuario marcado como vinculado:', userId);
  }
  
  await supabase.from('oauth_codes').update({ used: true }).eq('code', code);
  console.log('✅ Código marcado como usado');
  
  res.redirect(`${codeRecord.redirect_uri}?code=${code}&state=${state}`);
});

// 3. Token endpoint - CON SOPORTE PARA REFRESH_TOKEN
router.post('/token', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  if (!checkRateLimit(clientIp)) {
    console.error(`❌ Rate limit excedido para IP: ${clientIp}`);
    return res.status(429).json({ error: 'too_many_requests' });
  }
  
  const { grant_type, code, client_id, client_secret, redirect_uri, refresh_token } = req.body;
  
  console.log('🎫 /token recibido:');
  console.log('  - grant_type:', grant_type);
  console.log('  - client_id:', client_id);
  console.log('  - client_secret:', client_secret ? '***' : 'NULL');
  console.log('  - IP:', clientIp);
  
  // Validación de client_id
  if (client_id !== CLIENT_ID) {
    console.error('❌ client_id inválido');
    return res.status(401).json({ error: 'invalid_client' });
  }
  
  // MODO PRUEBA: aceptamos cualquier secret
  if (client_secret !== CLIENT_SECRET) {
    console.log('⚠️ MODO PRUEBA: Secret no coincide pero lo aceptamos igual');
  }
  
  // ============================================================
  // === FLUJO: REFRESH_TOKEN ===
  // ============================================================
  if (grant_type === 'refresh_token') {
    console.log('🔄 Procesando refresh_token...');
    
    const { data: tokenRecord } = await supabase
      .from('alexa_tokens')
      .select('code')
      .eq('refresh_token', refresh_token)
      .single();
    
    if (!tokenRecord) {
      console.error('❌ Refresh token inválido');
      return res.status(400).json({ error: 'invalid_grant' });
    }
    
    const new_access_token = crypto.randomBytes(32).toString('hex');
    const new_refresh_token = crypto.randomBytes(32).toString('hex');
    
    await supabase
      .from('alexa_tokens')
      .update({ 
        access_token: new_access_token, 
        refresh_token: new_refresh_token,
        updated_at: new Date().toISOString()
      })
      .eq('refresh_token', refresh_token);
    
    console.log('✅ Token renovado correctamente');
    
    return res.json({
      access_token: new_access_token,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: new_refresh_token
    });
  }
  
  // ============================================================
  // === FLUJO: AUTHORIZATION_CODE ===
  // ============================================================
  if (grant_type !== 'authorization_code') {
    console.error('❌ grant_type inválido:', grant_type);
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  
  if (!ALLOWED_REDIRECT_URIS.includes(redirect_uri)) {
    console.error('❌ redirect_uri no permitido:', redirect_uri);
    return res.status(400).json({ error: 'invalid_request' });
  }
  
  const { data: codeRecord } = await supabase
    .from('oauth_codes')
    .select('*')
    .eq('code', code)
    .eq('used', true)
    .single();

  if (!codeRecord) {
    console.error('❌ Código no encontrado');
    return res.status(400).json({ error: 'invalid_grant' });
  }
  
  if (codeRecord.redirect_uri !== redirect_uri) {
    console.error('❌ redirect_uri no coincide');
    return res.status(400).json({ error: 'invalid_grant' });
  }

  const access_token = crypto.randomBytes(32).toString('hex');
  const new_refresh_token = crypto.randomBytes(32).toString('hex');
  
  await supabase.from('alexa_tokens').upsert({ 
    code, 
    access_token, 
    refresh_token: new_refresh_token,
    used: true,
    created_at: new Date().toISOString()
  }, { onConflict: 'code' });

  console.log('✅ Token guardado correctamente');
  
  res.json({
    access_token,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: new_refresh_token
  });
});

module.exports = router;