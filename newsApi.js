require('dotenv').config();
const express = require('express');
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });
const sharp = require('sharp');
const nodeFetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { requireToken } = require('./usersApi');
const cors = require('cors');
const { connectDB } = require('./db');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const imagesDir = process.env.IMAGES_DIR || path.join(dataDir, 'images');
const defaultImage = process.env.DEFAULT_IMAGE || '/public/placeholder.svg';
const BUNNY_STORAGE_API = process.env.BUNNY_STORAGE_API || 'https://br.storage.bunnycdn.com/gis-images';
const BUNNY_STORAGE_ACCESS_KEY = process.env.BUNNY_STORAGE_ACCESS_KEY || '';
const BUNNY_STORAGE_READONLY_KEY = process.env.BUNNY_STORAGE_READONLY_KEY || '';

function validateUniqueTitle(list, title, excludeId = null) {
  return list.some(item => item.title === title && item.id !== excludeId);
}

function categoryExists(categories, name, excludeId = null) {
  return categories.some(cat => cat.name === name && cat.id !== excludeId);
}

function validateCategoryInput(body) {
  if (!body.name || !body.color) {
    return { valid: false, error: 'El nombre y el color son obligatorios.' };
  }
  return { valid: true };
}

async function uploadToBunnyStorage(localPath, remotePath, readOnly = false) {
  const accessKey = readOnly ? BUNNY_STORAGE_READONLY_KEY : BUNNY_STORAGE_ACCESS_KEY;
  const fullRemotePath = `images/${remotePath}`;
  const url = `${BUNNY_STORAGE_API}/${fullRemotePath}`;
  try {
    const res = await nodeFetch(url, {
      method: 'PUT',
      body: fs.createReadStream(localPath),
      headers: { AccessKey: accessKey }
    });
    const text = await res.text();
    console.log(`[BUNNY] Subiendo archivo local: ${localPath}`);
    console.log(`[BUNNY] URL: ${url}`);
    console.log(`[BUNNY] AccessKey usada: ${accessKey}`);
    console.log(`[BUNNY] Código de respuesta: ${res.status}`);
    console.log(`[BUNNY] Respuesta Bunny: ${text}`);
    return res.status === 201 || res.status === 200;
  } catch (err) {
    console.log(`[BUNNY] Error subiendo a Bunny:`, err);
    return false;
  }
}

async function uploadToBunnyStorageFromBuffer(buffer, remotePath, readOnly = false) {
  const accessKey = readOnly ? BUNNY_STORAGE_READONLY_KEY : BUNNY_STORAGE_ACCESS_KEY;
  const fullRemotePath = `images/${remotePath}`;
  const url = `${BUNNY_STORAGE_API}/${fullRemotePath}`;
  try {
    const res = await nodeFetch(url, {
      method: 'PUT',
      body: buffer,
      headers: { AccessKey: accessKey }
    });
    const text = await res.text();
    let success = false;
    try {
      const bunnyRes = JSON.parse(text);
      success = res.status === 201 && bunnyRes.Message === "File uploaded.";
    } catch {
      success = false;
    }
    console.log(`[BUNNY] Subiendo buffer a: ${url}`);
    console.log(`[BUNNY] AccessKey usada: ${accessKey}`);
    console.log(`[BUNNY] Código de respuesta: ${res.status}`);
    console.log(`[BUNNY] Respuesta Bunny: ${text}`);
    return success;
  } catch (err) {
    console.log(`[BUNNY] Error subiendo a Bunny:`, err);
    return false;
  }
}

async function deleteFromBunnyStorage(remotePath, readOnly = false) {
  const accessKey = readOnly ? BUNNY_STORAGE_READONLY_KEY : BUNNY_STORAGE_ACCESS_KEY;
  const fullRemotePath = `images/${remotePath}`;
  const url = `${BUNNY_STORAGE_API}/${fullRemotePath}`;
  try {
    const res = await nodeFetch(url, {
      method: 'DELETE',
      headers: { AccessKey: accessKey }
    });
    const text = await res.text();
    console.log(`[BUNNY] Eliminando archivo remoto: ${url}`);
    console.log(`[BUNNY] Código de respuesta DELETE: ${res.status}`);
    console.log(`[BUNNY] Respuesta Bunny DELETE: ${text}`);
    return res.status === 200 || res.status === 204;
  } catch (err) {
    console.log(`[BUNNY] Error eliminando en Bunny:`, err);
    return false;
  }
}

// --- NEWS CATEGORIES ---
router.post('/categories', requireToken, async (req, res) => {
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  try {
    const db = await connectDB();
    const exists = await db.collection('newsCategories').findOne({ name });
    if (exists) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    const newCategory = { id: name, name, color };
    await db.collection('newsCategories').insertOne(newCategory);
    res.json(newCategory);
  } catch (err) {
    res.status(500).json({ error: 'Error guardando categoría en MongoDB' });
  }
});

router.put('/categories/:id', requireToken, async (req, res) => {
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  try {
    const db = await connectDB();
    const exists = await db.collection('newsCategories').findOne({ name, id: { $ne: req.params.id } });
    if (exists) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    const result = await db.collection('newsCategories').findOneAndUpdate(
      { id: req.params.id },
      { $set: { id: name, name, color } },
      { returnDocument: 'after' }
    );
    if (!result.value) return res.status(404).json({ error: 'Categoría no encontrada.' });
    res.json(result.value);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando categoría en MongoDB' });
  }
});

router.delete('/categories/:id', requireToken, async (req, res) => {
  try {
    const db = await connectDB();
    const result = await db.collection('newsCategories').findOneAndDelete({ id: req.params.id });
    if (!result.value) return res.status(404).json({ error: 'Categoría no encontrada.' });
    res.json(result.value);
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando categoría en MongoDB' });
  }
});

