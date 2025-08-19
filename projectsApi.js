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
const projectsPath = process.env.PROJECTS_PATH || path.join(dataDir, 'projects.json');
const newsPath = process.env.NEWS_PATH || path.join(dataDir, 'news.json');
const defaultImage = process.env.DEFAULT_IMAGE || '/public/placeholder.svg';

function validateUniqueTitle(list, title, excludeId = null) {
  return list.some(item => item.title === title && item.id !== excludeId);
}
function validateCategoryInput(body) {
  if (!body.name || !body.color) {
    return { valid: false, error: 'El nombre y el color son obligatorios.' };
  }
  return { valid: true };
}
function categoryExists(categories, name) {
  return categories.some(cat => cat.name === name);
}

// --- PROJECTS CATEGORIES ---
router.post('/categories', (req, res) => {
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

router.put('/categories/:id', (req, res) => {
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  fs.readFile(projectsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading projects.json' });
    const json = JSON.parse(data);
    const idx = json.categories.findIndex(cat => cat.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Categoría no encontrada.' });
    if (name !== req.params.id && categoryExists(json.categories, name)) {
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    json.categories[idx] = { id: name, name, color };
    fs.writeFile(projectsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing projects.json' });
      res.json(json.categories[idx]);
    });
  });
});

router.delete('/categories/:id', (req, res) => {
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

router.post('/', upload.fields([
  { name: 'imagenPrincipal', maxCount: 1 },
  { name: 'image1', maxCount: 1 },
  { name: 'image2', maxCount: 1 }
]), async (req, res) => {
  // defaultImage ya está definido arriba
  const fields = [
    "title", "tipo", "tema", "entidadContratante", "paisOrigen", "tipo2", "objeto", "fechaInicial", "fechaFinal", "consorcio", "integrantes", "descripcion", "category", "imagenPrincipal", "image1", "image2"
  ];
  const newProject = {};
  newProject.id = uuidv4();
  // Validar título no vacío
  if (!req.body.title || req.body.title.trim() === "") {
    return res.status(400).json({ error: 'El título no puede estar vacío.' });
  }
  // Guardar imágenes si se envían
  const dir = path.join(imagesDir, newProject.id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const imgKey of ["imagenPrincipal", "image1", "image2"]) {
    if (req.files && req.files[imgKey]) {
      const imgFile = path.join(dir, `${imgKey}.jpg`);
      await sharp(req.files[imgKey][0].buffer).jpeg({ quality: 90 }).toFile(imgFile);
      newProject[imgKey] = `/images/${newProject.id}/${imgKey}.jpg`;
    } else {
      newProject[imgKey] = defaultImage;
    }
  }
  fields.forEach(key => {
    if (!["imagenPrincipal", "image1", "image2", "id"].includes(key)) {
      newProject[key] = req.body[key] ?? "";
    }
  });
  fs.readFile(projectsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading projects.json' });
    const json = JSON.parse(data);
    if (validateUniqueTitle(json.projects, newProject.title)) {
      return res.status(400).json({ error: 'Ya existe un proyecto con ese título.' });
    }
    json.projects.push(newProject);
    fs.writeFile(projectsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing projects.json' });
      res.json(newProject);
    });
  });
});

router.put('/:id', upload.fields([
  { name: 'imagenPrincipal', maxCount: 1 },
  { name: 'image1', maxCount: 1 },
  { name: 'image2', maxCount: 1 }
]), async (req, res) => {
  const id = req.params.id;
  // defaultImage ya está definido arriba
  const fields = [
    "title", "tipo", "tema", "entidadContratante", "paisOrigen", "tipo2", "objeto", "fechaInicial", "fechaFinal", "consorcio", "integrantes", "descripcion", "category", "imagenPrincipal", "image1", "image2"
  ];
  const updatedProject = { id };
  // Validar título no vacío
  if (!req.body.title || req.body.title.trim() === "") {
    return res.status(400).json({ error: 'El título no puede estar vacío.' });
  }
  // Guardar imágenes si se envían
  const dir = path.join(imagesDir, id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const imgKey of ["imagenPrincipal", "image1", "image2"]) {
    if (req.files && req.files[imgKey]) {
      const imgFile = path.join(dir, `${imgKey}.jpg`);
      await sharp(req.files[imgKey][0].buffer).jpeg({ quality: 90 }).toFile(imgFile);
      updatedProject[imgKey] = `/images/${id}/${imgKey}.jpg`;
    } else {
      updatedProject[imgKey] = req.body[imgKey] || defaultImage;
    }
  }
  fields.forEach(key => {
    if (!["imagenPrincipal", "image1", "image2", "id"].includes(key)) {
      updatedProject[key] = req.body[key] ?? "";
    }
  });
  fs.readFile(projectsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading projects.json' });
    const json = JSON.parse(data);
    if (validateUniqueTitle(json.projects, updatedProject.title, id)) {
      return res.status(400).json({ error: 'Ya existe un proyecto con ese título.' });
    }
    const idx = json.projects.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Project not found' });
    json.projects[idx] = updatedProject;
    fs.writeFile(projectsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing projects.json' });
      res.json(updatedProject);
    });
  });
});


router.delete('/:id', (req, res) => {
  const id = req.params.id;
  fs.readFile(projectsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading projects.json' });
    const json = JSON.parse(data);
    const idx = json.projects.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Project not found' });
    const deleted = json.projects.splice(idx, 1);
    fs.writeFile(projectsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing projects.json' });
      // Eliminar carpeta de imágenes del proyecto borrado
      const dir = path.join(imagesDir, id);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      // Repasar todas las carpetas y borrar las que no tengan id en projects.json ni en news.json
      // newsPath ya está definido arriba
      fs.readFile(newsPath, 'utf8', (err2, data2) => {
        let validNewsIds = [];
        if (!err2) {
          try {
            const newsJson = JSON.parse(data2);
            validNewsIds = Array.isArray(newsJson.news) ? newsJson.news.map(n => n.id) : [];
          } catch {}
        }
        fs.readdir(imagesDir, (err, folders) => {
          if (!err && Array.isArray(folders)) {
            const validProjectIds = json.projects.map(p => p.id);
            const validIds = [...validProjectIds, ...validNewsIds];
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
