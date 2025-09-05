require('dotenv').config();
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { requireToken } = require('./usersApi');
const router = express.Router();
const cors = require('cors');
const { connectDB } = require('./db');

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
router.post('/categories', requireToken, async (req, res) => {
  console.log(`[JOBS] POST /categories - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  try {
    const db = await connectDB();
    const exists = await db.collection('jobCategories').findOne({ name });
    if (exists) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    const newCategory = { id: name, name, color };
    await db.collection('jobCategories').insertOne(newCategory);
    res.json(newCategory);
  } catch (err) {
    res.status(500).json({ error: 'Error guardando categoría en MongoDB' });
  }
});

router.put('/categories/:id', requireToken, async (req, res) => {
  console.log(`[JOBS] PUT /categories/${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  console.log(`[JOBS] PUT /categories/${req.params.id} - body:`, req.body);
  const { name, color } = req.body;
  const validation = validateCategoryInput(req.body);
  if (!validation.valid) {
    console.log(`[JOBS] PUT /categories/${req.params.id} - error: validación fallida:`, validation.error);
    return res.status(400).json({ error: validation.error });
  }
  try {
    const db = await connectDB();
    const exists = await db.collection('jobCategories').findOne({ name, id: { $ne: req.params.id } });
    if (exists) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    const result = await db.collection('jobCategories').findOneAndUpdate(
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
  console.log(`[JOBS] DELETE /categories/${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  try {
    const db = await connectDB();
    const result = await db.collection('jobCategories').findOneAndDelete({ id: req.params.id });
    if (!result.value) return res.status(404).json({ error: 'Categoría no encontrada.' });
    res.json(result.value);
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando categoría en MongoDB' });
  }
});

// --- JOBS CRUD ---
router.get('/', async (req, res) => {
  try {
    const db = await connectDB();
    const jobs = await db.collection('jobs').find({}).toArray();
    const categories = await db.collection('jobCategories').find({}).toArray();
    res.json({ jobs, categories });
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo empleos/categorías de MongoDB' });
  }
});

router.post('/', requireToken, async (req, res) => {
  console.log(`[JOBS] POST / - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  const fields = ["title", "description", "date", "category"];
  const newJob = req.body;
  if (!newJob.title || newJob.title.trim() === "") return res.status(400).json({ error: 'El título no puede estar vacío.' });
  if (!newJob.category) return res.status(400).json({ error: 'La categoría es obligatoria.' });
  newJob.id = uuidv4();
  try {
    const db = await connectDB();
    await db.collection('jobs').insertOne(newJob);
    res.json(newJob);
  } catch (err) {
    res.status(500).json({ error: 'Error guardando empleo en MongoDB' });
  }
});

router.put('/:id', requireToken, async (req, res) => {
  console.log(`[JOBS] PUT /${req.params.id} - usuario: ${req.user?.username}, token: ${req.user?.token}`);
  const id = req.params.id;
  const fields = ["title", "description", "date", "category"];
  const updatedJob = req.body;
  if (!updatedJob.title || updatedJob.title.trim() === "") return res.status(400).json({ error: 'El título no puede estar vacío.' });
  updatedJob.id = id;
  try {
    const db = await connectDB();
    const result = await db.collection('jobs').findOneAndUpdate(
      { id },
      { $set: updatedJob },
      { returnDocument: 'after' }
    );
    if (!result.value) return res.status(404).json({ error: 'Oferta no encontrada.' });
    res.json(result.value);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando empleo en MongoDB' });
  }
});

router.delete('/:id', requireToken, async (req, res) => {
  try {
    const db = await connectDB();
    const result = await db.collection('jobs').findOneAndDelete({ id: req.params.id });
    if (!result.value) return res.status(404).json({ error: 'Oferta no encontrada.' });
    res.json(result.value);
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando empleo en MongoDB' });
  }
});

module.exports = router;

