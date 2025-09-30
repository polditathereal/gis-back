require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const path = require('path');
const PORT = process.env.PORT || 4000;
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const imagesDir = process.env.IMAGES_DIR || path.join(dataDir, 'images');

// Configura CORS globalmente para toda la app
const allowedOrigins = [
  'http://localhost:3000',
  'https://gis-web.vercel.app',
  'https://gis-web-fvpn.vercel.app',
  'https://gis-web-ten.vercel.app' // <-- agrega este dominio
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  console.log('[CORS] Middleware ejecutado para origen:', origin);
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const projectsApi = require('./projectsApi');
const newsApi = require('./newsApi');
const jobsApi = require('./jobsApi');
const usersApi = require('./usersApi');

// Servir imágenes estáticas directamente desde /images
app.use('/images', express.static(imagesDir));

app.use('/projects', projectsApi);
app.use('/news', newsApi);
app.use('/noticias', newsApi); // <-- agrega esta línea para exponer /noticias
app.use('/jobs', jobsApi);
app.use('/users', usersApi.router);

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`Data dir: ${dataDir}`);
  console.log(`Images dir: ${imagesDir}`);
});

// Si quieres restringir CORS solo a ciertas rutas:
/*
const corsRoutes = ['/noticias', '/jobs', '/admin', '/login', '/proyectos'];
app.use((req, res, next) => {
  if (corsRoutes.some(route => req.path.startsWith(route))) {
    // ...CORS logic...
  }
  next();
});
*/
