const path    = require('path');

// A backup chosen in Settings → Backups is swapped in now, before settings are
// read and the database is opened
try { require('../services/backup').applyPendingRestore(); } catch (err) {
  // Don't start on half-restored data: stop with the reason (shown by the desktop app)
  console.error(`Restoring the backup did not finish: ${err.message}. Your previous data is in the backups folder (before-restore-…). Free some disk space or close other programs, then start Social-Nexus again.`);
  process.exit(1);
}

// Load .env from the writable location Electron prepared (falls back to project
// root in development). Plain `dotenv.config()` only reads ./.env, so pass it.
require('dotenv').config(
  process.env.DOTENV_CONFIG_PATH ? { path: process.env.DOTENV_CONFIG_PATH } : {}
);

// Writable data directory. When packaged, the app source lives inside a
// read-only asar archive, so all databases/sessions must live in userData
// (provided by Electron via NEXUS_DATA_DIR). Falls back to ../data in dev.
const DATA_DIR = process.env.NEXUS_DATA_DIR || path.join(__dirname, '..', 'data');

// Express 4 does not forward rejected promises from async handlers/middleware to the
// error handler; without this a thrown await leaves the request hanging.
require('express-async-errors');

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
const platformAdmin = require('../services/platformAdmin');
// Looks the user up on every request: a suspended or demoted account loses access at once
const withWorkspace = makeWithWorkspace(membershipsRepo, { loadUser: platformAdmin.loadUser });

const app  = express();
const PORT = process.env.PORT || 3000;
// Desktop app: listen on loopback only so other machines on the network can't reach it.
const HOST = process.env.HOST || '127.0.0.1';

// The key that signs login cookies. Anyone who knows it can forge a login as any user,
// so a hosted install must set its own; the desktop app makes and keeps a random one.
const sessionSecret = require('./sessionSecret').resolve({ dataDir: DATA_DIR });
const isHosted = require('../services/edition').isServer();
// Behind a reverse proxy (nginx, a cloud load balancer) the real client address and
// https come from X-Forwarded-*: needed for secure cookies and rate limits
if (isHosted && !process.env.TRUST_PROXY) {
  console.warn('[Startup] TRUST_PROXY is not set. Behind a reverse proxy or load balancer set TRUST_PROXY=1 (the number of proxies in front), '
    + 'or every visitor looks like one address and shares one rate limit, and secure cookies can fail.');
}
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.disable('x-powered-by');
// Smaller pages and scripts: faster loads, which search engines reward
app.use(require('compression')());
// Basic browser protections on every response (no framing of the app, no sniffing)
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // The chat widget is meant to be embedded on customers' sites; the app is not
  if (!req.path.startsWith('/webchat') && !req.path.startsWith('/api/webhooks/webchat')) res.set('X-Frame-Options', 'SAMEORIGIN');
  if (isHosted) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

// ── Middleware ────────────────────────────────────────────────────────────────

// The UI is served from this same server, so no other website may call the API.
// (cors() with no options allowed every origin.)
app.use(cors({ origin: false }));
app.use(express.json({
  limit: '10mb',
  // Meta signs the exact bytes it sends: keep them for the webhook signature check
  verify: (req, res, buf) => { if (req.url.startsWith('/api/webhooks/') || req.url.startsWith('/billing/webhook')) req.rawBody = buf; },
}));
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
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  // secure: only over https (set on hosted installs; the desktop app runs on http://127.0.0.1)
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: isHosted ? 'auto' : false },
}));

// Identity check used by the desktop shell before it connects to this port
// Used by Electron (is this our server?) and the build smoke test (licence state
// must not be "invalid", i.e. a genuine build is not flagged as modified)
app.get('/__health', (req, res) => {
  let licence = 'unknown';
  try { licence = require('../services/license').status().state; } catch {}
  res.json({ app: 'social-nexus', version: require('../package.json').version, licence });
});

