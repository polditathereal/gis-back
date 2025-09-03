require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { requireToken } = require('./usersApi');
const nodeFetch = (...args) => import('node-fetch').then(mod => mod.default(...args));

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const imagesDir = process.env.IMAGES_DIR || path.join(dataDir, 'images');
const projectsPath = process.env.PROJECTS_PATH || path.join(dataDir, 'projects.json');
const newsPath = process.env.NEWS_PATH || path.join(dataDir, 'news.json');
const defaultImage = process.env.DEFAULT_IMAGE || '/public/placeholder.svg';
const BUNNY_STORAGE_API = process.env.BUNNY_STORAGE_API || 'https://br.storage.bunnycdn.com/gis-images';
const BUNNY_STORAGE_ACCESS_KEY = process.env.BUNNY_STORAGE_ACCESS_KEY || '';
const BUNNY_STORAGE_READONLY_KEY = process.env.BUNNY_STORAGE_READONLY_KEY || '';

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

// --- PROJECTS CATEGORIES ---
router.post('/categories', requireToken, (req, res) => {
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  fs.readFile(projectsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading projects.json' });
    const json = JSON.parse(data);
    if (categoryExists(json.categories, name)) {
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    const newCategory = { id: name, name, color };
    json.categories.push(newCategory);
    fs.writeFile(projectsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing projects.json' });
      res.json(newCategory);
    });
  });
});