// --- NEWS ---
router.get('/', async (req, res) => {
  try {
    const db = await connectDB();
    const news = await db.collection('news').find({}).toArray();
    const categories = await db.collection('newsCategories').find({}).toArray();
    res.json({ news, categories });
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo noticias/categorías de MongoDB' });
  }
});

router.post('/', requireToken, upload.single('image'), async (req, res) => {
  console.log(`[NEWS] POST / - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  console.log('POST /news - body:', req.body);
  const fields = ["title", "description", "category", "date", "featured", "author", "readTime"];
  const newNews = req.body;
  if (!newNews.title || newNews.title.trim() === "") {
    console.log('POST /news - error: título vacío');
    return res.status(400).json({ error: 'El título no puede estar vacío.', status: 400 });
  }
  if (!req.file) {
    console.log('POST /news - error: imagen faltante');
    return res.status(400).json({ error: 'La imagen es obligatoria.', status: 400 });
  }
  newNews.id = uuidv4();
  let imagePath;
  try {
    const db = await connectDB();
    const exists = await db.collection('news').findOne({ title: newNews.title });
    if (exists) {
      console.log('POST /news - error: título duplicado');
      return res.status(400).json({ error: 'Ya existe una noticia con ese título.', status: 400 });
    }
    const buffer = await sharp(req.file.buffer)
      .rotate()
      .jpeg({ quality: 90 })
      .toBuffer();
    imagePath = `/images/${newNews.id}/image.jpg`;
    await uploadToBunnyStorageFromBuffer(buffer, `${newNews.id}/image.jpg`);
    console.log(`[NEWS] Imagen subida a Bunny: images/${newNews.id}/image.jpg`);
    newNews.image = imagePath;
    fields.forEach(key => {
      newNews[key] = req.body[key] ?? "";
    });
    await db.collection('news').insertOne(newNews);
    res.json({ message: 'Noticia creada correctamente', news: newNews, status: 200 });
  } catch (e) {
    console.log('POST /news - error procesando imagen o guardando noticia:', e);
    res.status(500).json({ error: 'Error procesando la imagen o guardando la noticia', details: e?.message, status: 500 });
  }
});

router.put('/:id', requireToken, upload.single('image'), async (req, res) => {
  console.log(`[NEWS] PUT /${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  console.log(`PUT /news/${req.params.id} - body:`, req.body);
  const id = req.params.id;
  const fields = ["title", "description", "category", "date", "featured", "author", "readTime"];
  try {
    const db = await connectDB();
    const prevNews = await db.collection('news').findOne({ id });
    if (!prevNews) {
      console.log(`PUT /news/${id} - error: noticia no encontrada`);
      return res.status(404).json({ error: 'Noticia no encontrada', status: 404 });
    }
    const updatedNews = { ...req.body, id };
    if (!updatedNews.title || updatedNews.title.trim() === "") {
      console.log(`PUT /news/${id} - error: título vacío`);
      return res.status(400).json({ error: 'El título no puede estar vacío.', status: 400 });
    }
    let imagePath = prevNews.image || defaultImage;
    try {
      if (req.file) {
        if (prevNews.image && typeof prevNews.image === 'string' && prevNews.image.startsWith('/images/')) {
          await deleteFromBunnyStorage(`${id}/image.jpg`);
        }
        const buffer = await sharp(req.file.buffer)
          .rotate()
          .jpeg({ quality: 90 })
          .toBuffer();
        const uploadSuccess = await uploadToBunnyStorageFromBuffer(buffer, `${id}/image.jpg`);
        if (uploadSuccess) {
          imagePath = `/images/${id}/image.jpg`;
          console.log(`[NEWS] Imagen modificada subida a Bunny: images/${id}/image.jpg`);
        } else {
          imagePath = prevNews.image || defaultImage;
          console.log(`[NEWS] ERROR: Bunny no subió la imagen, se mantiene la anterior`);
        }
      } else if (req.body.image && typeof req.body.image === 'string' && req.body.image.startsWith('/images/')) {
        imagePath = req.body.image;
        console.log(`PUT /news/${id} - no se envió imagen, se mantiene la anterior (por URL recibida)`);
      } else {
        console.log(`PUT /news/${id} - no se envió imagen, se mantiene la anterior`);
      }
      updatedNews.image = imagePath;
      fields.forEach(key => {
        updatedNews[key] = req.body[key] ?? "";
      });
      const duplicate = await db.collection('news').findOne({ title: updatedNews.title, id: { $ne: id } });
      if (duplicate) {
        console.log(`PUT /news/${id} - error: título duplicado`);
        return res.status(400).json({ error: 'Ya existe una noticia con ese título.', status: 400 });
      }
      const result = await db.collection('news').findOneAndUpdate(
        { id },
        { $set: updatedNews },
        { returnDocument: 'after' }
      );
      if (!result.value) return res.status(404).json({ error: 'Noticia no encontrada', status: 404 });
      res.json({ message: 'Noticia editada correctamente', news: result.value, status: 200 });
    } catch (e) {
      console.log(`PUT /news/${id} - error procesando imagen o editando noticia:`, e);
      res.status(500).json({ error: 'Error procesando la imagen o editando la noticia', details: e?.message, status: 500 });
    }
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando noticia en MongoDB' });
  }
});

router.delete('/:id', requireToken, async (req, res) => {
  try {
    const db = await connectDB();
    const result = await db.collection('news').findOneAndDelete({ id: req.params.id });
    if (!result.value) return res.status(404).json({ error: 'News not found' });
    res.json(result.value);
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando noticia en MongoDB' });
  }
});

module.exports = router;
