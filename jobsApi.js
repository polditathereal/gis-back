require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const jobsPath = process.env.JOBS_PATH || path.join(dataDir, 'jobs.json');

function validateCategoryInput(cat) {
  if (!cat.name || !cat.color) return { valid: false, error: 'Nombre y color requeridos.' };
  return { valid: true };
}
function categoryExists(categories, name) {
  return categories.some(cat => cat.name === name);
}
function validateUniqueTitle(list, title, excludeId = null) {
  return list.some(item => item.title === title && item.id !== excludeId);
}

// --- JOBS CATEGORIES ---
router.post('/categories', (req, res) => {
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

router.put('/categories/:id', (req, res) => {
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  fs.readFile(jobsPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Error reading jobs.json' });
    const json = JSON.parse(data);
    const idx = json.categories.findIndex(cat => cat.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Categoría no encontrada.' });
    if (name !== req.params.id && categoryExists(json.categories, name)) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    json.categories[idx] = { id: name, name, color };
    fs.writeFile(jobsPath, JSON.stringify(json, null, 2), err => {
      if (err) return res.status(500).json({ error: 'Error writing jobs.json' });
      res.json(json.categories[idx]);
    });
  });
});

router.delete('/categories/:id', (req, res) => {
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

router.post('/', (req, res) => {
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

router.put('/:id', (req, res) => {
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

router.delete('/:id', (req, res) => {
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
