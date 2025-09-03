require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const nodeFetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { requireToken } = require('./usersApi');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const imagesDir = process.env.IMAGES_DIR || path.join(dataDir, 'images');
const newsPath = process.env.NEWS_PATH || path.join(dataDir, 'news.json');
const projectsPath = process.env.PROJECTS_PATH || path.join(dataDir, 'projects.json');
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
router.post('/categories', requireToken, (req, res) => {
  console.log(`[NEWS] POST /categories - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  console.log('POST /news/categories - body:', req.body);
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) {
    console.log('POST /news/categories - error: validación fallida:', validation.error);
    return res.status(400).json({ error: validation.error });
  }
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) {
      console.log('POST /news/categories - error leyendo news.json:', err);
      return res.status(500).json({ error: 'Error reading news.json' });
    }
    const json = JSON.parse(data);
    if (categoryExists(json.categories, name)) {
      console.log('POST /news/categories - error: categoría duplicada');
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    const newCategory = { id: name, name, color };
    json.categories.push(newCategory);
    fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
      if (err) {
        console.log('POST /news/categories - error escribiendo news.json:', err);
        return res.status(500).json({ error: 'Error writing news.json' });
      }
      console.log('POST /news/categories - categoría creada:', newCategory);
      res.json(newCategory);
    });
  });
});

router.put('/categories/:id', requireToken, (req, res) => {
  console.log(`[NEWS] PUT /categories/${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  console.log(`[NEWS] PUT /categories/${req.params.id} - body:`, req.body);
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) {
    console.log(`[NEWS] PUT /categories/${req.params.id} - error: validación fallida:`, validation.error);
    return res.status(400).json({ error: validation.error });
  }
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) {
      console.log(`[NEWS] PUT /categories/${req.params.id} - error leyendo news.json:`, err);
      return res.status(500).json({ error: 'Error reading news.json' });
    }
    const json = JSON.parse(data);
    const idx = json.categories.findIndex(cat => cat.id === req.params.id);
    if (idx === -1) {
      console.log(`[NEWS] PUT /categories/${req.params.id} - error: categoría no encontrada`);
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }
    if (name !== req.params.id && categoryExists(json.categories, name, req.params.id)) {
      console.log(`[NEWS] PUT /categories/${req.params.id} - error: categoría duplicada`);
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    json.categories[idx] = { id: name, name, color };
    fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
      if (err) {
        console.log(`[NEWS] PUT /categories/${req.params.id} - error escribiendo news.json:`, err);
        return res.status(500).json({ error: 'Error writing news.json' });
      }
      console.log(`[NEWS] PUT /categories/${req.params.id} - categoría actualizada:`, json.categories[idx]);
      res.json(json.categories[idx]);
    });
  });
});

