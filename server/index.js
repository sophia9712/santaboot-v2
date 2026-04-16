const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/auth', require('./routes/auth'));
app.use('/devices', require('./routes/devices'));
app.use('/payments', require('./routes/payments'));
app.use('/alexa', require('./routes/alexa'));  // ← Ruta /alexa/wake

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 SantaBoot corriendo en puerto ${PORT}`);
    console.log(`📍 Endpoint para Alexa: https://santaboot-production.up.railway.app/alexa/wake`);
});