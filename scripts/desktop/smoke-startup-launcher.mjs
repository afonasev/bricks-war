/** Real Electron/main/preload route, with ephemeral signed game fixtures and no installation. */
import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { digest } from '../../electron/content.mjs';
import electronPath from 'electron';

const output = await mkdtemp(join(process.env.BRICKS_QA_HOME || join(homedir(), '.local/state/bricks-war/qa'), 'launcher-ui-'));
const root = join(output, 'fixture-app');
await mkdir(join(root, 'build/desktop-content'), { recursive: true });
await cp('electron', join(root, 'electron'), { recursive: true });
const key = generateKeyPairSync('ed25519');
await writeFile(join(root, 'electron/content-public-key.pem'), key.publicKey.export({ type: 'spki', format: 'pem' }));
const html = version => Buffer.from(`<!doctype html><html><head><title>Game ${version}</title></head><body><h1>Fixture ${version}</h1><script>window.fixtureVersion='${version}';</script></body></html>`);
const a = html('A'), b = html('B'), extra = Buffer.alloc(220, 32);
function signed(sequence, version, files) {
  const manifest = { schema: 1, game: 'bricks-war', component: 'content', channel: 'stable', sequence, gameVersion: version,
    minShellVersion: 3, minShellRelease: '1.13.0', files: Object.entries(files).map(([path, bytes]) => ({ path, size: bytes.length, sha256: digest(bytes) })) };
  const payload = JSON.stringify(manifest);
  return { manifest, envelope: { payload, signature: sign(null, Buffer.from(payload), key.privateKey).toString('base64') } };
}
const baseline = signed(1, '1.0.0', { 'index.html': a });
const target = signed(2, '2.0.0', { 'index.html': b, 'extra.txt': extra });
await writeFile(join(root, 'build/desktop-content/index.html'), a);
await writeFile(join(root, 'build/desktop-content/manifest.json'), JSON.stringify(baseline.envelope));
await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', version: '1.15.0', main: 'entry.mjs' }));
const release = { id: 9, tag_name: 'content-2', draft: false, prerelease: false, published_at: '2026-11-03',
  assets: [{ name: 'manifest.json' }, ...target.manifest.files.map(f => ({ name: f.sha256, size: f.size, digest: `sha256:${f.sha256}` }))] };
await writeFile(join(root, 'fixture.json'), JSON.stringify({ release, envelope: target.envelope,
  files: { [digest(b)]: b.toString('base64'), [digest(extra)]: extra.toString('base64') } }));
await writeFile(join(root, 'entry.mjs'), `
import {app,shell} from 'electron';
import {readFileSync,appendFileSync} from 'node:fs';
import {ContentStore} from './electron/content.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixture.json',import.meta.url),'utf8'));
globalThis.qa={calls:[],windows:[],opened:[],corrupt:process.env.QA_MODE==='retry',delay:0};
shell.openExternal=async url=>{qa.opened.push(url);};
const activate=ContentStore.prototype.activate;
if(process.env.QA_MODE.startsWith('activation-fault'))ContentStore.prototype.activate=async function(){
  if(process.env.QA_MODE==='activation-fault-after')await activate.call(this);
  throw Error('Injected activation fault');
};
app.commandLine.appendSwitch('lang','en-US');
app.on('browser-window-created',(_e,w)=>{qa.windows.push(w.id);w.webContents.on('did-finish-load',()=>appendFileSync(process.env.QA_WITNESS,JSON.stringify({url:w.webContents.getURL(),muted:w.webContents.isAudioMuted()})+'\\n'));});
globalThis.fetch=async(url,options={})=>{
  qa.calls.push(url);
  if(process.env.QA_MODE==='offline')throw Error('QA offline');
  if(process.env.QA_MODE==='timeout')return new Promise(()=>{});
  if(url.includes('api.github.com'))return Response.json(process.env.QA_MODE==='current'?[]:[fixture.release]);
  if(url.endsWith('/manifest.json'))return Response.json(fixture.envelope);
  const hash=url.split('/').pop(), bytes=fixture.files[hash];
  if(!bytes)throw Error('Unexpected fixture request '+url);
  if(qa.corrupt){qa.corrupt=false;return new Response(Buffer.from('corrupt'));}
  const delay=hash===${JSON.stringify(digest(extra))}?qa.delay:0;
  if(delay)await new Promise(r=>setTimeout(r,delay));
  return new Response(Buffer.from(bytes,'base64'));
};
await import('./electron/main.mjs');
`);
const report = { output, revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  source: Object.fromEntries(await Promise.all([
    'main.mjs', 'native-health.mjs', 'launcher-window.mjs', 'launcher-preload.cjs', 'launcher-renderer.js', 'launcher.html', 'launcher.css',
  ].map(async name => [`electron/${name}`, digest(await readFile(`electron/${name}`))]))), scenarios: [] };
