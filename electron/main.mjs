import { app, BrowserWindow, ipcMain, session, screen, Menu } from 'electron';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { join, dirname, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import updater from 'electron-updater';
import { ContentStore } from './content.mjs';
import { windowPreferences, fitWindow, RESOLUTIONS } from './window.mjs';

const ORIGIN = 'https://bricks.afonasev.tech';
const SHELL_ABI = 1;
const here = dirname(fileURLToPath(import.meta.url));
if (process.platform === 'win32') app.setAppUserModelId('tech.afonasev.brickswar');
if (process.env.BRICKS_DESKTOP_QA_PROFILE) app.setPath('userData', process.env.BRICKS_DESKTOP_QA_PROFILE);
const API = new Map([['/api/network/health', 'GET'], ['/api/network/lobbies', 'GET'],
  ['/api/network/create', 'POST'], ['/api/network/join', 'POST'], ['/api/network/current', 'POST']]);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2' };
if (!app.requestSingleInstanceLock()) app.quit();
let win, store, safeMenu = false, shellReady = false, updateError = false, applying = false;
let preferences = windowPreferences();
const autoUpdater = updater.autoUpdater;
const state = () => ({ available: Boolean(store?.ready || shellReady), applying, error: updateError });
const allowedSender = event => win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
  && event.senderFrame.url === `${ORIGIN}/`;
const handle = (channel, fn) => ipcMain.handle(`desktop:${channel}`, (event, ...args) => {
  if (!allowedSender(event)) throw Error('Untrusted desktop request');
  return fn(...args);
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const profile = process.env.BRICKS_DESKTOP_QA_PROFILE || app.getPath('userData');
  await mkdir(profile, { recursive: true });
  const displayFile = join(profile, 'display.json');
  try { preferences = windowPreferences(JSON.parse(await readFile(displayFile, 'utf8'))); } catch { /* First launch. */ }
  const ses = session.fromPartition('persist:bricks-desktop-v1');
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  if (process.env.BRICKS_DESKTOP_QA_OFFLINE === '1') await ses.setProxy({ proxyRules: '127.0.0.1:9' });
  async function download(path, limit) {
    if (!app.isPackaged && process.env.BRICKS_DESKTOP_QA_PROFILE && process.env.BRICKS_DESKTOP_QA_FEED) {
      const bytes = await readFile(join(process.env.BRICKS_DESKTOP_QA_FEED, path));
      if (bytes.length > limit) throw Error('Oversized fixture');
      return bytes;
    }
    const url = new URL(`/desktop/game/${path}`, ORIGIN);
    if (url.origin !== ORIGIN) throw Error('Invalid update origin');
    const response = await ses.fetch(url.href, { bypassCustomProtocolHandlers: true, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > limit) throw Error('Update unavailable');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > limit) throw Error('Oversized update'); chunks.push(Buffer.from(value)); }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks);
  }
  store = await new ContentStore({ root: join(profile, 'content'), bundled: join(here, '..', 'build', 'desktop-content'),
    publicKey: await readFile(join(here, 'content-public-key.pem'), 'utf8'), shellVersion: SHELL_ABI, download }).open();
  let serving = store.active;
  let inventory = new Set(store.manifest.files.map(f => f.path));
  ses.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.origin !== ORIGIN) return new Response('Forbidden', { status: 403 });
    if (API.get(url.pathname) === request.method) {
      const headers = new Headers(request.headers); headers.set('Origin', ORIGIN);
      return ses.fetch(request.url, { method: request.method, headers,
        ...(request.method === 'POST' ? { body: await request.arrayBuffer() } : {}),
        bypassCustomProtocolHandlers: true, redirect: 'error' });
    }
    if (request.method !== 'GET') return new Response('Forbidden', { status: 403 });
    const path = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!inventory.has(path)) return new Response('Not found', { status: 404 });
    try {
      const root = await realpath(serving), file = await realpath(join(root, path)), rel = relative(root, file);
      if (rel.startsWith('..') || isAbsolute(rel)) return new Response('Forbidden', { status: 403 });
      return new Response(await readFile(file), { headers: { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' data: blob: wss://bricks.afonasev.tech/network/socket; object-src 'none'; frame-src 'none'` } });
    } catch { return new Response('Content unavailable', { status: 404 }); }
  });
  const size = fitWindow(preferences, screen.getPrimaryDisplay().workAreaSize);
  win = new BrowserWindow({ ...size, useContentSize: true, minWidth: 800, minHeight: 480,
    fullscreen: preferences.fullscreen, title: 'Bricks War', show: false,
    icon: join(here, '..', 'build', 'desktop-content', 'pwa-512.png'),
    webPreferences: { session: ses, preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.webContents.setZoomMode('disabled');
  win.webContents.on('did-finish-load', () => win.webContents.setZoomMode('disabled'));
  if (process.env.BRICKS_DESKTOP_QA_PROFILE) win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== `${ORIGIN}/`) event.preventDefault(); });
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) safeMenu = false; });
  win.webContents.on('render-process-gone', () => { safeMenu = false; });
  win.on('close', () => { safeMenu = false; });
  win.once('ready-to-show', () => win.show());
  handle('update-state', state);
  handle('check', async () => { try { await store.check(); updateError = false; } catch { /* Offline checks must not remove a ready update. */ } return state(); });
  ipcMain.on('desktop:safe-menu', (event, safe) => { if (allowedSender(event)) safeMenu = safe === true; });
  handle('apply', async () => {
    if (!safeMenu || applying || !state().available) return false;
    applying = true; updateError = false;
    try {
      if (shellReady) { autoUpdater.quitAndInstall(false, true); return true; }
      if (!await store.activate()) return false;
      serving = store.active; inventory = new Set(store.manifest.files.map(f => f.path));
      safeMenu = false; await win.loadURL(`${ORIGIN}/`); return true;
    } catch { updateError = true; return false; } finally { applying = false; }
  });
  handle('healthy', () => store.healthy());
  handle('display', () => ({ ...preferences, fullscreen: win.isFullScreen(), resolutions: RESOLUTIONS }));
  handle('set-display', async value => {
    if (!value || typeof value !== 'object') throw Error('Invalid display preferences');
    preferences = windowPreferences(value);
    await writeFile(displayFile, JSON.stringify(preferences));
    win.setFullScreen(preferences.fullscreen);
    if (!preferences.fullscreen) {
      const fit = fitWindow(preferences, screen.getDisplayMatching(win.getBounds()).workAreaSize);
      win.setContentSize(fit.width, fit.height); win.center();
    }
    return { ...preferences, resolutions: RESOLUTIONS };
  });
  handle('exit', () => app.quit());
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', () => { shellReady = true; });
  autoUpdater.on('error', () => {});
  if (app.isPackaged && !process.env.BRICKS_DESKTOP_QA_PROFILE) {
    void autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => { void autoUpdater.checkForUpdates().catch(() => {}); }, 60 * 60 * 1000).unref();
  }
  await win.loadURL(`${ORIGIN}/`);
  await win.webContents.setVisualZoomLevelLimits(1, 1);
}).catch(error => { console.error('Desktop startup failed:', error.message); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
