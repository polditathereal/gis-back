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
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading news.json' });
    const json = JSON.parse(data);
    if (categoryExists(json.categories, name)) {
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    const newCategory = { id: name, name, color };
    json.categories.push(newCategory);
    fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing news.json' });
      res.json(newCategory);
    });
  });
});

router.put('/categories/:id', (req, res) => {
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading news.json' });
    const json = JSON.parse(data);
    const idx = json.categories.findIndex(cat => cat.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Categoría no encontrada.' });
    if (name !== req.params.id && categoryExists(json.categories, name)) {
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    json.categories[idx] = { id: name, name, color };
    fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing news.json' });
      res.json(json.categories[idx]);
    });
  });
});

router.delete('/categories/:id', (req, res) => {
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading news.json' });
    const json = JSON.parse(data);
    const idx = json.categories.findIndex(cat => cat.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Categoría no encontrada.' });
    const deleted = json.categories.splice(idx, 1);
    fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing news.json' });
      res.json(deleted[0]);
    });
  });
});

// --- NEWS ---
// Servir la imagen de una noticia por id
router.get('/:id/image', (req, res) => {
  const { id } = req.params;
  const imgPath = path.join(imagesDir, id, 'image.jpg');
  fs.access(imgPath, fs.constants.F_OK, err => {
    if (err) {
      // Si no existe, devolver el placeholder
      return res.sendFile(path.join(__dirname, defaultImage));
    }
    res.sendFile(imgPath);
  });
});
// Multer config for image upload
const storage = multer.memoryStorage();
const upload = multer({ storage });
router.get('/', (req, res) => {
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading news.json' });
    res.json(JSON.parse(data));
  });
});

// Eliminar duplicado
router.post('/', upload.single('image'), async (req, res) => {
  // defaultImage ya está definido arriba
  const fields = [
    "title", "description", "category", "date", "featured", "author", "readTime"
  ];
  const newNews = req.body;
  // Validar título no vacío
  if (!newNews.title || newNews.title.trim() === "") {
    return res.status(400).json({ error: 'El título no puede estar vacío.' });
  }
  // Generar ID automáticamente
  newNews.id = uuidv4();
  // Guardar imagen si se envía
  let imagePath = defaultImage;
  if (req.file) {
    const dir = path.join(imagesDir, newNews.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const imgFile = path.join(dir, 'image.jpg');
    await sharp(req.file.buffer).jpeg({ quality: 90 }).toFile(imgFile);
    imagePath = `/images/${newNews.id}/image.jpg`;
  }
  newNews.image = imagePath;
  fields.forEach(key => {
    newNews[key] = req.body[key] ?? "";
  });
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading news.json' });
    const json = JSON.parse(data);
    if (validateUniqueTitle(json.news, newNews.title)) {
      return res.status(400).json({ error: 'Ya existe una noticia con ese título.' });
    }
    json.news.push(newNews);
    fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing news.json' });
      res.json(newNews);
    });
  });
});

// Eliminar duplicado
router.put('/:id', upload.single('image'), async (req, res) => {
  const id = req.params.id;
  // defaultImage ya está definido arriba
  const fields = [
    "title", "description", "category", "date", "featured", "author", "readTime"
  ];
  const updatedNews = req.body;
  // Validar título no vacío
  if (!updatedNews.title || updatedNews.title.trim() === "") {
    return res.status(400).json({ error: 'El título no puede estar vacío.' });
  }
  // Mantener el id original
  updatedNews.id = id;
  // Guardar imagen si se envía
  let imagePath = defaultImage;
  if (req.file) {
    const dir = path.join(imagesDir, id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const imgFile = path.join(dir, 'image.jpg');
    await sharp(req.file.buffer).jpeg({ quality: 90 }).toFile(imgFile);
    imagePath = `/images/${id}/image.jpg`;
  } else {
    imagePath = req.body.image || defaultImage;
  }
  updatedNews.image = imagePath;
  fields.forEach(key => {
    updatedNews[key] = req.body[key] ?? "";
  });
// Servir imágenes estáticas
router.use('/images', express.static(imagesDir));
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading news.json' });
    const json = JSON.parse(data);
    if (validateUniqueTitle(json.news, updatedNews.title, id)) {
      return res.status(400).json({ error: 'Ya existe una noticia con ese título.' });
    }
    const idx = json.news.findIndex(n => n.id === id);
    if (idx === -1) return res.status(404).json({ error: 'News not found' });
    json.news[idx] = updatedNews;
    fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing news.json' });
      res.json(updatedNews);
    });
  });
});

router.delete('/:id', (req, res) => {
  const id = req.params.id;
  fs.readFile(newsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading news.json' });
    const json = JSON.parse(data);
    const idx = json.news.findIndex(n => n.id === id);
    if (idx === -1) return res.status(404).json({ error: 'News not found' });
    const deleted = json.news.splice(idx, 1);
    fs.writeFile(newsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing news.json' });
      // Eliminar carpeta de imágenes de la noticia borrada
      const dir = path.join(imagesDir, id);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      // Repasar todas las carpetas y borrar las que no tengan id en news.json ni en projects.json
      // projectsPath ya está definido arriba
      fs.readFile(projectsPath, 'utf8', (err2, data2) => {
        let validProjectIds = [];
        if (!err2) {
          try {
            const projectsJson = JSON.parse(data2);
            validProjectIds = Array.isArray(projectsJson.projects) ? projectsJson.projects.map(p => p.id) : [];
          } catch {}
        }
        fs.readdir(imagesDir, (err, folders) => {
          if (!err && Array.isArray(folders)) {
            const validNewsIds = json.news.map(n => n.id);
            const validIds = [...validNewsIds, ...validProjectIds];
            folders.forEach(folder => {
              const folderPath = path.join(imagesDir, folder);
              if (!validIds.includes(folder) && fs.lstatSync(folderPath).isDirectory()) {
                fs.rmSync(folderPath, { recursive: true, force: true });
              }
            });
          }
          res.json(deleted[0]);
        });
      });
    });
  });
});

module.exports = router;
