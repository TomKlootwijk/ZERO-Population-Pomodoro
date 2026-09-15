'use strict';
// Only local, allowlisted assets execute in the renderer.
const { app, BrowserWindow, ipcMain, screen, protocol, session, shell, Notification, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { parseFeed } = require('../web/core.js');
const { fitBounds, isDocked } = require('./window-bounds.cjs');
const { fetchSpaceWeather } = require('./space-weather.cjs');
const { fetchWeather } = require('./weather.cjs');
const ROOT = path.resolve(__dirname, '..');
const FEED = 'https://www.census.gov/popclock/data/population.php/world';
const ENTRY = 'zero://app/index.html';
const ASSETS = new Map([
  ['/index.html', 'text/html; charset=utf-8'], ['/web/style.css', 'text/css; charset=utf-8'],
  ['/web/app.js', 'text/javascript; charset=utf-8'], ['/web/core.js', 'text/javascript; charset=utf-8'],
  ['/web/instruments.js', 'text/javascript; charset=utf-8'], ['/web/instrument-view.js', 'text/javascript; charset=utf-8'],
  ['/web/telemetry.js', 'text/javascript; charset=utf-8'], ['/web/telemetry-view.js', 'text/javascript; charset=utf-8'],
  ['/web/telemetry.css', 'text/css; charset=utf-8'],
  ['/web/weather.js', 'text/javascript; charset=utf-8'], ['/web/weather-view.js', 'text/javascript; charset=utf-8'],
  ['/web/weather.css', 'text/css; charset=utf-8'],
  ['/web/live-signal.js', 'text/javascript; charset=utf-8'], ['/web/unified-view.js', 'text/javascript; charset=utf-8'],
  ['/web/seed.js', 'text/javascript; charset=utf-8'], ['/web/icon.svg', 'image/svg+xml']
]);
const EXTERNAL = new Set([
  'https://www.census.gov/popclock/world', FEED,
  'https://www.nist.gov/pml/owm/si-units-electric-current',
  'https://www.spaceweather.gov/products/solar-wind',
  'https://open-meteo.com/', 'https://creativecommons.org/licenses/by/4.0/',
  'https://github.com/TomKlootwijk/ZERO-Population-Pomodoro',
  'https://github.com/TomKlootwijk/ZERO-Population-Pomodoro/blob/main/docs/LIVE.md',
  'https://github.com/TomKlootwijk/ZERO-Population-Pomodoro/tree/main/references'
]);
protocol.registerSchemesAsPrivileged([{ scheme: 'zero', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('ZERO');
// Development and the installed executable share settings and timer history.
const profileOverride = app.commandLine.getSwitchValue('user-data-dir');
const DATA_PATH = profileOverride ? path.resolve(profileOverride) : path.join(app.getPath('appData'), 'ZERO');
fsSync.mkdirSync(DATA_PATH, { recursive: true });
app.setPath('userData', DATA_PATH);
const SETTINGS_PATH = path.join(DATA_PATH, 'desktop-settings.json');
let win = null, tray = null, quitting = false, settingsTimer = null, pinWatch = null;
let cache = null, lastFetch = 0, pendingFetch = null;
let desired = { width: 392, height: 680 };
let settings = { pinned: true, launchAtLogin: false, bounds: null, docked: true };
let timerStatus = { clock: '25:00', mode: 'focus', running: false, finished: false };
const MODE_NAMES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const safeExternal = url => { if (EXTERNAL.has(url)) shell.openExternal(url).catch(() => {}); };
function loadSettings() {
  try {
    const saved = JSON.parse(fsSync.readFileSync(SETTINGS_PATH, 'utf8'));
    if (typeof saved.pinned === 'boolean') settings.pinned = saved.pinned;
    if (typeof saved.launchAtLogin === 'boolean') settings.launchAtLogin = saved.launchAtLogin;
    if (typeof saved.docked === 'boolean') settings.docked = saved.docked;
    if (saved.bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved.bounds[key])) &&
        saved.bounds.width >= 1 && saved.bounds.height >= 1) {
      settings.bounds = saved.bounds;
      desired = { width: Math.min(600, Math.max(300, saved.bounds.width)), height: Math.min(1000, Math.max(200, saved.bounds.height)) };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('ZERO settings could not be read:', error.message);
  }
}
function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = null;
  try {
    const temporary = `${SETTINGS_PATH}.tmp`;
    fsSync.writeFileSync(temporary, JSON.stringify(settings, null, 2));
    fsSync.renameSync(temporary, SETTINGS_PATH);
  } catch (error) { console.warn('ZERO settings could not be saved:', error.message); }
}
function scheduleSave() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(saveSettings, 250);
}
function loginOptions() { return { path: process.execPath, args: ['--startup'] }; }
function launchAtLogin() {
  if (!app.isPackaged || !['win32', 'darwin'].includes(process.platform)) return false;
  try {
    const actual = app.getLoginItemSettings(loginOptions());
    return process.platform === 'win32' ? actual.executableWillLaunchAtLogin === true : actual.openAtLogin;
  } catch (_) { return false; }
}
function desktopState() {
  return { pinned: win && !win.isDestroyed() ? win.isAlwaysOnTop() : settings.pinned, launchAtLogin: launchAtLogin() };
}
function broadcastState() {
  if (win && !win.isDestroyed() && !win.webContents.isLoadingMainFrame()) win.webContents.send('zero:state-changed', desktopState());
  refreshTray();
}
function setPinned(enabled) {
  settings.pinned = enabled;
  // Floating stays above application windows while respecting the Windows taskbar.
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(enabled, 'floating');
  scheduleSave(); broadcastState();
  return settings.pinned;
}
function maintainPin() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  // Recover when another window manager temporarily clears the native topmost flag.
  // This never focuses ZERO and respects an explicit unpin in the app.
  if (settings.pinned && !win.isAlwaysOnTop()) {
    win.setAlwaysOnTop(true, 'floating');
    broadcastState();
  }
}
function setLaunchAtLogin(enabled) {
  if (!app.isPackaged || !['win32', 'darwin'].includes(process.platform)) return false;
  app.setLoginItemSettings({ ...loginOptions(), name: 'ZERO', openAtLogin: enabled, enabled });
  settings.launchAtLogin = launchAtLogin();
  scheduleSave(); broadcastState();
  return settings.launchAtLogin;
}
function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  layoutWindow(); win.show(); maintainPin(); win.focus();
}
function sendAction(action) {
  if (win && !win.isDestroyed()) win.webContents.send('zero:action', action);
}
function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  const visible = win && !win.isDestroyed() && win.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Hide ZERO' : 'Show ZERO', click: () => { if (win && win.isVisible()) win.hide(); else showWindow(); } },
    { type: 'separator' },
    { label: timerStatus.running ? 'Pause timer' : timerStatus.finished ? 'Start next interval' : 'Start / resume timer', click: () => sendAction('toggle-timer') },
    { label: 'Next interval', click: () => sendAction('next-timer') },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: settings.pinned, click: item => setPinned(item.checked) },
    { label: 'Start with Windows', type: 'checkbox', checked: launchAtLogin(), enabled: app.isPackaged && process.platform === 'win32',
      click: item => { try { setLaunchAtLogin(item.checked); } catch (error) { console.error('ZERO startup setting failed:', error.message); refreshTray(); } } },
    { label: 'Dock to bottom right', click: () => { dock(); showWindow(); } },
    { type: 'separator' },
    { label: 'Quit ZERO', click: () => app.quit() }
  ]));
}
function updateTooltip() {
  if (tray && !tray.isDestroyed()) tray.setToolTip(`ZERO · ${MODE_NAMES[timerStatus.mode]} · ${timerStatus.clock}${timerStatus.finished ? ' · complete' : timerStatus.running ? '' : ' · paused'}`);
}
async function createTray() {
  let icon = nativeImage.createEmpty();
  for (const candidate of ['build/icon.ico', 'build/icon.png']) {
    icon = nativeImage.createFromPath(path.join(ROOT, candidate));
    if (!icon.isEmpty()) break;
  }
  if (icon.isEmpty()) icon = await app.getFileIcon(process.execPath, { size: 'small' });
  if (icon.isEmpty()) throw new Error('The tray icon is unavailable.');
  tray = new Tray(icon);
  tray.on('click', showWindow);
  tray.on('right-click', refreshTray);
  updateTooltip(); refreshTray();
}
function trusted(event) {
  if (!win || event.sender !== win.webContents || !event.senderFrame || event.senderFrame !== win.webContents.mainFrame)
    throw new Error('Untrusted IPC sender.');
  const u = new URL(event.senderFrame.url);
  if (u.protocol !== 'zero:' || u.hostname !== 'app' || u.pathname !== '/index.html') throw new Error('Untrusted origin.');
}
function workArea() {
  if (win && !win.isDestroyed()) return screen.getDisplayMatching(win.getBounds()).workArea;
  if (settings.bounds) return screen.getDisplayMatching(settings.bounds).workArea;
  return screen.getPrimaryDisplay().workArea;
}
function rememberBounds() {
  if (!win || win.isDestroyed()) return;
  settings.bounds = win.getBounds();
  settings.docked = isDocked(settings.bounds, workArea());
  scheduleSave();
}
function layoutWindow() {
  if (!win || win.isDestroyed()) return;
  win.setBounds(fitBounds(desired, workArea(), win.getBounds(), settings.docked));
  rememberBounds();
}
function dock() {
  if (!win || win.isDestroyed()) return;
  settings.docked = true;
  layoutWindow();
}
function fetchPopulation() {
  if (cache && Date.now() - lastFetch < 60000) return Promise.resolve(cache);
  if (pendingFetch) return pendingFetch;
  pendingFetch = new Promise((resolve, reject) => {
    const req = https.get(FEED, { headers: { Accept: 'application/json', 'User-Agent': 'ZERO-Population-Widget/1.0' }, timeout: 8000 }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Census HTTP ${res.statusCode}.`)); return; }
      let size = 0; const chunks = [];
      res.on('data', chunk => { size += chunk.length; if (size > 1000000) req.destroy(new Error('Census response too large.')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => {
        try {
          if (size > 1000000) throw new Error('Census response too large.');
          const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          parseFeed(raw); cache = raw; lastFetch = Date.now(); resolve(raw);
        } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Census request timed out.')));
    req.on('error', reject);
  }).finally(() => { pendingFetch = null; });
  return pendingFetch;
}
function createWindow() {
  const bounds = fitBounds(desired, workArea(), settings.bounds, settings.docked);
  win = new BrowserWindow({
    ...bounds,
    frame: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: settings.pinned, resizable: false, maximizable: false, fullscreenable: false,
    hasShadow: true, show: false, title: 'ZERO', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false }
  });
  win.setMenu(null);
  win.setAlwaysOnTop(settings.pinned, 'floating');
  win.webContents.setWindowOpenHandler(({ url }) => { safeExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { event.preventDefault(); safeExternal(url); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('ready-to-show', () => { layoutWindow(); win.show(); });
  win.on('moved', rememberBounds);
  win.on('show', () => { maintainPin(); refreshTray(); });
  win.on('hide', refreshTray);
  win.on('focus', () => { maintainPin(); broadcastState(); });
  win.on('close', event => {
    if (!quitting && tray && !tray.isDestroyed()) { event.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
  win.webContents.on('did-finish-load', broadcastState);
  win.loadURL(ENTRY);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--quit-for-update')) { app.quit(); return; }
    if (argv.includes('--configure-desktop')) { setPinned(true); setLaunchAtLogin(true); }
    showWindow();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId('local.zero.population');
    loadSettings();
    if (app.commandLine.hasSwitch('quit-for-update')) { app.quit(); return; }
    if (app.commandLine.hasSwitch('configure-desktop')) {
      settings.pinned = true;
      setLaunchAtLogin(true);
    }
    settings.launchAtLogin = launchAtLogin();
    protocol.handle('zero', async request => {
      try {
        const url = new URL(request.url);
        if (request.method !== 'GET' || url.hostname !== 'app' || !ASSETS.has(url.pathname)) return new Response('Not found', { status: 404 });
        const content = await fs.readFile(path.join(ROOT, url.pathname.slice(1)));
        return new Response(content, { headers: { 'Content-Type': ASSETS.get(url.pathname), 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "frame-ancestors 'none'" } });
      } catch (_) { return new Response('Unavailable', { status: 500 }); }
    });
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    ipcMain.handle('zero:population', event => { trusted(event); return fetchPopulation(); });
    ipcMain.handle('zero:space-weather', event => { trusted(event); return fetchSpaceWeather(); });
    ipcMain.handle('zero:weather', event => { trusted(event); return fetchWeather(); });
    ipcMain.handle('zero:state', event => { trusted(event); return desktopState(); });
    ipcMain.handle('zero:pin', (event, enabled) => {
      trusted(event); if (typeof enabled !== 'boolean') throw new Error('Expected boolean.');
      return setPinned(enabled);
    });
    ipcMain.handle('zero:startup', (event, enabled) => {
      trusted(event); if (typeof enabled !== 'boolean') throw new Error('Expected boolean.');
      return setLaunchAtLogin(enabled);
    });
    ipcMain.handle('zero:resize', (event, size) => {
      trusted(event);
      if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) throw new Error('Invalid dimensions.');
      const width = Math.round(Math.min(600, Math.max(300, size.width)));
      const height = Math.round(Math.min(1000, Math.max(200, size.height)));
      if (width !== desired.width || height !== desired.height) { desired = { width, height }; layoutWindow(); }
      return desired;
    });
    ipcMain.handle('zero:dock', event => { trusted(event); dock(); });
    ipcMain.handle('zero:close', event => { trusted(event); win.close(); });
    ipcMain.handle('zero:quit', event => { trusted(event); app.quit(); });
    ipcMain.on('zero:timer', (event, status) => {
      try {
        trusted(event);
        if (!status || typeof status.clock !== 'string' || !/^\d{1,3}:\d{2}$/.test(status.clock) ||
            !Object.hasOwn(MODE_NAMES, status.mode) || typeof status.running !== 'boolean' || typeof status.finished !== 'boolean') return;
        const changed = timerStatus.mode !== status.mode || timerStatus.running !== status.running || timerStatus.finished !== status.finished;
        timerStatus = { clock: status.clock, mode: status.mode, running: status.running, finished: status.finished };
        updateTooltip();
        if (changed) refreshTray();
      } catch (_) { /* Ignore invalid one-way messages from an untrusted frame. */ }
    });
    ipcMain.handle('zero:notify', (event, title) => {
      trusted(event);
      if (!['Focus complete', 'Break complete'].includes(title)) throw new Error('Invalid notification.');
      if (Notification.isSupported()) {
        const notification = new Notification({ title: `ZERO · ${title}`, body: 'Your next interval is ready.', silent: true });
        notification.on('click', showWindow);
        notification.show();
      }
    });
    screen.on('display-metrics-changed', layoutWindow);
    screen.on('display-removed', layoutWindow);
    screen.on('display-added', layoutWindow);
    await createTray();
    createWindow();
    pinWatch = setInterval(maintainPin, 2000);
    pinWatch.unref();
    app.on('activate', showWindow);
  }).catch(error => { console.error('ZERO could not start:', error.message); app.quit(); });
  app.on('before-quit', () => { quitting = true; if (win && !win.isDestroyed()) rememberBounds(); saveSettings(); });
  app.on('will-quit', () => { clearInterval(pinWatch); if (tray && !tray.isDestroyed()) tray.destroy(); });
  app.on('window-all-closed', () => app.quit());
}