router.delete('/categories/:id', requireToken, (req, res) => {
  console.log(`[NEWS] DELETE /categories/${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  console.log(`DELETE /news/categories/${req.params.id}`);
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) {
      console.log(`DELETE /news/categories/${req.params.id} - error leyendo news.json:`, err);
      return res.status(500).json({ error: 'Error reading news.json' });
    }
    const json = JSON.parse(data);
    const idx = json.categories.findIndex(cat => cat.id === req.params.id);
    if (idx === -1) {
      console.log(`DELETE /news/categories/${req.params.id} - error: categoría no encontrada`);
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }
    const deleted = json.categories.splice(idx, 1);
    fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
      if (err) {
        console.log(`DELETE /news/categories/${req.params.id} - error escribiendo news.json:`, err);
        return res.status(500).json({ error: 'Error writing news.json' });
      }
      console.log(`DELETE /news/categories/${req.params.id} - categoría eliminada:`, deleted[0]);
      res.json(deleted[0]);
    });
  });
});

// --- NEWS ---
// Servir la imagen de una noticia por id
router.get('/:id/image', (req, res) => {
  const { id } = req.params;
  const imgPath = path.join(imagesDir, id, 'image.jpg');
  console.log(`GET /news/${id}/image - buscando imagen en:`, imgPath);
  fs.access(imgPath, fs.constants.F_OK, err => {
    if (err) {
      console.log(`GET /news/${id}/image - imagen no encontrada, devolviendo placeholder`);
      return res.sendFile(path.join(__dirname, defaultImage));
    }
    console.log(`GET /news/${id}/image - imagen encontrada, enviando archivo`);
    res.sendFile(imgPath);
  });
});
// Multer config for image upload
const storage = multer.memoryStorage();
const upload = multer({ storage });
router.get('/', (req, res) => {
  console.log('GET /news - leyendo todas las noticias');
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) {
      console.log('GET /news - error leyendo news.json:', err);
      return res.status(500).json({ error: 'Error reading news.json' });
    }
    console.log('GET /news - noticias encontradas');
    res.json(JSON.parse(data));
  });
});

// Eliminar duplicado

router.post('/', requireToken, upload.single('image'), async (req, res) => {
  console.log(`[NEWS] POST / - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  console.log('POST /news - body:', req.body);
  const fields = ["title", "description", "category", "date", "featured", "author", "readTime"];
  const newNews = req.body;
  if (!newNews.title || newNews.title.trim() === "") {
    console.log('POST /news - error: título vacío');
    return res.status(400).json({ error: 'El título no puede estar vacío.', status: 400 });
  }
  // Validar que la imagen exista
  if (!req.file) {
    console.log('POST /news - error: imagen faltante');
    return res.status(400).json({ error: 'La imagen es obligatoria.', status: 400 });
  }
  newNews.id = uuidv4();
  let imagePath;
  try {
    fs.readFile(newsPath, 'utf8', async (err, data) => {
      if (err) {
        console.log('POST /news - error leyendo news.json:', err);
        return res.status(500).json({ error: 'Error leyendo news.json', status: 500 });
      }
      const json = JSON.parse(data);
      if (validateUniqueTitle(json.news, newNews.title)) {
        console.log('POST /news - error: título duplicado');
        return res.status(400).json({ error: 'Ya existe una noticia con ese título.', status: 400 });
      }
      // Solo crear carpeta y guardar imagen si el título es único
      const buffer = await sharp(req.file.buffer)
        .rotate()
        .jpeg({ quality: 90 })
        .toBuffer();
      imagePath = `/images/${newNews.id}/image.jpg`;
      // Subir a Bunny Storage
      await uploadToBunnyStorageFromBuffer(buffer, `${newNews.id}/image.jpg`);
      console.log(`[NEWS] Imagen subida a Bunny: images/${newNews.id}/image.jpg`);
      newNews.image = imagePath;
      fields.forEach(key => {
        newNews[key] = req.body[key] ?? "";
      });
      json.news.push(newNews);
      fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
        if (err) {
          console.log('POST /news - error escribiendo news.json:', err);
          return res.status(500).json({ error: 'Error escribiendo news.json', status: 500 });
        }
        console.log('POST /news - noticia creada:', newNews);
        res.json({ message: 'Noticia creada correctamente', news: newNews, status: 200 });
      });
    });
  } catch (e) {
    console.log('POST /news - error procesando imagen o guardando noticia:', e);
    res.status(500).json({ error: 'Error procesando la imagen o guardando la noticia', details: e?.message, status: 500 });
  }
});