router.put('/categories/:id', requireToken, (req, res) => {
  console.log(`[PROJECTS] PUT /categories/${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  console.log(`[PROJECTS] PUT /categories/${req.params.id} - body:`, req.body);
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) {
    console.log(`[PROJECTS] PUT /categories/${req.params.id} - error: validación fallida:`, validation.error);
    return res.status(400).json({ error: validation.error });
  }
  fs.readFile(projectsPath, 'utf8', (err, data) => {
    if (err) {
      console.log(`[PROJECTS] PUT /categories/${req.params.id} - error leyendo projects.json:`, err);
      return res.status(500).json({ error: 'Error reading projects.json' });
    }
    const json = JSON.parse(data);
    const idx = json.categories.findIndex(cat => cat.id === req.params.id);
    if (idx === -1) {
      console.log(`[PROJECTS] PUT /categories/${req.params.id} - error: categoría no encontrada`);
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }
    if (name !== req.params.id && categoryExists(json.categories, name, req.params.id)) {
      console.log(`[PROJECTS] PUT /categories/${req.params.id} - error: categoría duplicada`);
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    json.categories[idx] = { id: name, name, color };
    fs.writeFile(projectsPath, JSON.stringify(json, null, 2), err => {
      if (err) {
        console.log(`[PROJECTS] PUT /categories/${req.params.id} - error escribiendo projects.json:`, err);
        return res.status(500).json({ error: 'Error writing projects.json' });
      }
      console.log(`[PROJECTS] PUT /categories/${req.params.id} - categoría actualizada:`, json.categories[idx]);
      res.json(json.categories[idx]);
    });
  });
});

router.delete('/categories/:id', requireToken, (req, res) => {
  fs.readFile(projectsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading projects.json' });
    const json = JSON.parse(data);
    const idx = json.categories.findIndex(cat => cat.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Categoría no encontrada.' });
    const deleted = json.categories.splice(idx, 1);
    fs.writeFile(projectsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing projects.json' });
      res.json(deleted[0]);
    });
  });
});

// --- PROJECTS ---
// Obtener las URLs de las imágenes de un proyecto
router.get('/:id/images', (req, res) => {
  const id = req.params.id;
  fs.readFile(projectsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading projects.json' });
    const json = JSON.parse(data);
    const project = json.projects.find(p => p.id === id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({
      imagenPrincipal: project.imagenPrincipal || defaultImage,
      image1: project.image1 || defaultImage,
      image2: project.image2 || defaultImage
    });
  });
});
// Multer config for image upload
const storage = multer.memoryStorage();
const upload = multer({ storage });
router.get('/', (req, res) => {
  fs.readFile(projectsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading projects.json' });
    res.json(JSON.parse(data));
  });
});


router.post('/', requireToken, upload.fields([
  { name: 'imagenPrincipal', maxCount: 1 },
  { name: 'image1', maxCount: 1 },
  { name: 'image2', maxCount: 1 }
]), async (req, res) => {
  console.log('POST /projects - body:', req.body);
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
  fs.readFile(projectsPath, 'utf8', async (err, data) => {
    if (err) {
      console.log('POST /projects - error leyendo projects.json:', err);
      return res.status(500).json({ error: 'Error leyendo projects.json' });
    }
    let json;
    try {
      json = JSON.parse(data);
    } catch (e) {
      console.log('POST /projects - error parseando projects.json:', e);
      return res.status(500).json({ error: 'Error parseando projects.json, archivo corrupto.' });
    }
    if (validateUniqueTitle(json.projects, req.body.title)) {
      console.log('POST /projects - error: título duplicado');
      return res.status(400).json({ error: 'Ya existe un proyecto con ese título.' });
    }
    // Imagen principal obligatoria
    try {
      const buffer = await sharp(req.files['imagenPrincipal'][0].buffer)
        .rotate()
        .jpeg({ quality: 90 })
        .toBuffer();
      newProject['imagenPrincipal'] = `/images/${newProject.id}/imagenPrincipal.jpg`;
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
          newProject[imgKey] = `/images/${newProject.id}/${imgKey}.jpg`;
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
    json.projects.push(newProject);
    fs.writeFile(projectsPath, JSON.stringify(json, null, 2), err => {
      if (err) {
        console.log('POST /projects - error escribiendo projects.json:', err);
        return res.status(500).json({ error: 'Error escribiendo projects.json' });
      }
      console.log('POST /projects - proyecto creado:', newProject);
      res.json(newProject);
    });
  });
});

router.put('/:id', requireToken, upload.fields([
  { name: 'imagenPrincipal', maxCount: 1 },
  { name: 'image1', maxCount: 1 },
  { name: 'image2', maxCount: 1 }
]), async (req, res) => {
  const id = req.params.id;
  console.log(`PUT /projects/${id} - body:`, req.body);
  const fields = [
    "title", "tipo", "tema", "entidadContratante", "paisOrigen", "tipo2", "objeto", "fechaInicial", "fechaFinal", "consorcio", "integrantes", "descripcion", "category", "imagenPrincipal", "image1", "image2"
  ];
  fs.readFile(projectsPath, 'utf8', async (err, data) => {
    if (err) {
      console.log(`PUT /projects/${id} - error leyendo projects.json:`, err);
      return res.status(500).json({ error: 'Error reading projects.json' });
    }
    const json = JSON.parse(data);
    const idx = json.projects.findIndex(p => p.id === id);
    if (idx === -1) {
      console.log(`PUT /projects/${id} - error: proyecto no encontrado`);
      return res.status(404).json({ error: 'Project not found' });
    }
    const prevProject = json.projects[idx];
    const updatedProject = { id };
    if (!req.body.title || req.body.title.trim() === "") {
      console.log(`PUT /projects/${id} - error: título vacío`);
      return res.status(400).json({ error: 'El título no puede estar vacío.' });
    }
    for (const imgKey of ["imagenPrincipal", "image1", "image2"]) {
      // Solo elimina y sube si hay archivo subido (no si es string/URL)
      if (req.files && req.files[imgKey]) {
        try {
          if (prevProject[imgKey] && typeof prevProject[imgKey] === 'string' && prevProject[imgKey].startsWith('/images/')) {
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
            updatedProject[imgKey] = `/images/${id}/${imgKey}.jpg`;
            console.log(`[PROJECTS] Imagen modificada subida a Bunny: images/${id}/${imgKey}.jpg`);
          } else {
            updatedProject[imgKey] = prevProject[imgKey] || defaultImage;
            console.log(`[PROJECTS] ERROR: Bunny no subió la imagen, se mantiene la anterior`);
          }
        } catch (e) {
          updatedProject[imgKey] = prevProject[imgKey] || defaultImage;
          console.log(`PUT /projects/${id} - error guardando imagen ${imgKey}:`, e);
        }
      } else if (req.body[imgKey] && typeof req.body[imgKey] === 'string' && req.body[imgKey].startsWith('/images/')) {
        updatedProject[imgKey] = req.body[imgKey];
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
    if (validateUniqueTitle(json.projects, updatedProject.title, id)) {
      console.log(`PUT /projects/${id} - error: título duplicado`);
      return res.status(400).json({ error: 'Ya existe un proyecto con ese título.' });
    }
    json.projects[idx] = updatedProject;
    fs.writeFile(projectsPath, JSON.stringify(json, null, 2), err => {
      if (err) {
        console.log(`PUT /projects/${id} - error escribiendo projects.json:`, err);
        return res.status(500).json({ error: 'Error writing projects.json' });
      }
      console.log(`PUT /projects/${id} - proyecto actualizado:`, updatedProject);
      res.json(updatedProject);
    });
  });
});


router.delete('/:id', requireToken, (req, res) => {
  const id = req.params.id;
  console.log(`DELETE /projects/${id}`);
  fs.readFile(projectsPath, 'utf8', (err, data) => {
    if (err) {
      console.log(`DELETE /projects/${id} - error leyendo projects.json:`, err);
      return res.status(500).json({ error: 'Error reading projects.json' });
    }
    const json = JSON.parse(data);
    const idx = json.projects.findIndex(p => p.id === id);
    if (idx === -1) {
      console.log(`DELETE /projects/${id} - error: proyecto no encontrado`);
      return res.status(404).json({ error: 'Project not found' });
    }
    const deleted = json.projects.splice(idx, 1);
    fs.writeFile(projectsPath, JSON.stringify(json, null, 2), err => {
      if (err) {
        console.log(`DELETE /projects/${id} - error escribiendo projects.json:`, err);
        return res.status(500).json({ error: 'Error writing projects.json' });
      }
      fs.readFile(newsPath, 'utf8', (err2, data2) => {
        let validNewsIds = [];
        if (!err2) {
          try {
            const newsJson = JSON.parse(data2);
            validNewsIds = Array.isArray(newsJson.news) ? newsJson.news.map(n => n.id) : [];
          } catch (e) {
            console.log(`DELETE /projects/${id} - error parseando news.json:`, e);
          }
        }
        fs.readdir(imagesDir, (err, folders) => {
          if (!err && Array.isArray(folders)) {
            const validProjectIds = json.projects.map(p => p.id);
            const validIds = [...validProjectIds, ...validNewsIds];
            folders.forEach(folder => {
              const folderPath = path.join(imagesDir, folder);
              if (!validIds.includes(folder) && fs.lstatSync(folderPath).isDirectory()) {
                try {
                  fs.rmSync(folderPath, { recursive: true, force: true });
                  console.log(`DELETE /projects/${id} - carpeta huérfana eliminada: ${folderPath}`);
                } catch (e) {
                  console.log(`DELETE /projects/${id} - error eliminando carpeta huérfana:`, e);
                }
              }
            });
          }
          console.log(`DELETE /projects/${id} - proyecto eliminado:`, deleted[0]);
          res.json(deleted[0]);
        });
      });
    });
  });
});

module.exports = router;
