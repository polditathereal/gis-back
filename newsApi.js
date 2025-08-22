require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const imagesDir = process.env.IMAGES_DIR || path.join(dataDir, 'images');
const newsPath = process.env.NEWS_PATH || path.join(dataDir, 'news.json');
const projectsPath = process.env.PROJECTS_PATH || path.join(dataDir, 'projects.json');
const defaultImage = process.env.DEFAULT_IMAGE || '/public/placeholder.svg';
function validateUniqueTitle(list, title, excludeId = null) {
  return list.some(item => item.title === title && item.id !== excludeId);
}

// --- NEWS CATEGORIES ---
router.post('/categories', (req, res) => {
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

router.put('/categories/:id', (req, res) => {
  console.log(`PUT /news/categories/${req.params.id} - body:`, req.body);
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) {
    console.log(`PUT /news/categories/${req.params.id} - error: validación fallida:`, validation.error);
    return res.status(400).json({ error: validation.error });
  }
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) {
      console.log(`PUT /news/categories/${req.params.id} - error leyendo news.json:`, err);
      return res.status(500).json({ error: 'Error reading news.json' });
    }
    const json = JSON.parse(data);
    const idx = json.categories.findIndex(cat => cat.id === req.params.id);
    if (idx === -1) {
      console.log(`PUT /news/categories/${req.params.id} - error: categoría no encontrada`);
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }
    if (name !== req.params.id && categoryExists(json.categories, name)) {
      console.log(`PUT /news/categories/${req.params.id} - error: categoría duplicada`);
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    json.categories[idx] = { id: name, name, color };
    fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
      if (err) {
        console.log(`PUT /news/categories/${req.params.id} - error escribiendo news.json:`, err);
        return res.status(500).json({ error: 'Error writing news.json' });
      }
      console.log(`PUT /news/categories/${req.params.id} - categoría actualizada:`, json.categories[idx]);
      res.json(json.categories[idx]);
    });
  });
});

router.delete('/categories/:id', (req, res) => {
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
router.post('/', upload.single('image'), async (req, res) => {
  console.log('POST /news - body:', req.body);
  const fields = ["title", "description", "category", "date", "featured", "author", "readTime"];
  const newNews = req.body;
  if (!newNews.title || newNews.title.trim() === "") {
    console.log('POST /news - error: título vacío');
    return res.status(400).json({ error: 'El título no puede estar vacío.', status: 400 });
  }
  newNews.id = uuidv4();
  let imagePath = defaultImage;
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
      if (req.file) {
        const dir = path.join(imagesDir, newNews.id);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const imgFile = path.join(dir, 'image.jpg');
        await sharp(req.file.buffer)
          .rotate() // Corrige la orientación según EXIF
          .jpeg({ quality: 90 })
          .toFile(imgFile);
        imagePath = `/images/${newNews.id}/image.jpg`;
        console.log('POST /news - imagen guardada:', imgFile);
      }
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
router.put('/:id', upload.single('image'), async (req, res) => {
  console.log(`PUT /news/${req.params.id} - body:`, req.body);
  const id = req.params.id;
  const fields = ["title", "description", "category", "date", "featured", "author", "readTime"];
  const updatedNews = req.body;
  if (!updatedNews.title || updatedNews.title.trim() === "") {
    console.log(`PUT /news/${id} - error: título vacío`);
    return res.status(400).json({ error: 'El título no puede estar vacío.', status: 400 });
  }
  updatedNews.id = id;
  let imagePath = defaultImage;
  try {
    if (req.file) {
      const dir = path.join(imagesDir, id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const imgFile = path.join(dir, 'image.jpg');
      // Elimina la imagen anterior si existe
      if (fs.existsSync(imgFile)) {
        fs.unlinkSync(imgFile);
      }
      await sharp(req.file.buffer)
        .rotate() // Corrige la orientación según EXIF
        .jpeg({ quality: 90 })
        .toFile(imgFile);
      imagePath = `/images/${id}/image.jpg`;
      console.log(`PUT /news/${id} - imagen guardada:`, imgFile);
    } else {
      imagePath = req.body.image || defaultImage;
      console.log(`PUT /news/${id} - no se envió imagen, usando:`, imagePath);
    }
    updatedNews.image = imagePath;
    fields.forEach(key => {
      updatedNews[key] = req.body[key] ?? "";
    });
    fs.readFile(newsPath, 'utf8', (err, data) => {
      if (err) {
        console.log(`PUT /news/${id} - error leyendo news.json:`, err);
        return res.status(500).json({ error: 'Error leyendo news.json', status: 500 });
      }
      const json = JSON.parse(data);
      if (validateUniqueTitle(json.news, updatedNews.title, id)) {
        console.log(`PUT /news/${id} - error: título duplicado`);
        return res.status(400).json({ error: 'Ya existe una noticia con ese título.', status: 400 });
      }
      const idx = json.news.findIndex(n => n.id === id);
      if (idx === -1) {
        console.log(`PUT /news/${id} - error: noticia no encontrada`);
        return res.status(404).json({ error: 'Noticia no encontrada', status: 404 });
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
    });
  } catch (e) {
    console.log(`PUT /news/${id} - error procesando imagen o editando noticia:`, e);
    res.status(500).json({ error: 'Error procesando la imagen o editando la noticia', details: e?.message, status: 500 });
  }
});

router.delete('/:id', (req, res) => {
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
            validProjectIds = Array.isArray(projectsJson.projects) ? projectsJson.projects.map(p => p.id) : [];
          } catch (e) {
            console.log(`DELETE /news/${id} - error parseando projects.json:`, e);
          }
        }
        fs.readdir(imagesDir, (err, folders) => {
          if (!err && Array.isArray(folders)) {
            const validNewsIds = json.news.map(n => n.id);
            const validIds = [...validNewsIds, ...validProjectIds];
            folders.forEach(folder => {
              const folderPath = path.join(imagesDir, folder);
              if (!validIds.includes(folder) && fs.lstatSync(folderPath).isDirectory()) {
                try {
                  fs.rmSync(folderPath, { recursive: true, force: true });
                  console.log(`DELETE /news/${id} - carpeta huérfana eliminada:`, folderPath);
                } catch (e) {
                  console.log(`DELETE /news/${id} - error eliminando carpeta huérfana:`, e);
                }
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
