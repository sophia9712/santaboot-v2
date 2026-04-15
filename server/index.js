const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Redirigir /dashboard a /dashboard.html
app.get('/dashboard', (req, res) => {
  res.redirect('/dashboard.html' + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''));
});

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

// Endpoint de prueba
app.get('/', (req, res) => {
  res.json({ message: 'SantaBoot API funcionando' });
});

// IMPORTANTE: Railway usa el puerto que está en process.env.PORT
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log('SantaBoot corriendo en puerto ' + PORT);
});