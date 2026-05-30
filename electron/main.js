/**
 * NEXUS — Electron Main Process
 * Company: Radixile Technology Solutions LLP (India)
 *
 * Bundles Node.js, manages the Express server as a child process,
 * provides system tray, browser window, Windows compatibility checks,
 * and proper permission/error handling.
 */

const {
  app, BrowserWindow, Tray, Menu, shell, dialog,
  ipcMain, nativeImage, Notification, powerSaveBlocker,
} = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const cp     = require('child_process');
const os     = require('os');

// ── Company & App Info ────────────────────────────────────────────────────────

const COMPANY   = 'Radixile Technology Solutions LLP';
const APP_NAME  = 'NEXUS';
const APP_VER   = app.getVersion();
const PORT      = parseInt(process.env.PORT || '3000');
const APP_URL   = `http://localhost:${PORT}`;
const IS_DEV    = process.env.NODE_ENV === 'development';

// Paths
const APP_ROOT  = IS_DEV
  ? path.join(__dirname, '..')
  : path.join(process.resourcesPath, 'app');

const BUNDLED_NODE = IS_DEV
  ? path.join(__dirname, '..', 'resources', 'node', 'node.exe')
  : path.join(process.resourcesPath, 'node', 'node.exe');

const ICON_PATH = IS_DEV
  ? path.join(__dirname, '..', 'build', 'icon.png')
  : path.join(process.resourcesPath, 'build', 'icon.png');

const DATA_DIR  = path.join(app.getPath('userData'));

// ── State ─────────────────────────────────────────────────────────────────────

let mainWindow   = null;
let splashWin    = null;
let tray         = null;
let serverProc   = null;
let psBlockerId  = null;

// ── Windows Compatibility Check ───────────────────────────────────────────────

function checkWindowsCompatibility() {
  const release = os.release(); // e.g. "10.0.19041"
  const parts   = release.split('.').map(Number);
  const major   = parts[0];
  const build   = parts[2] || 0;

  const issues = [];

  // Windows 7 / 8 — Electron 35 requires Windows 10+
  if (major < 10) {
    issues.push(`Windows ${major} is not supported.\n${APP_NAME} requires Windows 10 (version 1903) or later.`);
  }

  // Windows 10 old builds (below 1903 = build 18362)
  if (major === 10 && build < 18362) {
    issues.push(`Your Windows 10 build (${build}) is outdated.\n${APP_NAME} works best on Windows 10 version 1903 or later.\nPlease run Windows Update.`);
  }

  // RAM check — warn if less than 2GB free
  const freeRamGB = os.freemem() / (1024 ** 3);
  if (freeRamGB < 0.5) {
    issues.push(`Low available memory (${freeRamGB.toFixed(1)} GB free).\nNEXUS may run slowly. Close other applications for better performance.`);
  }

  // Disk space check — warn if less than 500MB free on system drive
  try {
    const { execSync } = require('child_process');
    const diskInfo = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace /value', { timeout: 3000 }).toString();
    const match    = diskInfo.match(/FreeSpace=(\d+)/);
    if (match) {
      const freeGB = parseInt(match[1]) / (1024 ** 3);
      if (freeGB < 0.5) {
        issues.push(`Low disk space on C: drive (${freeGB.toFixed(1)} GB free).\nNEXUS needs at least 500MB to operate.`);
      }
    }
  } catch {}

  return issues;
}

// ── Find Node.js ──────────────────────────────────────────────────────────────

function findNodeExe() {
  // 1. Bundled node.exe (highest priority — fully self-contained)
  if (fs.existsSync(BUNDLED_NODE)) {
    return BUNDLED_NODE;
  }

  // 2. System PATH
  try {
    const result = cp.execSync('where node 2>nul', { timeout: 3000 }).toString().trim();
    const lines  = result.split(/[\r\n]+/).filter(l => l.toLowerCase().endsWith('.exe'));
    for (const line of lines) {
      if (fs.existsSync(line.trim())) return line.trim();
    }
  } catch {}

  // 3. Common installation paths
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
    path.join(process.env.APPDATA      || '', '..', 'Local', 'Programs', 'nodejs', 'node.exe'),
    'C:\\nodejs\\node.exe',
  ];

  // nvm paths
  try {
    const nvmHome = process.env.NVM_HOME || 'C:\\nvm4w';
    if (fs.existsSync(nvmHome)) {
      const nvmDirs = fs.readdirSync(nvmHome).filter(d => d.startsWith('v'));
      for (const d of nvmDirs) {
        candidates.push(path.join(nvmHome, d, 'node.exe'));
      }
    }
  } catch {}

  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }

  return null;
}

// ── Prepare Environment & .env ────────────────────────────────────────────────

