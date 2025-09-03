require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { requireToken } = require('./usersApi');
const router = express.Router();

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const jobsPath = process.env.JOBS_PATH || path.join(dataDir, 'jobs.json');

function validateCategoryInput(cat) {
  if (!cat.name || !cat.color) return { valid: false, error: 'Nombre y color requeridos.' };
  return { valid: true };
}
function categoryExists(categories, name, excludeId = null) {
  return categories.some(cat => cat.name === name && cat.id !== excludeId);
}
function validateUniqueTitle(list, title, excludeId = null) {
  return list.some(item => item.title === title && item.id !== excludeId);
}

// --- JOBS CATEGORIES ---
router.post('/categories', requireToken, (req, res) => {
  console.log(`[JOBS] POST /categories - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  fs.readFile(jobsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading jobs.json' });
    const json = JSON.parse(data);
    if (categoryExists(json.categories, name)) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    const newCategory = { id: name, name, color };
    json.categories.push(newCategory);
    fs.writeFile(jobsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing jobs.json' });
      res.json(newCategory);
    });
  });
});

router.put('/categories/:id', requireToken, (req, res) => {
  console.log(`[JOBS] PUT /categories/${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  console.log(`[JOBS] PUT /categories/${req.params.id} - body:`, req.body);
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) {
    console.log(`[JOBS] PUT /categories/${req.params.id} - error: validación fallida:`, validation.error);
    return res.status(400).json({ error: validation.error });
  }
  fs.readFile(jobsPath, 'utf8', (err, data) => {
    if (err) {
      console.log(`[JOBS] PUT /categories/${req.params.id} - error leyendo jobs.json:`, err);
      return res.status(500).json({ error: 'Error reading jobs.json' });
    }
    const json = JSON.parse(data);
    const idx = json.categories.findIndex(cat => cat.id === req.params.id);
    if (idx === -1) {
      console.log(`[JOBS] PUT /categories/${req.params.id} - error: categoría no encontrada`);
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }
    if (name !== req.params.id && categoryExists(json.categories, name, req.params.id)) {
      console.log(`[JOBS] PUT /categories/${req.params.id} - error: categoría duplicada`);
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    json.categories[idx] = { id: name, name, color };
    fs.writeFile(jobsPath, JSON.stringify(json, null, 2), err => {
      if (err) {
        console.log(`[JOBS] PUT /categories/${req.params.id} - error escribiendo jobs.json:`, err);
        return res.status(500).json({ error: 'Error writing jobs.json' });
      }
      console.log(`[JOBS] PUT /categories/${req.params.id} - categoría actualizada:`, json.categories[idx]);
      res.json(json.categories[idx]);
    });
  });
});

router.delete('/categories/:id', requireToken, (req, res) => {
  console.log(`[JOBS] DELETE /categories/${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  fs.readFile(jobsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading jobs.json' });
    const json = JSON.parse(data);
    const idx = json.categories.findIndex(cat => cat.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Categoría no encontrada.' });
    const deleted = json.categories.splice(idx, 1);
    fs.writeFile(jobsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing jobs.json' });
      res.json(deleted[0]);
    });
  });
});

// --- JOBS CRUD ---
router.get('/', (req, res) => {
  fs.readFile(jobsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading jobs.json' });
    res.json(JSON.parse(data));
  });
});

router.post('/', requireToken, (req, res) => {
  console.log(`[JOBS] POST / - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  const fields = ["title", "description", "date", "category"];
  const newJob = req.body;
  if (!newJob.title || newJob.title.trim() === "") return res.status(400).json({ error: 'El título no puede estar vacío.' });
  if (!newJob.category) return res.status(400).json({ error: 'La categoría es obligatoria.' });
  newJob.id = uuidv4();
  fs.readFile(jobsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading jobs.json' });
    const json = JSON.parse(data);
    if (validateUniqueTitle(json.jobs, newJob.title)) return res.status(400).json({ error: 'Ya existe una oferta con ese título.' });
    fields.forEach(key => { if (!newJob[key]) newJob[key] = ""; });
    json.jobs.push(newJob);
    fs.writeFile(jobsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing jobs.json' });
      res.json(newJob);
    });
  });
});

router.put('/:id', requireToken, (req, res) => {
  console.log(`[JOBS] PUT /${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  const id = req.params.id;
  const fields = ["title", "description", "date", "category"];
  const updatedJob = req.body;
  if (!updatedJob.title || updatedJob.title.trim() === "") return res.status(400).json({ error: 'El título no puede estar vacío.' });
  updatedJob.id = id;
  fs.readFile(jobsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading jobs.json' });
    const json = JSON.parse(data);
    const idx = json.jobs.findIndex(j => j.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Oferta no encontrada.' });
    if (validateUniqueTitle(json.jobs, updatedJob.title, id)) return res.status(400).json({ error: 'Ya existe una oferta con ese título.' });
    fields.forEach(key => { if (!updatedJob[key]) updatedJob[key] = ""; });
    json.jobs[idx] = updatedJob;
    fs.writeFile(jobsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing jobs.json' });
      res.json(updatedJob);
    });
  });
});

router.delete('/:id', requireToken, (req, res) => {
  console.log(`[JOBS] DELETE /${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  const id = req.params.id;
  fs.readFile(jobsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading jobs.json' });
    const json = JSON.parse(data);
    const idx = json.jobs.findIndex(j => j.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Oferta no encontrada.' });
    const deleted = json.jobs.splice(idx, 1);
    fs.writeFile(jobsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing jobs.json' });
      res.json(deleted[0]);
    });
  });
});

module.exports = router;
