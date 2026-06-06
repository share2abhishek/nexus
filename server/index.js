const path    = require('path');

// Load .env from the writable location Electron prepared (falls back to project
// root in development). Plain `dotenv.config()` only reads ./.env, so pass it.
require('dotenv').config(
  process.env.DOTENV_CONFIG_PATH ? { path: process.env.DOTENV_CONFIG_PATH } : {}
);

// Writable data directory. When packaged, the app source lives inside a
// read-only asar archive, so all databases/sessions must live in userData
// (provided by Electron via NEXUS_DATA_DIR). Falls back to ../data in dev.
const DATA_DIR = process.env.NEXUS_DATA_DIR || path.join(__dirname, '..', 'data');

const knex               = require('../services/knex');
const runLegacyMigration = require('../services/legacyMigration');

const express = require('express');
const session = require('express-session');
const cors    = require('cors');

const authRoutes   = require('../routes/auth');
const usersRoutes  = require('../routes/users');
const adminRoutes  = require('../routes/admin');
const apiRoutes    = require('../routes/api');
const seoRoutes    = require('../routes/seo');
const emailRoutes  = require('../routes/email');
const toolsRoutes  = require('../routes/tools');
const mediaRoutes  = require('../routes/media');
const configRoutes = require('../routes/config');
const ollamaRoutes = require('../routes/ollama');
const scheduler    = require('../services/scheduler');
const { requireAuth, injectUserKeys } = require('../middleware/auth');
const { makeWithWorkspace, requirePermission } = require('../middleware/tenancy');
const membershipsRepo = require('../repos/membershipsRepo')(knex);
const withWorkspace = makeWithWorkspace(membershipsRepo);

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

let sessionStore;
if (process.env.DB_CLIENT === 'pg') {
  const pgSession = require('connect-pg-simple')(session);
  sessionStore = new pgSession({ conString: process.env.DATABASE_URL, createTableIfMissing: true });
} else {
  const SQLiteStore = require('connect-sqlite3')(session);
  sessionStore = new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR });
}
app.use(session({
  store: sessionStore,
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
app.use('/ollama',     ollamaRoutes); // guided AI setup (status / pull)

// ── Protected Routes (require login) ─────────────────────────────────────────

app.use('/api',        requireAuth, withWorkspace, injectUserKeys, apiRoutes);
app.use('/api/seo',    requireAuth, withWorkspace, injectUserKeys, seoRoutes);
app.use('/api/email',  requireAuth, withWorkspace, injectUserKeys, emailRoutes);
app.use('/api/tools',  requireAuth, withWorkspace, injectUserKeys, toolsRoutes);
app.use('/api/media',  requireAuth, withWorkspace, injectUserKeys, mediaRoutes);
app.use('/api/config', requireAuth, withWorkspace, configRoutes);

// ── Tenancy Routes ────────────────────────────────────────────────────────────

app.use('/workspaces', require('../routes/workspaces')(knex));
app.use('/workspaces/:workspaceId/members', require('../routes/members')(knex, withWorkspace, requirePermission));
app.use('/invitations', require('../routes/invitations')(knex, withWorkspace, requirePermission));

app.post('/session/active-workspace', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  req.session.activeWorkspaceId = Number(req.body.workspaceId);
  res.json({ ok: true });
});

app.get('/me/workspaces', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await membershipsRepo.listForUser(req.session.userId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

async function bootstrap() {
  try {
    await knex.migrate.latest();
    await runLegacyMigration(knex);
    console.log('[DB] Migrations complete.');
  } catch (err) {
    console.error('[DB] Migration error:', err.message);
    // Don't exit on migration error — let the app start, log the issue
  }

  app.listen(PORT, async () => {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║   NEXUS v2.0 — Digital Marketing Suite ║`);
    console.log(`║   http://localhost:${PORT}                ║`);
    console.log(`╚════════════════════════════════════════╝\n`);

    scheduler.start();

    // Only auto-open a browser when running standalone. Under Electron the
    // desktop window handles the UI (NEXUS_NO_BROWSER=true).
    if (process.env.NEXUS_NO_BROWSER !== 'true') {
      try {
        const open = (await import('open')).default;
        await open(`http://localhost:${PORT}`);
      } catch {}
    }
  });
}

bootstrap().catch(err => { console.error('[Startup] fatal', err); process.exit(1); });

module.exports = app;