// Eliminar duplicado
router.put('/:id', requireToken, upload.single('image'), async (req, res) => {
  console.log(`[NEWS] PUT /${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  console.log(`PUT /news/${req.params.id} - body:`, req.body);
  const id = req.params.id;
  const fields = ["title", "description", "category", "date", "featured", "author", "readTime"];
  // Leer la noticia actual para mantener la ruta de imagen si no se sube nueva
  fs.readFile(newsPath, 'utf8', async (err, data) => {
    if (err) {
      console.log(`PUT /news/${id} - error leyendo news.json:`, err);
      return res.status(500).json({ error: 'Error leyendo news.json', status: 500 });
    }
    const json = JSON.parse(data);
    const idx = json.news.findIndex(n => n.id === id);
    if (idx === -1) {
      console.log(`PUT /news/${id} - error: noticia no encontrada`);
      return res.status(404).json({ error: 'Noticia no encontrada', status: 404 });
    }
    const prevNews = json.news[idx];
    const updatedNews = req.body;
    if (!updatedNews.title || updatedNews.title.trim() === "") {
      console.log(`PUT /news/${id} - error: título vacío`);
      return res.status(400).json({ error: 'El título no puede estar vacío.', status: 400 });
    }
    updatedNews.id = id;
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
      if (validateUniqueTitle(json.news, updatedNews.title, id)) {
        console.log(`PUT /news/${id} - error: título duplicado`);
        return res.status(400).json({ error: 'Ya existe una noticia con ese título.', status: 400 });
      }
      json.news[idx] = updatedNews;
      fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
        if (err) {
          console.log(`PUT /news/${id} - error escribiendo news.json:`, err);
          return res.status(500).json({ error: 'Error escribiendo news.json', status: 500 });
        }
        console.log(`PUT /news/${id} - noticia editada:`, updatedNews);
        res.json({ message: 'Noticia editada correctamente', news: updatedNews, status: 200 });
      });
    } catch (e) {
      console.log(`PUT /news/${id} - error procesando imagen o editando noticia:`, e);
      res.status(500).json({ error: 'Error procesando la imagen o editando la noticia', details: e?.message, status: 500 });
    }
  });
});

router.delete('/:id', requireToken, (req, res) => {
  console.log(`[NEWS] DELETE /${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  const id = req.params.id;
  console.log(`DELETE /news/${id}`);
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) {
      console.log(`DELETE /news/${id} - error leyendo news.json:`, err);
      return res.status(500).json({ error: 'Error reading news.json' });
    }
    const json = JSON.parse(data);
    const idx = json.news.findIndex(n => n.id === id);
    if (idx === -1) {
      console.log(`DELETE /news/${id} - error: noticia no encontrada`);
      return res.status(404).json({ error: 'News not found' });
    }
    const deleted = json.news.splice(idx, 1);
    fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
      if (err) {
        console.log(`DELETE /news/${id} - error escribiendo news.json:`, err);
        return res.status(500).json({ error: 'Error writing news.json' });
      }
      // Eliminar carpeta de imágenes de la noticia borrada
      const dir = path.join(imagesDir, id);
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          console.log(`DELETE /news/${id} - carpeta de imágenes eliminada:`, dir);
        } catch (e) {
          console.log(`DELETE /news/${id} - error eliminando carpeta de imágenes:`, e);
        }
      }
      // Repasar todas las carpetas y borrar las que no tengan id en news.json ni en projects.json
      fs.readFile(projectsPath, 'utf8', (err2, data2) => {
        let validProjectIds = [];
        if (!err2) {
          try {
            const projectsJson = JSON.parse(data2);
            validProjectIds = Array.isArray(projectsJson.projects)
              ? projectsJson.projects.map(p => p.id)
              : [];
          } catch (e) {
            console.log(`DELETE /news/${id} - error parseando projects.json:`, e);
          }
        }
        // Repasar todas las carpetas en imagesDir
        fs.readdir(imagesDir, (err3, folders) => {
          if (!err3 && Array.isArray(folders)) {
            // Obtener ids válidos de noticias y proyectos
            const validNewsIds = json.news.map(n => n.id);
            const validIds = validNewsIds.concat(validProjectIds);
            folders.forEach(folder => {
              const folderPath = path.join(imagesDir, folder);
              try {
                if (!validIds.includes(folder) && fs.lstatSync(folderPath).isDirectory()) {
                  fs.rmSync(folderPath, { recursive: true, force: true });
                  console.log(`DELETE /news/${id} - carpeta huérfana eliminada:`, folderPath);
                }
              } catch (e) {
                console.log(`DELETE /news/${id} - error eliminando carpeta huérfana:`, e);
              }
            });
          }
          console.log(`DELETE /news/${id} - noticia eliminada:`, deleted[0]);
          res.json(deleted[0]);
        });
      });
    });
  });
});

module.exports = router;
