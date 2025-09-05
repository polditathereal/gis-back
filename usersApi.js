require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const cors = require('cors');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const usersPath = process.env.USERS_PATH || path.join(dataDir, 'users.json');

// Backend URLs (local y producción - Vercel)
const API_URL_LOCAL = process.env.API_URL_LOCAL || `http://localhost:${process.env.PORT || 4000}`;
const API_URL_PROD = process.env.API_URL_PROD || 'https://gis-back.vercel.app';
// Selección del base URL del backend
const API_BASE_URL = process.env.NODE_ENV === 'production' ? API_URL_PROD : API_URL_LOCAL;

// Helper: leer usuarios
function readUsers() {
  if (!fs.existsSync(usersPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  } catch {
    return [];
  }
}
// Helper: guardar usuarios
function writeUsers(users) {
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
}
// Helper: hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}
// Helper: generar token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Login: recibe username y password, devuelve token
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();
  console.log(`[LOGIN] users list:`, users);
  const user = users.find(u => u.username === username);
  console.log(`[LOGIN] found user:`, user);
  const inputHash = hashPassword(password);
  const storedHash = user ? user.password : null;
  console.log(`[LOGIN] username: ${username}`);
  console.log(`[LOGIN] input hash: ${inputHash}`);
  console.log(`[LOGIN] stored hash: ${storedHash}`);
  if (!user || storedHash !== inputHash) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  // Generar nuevo token
  user.token = generateToken();
  writeUsers(users);
  res.json({ token: user.token });
});

// Logout: elimina el token del usuario
router.post('/logout', (req, res) => {
  const { token } = req.body;
  const users = readUsers();
  const user = users.find(u => u.token === token);
  if (user) {
    user.token = null;
    writeUsers(users);
  }
  res.json({ success: true });
});

// Validar token (middleware)
function requireToken(req, res, next) {
  const token = req.headers['authorization'] || req.body.token;
  console.log(`[TOKEN] recibido: ${token}`);
  if (!token) {
    console.log(`[TOKEN] error: Token requerido`);
    return res.status(401).json({ error: 'Token requerido' });
  }
  const users = readUsers();
  const user = users.find(u => u.token === token);
  console.log(`[TOKEN] usuario encontrado:`, user);
  if (!user) {
    console.log(`[TOKEN] error: Token inválido`);
    return res.status(401).json({ error: 'Token inválido' });
  }
  console.log(`[TOKEN] verificación exitosa para usuario: ${user.username}`);
  req.user = user;
  next();
}

// Endpoint para validar token desde frontend
router.post('/validate', (req, res) => {
  const { token } = req.body;
  const users = readUsers();
  const user = users.find(u => u.token === token);
  if (!user) return res.status(401).json({ error: 'Token inválido' });
  res.json({ valid: true });
});

// Exporta también el API_BASE_URL para otros módulos que lo necesiten
module.exports = { router, requireToken, API_BASE_URL };
