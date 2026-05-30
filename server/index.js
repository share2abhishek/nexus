require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors    = require('cors');
const path    = require('path');

const authRoutes   = require('../routes/auth');
const usersRoutes  = require('../routes/users');
const adminRoutes  = require('../routes/admin');
const apiRoutes    = require('../routes/api');
const seoRoutes    = require('../routes/seo');
const emailRoutes  = require('../routes/email');
const toolsRoutes  = require('../routes/tools');
const mediaRoutes  = require('../routes/media');
const configRoutes = require('../routes/config');
const scheduler    = require('../services/scheduler');
const { requireAuth, injectUserKeys } = require('../middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const SQLiteStore = require('connect-sqlite3')(session);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, '..', 'data') }),
  secret: process.env.SESSION_SECRET || 'nexus-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ── Static Files ──────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Public Routes (no auth required) ─────────────────────────────────────────

app.use('/auth',       authRoutes);   // OAuth platform callbacks
app.use('/users',      usersRoutes);  // register / login / logout / me
app.use('/admin',      adminRoutes);  // super admin dashboard

// ── Protected Routes (require login) ─────────────────────────────────────────

app.use('/api',        requireAuth, injectUserKeys, apiRoutes);
app.use('/api/seo',    requireAuth, injectUserKeys, seoRoutes);
app.use('/api/email',  requireAuth, injectUserKeys, emailRoutes);
app.use('/api/tools',  requireAuth, injectUserKeys, toolsRoutes);
app.use('/api/media',  requireAuth, injectUserKeys, mediaRoutes);
app.use('/api/config', requireAuth, configRoutes);

// ── Root: landing for guests, app for logged-in users ────────────────────────

app.get('/', (req, res) => {
  if (req.session?.userId) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, '..', 'public', 'landing.html'));
  }
});

// Explicit app route
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Error Handler ─────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║   NEXUS v2.0 — Digital Marketing Suite ║`);
  console.log(`║   http://localhost:${PORT}                ║`);
  console.log(`╚════════════════════════════════════════╝\n`);

  scheduler.start();

  try {
    const open = (await import('open')).default;
    await open(`http://localhost:${PORT}`);
  } catch {}
});

module.exports = app;