let app;
async function launch(mode, profile = mode) {
  app = await electron.launch({ executablePath: electronPath, args: [root, '-muted'], env: { ...process.env,
    BRICKS_DESKTOP_QA_PROFILE: join(output, `profile-${profile}`), BRICKS_DESKTOP_QA_FEED: '', BRICKS_DESKTOP_QA_OFFLINE: '',
    BRICKS_BOOTSTRAP_NONCE: 'a'.repeat(64), BRICKS_BOOTSTRAP_DIGEST: 'b'.repeat(64),
    BRICKS_BOOTSTRAP_RECEIPT: join(output, `client-${'a'.repeat(64)}.json`),
    QA_MODE: mode, QA_WITNESS: join(output, `${mode}-windows.jsonl`) } });
  app.process().stderr.on('data', data => { void writeFile(join(output, `${mode}-stderr.log`), data, { flag: 'a' }); });
  return app.firstWindow();
}
async function finish() { if (app) await app.close(); app = null; }
async function game(version) {
  let page;
  await assert.doesNotReject(async () => {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      page = app.windows().find(p => p.url().startsWith('https://bricks.afonasev.tech/'));
      if (page) break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(page, 'game window created');
    await page.getByRole('heading', { name: `Fixture ${version}` }).waitFor();
  });
  assert.equal(new URL(page.url()).searchParams.get('muted'), '1');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  return page;
}
async function onlyLauncher(page) {
  await page.locator('#actions button').first().waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.ok(page.url().endsWith('/electron/launcher.html'));
  assert.equal(await app.evaluate(() => qa.calls.filter(url => !url.includes('api.github.com') && !url.endsWith('manifest.json')).length), 0);
}
async function layout(page) {
  const errors = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('h1,#description,main button:not([hidden])')];
    const rects = elements.map(e => ({ label: e.textContent, r: e.getBoundingClientRect(), e }));
    const errors = [];
    for (const { label, r, e } of rects) if (r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight || e.scrollWidth > e.clientWidth) errors.push(`clipped ${label}`);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r, b = rects[j].r;
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) errors.push('overlap');
    }
    return errors;
  });
  assert.deepEqual(errors, []);
}
try {
  for (const mode of ['current', 'offline', 'timeout']) {
    const start = performance.now(); await launch(mode); const page = await game('A');
    const check = await page.evaluate(() => window.bricksDesktop.check());
    assert.equal(check.available, false); assert.equal(check.error, false);
    assert.equal(check.checkOutcome, { current: 'current', offline: 'failed', timeout: 'timeout' }[mode]);
    assert.equal(await app.evaluate(() => qa.windows.length), 1);
    report.scenarios.push({ mode, pass: true, elapsedMs: performance.now() - start }); await finish();
  }
  let page = await launch('offer', 'retained'); await onlyLauncher(page); await layout(page);
  await page.getByRole('button', { name: 'What’s new on GitHub', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => qa.opened), ['https://github.com/afonasev/bricks-war/releases/tag/content-2']);
  assert.equal(await app.evaluate(() => qa.calls.filter(url => !url.includes('api.github.com') && !url.endsWith('manifest.json')).length), 0);
  report.scenarios.push({ mode: 'selected-release-changelog-without-download', pass: true });
  await page.screenshot({ path: join(output, 'offer-wide.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(380, 450));
  await layout(page); await page.screenshot({ path: join(output, 'offer-narrow.png') });
  await page.getByRole('button', { name: 'Play now', exact: true }).click();
  page = await game('A'); await page.evaluate(() => localStorage.setItem('qa-retained', 'yes'));
  assert.equal(await app.evaluate(() => qa.calls.filter(url => url.endsWith('manifest.json')).length), 1);
  report.scenarios.push({ mode: 'decline-no-bytes', pass: true }); await finish();

  page = await launch('update', 'retained'); await onlyLauncher(page);
  await app.evaluate(() => { qa.delay = 2000; });
  await page.getByRole('button', { name: 'Update and launch', exact: true }).click();
  await page.getByRole('heading', { name: 'Downloading update', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('progress').value > 0);
  await layout(page); await page.screenshot({ path: join(output, 'progress.png') });
  page = await game('B'); assert.equal(await page.evaluate(() => localStorage.getItem('qa-retained')), 'yes');
  const state = await page.evaluate(() => window.bricksDesktop.check());
  assert.equal(state.available, false); assert.equal(state.checkOutcome, 'installed');
  await page.evaluate(() => window.bricksDesktop.healthy());
  assert.deepEqual(JSON.parse(await readFile(join(output, `client-${'a'.repeat(64)}.json`),'utf8')), {nonce:'a'.repeat(64),digest:'b'.repeat(64),pid:app.process().pid});
  assert.equal(await app.evaluate(() => process.env.BRICKS_BOOTSTRAP_NONCE), undefined);
  report.scenarios.push({ mode: 'signed-content-update-and-retained-profile', pass: true }); await finish();
  await launch('offline', 'retained'); page = await game('B');
  assert.equal(await page.evaluate(() => localStorage.getItem('qa-retained')), 'yes');
  report.scenarios.push({ mode: 'updated-offline-restart', pass: true }); await finish();

  page = await launch('cancel'); await onlyLauncher(page);
  await app.evaluate(() => { qa.delay = 2000; });
  await page.getByRole('button', { name: 'Update and launch', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await game('A'); report.scenarios.push({ mode: 'cancel-drain-launch', pass: true }); await finish();

  page = await launch('retry'); await onlyLauncher(page);
  await page.getByRole('button', { name: 'Update and launch', exact: true }).click();
  await page.getByRole('heading', { name: 'Update interrupted', exact: true }).waitFor();
  await layout(page); await page.screenshot({ path: join(output, 'failure.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(380, 450));
  await layout(page); await page.screenshot({ path: join(output, 'failure-narrow.png') });
  await page.getByRole('button', { name: 'Try again', exact: true }).click(); await game('B');
  assert.equal(await app.evaluate(() => qa.calls.filter(url => url.includes('api.github.com')).length), 1);
  report.scenarios.push({ mode: 'corrupt-bytes-retry-same-discovery', pass: true }); await finish();

  page = await launch('keyboard'); await onlyLauncher(page);
  await app.evaluate(() => { qa.delay = 2500; });
  await page.keyboard.down('Enter');
  await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
  await page.keyboard.down('Enter'); // Repeat across a state transition must not activate Cancel.
  await page.waitForTimeout(250);
  assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).count(), 1);
  await page.keyboard.up('Enter'); await page.keyboard.press('Escape'); await game('A');
  report.scenarios.push({ mode: 'keyboard-fresh-edge-escape-cancel', pass: true }); await finish();

  page = await launch('controller'); await onlyLauncher(page);
  await app.evaluate(() => { qa.delay = 2500; });
  await page.evaluate(() => {
    window.qaPad = { index: 0, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
    window.qaPad.buttons[0].pressed = true;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
  });
  await page.waitForTimeout(250);
  assert.equal(await page.getByRole('heading', { name: 'Update Bricks War?', exact: true }).count(), 1);
  await page.evaluate(() => { window.qaPad.buttons[0].pressed = false; }); await page.waitForTimeout(100);
  await page.evaluate(() => { window.qaPad.buttons[0].pressed = true; });
  await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
  await page.waitForTimeout(250);
  assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).count(), 1);
  await page.evaluate(() => { window.qaPad.buttons[0].pressed = false; window.qaPad.buttons[1].pressed = true; });
  await game('A'); report.scenarios.push({ mode: 'simulated-controller-fresh-edge-and-cancel', pass: true }); await finish();

  for (const mode of ['activation-fault-before', 'activation-fault-after']) {
    page = await launch(mode); await onlyLauncher(page);
    await page.getByRole('button', { name: 'Update and launch', exact: true }).click();
    await page.getByRole('heading', { name: 'Previous version restored', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Play now', exact: true }).click(); page = await game('A');
    const check = await page.evaluate(() => window.bricksDesktop.check());
    assert.equal(check.available, false); assert.equal(check.phase, 'idle'); assert.equal(check.checkOutcome, 'recovered');
    assert.equal(await page.evaluate(() => window.bricksDesktop.apply()), false);
    report.scenarios.push({ mode, pass: true }); await finish();
  }
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = error.stack; throw error;
} finally {
  await finish(); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
