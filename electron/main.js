/**
 * Social-Nexus — Electron Main Process
 * Company: Radixile Technology Solutions LLP (India)
 *
 * Bundles Node.js, manages the Express server as a child process,
 * provides system tray, browser window, Windows compatibility checks,
 * and proper permission/error handling.
 */

const {
  app, BrowserWindow, Tray, Menu, shell, dialog,
  ipcMain, nativeImage, Notification, powerSaveBlocker, safeStorage,
} = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const cp     = require('child_process');
const os     = require('os');

// ── Company & App Info ────────────────────────────────────────────────────────

const COMPANY   = 'Radixile Technology Solutions LLP';
const APP_NAME  = 'Social-Nexus';
const APP_FULL  = 'Social-Nexus by Radixile Technology Solutions';
const APP_VER   = app.getVersion();
const PORT      = parseInt(process.env.PORT || '3000');
const APP_URL   = `http://localhost:${PORT}`;
const IS_DEV    = process.env.NODE_ENV === 'development';

// Paths — resolved after app is ready (app.getPath needs app to be initialised)
let APP_ROOT, BUNDLED_NODE, ICON_PATH;

function resolvePaths() {
  const exeDir = path.dirname(app.getPath('exe')); // e.g. D:\Radixile\social\Social-Nexus

  if (IS_DEV) {
    APP_ROOT     = path.join(__dirname, '..');
    BUNDLED_NODE = path.join(__dirname, '..', 'resources', 'node', 'node.exe');
    ICON_PATH    = path.join(__dirname, '..', 'build', 'icon.png');
  } else {
    APP_ROOT     = path.join(process.resourcesPath, 'app');

    // Try multiple locations for bundled node.exe
    const candidates = [
      path.join(exeDir,                    'resources', 'node', 'node.exe'),
      path.join(process.resourcesPath,     'node',              'node.exe'),
      path.join(exeDir,                    'node',              'node.exe'),
    ];
    BUNDLED_NODE = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || candidates[0];

    ICON_PATH = [
      path.join(exeDir,              'resources', 'build', 'icon.png'),
      path.join(process.resourcesPath, 'build',            'icon.png'),
    ].find(p => { try { return fs.existsSync(p); } catch { return false; } }) || '';
  }

  console.log('[Paths] exeDir:       ', exeDir);
  console.log('[Paths] APP_ROOT:     ', APP_ROOT);
  console.log('[Paths] BUNDLED_NODE: ', BUNDLED_NODE);
  console.log('[Paths] ICON_PATH:    ', ICON_PATH);
}

// Data lives in %APPDATA%\Social-Nexus. Set explicitly so it never depends on the
// package name, and carry over data from the old "NEXUS" folder on first start.
app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));
const DATA_DIR  = app.getPath('userData');
const LEGACY_DIR = path.join(app.getPath('appData'), 'NEXUS');

// Runs once, after the single-instance lock (so two quick launches can't both copy).
// Copies the old NEXUS data, repoints absolute paths in .env, then renames the old
// folder so its plain-text secrets aren't left in a "live" location. Returns the
// backup folder path when a migration happened (the user is offered to delete it).
function migrateLegacyDataDir() {
  try {
    if (!fs.existsSync(LEGACY_DIR)) return null;
    if (fs.existsSync(path.join(DATA_DIR, 'nexus.db'))) return null; // already migrated / new data
    // The old app may still be running (WAL touched in the last 10 s) — try next start
    const wal = path.join(LEGACY_DIR, 'nexus.db-wal');
    if (fs.existsSync(wal) && Date.now() - fs.statSync(wal).mtimeMs < 10000) return null;

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.cpSync(LEGACY_DIR, DATA_DIR, { recursive: true, errorOnExist: false, force: false });

    // .env holds absolute paths (e.g. CONTENT_FOLDER) that still point at the old folder
    const envFile = path.join(DATA_DIR, '.env');
    if (fs.existsSync(envFile)) {
      const legacyFwd = LEGACY_DIR.split(path.sep).join('/');
      const newFwd = DATA_DIR.split(path.sep).join('/');
      const text = fs.readFileSync(envFile, 'utf8')
        .split(LEGACY_DIR).join(DATA_DIR)
        .split(legacyFwd).join(newFwd);
      fs.writeFileSync(envFile, text, 'utf8');
    }

    fs.writeFileSync(path.join(DATA_DIR, '.migrated_from_nexus'), new Date().toISOString());
    const backup = `${LEGACY_DIR}.migrated-${new Date().toISOString().slice(0, 10)}`;
    fs.renameSync(LEGACY_DIR, backup);
    console.log('[Data] Moved NEXUS data to', DATA_DIR, '— old copy kept at', backup);
    return backup;
  } catch (err) {
    console.error('[Data] Could not migrate old NEXUS data:', err.message);
    return null;
  }
}