function prepareDataDir() {
  if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR,   { recursive: true });

  const contentDir = path.join(DATA_DIR, 'content');
  if (!fs.existsSync(contentDir)) fs.mkdirSync(contentDir, { recursive: true });

  const envFile    = path.join(DATA_DIR, '.env');
  const envExample = path.join(APP_ROOT, '.env.example');

  if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
    let content = fs.readFileSync(envExample, 'utf8');
    const secret = require('crypto').randomBytes(32).toString('base64');
    content = content
      .replace(/SESSION_SECRET=.*/, `SESSION_SECRET=${secret}`)
      .replace(/CONTENT_FOLDER=.*/, `CONTENT_FOLDER=${contentDir.replace(/\\/g, '/')}`);
    fs.writeFileSync(envFile, content, 'utf8');
  }

  return { envFile, contentDir };
}

// ── Start Express Server ──────────────────────────────────────────────────────

function startServer(nodeExe, envFile) {
  const serverFile = path.join(APP_ROOT, 'server', 'index.js');

  const env = {
    ...process.env,
    PORT:               String(PORT),
    NEXUS_DATA_DIR:     DATA_DIR,
    DOTENV_CONFIG_PATH: envFile,
    NODE_ENV:           'production',
    ELECTRON:           'true',
    // Disable auto-open browser (Electron manages the window)
    NEXUS_NO_BROWSER:   'true',
  };

  serverProc = cp.spawn(nodeExe, [serverFile], {
    cwd:   APP_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout?.on('data', d => {
    const msg = d.toString().trim();
    if (msg) console.log('[Server]', msg);
  });

  serverProc.stderr?.on('data', d => {
    const msg = d.toString().trim();
    if (msg) console.error('[Server ERR]', msg);
  });

  serverProc.on('error', err => {
    showError(
      `${APP_NAME} — Server Error`,
      `The server process failed to start.\n\nError: ${err.message}\n\n` +
      (err.code === 'ENOENT'
        ? `Node.js not found at: ${nodeExe}\n\nPlease reinstall ${APP_NAME}.`
        : `Please contact support at: support@radixile.com`)
    );
  });

  serverProc.on('exit', (code, signal) => {
    if (!app.isQuiting && code !== 0 && code !== null) {
      console.error(`[Electron] Server exited unexpectedly (code ${code})`);
    }
  });
}

// ── Wait For Server ───────────────────────────────────────────────────────────

function waitForServer(timeoutMs = 35000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      if (Date.now() > deadline) return reject(new Error(`Server did not start within ${timeoutMs / 1000}s`));
      const req = http.get(APP_URL, res => { res.destroy(); resolve(); });
      req.setTimeout(800, () => req.destroy());
      req.on('error', () => setTimeout(attempt, 600));
    };
    attempt();
  });
}

// ── Error Dialog Helper ───────────────────────────────────────────────────────

function showError(title, message) {
  dialog.showMessageBoxSync({
    type:    'error',
    title,
    message,
    buttons: ['OK'],
    icon:    fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    detail:  `\n${COMPANY}\nVersion ${APP_VER}`,
  });
}

// ── Splash Window ─────────────────────────────────────────────────────────────

function createSplashWindow() {
  splashWin = new BrowserWindow({
    width: 480, height: 300, frame: false, transparent: true,
    resizable: false, center: true, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
  });
  splashWin.loadFile(path.join(__dirname, 'splash.html'));
}

// ── Main Window ───────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 920, minWidth: 960, minHeight: 640,
    show: false,
    title: `${APP_NAME} — AI Digital Marketing`,
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    backgroundColor: '#080c14',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      webSecurity:      true,
      spellcheck:       false,
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.once('ready-to-show', () => {
    splashWin?.close(); splashWin = null;
    mainWindow.show();
    mainWindow.focus();
  });

  // Graceful minimize to tray
  mainWindow.on('close', e => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
      showTrayNotification(
        `${APP_NAME} is running`,
        'NEXUS is minimized to the system tray. Right-click the icon to quit.',
      );
    }
  });

  // Open all external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  // Handle navigation errors
  mainWindow.webContents.on('did-fail-load', (event, code, desc) => {
    if (code === -6 || code === -105) {
      // Server not ready yet — retry
      setTimeout(() => mainWindow.loadURL(APP_URL), 2000);
    }
  });
}

// ── System Tray ───────────────────────────────────────────────────────────────