// For the desktop app's tray and shutdown warning: when the next posts are due.
// Counts and times only (no post text), and only for this PC (127.0.0.1).
app.get('/__schedule', async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (!['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(ip)) return res.status(403).end();
  try {
    const now = Math.floor(Date.now() / 1000);
    const rows = await knex('content_items').where({ status: 'scheduled' }).where('scheduled_at', '>', now)
      .orderBy('scheduled_at', 'asc').limit(500).pluck('scheduled_at');
    if (await knex.schema.hasTable('scheduled_posts')) {
      rows.push(...await knex('scheduled_posts').where({ status: 'pending' }).where('scheduled_at', '>', now).limit(500).pluck('scheduled_at'));
      rows.sort((a, b) => a - b);
    }
    res.json({
      next_at: rows[0] || null,
      due_1h: rows.filter(t => t <= now + 3600).length,
      due_24h: rows.filter(t => t <= now + 86400).length,
    });
  } catch { res.json({ next_at: null, due_1h: 0, due_24h: 0 }); }
});

// ── Static Files ──────────────────────────────────────────────────────────────

// Landing page address, robots.txt and sitemap.xml for search engines
const publicPages = require('./publicPages');
app.use(publicPages.noindexMiddleware); // app, sign-in and one-time links stay out of search results
app.use(publicPages.router);
// Share page for a website chat: the bot full-size on its own address, to try it or send
// the link (the bot's look comes from the workspace's chat profile)
app.get('/webchat/:token', (req, res) => {
  const token = String(req.params.token || '');
  if (!/^webchat_[a-f0-9]{16,64}$/.test(token)) return res.status(404).send('Not found');
  res.set('Cache-Control', 'no-cache');
  res.set('X-Robots-Tag', 'noindex');
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Chat</title><style>html,body{margin:0;height:100%;background:#f3f1ee}</style></head>
<body><script src="/webchat-widget.js" data-token="${token}" data-open="true"></script></body></html>`);
});

// index: false, so "/" goes to the route below (app or landing page), not straight to index.html
// Hosted: fonts and images are cached for a long time, scripts and styles are re-checked often
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: false,
  setHeaders: (res, file) => {
    if (!isHosted) return;
    if (/\.(woff2|png|jpe?g|webp|svg|ico)$/i.test(file)) res.set('Cache-Control', 'public, max-age=604800');
    else if (/\.(js|css)$/i.test(file)) res.set('Cache-Control', 'public, max-age=300, must-revalidate');
  },
}));
// Chart library shipped with the app (works offline; no CDN)
app.get('/vendor/chart.umd.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js')));

// Picture editor library (Fabric.js, MIT licence) shipped with the app: works offline, no CDN
app.get('/vendor/fabric.min.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'node_modules', 'fabric', 'dist', 'index.min.js')));

// Ollama setup: reads (status/recommend) are public for the first-run wizard, but
// changes (select model, pull model — which also write .env) need a logged-in user,
// except on a brand-new install before the first account exists.
async function ollamaSetupGuard(req, res, next) {
  // Local AI runs on a person's own PC: it does not exist on the hosted edition
  if (isHosted) return res.status(404).json({ error: 'Not available on the hosted edition.' });
  if (req.method === 'GET') return next();
  const [{ c }] = await knex('users').count('id as c');
  if (parseInt(c, 10) === 0) return next();
  // These change the app-wide AI setting, so only an admin may use them
  const user = req.session?.userId ? await knex('users').where({ id: req.session.userId }).first() : null;
  if (!user) return res.status(401).json({ error: 'Not authenticated', redirect: '/login' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can change the local AI setup.' });
  return next();
}

// ── Public Routes (no auth required) ─────────────────────────────────────────

app.use('/auth',       authRoutes);   // OAuth platform callbacks
app.use('/users',      usersRoutes);  // register / login / logout / me
app.use('/admin',      adminRoutes);  // super admin dashboard
app.use('/ollama',     ollamaSetupGuard, ollamaRoutes); // guided AI setup (status / pull)
const helpChat = require('../routes/assistant')(knex);
app.use('/api/assistant/public', helpChat.pub); // landing-page chat: no sign-in
app.use('/api/webhooks', require('../routes/webhooks')(knex)); // Meta Lead Ads & Messenger Webhooks (HMAC-SHA256 verified)
// Hosted edition: client approval links are served by this app (no relay or licence server)
if (isHosted) {
  app.use(require('../routes/relayPublic')(knex));
  require('../services/localRelay').startPurge(knex);
}

// ── Rate limits ──────────────────────────────────────────────────────────────
// A general ceiling on the API per person, and a tighter one on actions that use AI
// or fetch other websites (they cost money or reach out from this server).
const { rateLimit, byUserOrIp } = require('../middleware/rateLimit');
const apiLimit = rateLimit({ name: 'api', windowMs: 60_000, max: 600, key: byUserOrIp });
const aiLimitCore = rateLimit({ name: 'ai', windowMs: 60_000, max: 40, key: byUserOrIp, message: 'You’re going very fast. Please wait a minute and try again.' });
const aiLimit = (req, res, next) => (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? next() : aiLimitCore(req, res, next));
app.use('/api', apiLimit);
app.use(['/api/knowledge-base', '/api/tools', '/api/media', '/api/seo', '/api/sellbird', '/api/lead-pipeline/bot', '/api/lead-pipeline/n8n', '/api/email/generate', '/api/generate', '/api/assist'], aiLimit);

// ── Protected Routes (require login) ─────────────────────────────────────────

app.use('/api/license', requireAuth, require('../routes/license'));
// Server edition: paying for the business's plan (billing service at BILLING_URL)
const billingRoutes = require('../routes/billing');
app.use('/billing', billingRoutes.pub);
app.use('/api/billing', requireAuth, withWorkspace, billingRoutes.api);
app.use('/api/backups', requireAuth, require('../routes/backups')(knex));
app.use('/api/bio', requireAuth, withWorkspace, require('../routes/bio')(knex, requirePermission));
// Phone companion (per user, across workspaces)
app.use('/api/companion', requireAuth, (() => {
  const r = require('express').Router();
  const companion = require('../services/companion');
  r.get('/', async (req, res) => {
    try {
      const rows = await knex('companion_pairs').where({ user_id: req.session.userId }).orderBy('id', 'desc');
      res.json(rows.map(p => ({ id: p.id, label: p.label, url: p.url, created_at: p.created_at, last_push: p.last_push })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  r.post('/', async (req, res) => {
    try { res.json(await companion.pair(knex, req.session.userId, req.body?.label || 'My phone')); }
    catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });
  r.delete('/:id', async (req, res) => {
    try { res.json({ success: await companion.unpair(knex, req.session.userId, Number(req.params.id)) }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });
  return r;
})());
app.use('/api/cloud/status', requireAuth, async (req, res) => res.json({ enabled: await require('../services/cloudPosting').enabled() }));
app.use('/api/assistant', requireAuth, withWorkspace, injectUserKeys, helpChat.app); // in-app help chat
app.use('/api/inbox', requireAuth, withWorkspace, injectUserKeys, require('../routes/inbox')(knex, requirePermission));
app.use('/api/media-library', requireAuth, withWorkspace, require('../routes/mediaLibrary')(knex, requirePermission));
app.use('/api',        requireAuth, withWorkspace, injectUserKeys, apiRoutes);
// SEO autopilot (server edition): before /api/seo so its paths match first
app.use('/api/seo/autopilot', requireAuth, withWorkspace, injectUserKeys, require('../routes/seoAutopilot')(knex, requirePermission));
app.use('/api/seo',    requireAuth, withWorkspace, injectUserKeys, seoRoutes);
app.use('/api/email',  requireAuth, withWorkspace, injectUserKeys, emailRoutes);
app.use('/api/tools',  requireAuth, withWorkspace, injectUserKeys, toolsRoutes);
app.use('/api/media',  requireAuth, withWorkspace, injectUserKeys, mediaRoutes);
app.use('/api/config', requireAuth, withWorkspace, injectUserKeys, configRoutes);
app.use('/api/content', requireAuth, withWorkspace, injectUserKeys, require('../routes/content')(knex, requirePermission));
app.use('/api/post-extras', requireAuth, withWorkspace, require('../routes/postExtras')(knex, requirePermission)); // signatures, post sets, RSS feeds
app.use('/api/sellbird', requireAuth, withWorkspace, injectUserKeys, require('../routes/sellbird')(knex, requirePermission));
app.use('/api/lead-pipeline', requireAuth, withWorkspace, injectUserKeys, require('../routes/leadPipeline')(knex, requirePermission));
app.use('/api/meta-reports', requireAuth, withWorkspace, require('../routes/metaReports')(knex, requirePermission));
app.use('/api/contact-sync', requireAuth, withWorkspace, require('../routes/contactSync')(knex, requirePermission));
app.use('/api/knowledge-base', requireAuth, withWorkspace, injectUserKeys, require('../routes/knowledgeBase')(knex, requirePermission));

// ── Tenancy Routes ────────────────────────────────────────────────────────────

app.use('/workspaces', requireAuth, require('../routes/workspaces')(knex));
app.use('/workspaces/:workspaceId/members', requireAuth, require('../routes/members')(knex, withWorkspace, requirePermission));
app.use('/workspaces/:workspaceId/social-accounts', requireAuth, require('../routes/social-accounts')(knex, withWorkspace, requirePermission));
app.use('/invitations', requireAuth, require('../routes/invitations')(knex, withWorkspace, requirePermission));

app.post('/session/active-workspace', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  const workspaceId = Number(req.body.workspaceId);
  const user = await knex('users').where({ id: req.session.userId }).first();
  const isSuperAdmin = platformAdmin.isPlatformAdmin(user);

  let role = workspaceId ? await membershipsRepo.roleFor(req.session.userId, workspaceId) : null;
  if (!role && isSuperAdmin && workspaceId) {
    const ws = await knex('workspaces').where({ id: workspaceId }).first();
    if (ws) {
      role = 'manager';
    }
  }
  if (!role) return res.status(403).json({ error: 'You are not a member of that workspace.' });
  req.session.activeWorkspaceId = workspaceId;
  res.json({ ok: true, role });
});

app.get('/me/workspaces', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  try {
    await require('../services/workspaceHelper').ensureDefaultWorkspace(req.session.userId);
    const user = await knex('users').where({ id: req.session.userId }).first();
    const isSuperAdmin = platformAdmin.isPlatformAdmin(user);
    if (isSuperAdmin) {
      const allWorkspaces = await knex('workspaces')
        .leftJoin('organizations', 'workspaces.org_id', 'organizations.id')
        .select(
          'workspaces.id as workspace_id',
          'workspaces.name as workspace_name',
          'workspaces.name',
          'workspaces.slug',
          'workspaces.org_id',
          'organizations.name as org_name'
        );
      return res.json(allWorkspaces.map(w => ({ ...w, role: 'manager', status: 'active' })));
    }
    res.json(await membershipsRepo.listForUser(req.session.userId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Root: landing for guests, app for logged-in users ────────────────────────

app.get('/', (req, res) => {
  if (req.session?.userId) {
    res.set('X-Robots-Tag', 'noindex, nofollow'); // the app itself is not for search results
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } else if (/Electron/i.test(req.get('user-agent') || '') && !require('../services/edition').isServer()) {
    // The desktop app's own window: straight to sign-in
    res.redirect('/login.html');
  } else {
    // Any browser: visitors see what Social-Nexus is, then sign up or sign in
    publicPages.sendLanding(req, res);
  }
});

// Explicit app route
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  // Unknown data addresses get a clear 404, not the app's page
  if (/^\/(api|auth|users|v1)\//.test(req.path)) return res.status(404).json({ error: 'Not found' });
  // Visitors who aren't signed in get a real 404 page, not the app's page (search engines would index it)
  if (!req.session?.userId) {
    if (/^\/(login|register|signin|signup)\/?$/i.test(req.path)) return res.redirect(302, '/login.html');
    return publicPages.sendNotFound(req, res);
  }
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Error Handler ─────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'production' ? {} : { details: err.message }),
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function bootstrap() {
  try {
    await knex.migrate.latest();
    await runLegacyMigration(knex);
    await require('../services/ensureAdmin')(knex);
    console.log('[DB] Migrations complete.');
  } catch (err) {
    // Starting on a half-migrated schema corrupts data in confusing ways — stop instead.
    console.error('[DB] Migration error:', err.message);
    throw err;
  }

  app.listen(PORT, HOST, async () => {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║   NexaDrip — Radixile Technology Sol.     ║`);
    console.log(`║   http://localhost:${PORT}                ║`);
    console.log(`╚════════════════════════════════════════╝\n`);

    require('../services/secrets').start(knex); // encrypt any login still saved in plain text
    scheduler.start();
    require('../services/tokenRefresher').start(knex); // renews platform logins daily
    setInterval(() => require('../services/social').cleanupHostedPhotos(knex).catch(() => {}), 3600 * 1000).unref?.(); // hidden FB photos
    if ((process.env.DB_CLIENT || 'sqlite') === 'sqlite') require('../services/backup').start(knex); // daily backup
    require('../services/festivals').start(require('../services/license').serverUrl()); // festival calendar updates
    require('../services/insights').start(knex); // likes, comments and reach, daily
    require('../services/approvals').start(knex); // answers to client approval links
    require('../services/rss').start(knex); // blog / news feeds → new posts
    require('../services/leadPipeline/broadcast').recoverInterrupted(knex).catch(() => {}); // broadcasts cut off by a restart
    require('../services/inbox').start(knex); // new comments on published posts
    require('../services/contactSync').start(knex); // new and changed contacts → Google Sheet / Salesforce
    require('../services/companion').start(knex); // phone companion summaries and actions
    require('../services/cloudPosting').start(knex); // PC-off safety net (paid editions)
    require('../services/billing').start(); // server edition: keeps business plans in step with billing
    require('../services/license').start(); // background licence check

    // Automated Webhook & Tunnel Manager:
    // When on Server (PUBLIC_URL or APP_URL): binds public domain (e.g. app.yourbusiness.com)
    // When on Localhost: provisions zero-config Cloudflare HTTPS tunnel for Meta Webhook ingestion
    try {
      const tunnelManager = require('../services/leadPipeline/tunnelManager');
      tunnelManager.start(PORT).catch(err => console.warn('[Tunnel] Startup notice:', err.message));
    } catch (err) {
      console.warn('[Tunnel] Init notice:', err.message);
    }

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
