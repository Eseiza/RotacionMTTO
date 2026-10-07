const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const admin = require('firebase-admin');

const PORT = process.env.PORT || 3000;
const DB_URL = process.env.FIREBASE_DATABASE_URL || 'https://rotacionmtto-default-rtdb.firebaseio.com';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

let firebaseAdmin;
try {
  // En Render: variable de entorno. En local: archivo serviceAccountKey.json junto a server.js
  const localKey = path.join(__dirname, 'serviceAccountKey.json');
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    : (fs.existsSync(localKey) ? JSON.parse(fs.readFileSync(localKey, 'utf8')) : JSON.parse(required('FIREBASE_SERVICE_ACCOUNT_JSON')));
  firebaseAdmin = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DB_URL
  });
} catch (err) {
  console.error('Firebase Admin no pudo inicializarse:', err.message);
}

const app = express();
app.set('trust proxy', 1);
// CORS solo para desarrollo local (Live Server en otro puerto)
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Vary': 'Origin'
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: '100kb' }));
// Solo se publican las carpetas del frontend (no server.js, package.json, reglas, etc.)
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/html', express.static(path.join(__dirname, 'html')));

const USERS = {
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
    role: 'admin',
    name: 'Administrador'
  },
  mantenimiento: {
    username: process.env.MTTO_USERNAME || 'mtto',
    password: process.env.MTTO_PASSWORD || 'mtto123',
    role: 'mantenimiento',
    name: 'Mantenimiento'
  }
};

const sha = v => crypto.createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// El rol se deduce del usuario; "role" es opcional (compatibilidad con versiones anteriores)
function authenticate(username, password, role) {
  const clean = String(username || '').trim().toLowerCase();
  return Object.values(USERS).find(u =>
    u.password &&
    u.username.toLowerCase() === clean &&
    (!role || u.role === role) &&
    safeEqual(password || '', u.password)
  ) || null;
}

// Límite simple de intentos fallidos por IP (10 cada 15 min)
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const fails = new Map();
const isBlocked = ip => { const e = fails.get(ip); return !!e && Date.now() < e.reset && e.count >= MAX_FAILS; };
const addFail = ip => {
  const now = Date.now();
  const e = fails.get(ip);
  if (!e || now >= e.reset) fails.set(ip, { count: 1, reset: now + WINDOW_MS });
  else e.count++;
};
setInterval(() => { const now = Date.now(); for (const [ip, e] of fails) if (now >= e.reset) fails.delete(ip); }, WINDOW_MS).unref();

app.post('/api/login', async (req, res) => {
  try {
    if (!firebaseAdmin) return res.status(503).json({ error: 'Firebase Admin no está configurado en Render.' });
    if (isBlocked(req.ip)) return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.' });

    const { username, password, role } = req.body || {};
    const user = authenticate(username, password, role);
    if (!user) {
      addFail(req.ip);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    fails.delete(req.ip);

    const uid = `planning_${user.role}`;
    const token = await admin.auth().createCustomToken(uid, { role: user.role });
    return res.json({ token, username: user.username, role: user.role, name: user.name });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'No se pudo iniciar sesión.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'html', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Planning de Mantenimiento escuchando en ${PORT}`);
});