function createTray() {
  let icon;
  try {
    icon = fs.existsSync(ICON_PATH)
      ? nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 })
      : nativeImage.createEmpty();
  } catch { icon = nativeImage.createEmpty(); }

  tray = new Tray(icon);
  tray.setToolTip(`${APP_NAME} — ${COMPANY}`);

  const buildMenu = () => Menu.buildFromTemplate([
    { label: `⚡  ${APP_NAME}`,             enabled: false },
    { type: 'separator' },
    { label: '🖥️  Open Dashboard',           click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: '🌐  Open in Browser',          click: () => shell.openExternal(APP_URL) },
    { label: '📖  Help & Documentation',     click: () => shell.openExternal(`${APP_URL}/help.html`) },
    { type: 'separator' },
    { label: `🟢  Server: localhost:${PORT}`, enabled: false },
    { label: `v${APP_VER} · ${COMPANY}`,     enabled: false },
    { type: 'separator' },
    {
      label: '🚪  Quit NEXUS',
      click: () => {
        app.isQuiting = true;
        serverProc?.kill('SIGTERM');
        if (psBlockerId !== null) powerSaveBlocker.stop(psBlockerId);
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(buildMenu());
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
  tray.on('right-click',  () => { tray.popUpContextMenu(buildMenu()); });
}

// ── Tray Notification ─────────────────────────────────────────────────────────

function showTrayNotification(title, body) {
  if (!Notification.isSupported()) return;
  try {
    new Notification({
      title,
      body,
      icon:   fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
      silent: true,
    }).show();
  } catch {}
}

// ── Firewall / Port Check ─────────────────────────────────────────────────────

function checkPortAvailable() {
  return new Promise(resolve => {
    const server = require('net').createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(PORT, '127.0.0.1');
  });
}

// ── Single Instance ───────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized() || !mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Windows compatibility checks
  const issues = checkWindowsCompatibility();
  if (issues.some(i => i.includes('not supported'))) {
    showError(`${APP_NAME} — Incompatible System`, issues.join('\n\n'));
    app.quit();
    return;
  }
  // Show warnings but continue
  for (const warning of issues) {
    dialog.showMessageBoxSync({
      type: 'warning', title: `${APP_NAME} — Warning`,
      message: warning, buttons: ['Continue Anyway'],
    });
  }

  // Port availability check
  const portFree = await checkPortAvailable();
  if (!portFree) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: `${APP_NAME} — Port ${PORT} In Use`,
      message: `Port ${PORT} is already in use by another application.\n\nThis may be a previous instance of NEXUS.`,
      buttons: ['Try to Connect', 'Cancel'],
      defaultId: 0,
    });
    if (choice === 1) { app.quit(); return; }
    // Try connecting to existing instance
    createSplashWindow();
    try {
      await waitForServer(5000);
      createMainWindow();
      createTray();
      return;
    } catch { app.quit(); return; }
  }

  // Find Node.js
  const nodeExe = findNodeExe();
  if (!nodeExe) {
    showError(
      `${APP_NAME} — Node.js Not Found`,
      `Could not find Node.js on this computer.\n\nNEXUS requires Node.js to run the server.\n\n` +
      `The bundled Node.js may be missing. Please reinstall ${APP_NAME}.\n\n` +
      `Or download Node.js manually from: https://nodejs.org`
    );
    app.quit();
    return;
  }

  // Prepare data directory and .env
  const { envFile } = prepareDataDir();

  // Show splash
  createSplashWindow();

  // Start server
  startServer(nodeExe, envFile);

  // Wait for server with progress
  try {
    await waitForServer(40000);
  } catch (err) {
    showError(
      `${APP_NAME} — Startup Timeout`,
      `The NEXUS server failed to start in time.\n\nError: ${err.message}\n\n` +
      `Possible causes:\n` +
      `• Antivirus software blocking Node.js\n` +
      `• Windows Firewall blocking port ${PORT}\n` +
      `• Missing dependencies (try reinstalling)\n\n` +
      `Contact: support@radixile.com`
    );
    serverProc?.kill();
    app.quit();
    return;
  }

  // Prevent system sleep while server is running
  psBlockerId = powerSaveBlocker.start('prevent-app-suspension');

  // Create UI
  createMainWindow();
  createTray();

  // First-run notification
  const firstRunFlag = path.join(DATA_DIR, '.first_run_done');
  if (!fs.existsSync(firstRunFlag)) {
    fs.writeFileSync(firstRunFlag, '1');
    setTimeout(() => {
      showTrayNotification(
        `Welcome to ${APP_NAME}!`,
        'Register your admin account to get started. Click here to open NEXUS.',
      );
    }, 3000);
  }
});

app.on('window-all-closed', () => { /* keep running in tray */ });
app.on('activate', () => { mainWindow?.show(); mainWindow?.focus(); });
app.on('before-quit', () => {
  app.isQuiting = true;
  serverProc?.kill('SIGTERM');
  if (psBlockerId !== null) try { powerSaveBlocker.stop(psBlockerId); } catch {}
});

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('app-version',  () => APP_VER);
ipcMain.handle('data-dir',     () => DATA_DIR);
ipcMain.handle('company',      () => COMPANY);
ipcMain.handle('open-external',(_,url) => shell.openExternal(url));
ipcMain.handle('show-notification', (_, { title, body }) => showTrayNotification(title, body));