// Offer to delete the old copy (it contains the same posts, keys and logins)
function offerLegacyBackupDeletion(backup) {
  if (!backup || !fs.existsSync(backup)) return;
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    title: `${APP_NAME} — Data moved`,
    message: 'Your NEXUS data was moved to Social-Nexus.',
    detail: `An old copy is still at:
${backup}

It contains your posts, API keys and social logins. Delete it now? (Recommended once you have checked everything works.)`,
    buttons: ['Delete old copy', 'Keep for now'],
    defaultId: 1,
    cancelId: 1,
  });
  if (choice === 0) {
    try { fs.rmSync(backup, { recursive: true, force: true }); } catch (err) { console.error('[Data] Could not delete', backup, err.message); }
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

let mainWindow   = null;
let splashWin    = null;
let tray         = null;
let serverProc   = null;
let psBlockerId  = null;
// Started by Windows at sign-in: stay quietly in the tray
const START_HIDDEN = process.argv.includes('--hidden');
let schedule     = { next_at: null, due_1h: 0, due_24h: 0 };
let updateReady  = null; // version downloaded and waiting to be installed

// ── Automatic updates ─────────────────────────────────────────────────────────
// Checks Radixile's update server at start-up and every 6 hours, downloads in the
// background, and installs when the app is next closed (or on "Restart to update"
// in the tray). Windows only accepts an update signed by Radixile (publisherName),
// so a tampered download is refused. The portable .exe can't update itself.
let autoUpdater = null;
function setupAutoUpdate(refreshTray) {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: m => serverLog(`UPDATE ${m}`), warn: m => serverLog(`UPDATE WARN ${m}`), error: m => serverLog(`UPDATE ERR ${m}`), debug: () => {} };
  autoUpdater.on('update-downloaded', info => {
    updateReady = info.version;
    refreshTray?.();
    showTrayNotification(`${APP_NAME} ${info.version} is ready`, 'It installs the next time Social-Nexus closes, or choose "Restart to update" from the tray icon.');
  });
  autoUpdater.on('error', err => serverLog(`UPDATE ERR ${err?.message || err}`));
  const check = () => autoUpdater.checkForUpdates().catch(err => serverLog(`UPDATE ERR ${err.message}`));
  setTimeout(check, 90 * 1000);
  setInterval(check, 6 * 3600 * 1000);
}

function installUpdateNow() {
  if (!autoUpdater || !updateReady) return;
  if (schedule.due_1h > 0) {
    const choice = dialog.showMessageBoxSync({
      type: 'question', title: APP_NAME, buttons: ['Update now', 'Later'], defaultId: 1, cancelId: 1,
      message: 'A post is due within the hour', detail: 'Updating takes about a minute. Update now anyway?',
    });
    if (choice !== 0) return;
  }
  app.isQuiting = true;
  serverProc?.kill('SIGTERM');
  autoUpdater.quitAndInstall(true, true); // silent install, then start again
}


// ── Desktop settings (start with Windows) ─────────────────────────────────────

function desktopSettingsFile() { return path.join(DATA_DIR, 'desktop-settings.json'); }
function readDesktopSettings() {
  try { return JSON.parse(fs.readFileSync(desktopSettingsFile(), 'utf8')); } catch { return {}; }
}
function writeDesktopSettings(s) {
  try { fs.writeFileSync(desktopSettingsFile(), JSON.stringify(s, null, 2)); } catch {}
}

