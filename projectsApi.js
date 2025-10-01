require('dotenv').config();
const express = require('express');
const cors = require('cors'); 
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { requireToken } = require('./usersApi');
const nodeFetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
const { connectDB } = require('./db');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const defaultImage = process.env.DEFAULT_IMAGE || '/public/placeholder.svg';
const BUNNY_STORAGE_API = process.env.BUNNY_STORAGE_API || 'https://br.storage.bunnycdn.com/gis-images';
const BUNNY_STORAGE_ACCESS_KEY = process.env.BUNNY_STORAGE_ACCESS_KEY || '';
const BUNNY_STORAGE_READONLY_KEY = process.env.BUNNY_STORAGE_READONLY_KEY || '';
const BUNNY_CDN_ZONE_URL = process.env.BUNNY_CDN_ZONE_URL || 'https://br.b-cdn.net';


function validateUniqueTitle(list, title, excludeId = null) {
  return list.some(item => item.title === title && item.id !== excludeId);
}
function validateCategoryInput(body) {
  if (!body.name || !body.color) {
    return { valid: false, error: 'El nombre y el color son obligatorios.' };
  }
  return { valid: true };
}
function categoryExists(categories, name, excludeId = null) {
  return categories.some(cat => cat.name === name && cat.id !== excludeId);
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
      headers: {
        AccessKey: accessKey,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
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
    // Purga la CDN después de subir
    if (success) {
      await purgeBunnyCDN(fullRemotePath);
    }
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

async function purgeBunnyCDN(remotePath) {
  // Reemplaza estos valores por los de tu cuenta Bunny
  const cdnApiKey = process.env.BUNNY_CDN_API_KEY;
  const cdnZoneUrl = process.env.BUNNY_CDN_ZONE_URL; // Ejemplo: https://yourzone.b-cdn.net
  if (!cdnApiKey || !cdnZoneUrl) {
    console.warn('[BUNNY] CDN purge no configurado');
    return false;
  }
  const url = `https://api.bunny.net/purge?url=${cdnZoneUrl}/${remotePath}`;
  try {
    const res = await nodeFetch(url, {
      method: 'POST',
      headers: { AccessKey: cdnApiKey }
    });
    const text = await res.text();
    console.log(`[BUNNY] Purge CDN: ${url}`);
    console.log(`[BUNNY] Purge response: ${res.status} - ${text}`);
    return res.status === 200;
  } catch (err) {
    console.log(`[BUNNY] Error purgando CDN:`, err);
    return false;
  }
}

// Obtener las URLs de las imágenes de un proyecto desde MongoDB
router.get('/:id/images', async (req, res) => {
  const id = req.params.id;
  try {
    const db = await connectDB();
    const project = await db.collection('projects').findOne({ id });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({
      imagenPrincipal: project.imagenPrincipal || defaultImage,
      image1: project.image1 || defaultImage,
      image2: project.image2 || defaultImage
    });
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo proyecto de MongoDB' });
  }
});
// Multer config for image upload
const storage = multer.memoryStorage();
const upload = multer({ storage });
router.get('/', async (req, res) => {
  try {
    const db = await connectDB();
    const projects = await db.collection('projects').find({}).toArray();
    const categories = await db.collection('projectCategories').find({}).toArray();
    res.json({ projects, categories });
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo proyectos/categorías de MongoDB' });
  }
});

// --- PROJECTS CATEGORIES ---
router.post('/categories', requireToken, async (req, res) => {
  console.log('POST /categories - body:', req.body);
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) {
    console.error('POST /categories - error:', validation.error);
    return res.status(400).json({ error: validation.error });
  }
  try {
    const db = await connectDB();
    const exists = await db.collection('projectCategories').findOne({ name });
    if (exists) {
      console.error('POST /categories - error: categoría duplicada');
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    const newCategory = { id: name, name, color };
    await db.collection('projectCategories').insertOne(newCategory);
    console.log('POST /categories - categoría creada:', newCategory);
    res.json(newCategory);
  } catch (err) {
    console.error('POST /categories - error guardando en MongoDB:', err);
    res.status(500).json({ error: 'Error guardando categoría en MongoDB', details: err.message });
  }
});

router.put('/categories/:id', requireToken, async (req, res) => {
  console.log('PUT /categories/:id - body:', req.body);
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) {
    console.error('PUT /categories/:id - error:', validation.error);
    return res.status(400).json({ error: validation.error });
  }
  try {
    const db = await connectDB();
    const exists = await db.collection('projectCategories').findOne({ name, id: { $ne: req.params.id } });
    if (exists) {
      console.error('PUT /categories/:id - error: categoría duplicada');
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    const result = await db.collection('projectCategories').findOneAndUpdate(
      { id: req.params.id },
      { $set: { id: name, name, color } },
      { returnDocument: 'after' }
    );
    if (!result.value) {
      console.error('PUT /categories/:id - error: categoría no encontrada');
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }
    console.log('PUT /categories/:id - categoría actualizada:', result.value);
    res.json(result.value);
  } catch (err) {
    console.error('PUT /categories/:id - error actualizando en MongoDB:', err);
    res.status(500).json({ error: 'Error actualizando categoría en MongoDB', details: err.message });
  }
});

router.delete('/categories/:id', requireToken, async (req, res) => {
  console.log('DELETE /categories/:id - id:', req.params.id);
  try {
    const db = await connectDB();
    const result = await db.collection('projectCategories').findOneAndDelete({ id: req.params.id });
    if (!result.value) {
      console.error('DELETE /categories/:id - error: categoría no encontrada');
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }
    console.log('DELETE /categories/:id - categoría eliminada:', result.value);
    res.json(result.value);
  } catch (err) {
    console.error('DELETE /categories/:id - error eliminando en MongoDB:', err);
    res.status(500).json({ error: 'Error eliminando categoría en MongoDB', details: err.message });
  }
});

// --- PROJECTS ---
router.post(
  '/',
  requireToken,
  upload.fields([
    { name: 'imagenPrincipal', maxCount: 1 },
    { name: 'image1', maxCount: 1 },
    { name: 'image2', maxCount: 1 }
  ]),
  async (req, res) => {
    console.log('POST /projects - body:', req.body);
    console.log('POST /projects - files:', req.files);
    const fields = [
      "title", "tipo", "tema", "entidadContratante", "paisOrigen", "tipo2", "objeto", "fechaInicial", "fechaFinal", "consorcio", "integrantes", "descripcion", "category", "imagenPrincipal", "image1", "image2"
    ];
    const newProject = {};
    newProject.id = uuidv4();
    if (!req.body.title || req.body.title.trim() === "") {
      console.log('POST /projects - error: título vacío');
      return res.status(400).json({ error: 'El título no puede estar vacío.' });
    }
    // Validar que la imagen principal exista
    if (!req.files || !req.files['imagenPrincipal']) {
      console.log('POST /projects - error: imagen principal faltante');
      return res.status(400).json({ error: 'La imagen principal es obligatoria.' });
    }
    try {
      const db = await connectDB();
      // Imagen principal obligatoria
      try {
        const buffer = await sharp(req.files['imagenPrincipal'][0].buffer)
          .rotate()
          .jpeg({ quality: 90 })
          .toBuffer();
        newProject['imagenPrincipal'] = `${BUNNY_CDN_ZONE_URL}/images/${newProject.id}/imagenPrincipal.jpg`;
        // Subir a Bunny Storage
        await uploadToBunnyStorageFromBuffer(buffer, `${newProject.id}/imagenPrincipal.jpg`);
        console.log(`[PROJECTS] Imagen principal subida a Bunny: images/${newProject.id}/imagenPrincipal.jpg`);
      } catch (e) {
        console.log(`POST /projects - error guardando imagen principal:`, e);
        return res.status(500).json({ error: 'Error procesando la imagen principal.' });
      }
      // Imágenes secundarias (solo si llegan)
      for (const imgKey of ["image1", "image2"]) {
        if (req.files && req.files[imgKey]) {
          try {
            const buffer = await sharp(req.files[imgKey][0].buffer)
              .rotate()
              .jpeg({ quality: 90 })
              .toBuffer();
            newProject[imgKey] = `${BUNNY_CDN_ZONE_URL}/images/${newProject.id}/${imgKey}.jpg`;
            await uploadToBunnyStorageFromBuffer(buffer, `${newProject.id}/${imgKey}.jpg`);
            console.log(`[PROJECTS] Imagen secundaria subida a Bunny: images/${newProject.id}/${imgKey}.jpg`);
          } catch (e) {
            console.log(`POST /projects - error guardando imagen ${imgKey}:`, e);
            newProject[imgKey] = undefined;
          }
        } else {
          newProject[imgKey] = undefined;
          console.log(`POST /projects - no se envió imagen para ${imgKey}`);
        }
      }
      fields.forEach(key => {
        if (!["imagenPrincipal", "image1", "image2", "id"].includes(key)) {
          // Validación y normalización de fechas
          if (key === "fechaInicial" || key === "fechaFinal") {
            let val = req.body[key] ?? "";
            if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
              const d = new Date(val);
              val = !isNaN(d.getTime()) ? d.toISOString().slice(0,10) : "";
            } else {
              val = "";
            }
            newProject[key] = val;
          } else {
            newProject[key] = req.body[key] ?? "";
          }
        }
      });
      await db.collection('projects').insertOne(newProject);
      res.json(newProject);
    } catch (err) {
      res.status(500).json({ error: 'Error guardando proyecto en MongoDB' });
    }
  }
);

router.put(
  '/:id',
  requireToken,
  upload.fields([
    { name: 'imagenPrincipal', maxCount: 1 },
    { name: 'image1', maxCount: 1 },
    { name: 'image2', maxCount: 1 }
  ]),
  async (req, res) => {
    console.log(`PUT /projects/${req.params.id} - body:`, req.body);
    console.log(`PUT /projects/${req.params.id} - files:`, req.files);
    const id = req.params.id;
    const fields = [
      "title", "tipo", "tema", "entidadContratante", "paisOrigen", "tipo2", "objeto", "fechaInicial", "fechaFinal", "consorcio", "integrantes", "descripcion", "category", "imagenPrincipal", "image1", "image2"
    ];
    try {
      const db = await connectDB();
      const idx = await db.collection('projects').findOne({ id });
      if (!idx) {
        console.log(`PUT /projects/${id} - error: proyecto no encontrado`);
        return res.status(404).json({ error: 'Project not found' });
      }
      const prevProject = idx;
      // El id nunca se modifica, se fuerza el id original
      const updatedProject = { ...req.body, id };
      for (const imgKey of ["imagenPrincipal", "image1", "image2"]) {
        // Solo elimina y sube si hay archivo subido (no si es string/URL)
        if (req.files && req.files[imgKey]) {
          try {
            if (prevProject[imgKey] && typeof prevProject[imgKey] === 'string' && prevProject[imgKey].includes('/images/')) {
              console.log(`[PROJECTS] Intentando eliminar imagen anterior en Bunny: ${id}/${imgKey}.jpg`);
              const deleted = await deleteFromBunnyStorage(`${id}/${imgKey}.jpg`);
              if (!deleted) {
                console.warn(`[PROJECTS] WARNING: No se pudo eliminar la imagen vieja en Bunny: ${id}/${imgKey}.jpg`);
              } else {
                console.log(`[PROJECTS] Imagen anterior eliminada correctamente en Bunny: ${id}/${imgKey}.jpg`);
              }
            }
            const buffer = await sharp(req.files[imgKey][0].buffer)
              .rotate()
              .jpeg({ quality: 90 })
              .toBuffer();
            const uploadSuccess = await uploadToBunnyStorageFromBuffer(buffer, `${id}/${imgKey}.jpg`);
            if (uploadSuccess) {
              updatedProject[imgKey] = `${BUNNY_CDN_ZONE_URL}/images/${id}/${imgKey}.jpg`;
              console.log(`[PROJECTS] Imagen modificada subida a Bunny: images/${id}/${imgKey}.jpg`);
            } else {
              updatedProject[imgKey] = prevProject[imgKey] || defaultImage;
              console.log(`[PROJECTS] ERROR: Bunny no subió la imagen, se mantiene la anterior`);
            }
          } catch (e) {
            updatedProject[imgKey] = prevProject[imgKey] || defaultImage;
            console.log(`PUT /projects/${id} - error guardando imagen ${imgKey}:`, e);
          }
        } else if (req.body[imgKey] && typeof req.body[imgKey] === 'string' && req.body[imgKey].includes('/images/')) {
          updatedProject[imgKey] = req.body[imgKey].startsWith('http') ? req.body[imgKey] : `${BUNNY_CDN_ZONE_URL}${req.body[imgKey]}`;
          console.log(`PUT /projects/${id} - no se envió imagen para ${imgKey}, se mantiene la anterior (por URL recibida)`);
        } else {
          updatedProject[imgKey] = prevProject[imgKey] || defaultImage;
          console.log(`PUT /projects/${id} - no se envió imagen para ${imgKey}, se mantiene la anterior`);
        }
      }
      fields.forEach(key => {
        if (!["imagenPrincipal", "image1", "image2", "id"].includes(key)) {
          updatedProject[key] = req.body[key] ?? "";
        }
      });
      // Validación de título duplicado usando MongoDB
      const duplicate = await db.collection('projects').findOne({ title: updatedProject.title, id: { $ne: id } });
      if (duplicate) {
        console.log(`PUT /projects/${id} - error: título duplicado`);
        return res.status(400).json({ error: 'Ya existe un proyecto con ese título.' });
      }
      const result = await db.collection('projects').findOneAndUpdate(
        { id },
        { $set: updatedProject },
        { returnDocument: 'after' }
      );
      if (!result.value) return res.status(404).json({ error: 'Project not found' });
      res.json(result.value);
    } catch (err) {
      res.status(500).json({ error: 'Error actualizando proyecto en MongoDB' });
    }
  }
);

router.delete('/:id', requireToken, async (req, res) => {
  console.log('DELETE /projects/:id - id:', req.params.id);
  try {
    const db = await connectDB();
    const result = await db.collection('projects').findOneAndDelete({ id: req.params.id });
    if (!result.value) {
      console.error('DELETE /projects/:id - error: Project not found');
      return res.status(404).json({ error: 'Project not found' });
    }
    console.log('DELETE /projects/:id - proyecto eliminado:', result.value);
    res.json(result.value);
  } catch (err) {
    console.error('DELETE /projects/:id - error eliminando en MongoDB:', err);
    res.status(500).json({ error: 'Error eliminando proyecto en MongoDB', details: err.message });
  }
});




module.exports = router;
