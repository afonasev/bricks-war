import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LauncherWindow, releaseNotesURL } from '../../electron/launcher-window.mjs';

function fixture(options = {}) {
  const handlers = new Map(), windows = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; windows.push(this);
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: {}, setAudioMuted: value => { this.muted = value; },
        session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }, setWindowOpenHandler() {} });
    }
    isDestroyed() { return Boolean(this.destroyed); }
    async loadFile() { this.webContents.mainFrame.url = ui.url; }
    destroy() { this.destroyed = true; }
  }
  const ui = new LauncherWindow({ BrowserWindow: Window,
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) },
    directory: '/trusted/electron', snapshot: () => ({ progress: 42 }),
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1024, height: 768 } }) }, ...options });
  const event = () => ({ sender: ui.window.webContents, senderFrame: ui.window.webContents.mainFrame });
  return { ui, windows, handlers, event };
}

test('launcher remains unallocated until needed; sandboxed IPC checks exact window, frame and URL', async () => {
  const f = fixture(); assert.equal(f.windows.length, 0);
  const result = f.ui.offer();
  assert.equal(f.windows.length, 1); assert.equal(f.windows[0].muted, true);
  assert.equal(f.windows[0].options.show, false);
  assert.deepEqual(Object.fromEntries(['sandbox', 'contextIsolation', 'nodeIntegration'].map(k => [k, f.windows[0].options.webPreferences[k]])),
    { sandbox: true, contextIsolation: true, nodeIntegration: false });
  const state = f.handlers.get('launcher:state');
  assert.throws(() => state({ sender: {}, senderFrame: f.ui.window.webContents.mainFrame }), /Untrusted/);
  assert.throws(() => state({ sender: f.ui.window.webContents, senderFrame: { url: f.ui.url } }), /Untrusted/);
  f.ui.window.webContents.mainFrame.url = 'file:///foreign.html';
  assert.throws(() => state(f.event()), /Untrusted/);
  f.ui.window.webContents.mainFrame.url = f.ui.url;
  assert.equal(state(f.event()).state.progress, 42);
  f.handlers.get('launcher:choose')(f.event(), { id: f.ui.view.id, action: 'play' });
  assert.equal(await result, 'play'); f.ui.close();
  assert.equal(state({}), null); assert.equal(f.handlers.get('launcher:choose')({}, { id: 1, action: 'update' }), false);
});

test('release notes use only frozen release tags on the fixed GitHub repository; stale commands cannot open URLs', async () => {
  for (const tag of ['content-2', 'v2.0.0']) assert.equal(releaseNotesURL({ tag }), `https://github.com/afonasev/bricks-war/releases/tag/${tag}`);
  for (const tag of [undefined, 'https://evil.test', '../latest', 'content-2?x=y', 'v2.0.0/path']) assert.equal(releaseNotesURL({ tag }), null);
  const opened = [], f = fixture({ notesURL: () => releaseNotesURL({ tag: 'content-2' }), openExternal: async url => opened.push(url) });
  const offer = f.ui.offer();
  assert.equal(await f.ui.notes(f.ui.view.id - 1), false);
  assert.equal(await f.ui.notes(f.ui.view.id), true);
  assert.deepEqual(opened, ['https://github.com/afonasev/bricks-war/releases/tag/content-2']);
  f.ui.choose({ id: f.ui.view.id, action: 'play' });
  assert.equal(await f.ui.notes(f.ui.view.id), false); await offer; f.ui.close();
});

test('repeated, malformed and stale actions cannot consent or retry another view', async () => {
  const f = fixture(), offer = f.ui.offer();
  const id = f.ui.view.id;
  assert.equal(f.ui.choose(null), false);
  assert.equal(f.ui.choose({ id: id - 1, action: 'update' }), false);
  assert.equal(f.ui.choose({ id, action: 'retry' }), false);
  assert.equal(f.ui.choose({ id, action: 'update' }), true);
  assert.equal(f.ui.choose({ id, action: 'update' }), false);
  assert.equal(await offer, 'update');
  const failure = f.ui.failure({}, { retry: true });
  assert.equal(f.ui.choose({ id, action: 'play' }), false);
  assert.equal(f.ui.choose({ id: f.ui.view.id, action: 'retry' }), true);
  assert.equal(await failure, 'retry'); f.ui.close();
});

test('native close drains cancellation once and cannot interrupt installation; unavailable recovery offers no Play', async () => {
  const f = fixture(); let cancels = 0;
  await f.ui.progress({}, async () => { cancels++; });
  const event = { preventDefault() {} };
  f.ui.window.emit('close', event); f.ui.window.emit('close', event);
  assert.equal(cancels, 1); assert.equal(f.ui.view.kind, 'cancelling');
  await f.ui.installing(); f.ui.window.emit('close', event); assert.equal(cancels, 1);
  const failure = f.ui.failure({}, { recovery: true, playable: false });
  assert.deepEqual(f.ui.view.actions, ['quit']);
  f.ui.nativeClose(); assert.equal(await failure, 'quit'); f.ui.close();
});
