/**
 * NEXUS Electron Main Process
 * Spawns the Express server as a child process (avoids native module rebuild issues)
 * and manages the browser window + system tray.
 */

const { app, BrowserWindow, Tray, Menu, shell, dialog, ipcMain, nativeImage } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const cp     = require('child_process');

// ── Config ────────────────────────────────────────────────────────────────────

const PORT      = process.env.PORT || 3000;
const APP_URL   = `http://localhost:${PORT}`;
const IS_DEV    = process.env.NODE_ENV === 'development';
const APP_ROOT  = IS_DEV ? path.join(__dirname, '..') : path.join(process.resourcesPath, 'app');
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.png');

// ── State ─────────────────────────────────────────────────────────────────────

let mainWindow   = null;
let splashWin    = null;
let tray         = null;
let serverProc   = null;

// ── Find system Node.js ───────────────────────────────────────────────────────

function findNodeExe() {
  // Try the PATH first
  try {
    const result = cp.execSync('where node', { timeout: 3000 }).toString().trim();
    const lines  = result.split(/[\r\n]+/).filter(Boolean);
    for (const line of lines) {
      if (line.toLowerCase().endsWith('.exe') && fs.existsSync(line)) return line;
    }
  } catch {}

  // Common Windows locations
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
    path.join(process.env.APPDATA || '', '..', 'Local', 'Programs', 'nodejs', 'node.exe'),
  ];

  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }

  return 'node'; // fallback — rely on PATH
}

// ── Start Express server as child process ─────────────────────────────────────

function startServer() {
  const nodeExe    = findNodeExe();
  const serverFile = path.join(APP_ROOT, 'server', 'index.js');
  const dataDir    = path.join(app.getPath('userData'));
  const envFile    = path.join(dataDir, '.env');

  // Ensure userData dir exists
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // First run: copy .env.example
  if (!fs.existsSync(envFile)) {
    const example = path.join(APP_ROOT, '.env.example');
    if (fs.existsSync(example)) {
      let content = fs.readFileSync(example, 'utf8');
      const secret = require('crypto').randomBytes(32).toString('base64');
      content = content.replace(/SESSION_SECRET=.*/, `SESSION_SECRET=${secret}`);
      fs.writeFileSync(envFile, content);
    }
  }

  const env = {
    ...process.env,
    PORT:            String(PORT),
    NEXUS_DATA_DIR:  dataDir,
    DOTENV_CONFIG_PATH: envFile,
    NODE_ENV:        'production',
  };

  console.log(`[Electron] Starting server: ${nodeExe} ${serverFile}`);

  serverProc = cp.spawn(nodeExe, [serverFile], {
    cwd:   APP_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout.on('data', d => process.stdout.write('[Server] ' + d));
  serverProc.stderr.on('data', d => process.stderr.write('[Server ERR] ' + d));

  serverProc.on('error', err => {
    dialog.showErrorBox('NEXUS — Server Error',
      `Failed to start the NEXUS server.\n\nError: ${err.message}\n\n` +
      `Make sure Node.js is installed: https://nodejs.org`
    );
    app.quit();
  });

  serverProc.on('exit', (code) => {
    if (code !== 0 && !app.isQuiting) {
      console.error(`[Electron] Server exited with code ${code}`);
    }
  });
}

// ── Wait until server responds ────────────────────────────────────────────────

function waitForServer(maxMs = 30000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + maxMs;
    const check = () => {
      if (Date.now() > deadline) return reject(new Error('Server startup timeout'));
      const req = http.get(APP_URL, res => { res.destroy(); resolve(); });
      req.on('error', () => setTimeout(check, 500));
      req.setTimeout(800, () => { req.destroy(); });
    };
    check();
  });
}

// ── Splash Window ─────────────────────────────────────────────────────────────

function createSplashWindow() {
  splashWin = new BrowserWindow({
    width: 480, height: 300, frame: false, transparent: true,
    resizable: false, center: true, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWin.loadFile(path.join(__dirname, 'splash.html'));
}

// ── Main Window ───────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 920, minWidth: 900, minHeight: 600,
    show: false,
    title: 'NEXUS — AI Marketing Platform',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    backgroundColor: '#080c14',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.once('ready-to-show', () => {
    splashWin?.close(); splashWin = null;
    mainWindow.show();
  });

  mainWindow.on('close', e => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
      tray?.displayBalloon({
        iconType: 'info', title: 'NEXUS is still running',
        content:  'Right-click the tray icon to quit.',
      });
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── System Tray ───────────────────────────────────────────────────────────────

function createTray() {
  const icon = fs.existsSync(ICON_PATH)
    ? nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('NEXUS — AI Marketing Platform');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '⚡ Open NEXUS',      click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: '🌐 Open in Browser', click: () => shell.openExternal(APP_URL) },
    { label: '📖 Documentation',   click: () => shell.openExternal(`${APP_URL}/help.html`) },
    { type: 'separator' },
    { label: `🟢 Running on :${PORT}`, enabled: false },
    { type: 'separator' },
    { label: '🚪 Quit', click: () => { app.isQuiting = true; serverProc?.kill(); app.quit(); } },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── App Lifecycle ─────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); });
}

app.whenReady().then(async () => {
  createSplashWindow();
  startServer();

  try {
    await waitForServer();
  } catch (err) {
    dialog.showErrorBox('NEXUS — Startup Failed',
      `Server did not respond on port ${PORT}.\n\n${err.message}\n\nCheck that Node.js is installed.`
    );
    serverProc?.kill();
    app.quit();
    return;
  }

  createMainWindow();
  createTray();
});

app.on('window-all-closed', () => { /* stay in tray */ });
app.on('activate', () => { mainWindow?.show(); });
app.on('before-quit', () => { app.isQuiting = true; serverProc?.kill(); });
