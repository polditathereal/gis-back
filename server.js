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
  'https://gis-web.vercel.app'
];
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json());


const projectsApi = require('./projectsApi');
const newsApi = require('./newsApi');
const jobsApi = require('./jobsApi');
const usersApi = require('./usersApi');

// Servir imágenes estáticas directamente desde /images
app.use('/images', express.static(imagesDir));

app.use('/projects', projectsApi);
app.use('/news', newsApi);
app.use('/jobs', jobsApi);
app.use('/users', usersApi.router);

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`Data dir: ${dataDir}`);
  console.log(`Images dir: ${imagesDir}`);
});
