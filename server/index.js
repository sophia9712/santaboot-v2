const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // ← ← ← AGREGA ESTA LÍNEA
app.use(express.static('public'));

// Redirecciones amigables
app.get('/dashboard', (req, res) => res.redirect('/dashboard.html'));
app.get('/register', (req, res) => res.redirect('/register.html'));
app.get('/login', (req, res) => res.redirect('/login.html'));
app.get('/privacy', (req, res) => res.redirect('/privacy.html'));
app.get('/terms', (req, res) => res.redirect('/terms.html'));

// Importar rutas
const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const alexaRoutes = require('./routes/alexa');
const paymentRoutes = require('./routes/payments');

// Usar rutas
app.use('/auth', authRoutes);
app.use('/devices', deviceRoutes);
app.use('/alexa', alexaRoutes);
app.use('/payments', paymentRoutes);

// Health check
app.get('/', (req, res) => res.json({ message: 'SantaBoot API funcionando' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Puerto
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 SantaBoot corriendo en puerto ' + PORT);
});