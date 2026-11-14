import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTENT_REPOSITORY } from './update-source.mjs';

export function releaseNotesURL(target) {
  const tag = target?.tag;
  return typeof tag === 'string' && /^(content-[1-9]\d*|v\d+\.\d+\.\d+)$/.test(tag)
    ? `https://github.com/afonasev/bricks-war/releases/tag/${tag}` : null;
}

export function windowsInstallerURL(target) {
  const {tag, name} = target?.installer ?? {};
  const version = typeof tag === 'string' && /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];
  if (!version || typeof name !== 'string'
    || !['x64', 'arm64', 'ia32'].some(arch => name === `Bricks-War-${version}-win-${arch}.exe`)) return null;
  return `https://github.com/${CONTENT_REPOSITORY}/releases/download/${tag}/${name}`;
}

/** Local pre-game surface. No window is allocated until a visible decision is needed. */
export class LauncherWindow {
  constructor({ BrowserWindow, ipcMain, directory, snapshot, locale = 'en', screen, notesURL = () => null, installerTarget = () => null, openExternal }) {
    Object.assign(this, { BrowserWindow, ipcMain, directory, snapshot, locale, screen, notesURL, installerTarget, openExternal });
    this.url = pathToFileURL(join(directory, 'launcher.html')).href;
    this.serial = 0;
    this.view = null;
    for (const [channel, fn] of [['state', () => this.state()], ['choose', value => this.choose(value)], ['notes', id => this.notes(id)], ['installer', id => this.openInstaller(id)]]) {
      ipcMain.handle(`launcher:${channel}`, (event, value) => {
        // A poll already queued when the renderer is destroyed may still arrive.
        // Retain inert handlers for this process instead of logging a missing-handler error.
        if (this.closed) return channel === 'state' ? null : false;
        if (!this.trusted(event)) throw Error('Untrusted launcher request');
        return fn(value);
      });
    }
  }
  trusted(event) {
    return Boolean(this.window && !this.window.isDestroyed() && event.sender === this.window.webContents
      && event.senderFrame === this.window.webContents.mainFrame && event.senderFrame?.url === this.url);
  }
  state() {
    const { installerURL: _installerURL, ...view } = this.view ?? {};
    return { ...view, state: this.snapshot(), locale: this.locale,
      hasNotes: Boolean(view.kind === 'offer' && view.actions.includes('update') && this.notesURL()) };
  }
  async notes(id) {
    if (id !== this.view?.id || !this.state().hasNotes || this.openingNotes) return false;
    const url = this.notesURL();
    if (!/^https:\/\/github\.com\/afonasev\/bricks-war\/releases\/tag\/(content-[1-9]\d*|v\d+\.\d+\.\d+)$/.test(url ?? '')) return false;
    this.openingNotes = true;
    const view = this.view;
    view.notesOpenFailed = false;
    try { await this.openExternal(url); return true; }
    catch { view.notesOpenFailed = true; return false; }
    finally { this.openingNotes = false; }
  }
  async openInstaller(id) {
    if (id !== this.view?.id || !this.view.actions.includes('installer') || this.openingInstaller) return false;
    this.openingInstaller = true;
    const view = this.view;
    view.installerOpenFailed = false;
    try { await this.openExternal(view.installerURL); return true; }
    catch { view.installerOpenFailed = true; return false; }
    finally { this.openingInstaller = false; }
  }
  async show(kind, actions, options = {}) {
    this.view = { id: ++this.serial, kind, actions, ...options };
    if (!this.window) {
      const area = this.screen.getPrimaryDisplay().workAreaSize;
      const width = Math.min(760, area.width), height = Math.min(580, area.height);
      const win = this.window = new this.BrowserWindow({ width, height, useContentSize: true,
        minWidth: Math.min(360, area.width), minHeight: Math.min(420, area.height),
        title: 'Bricks War', show: false, resizable: true, fullscreenable: false, maximizable: false,
        backgroundColor: '#f5e5c5', autoHideMenuBar: true,
        webPreferences: { preload: join(this.directory, 'launcher-preload.cjs'),
          partition: 'bricks-launcher', contextIsolation: true, sandbox: true, nodeIntegration: false } });
      win.webContents.setAudioMuted(true);
      win.webContents.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
      win.webContents.session.setPermissionCheckHandler(() => false);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', event => event.preventDefault());
      win.webContents.on('will-attach-webview', event => event.preventDefault());
      win.on('close', event => { event.preventDefault(); this.nativeClose(); });
      win.webContents.on('render-process-gone', () => this.nativeClose());
      win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
      await win.loadFile(join(this.directory, 'launcher.html'));
    }
  }
  async decision(kind, actions, options) {
    // Install the waiter before loadFile: the renderer may respond during its first paint.
    const result = new Promise(resolve => { this.resolve = resolve; });
    await this.show(kind, actions, options);
    return result;
  }
  status(_state, options) { return this.decision('status', ['play', 'quit'], options); }
  offer(_state, options) { return this.decision('offer', ['play', 'update', 'quit'], options); }
  failure(_state, options) {
    const installerURL = options.unavailable ? windowsInstallerURL(this.installerTarget()) : null;
    if (installerURL) {
      return this.decision('manual', ['play', 'installer', 'quit'], { ...options, installerURL });
    }
    return this.decision('failure', options.playable === false ? ['quit']
      : options.retry ? ['play', 'retry', 'quit'] : ['play', 'quit'], options);
  }
  progress(_state, cancel) {
    this.cancel = cancel;
    return this.show('progress', ['cancel']);
  }
  installing() { this.cancel = null; return this.show('installing', []); }
  choose(value) {
    if (!value || value.id !== this.view?.id || !this.view.actions.includes(value.action)) return false;
    const action = value.action;
    if (action === 'installer') return false; // The browser link does not consume the launch decision.
    this.view = { ...this.view, actions: [] }; // Consume before any async transition.
    if (action === 'cancel') {
      this.view.kind = 'cancelling';
      void this.cancel?.().catch(() => {}); // Session owns cancellation/recovery result.
    } else {
      const resolve = this.resolve; this.resolve = null;
      resolve?.(action);
    }
    return true;
  }
  nativeClose() {
    if (this.view?.actions.includes('cancel')) return this.choose({ id: this.view.id, action: 'cancel' });
    if (this.resolve) {
      const resolve = this.resolve; this.resolve = null;
      this.view.actions = []; resolve('quit');
    }
    // Installation/cancellation owns the process; closing cannot interrupt its writes.
  }
  focus() { if (this.window && !this.window.isDestroyed()) { if (this.window.isMinimized()) this.window.restore(); this.window.show(); this.window.focus(); } }
  close() {
    this.closed = true;
    this.resolve = null; this.cancel = null;
    this.window?.destroy(); this.window = null;
  }
}