// Scheduled posts only go out while the app runs, so it starts with Windows by
// default (in the tray, no window). The person can switch it off in the tray menu.
function applyStartWithWindows(enabled) {
  if (!app.isPackaged) return; // dev runs would register electron.exe
  app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--hidden'] });
}
function initStartWithWindows() {
  const s = readDesktopSettings();
  if (s.startWithWindows === undefined) {
    s.startWithWindows = true; writeDesktopSettings(s);
    // Say so once, so it isn't a surprise
    if (app.isPackaged) setTimeout(() => showTrayNotification(`${APP_NAME} starts with Windows`, 'So scheduled posts go out on time. You can turn this off from the tray icon (right-click → Start with Windows).'), 8000);
  }
  applyStartWithWindows(s.startWithWindows);
}
function setStartWithWindows(enabled) {
  writeDesktopSettings({ ...readDesktopSettings(), startWithWindows: !!enabled });
  applyStartWithWindows(enabled);
}

// ── Upcoming posts (tray line, quit and shutdown warnings) ────────────────────

function fetchSchedule() {
  return new Promise(resolve => {
    const req = http.get(`${APP_URL}/__schedule`, { timeout: 3000 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { try { schedule = JSON.parse(body); } catch {} resolve(schedule); });
    });
    req.on('error', () => resolve(schedule));
    req.on('timeout', () => { req.destroy(); resolve(schedule); });
  });
}

function nextPostLabel() {
  if (!schedule.next_at) return 'No posts scheduled';
  const d = new Date(schedule.next_at * 1000);
  return `Next post: ${d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`;
}

function dueWarning() {
  const n = schedule.due_24h;
  return `${n} scheduled post${n === 1 ? ' is' : 's are'} due in the next 24 hours. Posts only go out while ${APP_NAME} is running.`;
}

// ── Windows Compatibility Check ───────────────────────────────────────────────

function checkWindowsCompatibility() {
  const platform = process.platform;

  // macOS compatibility
  if (platform === 'darwin') {
    const release = os.release();
    const major   = parseInt(release.split('.')[0]);
    // macOS Catalina (10.15) = Darwin 19
    if (major < 19) {
      return [`macOS version is too old.\n${APP_NAME} requires macOS Catalina (10.15) or later.`];
    }
    return [];
  }

  // Linux — generally compatible
  if (platform === 'linux') return [];

  const release = os.release();
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

  // Disk space check — warn if less than 500MB free where the data lives
  // (wmic is removed from recent Windows 11 builds; statfs is instant)
  try {
    const st = fs.statfsSync(app.getPath('appData'));
    const freeGB = (st.bavail * st.bsize) / (1024 ** 3);
    if (freeGB < 0.5) {
      issues.push(`Low disk space (${freeGB.toFixed(1)} GB free).
Social-Nexus needs at least 500MB to operate.`);
    }
  } catch {}

  return issues;
}

// ── Find Node.js ──────────────────────────────────────────────────────────────

function findNodeExe() {
  // 1. Bundled node.exe (highest priority — fully self-contained)
  try { if (BUNDLED_NODE && fs.existsSync(BUNDLED_NODE)) return BUNDLED_NODE; } catch {}
  console.warn('[Node] Bundled node.exe not found at:', BUNDLED_NODE);

  // Installed app: only the bundled runtime. A system Node of another version can't
  // load the native database modules, and swapping the runtime would bypass the
  // app's integrity checks. The searches below are for development only.
  if (app.isPackaged) return null;

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

// Server output goes to DATA_DIR\logs\server.log (rotated at 2 MB, 3 files kept)
// so support can see what happened. Logs stay on this PC.
const LOG_DIR = path.join(DATA_DIR, 'logs');
let logStream = null;
function serverLog(line) {
  try {
    if (!logStream) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      const file = path.join(LOG_DIR, 'server.log');
      if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
        for (let i = 2; i >= 1; i--) {
          const from = path.join(LOG_DIR, i === 1 ? 'server.log' : `server.${i - 1}.log`);
          if (fs.existsSync(from)) fs.renameSync(from, path.join(LOG_DIR, `server.${i}.log`));
        }
      }
      logStream = fs.createWriteStream(file, { flags: 'a' });
    }
    logStream.write(`${new Date().toISOString()} ${line}
`);
  } catch {}
}

let serverStartArgs = null;
let serverRestarts = 0;
let serverReady = false;
let serverExited = false;
const lastServerErr = []; // last few error lines, shown if startup fails

