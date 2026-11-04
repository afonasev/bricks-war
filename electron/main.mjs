import { NativeUpdate, nativeContext } from './native-update.mjs';
import { captureNativeHealth, notifyNativeHealth } from './native-health.mjs';
import { readFileSync, unlinkSync } from 'node:fs';
import { app, BrowserWindow, ipcMain, session, screen, Menu, shell as desktopShell } from 'electron';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { join, dirname, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContentStore } from './content.mjs';
import { githubContentDownload } from './update-source.mjs';
import { windowPreferences, fitWindow, RESOLUTIONS } from './window.mjs';
import { TransferGate, UpdateCoordinator, ShellActivation } from './update-coordinator.mjs';
import { ShellUpdate } from './shell-update.mjs';
import { GithubUpdates } from './github-updates.mjs';
import { gameUrl, startupMuted as isStartupMuted } from './startup.mjs';
import { StartupLauncherSession } from './startup-launcher.mjs';
import { LauncherWindow, releaseNotesURL } from './launcher-window.mjs';
import { CONTENT_ABI } from './compatibility.mjs';
import { releaseImageResponse } from './release-images.mjs';

// A signed native client may resolve the historical Electron profile without
// opening a game window, consuming update state or initializing audio.
if (process.argv.includes('--native-profile-probe')) {
  const profile=process.env.BRICKS_DESKTOP_QA_PROFILE || app.getPath('userData');
  await new Promise(resolve => process.stdout.write(JSON.stringify({schema:1,profile}),resolve));
  app.exit(0);
}
const nativeHealth = captureNativeHealth();
if (nativeHealth && process.env.BRICKS_BOOTSTRAP_INSTALLED === '1') {
  const profile = process.env.BRICKS_BOOTSTRAP_PROFILE;
  if (typeof profile !== 'string' || !isAbsolute(profile)) throw Error('Invalid original-user native profile');
  app.setPath('userData', profile);
}
const ORIGIN = 'https://bricks.afonasev.tech';
let restoredArgs = [], resumedShellHandoff = false;
try { const file = join(process.env.BRICKS_DESKTOP_QA_PROFILE || app.getPath('userData'),'shell-update','launch-args.json'); const saved = JSON.parse(readFileSync(file,'utf8')); if (saved.version === app.getVersion() && Array.isArray(saved.args) && saved.args.every(arg=>typeof arg === 'string')) { restoredArgs = saved.args; resumedShellHandoff = true; unlinkSync(file); } } catch { /* ordinary launch */ }
const launchArgs = [...process.argv,...restoredArgs];
const startupMuted = isStartupMuted(launchArgs, process.env.BRICKS_DESKTOP_QA_PROFILE);
const initialGameUrl = gameUrl(ORIGIN, startupMuted);
const SHELL_ABI = CONTENT_ABI;
const here = dirname(fileURLToPath(import.meta.url));
if (process.platform === 'win32') app.setAppUserModelId('tech.afonasev.brickswar');
if (process.env.BRICKS_DESKTOP_QA_PROFILE) app.setPath('userData', process.env.BRICKS_DESKTOP_QA_PROFILE);
const API = new Map([['/api/network/health', 'GET'], ['/api/network/lobbies', 'GET'],
  ['/api/network/rating', 'GET'], ['/api/network/rating-submit', 'POST'],
  ['/api/network/create', 'POST'], ['/api/network/join', 'POST'], ['/api/network/current', 'POST']]);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2' };