// The key that encrypts saved logins and API keys in the database. Kept in
// datakey.bin, protected by Windows for this user (DPAPI via safeStorage), so a
// copy of the data folder on another PC or account can't read the logins.
function dataKey() {
  const file = path.join(DATA_DIR, 'datakey.bin');
  const plainFile = path.join(DATA_DIR, '.data-key'); // made by the server before this existed
  const canProtect = safeStorage.isEncryptionAvailable();
  try {
    if (fs.existsSync(file)) return safeStorage.decryptString(fs.readFileSync(file));
  } catch (err) {
    serverLog(`DATA KEY could not be unlocked: ${err.message}`);
    // e.g. the Windows password was reset by an administrator, or the data folder
    // was copied from another PC/user: saved logins can't be read any more
    setTimeout(() => dialog.showMessageBox({
      type: 'warning', title: APP_NAME, buttons: ['OK'],
      message: 'Saved logins need signing in again',
      detail: 'Windows could not unlock the key that protects your saved social media logins (this happens after a Windows password reset or moving to another PC). Your posts are safe. Open Settings → Social Platforms and click Connect on each account.',
    }), 6000);
    try { fs.renameSync(file, `${file}.unreadable-${Date.now()}`); } catch {}
  }
  let key = null;
  try { if (fs.existsSync(plainFile)) key = fs.readFileSync(plainFile, 'utf8').trim(); } catch {}
  if (!key) key = require('crypto').randomBytes(32).toString('base64');
  if (canProtect) {
    try {
      fs.writeFileSync(file, safeStorage.encryptString(key));
      if (fs.existsSync(plainFile)) fs.unlinkSync(plainFile);
      return key;
    } catch {}
  }
  // Windows protection isn't available: keep the key in a file next to the data,
  // so it stays the same from one start to the next
  try { fs.writeFileSync(plainFile, key, { mode: 0o600 }); } catch {}
  return key;
}

function startServer(nodeExe, envFile) {
  serverStartArgs = { nodeExe, envFile };
  const serverFile = path.join(APP_ROOT, 'server', 'index.js');

  const ownEnv = {
    PORT:               String(PORT),
    NEXUS_DATA_DIR:     DATA_DIR,
    DOTENV_CONFIG_PATH: envFile,
    NODE_ENV:           'production',
    ELECTRON:           'true',
    // Disable auto-open browser (Electron manages the window)
    NEXUS_NO_BROWSER:   'true',
  };
  const key = dataKey();
  if (key) ownEnv.NEXUS_DATA_KEY = key;
  const env = { ...process.env, ...ownEnv };
  // Packaged server: pass on only the variables Windows and networking need.
  // Others (NODE_OPTIONS, NODE_PATH, OPENSSL_CONF, UV_*, LICENSE_*…) could load
  // code into the server or change licensing, so they are dropped.
  if (app.isPackaged) {
    const KEEP = /^(SYSTEMROOT|WINDIR|SYSTEMDRIVE|TEMP|TMP|USERPROFILE|USERNAME|USERDOMAIN|COMPUTERNAME|APPDATA|LOCALAPPDATA|PROGRAMDATA|HOMEDRIVE|HOMEPATH|PATHEXT|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|LANG|TZ|HTTPS?_PROXY|NO_PROXY)$/i;
    for (const k of Object.keys(env)) if (!KEEP.test(k) && !(k in ownEnv)) delete env[k];
    env.PATH = [path.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32'), env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows'].join(';');
  }

  serverProc = cp.spawn(nodeExe, [serverFile], {
    cwd:   APP_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverProc.stdout?.on('data', d => {
    const msg = d.toString().trim();
    if (msg) { console.log('[Server]', msg); serverLog(msg); }
  });

  serverProc.stderr?.on('data', d => {
    const msg = d.toString().trim();
    if (msg) {
      console.error('[Server ERR]', msg); serverLog(`ERR ${msg}`);
      lastServerErr.push(...msg.split(/\r?\n/));
      lastServerErr.splice(0, Math.max(0, lastServerErr.length - 8));
    }
  });

  serverProc.on('error', err => {
    serverLog(`SPAWN ERROR ${err.message}`);
    showError(
      `${APP_NAME} — Server Error`,
      `The server process failed to start.

Error: ${err.message}

` +
      (err.code === 'ENOENT'
        ? `The app's runtime is missing: ${nodeExe}

Please reinstall ${APP_NAME}.`
        : `Please contact support at: support@radixile.com`)
    );
  });

  serverExited = false;
  serverProc.on('exit', (code) => {
    serverLog(`EXIT code=${code}`);
    serverExited = true;
    // Failing during startup is reported by the startup code with the real error
    if (!serverReady) return;
    // The server asks for a full restart (e.g. to finish restoring a backup)
    if (code === 75 && !app.isQuiting) { app.relaunch(); app.isQuiting = true; app.quit(); return; }
    if (app.isQuiting || code === 0 || code === null) return;
    console.error(`[Electron] Server exited unexpectedly (code ${code})`);
    // Restart once automatically; after that, tell the user and point to the log
    if (serverRestarts < 1) {
      serverRestarts++;
      setTimeout(() => {
        startServer(serverStartArgs.nodeExe, serverStartArgs.envFile);
        waitForServer(40000).then(() => mainWindow?.loadURL(APP_URL)).catch(() => {});
      }, 1500);
      return;
    }
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: `${APP_NAME} stopped`,
      message: `${APP_NAME} stopped working unexpectedly.`,
      detail: `You can restart it, or send the log file to support@radixile.com.

Log folder: ${LOG_DIR}`,
      buttons: ['Restart', 'Open log folder', 'Quit'],
      defaultId: 0,
    });
    if (choice === 0) { app.relaunch(); app.isQuiting = true; app.quit(); }
    else if (choice === 1) { shell.openPath(LOG_DIR); }
    else { app.isQuiting = true; app.quit(); }
  });
}