if (!app.requestSingleInstanceLock()) app.quit();
let coordinator, launcherUI;
let launcherPending = true;
let win, store, safeMenu = false, applying = false;
let preferences = windowPreferences();
const state = () => coordinator?.snapshot() ?? { available:false, applying:false, error:false, phase:'idle' };
const allowedSender = event => win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
  && event.senderFrame.url === initialGameUrl;
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
  // Electron session.fetch cancels manual redirects. Node fetch exposes each response
  // and stays outside the local HTTPS protocol handler and renderer permissions.
  const gate = new TransferGate();
  const rawDownload = githubContentDownload(globalThis.fetch);
  const githubDownload = (path,limit,file) => gate.run(signal => rawDownload(path,limit,{...file, signal:file?.signal ? AbortSignal.any([signal,file.signal]) : signal}),file?.signal);
  async function download(path, limit, file) {
    if (!app.isPackaged && process.env.BRICKS_DESKTOP_QA_PROFILE && process.env.BRICKS_DESKTOP_QA_FEED) {
      const bytes = await readFile(join(process.env.BRICKS_DESKTOP_QA_FEED, path));
      if (bytes.length > limit) throw Error('Oversized fixture');
      return bytes;
    }
    if (process.env.BRICKS_DESKTOP_QA_PROFILE && process.env.BRICKS_DESKTOP_QA_OFFLINE === '1') throw Error('Offline QA transport');
    return githubDownload(path, limit, file);
  }
  const openStore = async () => new ContentStore({ root: join(profile, 'content'), bundled: join(here, '..', 'build', 'desktop-content'),
    publicKey: await readFile(join(here, 'content-public-key.pem'), 'utf8'), shellVersion: SHELL_ABI, shellRelease: app.getVersion(), download,
    onProgress: () => {} }).open();
  store = await openStore();
  const publicKey = await readFile(join(here,'content-public-key.pem'),'utf8');
  const legacyShell = await new ShellUpdate({root:join(profile,'shell-update'),gate,fetcher:globalThis.fetch,publicKey,version:app.getVersion(),args:launchArgs.slice(1),helper:join(here,'shell-helper.mjs')}).open();
  const installedNative = nativeHealth ? nativeContext(process.env, app.getVersion(), profile, nativeHealth.nonce) : null;
  const nativeShell = installedNative ? await new NativeUpdate({root:installedNative.updateRoot,gate,fetcher:globalThis.fetch,publicKey,version:app.getVersion(),args:launchArgs.slice(1),context:installedNative,legacyHealth:()=>legacyShell.healthy(),legacyPending:legacyShell.ready}).open() : null;
  // A pre-existing legacy package is retained as an unavailable migration target
  // in native mode; it must never replace an immutable signed client slot.
  const shell = nativeShell ?? legacyShell;
  const github = new GithubUpdates({gate,store,publicKey,shell,cachePath:join(profile,'github-updates-cache.json')});
  coordinator = new UpdateCoordinator({store,gate,discover:options => process.env.BRICKS_BOOTSTRAP_SKIP_DISCOVERY === '1' ? Promise.resolve(null) : nativeShell?.legacyPending ? Promise.resolve(nativeShell.legacyCandidate()) : github.discover(options),history:locale => github.history(locale),readyShell:() => shell.ready});
  coordinator.shellVersion = app.getVersion();
  coordinator.startupError ||= shell.recoveryRequired;
  if (coordinator.startupError && !shell.ready && !store.ready) coordinator.phase = 'install-error';
  if (shell.ready) { coordinator.phase = 'ready'; coordinator.available = true; }
  const activation=new ShellActivation(shell,()=>{coordinator.phase='install-error';coordinator.startupError=true;shell.ready=null;});
  app.on('before-quit',event=>{if(activation.pending){event.preventDefault();void activation.start().then(()=>app.quit(),()=>app.quit());}});
  let serving = store.active;
  let inventory = new Set(store.manifest.files.map(f => f.path));
  ses.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.origin !== ORIGIN) return new Response('Forbidden', { status: 403 });
    if (url.pathname === '/__release-image') {
      if (request.method !== 'GET' || !coordinator.inMenu) return new Response('Forbidden',{status:403});
      try {
        return await gate.run(signal => releaseImageResponse(url.searchParams.get('url') ?? '',
          (value, options) => ses.fetch(value,{...options,bypassCustomProtocolHandlers:true}),
          AbortSignal.any([signal,request.signal])), request.signal);
      } catch { return new Response('Image unavailable',{status:502}); }
    }
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
  const launchGame = async () => {
    serving = store.active;
    inventory = new Set(store.manifest.files.map(f => f.path));
    launcherPending = false;
    const size = fitWindow(preferences, screen.getPrimaryDisplay().workAreaSize);
    win = new BrowserWindow({ ...size, useContentSize: true, minWidth: 800, minHeight: 480,
      fullscreen: preferences.fullscreen, fullscreenable: true, title: 'Bricks War', show: false,
      icon: join(here, '..', 'build', 'desktop-content', 'pwa-512.png'),
      webPreferences: { session: ses, preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    win.webContents.setZoomMode('disabled');
    win.webContents.on('did-finish-load', () => win.webContents.setZoomMode('disabled'));
    if (startupMuted) win.webContents.setAudioMuted(true);
    const fitCurrentDisplay = (restorePreference = false) => {
      // Native fullscreen enters asynchronously and emits intermediate move events.
      if (win.isDestroyed() || win.isFullScreen() || preferences.fullscreen) return;
      const bounds = win.getBounds(), content = win.getContentBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const frame = { width: bounds.width - content.width, height: bounds.height - content.height };
      const fit = fitWindow(restorePreference || preferences.auto ? preferences : content, area, frame);
      win.setMinimumSize(Math.min(800, area.width), Math.min(480, area.height));
      const width = fit.width + frame.width, height = fit.height + frame.height;
      const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width));
      const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
      if (width !== bounds.width || height !== bounds.height || x !== bounds.x || y !== bounds.y) win.setBounds({ x, y, width, height });
    };
    win.on('leave-full-screen', () => fitCurrentDisplay(true));
    win.on('move', () => fitCurrentDisplay());
    screen.on('display-metrics-changed', () => fitCurrentDisplay());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url !== initialGameUrl) event.preventDefault(); });
    win.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) safeMenu = false; });
    win.webContents.on('render-process-gone', () => { safeMenu = false; });
    win.on('close', () => { safeMenu = false; });
    win.once('ready-to-show', () => win.show());
    handle('update-state', state);
    handle('check', () => coordinator.check());
    handle('download', () => { if (!safeMenu) return state(); void coordinator.download(); return state(); });
    handle('cancel', () => coordinator.cancel());
    handle('activity', async inMenu => { safeMenu = inMenu; return coordinator.setActivity(inMenu); });
    handle('history', locale => coordinator.getHistory(locale));
    ipcMain.on('desktop:safe-menu', (event, safe) => { if (allowedSender(event)) safeMenu = safe === true; });
    handle('apply', async () => {
      if (!safeMenu || applying || coordinator.phase !== 'ready') return false;
      applying = true;
      if (shell.ready) { try { await activation.start(); app.quit(); } catch { applying=false; return false; } } else { if (nativeShell) { try { await nativeShell.relaunch(); } catch { applying=false; return false; } } else app.relaunch({ args: launchArgs.slice(1) }); app.quit(); } return true;
    });
    handle('healthy', async () => { await store.healthy(); await shell.healthy(); await notifyNativeHealth(nativeHealth); });
    handle('display', () => ({ ...preferences, fullscreen: win.isFullScreen(), resolutions: RESOLUTIONS }));
    let displayPreview, displayTimer;
    const applyDisplay = () => { win.setFullScreen(preferences.fullscreen); if (!preferences.fullscreen) { fitCurrentDisplay(true); win.center(); } };
    const finishDisplay = async confirm => {
      clearTimeout(displayTimer);
      if (displayPreview) { if (!confirm) preferences = displayPreview; else await writeFile(displayFile, JSON.stringify(preferences)); displayPreview = null; applyDisplay(); }
      return { ...preferences, resolutions: RESOLUTIONS };
    };
    handle('confirm-display', finishDisplay);
    handle('set-display', async value => {
      if (!value || typeof value !== 'object') throw Error('Invalid display preferences');
      if (!displayPreview) displayPreview = { ...preferences };
      preferences = windowPreferences(value);
      clearTimeout(displayTimer);
      displayTimer = setTimeout(() => { void finishDisplay(false); }, 15000);
      win.setFullScreen(preferences.fullscreen);
      if (!preferences.fullscreen) {
        fitCurrentDisplay(true);
        win.center();
      }
      return { ...preferences, resolutions: RESOLUTIONS };
    });
    handle('exit', () => app.quit());
    await win.loadURL(initialGameUrl);
    await win.webContents.setVisualZoomLevelLimits(1, 1);
  };
  launcherUI = new LauncherWindow({ BrowserWindow, ipcMain, directory: here, snapshot: state,
    locale: app.getLocale(), screen, notesURL: () => releaseNotesURL(coordinator.candidate),
    openExternal: url => desktopShell.openExternal(url) });
  const startup = new StartupLauncherSession({ coordinator, ui: launcherUI, resumeLaunch: resumedShellHandoff || nativeShell?.activatingCandidate === true, launchGame:async()=>{await nativeShell?.acknowledgeLegacyPending();return launchGame();},
    activate: async () => {
      if (shell.ready) { await activation.start(); return { handoff: true }; }
      return { activated: await store.activate() };
    },
    recoverWorking: async () => {
      // Reopen verifies the signed local inventory and rolls an unconfirmed content trial back.
      // It must succeed before a failure screen may offer Play now.
      store = await openStore(); coordinator.store = store; github.store = store;
      if (store.ready) await store.discardPrepared(store.ready.sequence, { retryable: false });
      coordinator.completeRecovery();
      await nativeShell?.acknowledgeRecovery();
      return Boolean(store.manifest && store.active);
    },
    quit: () => app.quit(),
  });
  await startup.run();
}).catch(error => { console.error('Desktop startup failed:', error.message); app.exit(1); });
app.on('window-all-closed', () => { if (!launcherPending) app.quit(); });
app.on('second-instance', () => { launcherUI?.focus(); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