// ── Wait For Server ───────────────────────────────────────────────────────────

function waitForServer(timeoutMs = 35000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      if (serverExited && !serverReady) return reject(new Error('The server stopped while starting'));
      if (Date.now() > deadline) return reject(new Error(`Server did not start within ${timeoutMs / 1000}s`));
      // Only accept OUR server — another program may be using the same port
      const req = http.get(`${APP_URL}/__health`, res => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          try { if (JSON.parse(body).app === 'social-nexus') return resolve(); } catch {}
          reject(new Error(`Another program is using port ${PORT}`));
        });
      });
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
    title: APP_FULL,
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
    if (START_HIDDEN) return; // started with Windows: stay in the tray
    mainWindow.show();
    mainWindow.focus();
  });

  // Windows is shutting down or signing out while posts are due: ask first.
  // (Windows shows this app's name and lets the person shut down anyway.)
  // Only when a post is due within the hour, so Windows isn't held up every day.
  mainWindow.on('query-session-end', e => {
    if (schedule.due_1h > 0) {
      e.preventDefault();
      showTrayNotification('A post is due within the hour', `Posts only go out while ${APP_NAME} is running. Keep the PC on, or open ${APP_NAME} again after restarting.`);
    }
  });

  // Graceful minimize to tray
  mainWindow.on('close', e => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
      showTrayNotification(
        `${APP_NAME} is running`,
        'Social-Nexus is minimized to the system tray. Right-click the icon to quit.',
      );
    }
  });

  // The page asks to stay open when Create Post has unsaved changes:
  // let the person choose (without this, quitting would silently do nothing)
  mainWindow.webContents.on('will-prevent-unload', e => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Leave and lose changes', 'Stay'],
      defaultId: 1, cancelId: 1,
      title: APP_NAME,
      message: 'Create Post has changes you haven’t saved.',
      detail: 'Leave anyway? Your unsaved changes will be lost.',
    });
    if (choice === 0) e.preventDefault(); // go ahead and leave
    else app.isQuiting = false;           // stay: closing again just hides to the tray
  });

  // Open all external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Help & User Guide opens in its own window, next to the app
    if (url.startsWith(`${APP_URL}/help.html`) || url.startsWith(`${APP_URL}/api/reports/`)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1100, height: 820, minWidth: 420, autoHideMenuBar: true,
          title: url.includes('/api/reports/') ? 'Social-Nexus report' : 'Social-Nexus Help',
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
        },
      };
    }
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
    ...(updateReady ? [{ label: `⬆️  Restart to update (v${updateReady})`, click: installUpdateNow }, { type: 'separator' }] : []),
    { label: `🗓️  ${nextPostLabel()}`, enabled: false },
    {
      label: 'Start with Windows', type: 'checkbox',
      checked: readDesktopSettings().startWithWindows !== false,
      visible: app.isPackaged,
      click: (item) => setStartWithWindows(item.checked),
    },
    { type: 'separator' },
    { label: `🟢  Server: localhost:${PORT}`, enabled: false },
    { label: `v${APP_VER} · ${COMPANY}`,     enabled: false },
    { type: 'separator' },
    {
      label: '🚪  Quit Social-Nexus',
      click: async () => {
        await fetchSchedule();
        if (schedule.due_24h > 0) {
          const choice = dialog.showMessageBoxSync({
            type: 'warning', title: APP_NAME, buttons: ['Keep running', 'Quit anyway'], defaultId: 0, cancelId: 0,
            message: 'Posts are due soon',
            detail: `${dueWarning()} If you quit, they wait until you open ${APP_NAME} again.`,
          });
          if (choice === 0) return;
        }
        app.isQuiting = true;
        serverProc?.kill('SIGTERM');
        if (psBlockerId !== null) powerSaveBlocker.stop(psBlockerId);
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(buildMenu());
  // Keep the next-post line current
  const refresh = async () => {
    await fetchSchedule();
    tray.setContextMenu(buildMenu());
    tray.setToolTip(`${APP_NAME} — ${nextPostLabel()}`);
  };
  refresh();
  setInterval(refresh, 5 * 60 * 1000);
  setupAutoUpdate(() => tray.setContextMenu(buildMenu()));
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
  // Resolve all paths now that app is ready
  resolvePaths();

  // One-time move of old NEXUS data (after the single-instance lock)
  const legacyBackup = migrateLegacyDataDir();

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
      message: `Port ${PORT} is already in use by another application.\n\nThis may be a previous instance of Social-Nexus.`,
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
      `Could not find Node.js to run the Social-Nexus server.\n\n` +
      `Looked for bundled Node.js at:\n${BUNDLED_NODE}\n\n` +
      `Fix options:\n` +
      `1. Reinstall Social-Nexus from the latest installer\n` +
      `2. Install Node.js from https://nodejs.org then restart Social-Nexus\n\n` +
      `Support: support@radixile.com`
    );
    app.quit();
    return;
  }
  console.log('[Node] Using Node.js at:', nodeExe);

  // Prepare data directory and .env
  const { envFile } = prepareDataDir();

  // Show splash (not when Windows started the app in the tray)
  if (!START_HIDDEN) createSplashWindow();

  // Start server
  startServer(nodeExe, envFile);

  // Wait for server with progress
  try {
    await waitForServer(40000);
  } catch (err) {
    // Show the real reason when the server printed one (e.g. a database error)
    const detail = lastServerErr.filter(Boolean).slice(-5).join('\n');
    showError(
      `${APP_NAME} — Could not start`,
      `${APP_NAME} could not start.\n\n` +
      (detail
        ? `Reason:\n${detail}\n\n`
        : `Error: ${err.message}\n\nPossible causes:\n• Antivirus software blocking the app\n• Missing files (try reinstalling)\n\n`) +
      `Log folder: ${LOG_DIR}\nContact: support@radixile.com`
    );
    serverProc?.kill();
    app.quit();
    return;
  }
  serverReady = true;

  // Prevent system sleep while server is running
  psBlockerId = powerSaveBlocker.start('prevent-app-suspension');

  // Create UI
  createMainWindow();
  createTray();
  initStartWithWindows();
  if (legacyBackup) setTimeout(() => offerLegacyBackupDeletion(legacyBackup), 4000);

  // First-run notification
  const firstRunFlag = path.join(DATA_DIR, '.first_run_done');
  if (!fs.existsSync(firstRunFlag)) {
    fs.writeFileSync(firstRunFlag, '1');
    setTimeout(() => {
      showTrayNotification(
        `Welcome to ${APP_NAME}!`,
        'Register your admin account to get started. Click here to open Social-Nexus.',
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
