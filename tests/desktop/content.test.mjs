import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentStore, validateManifest, digest } from '../../electron/content.mjs';
import { windowPreferences, fitWindow } from '../../electron/window.mjs';

const keys = generateKeyPairSync('ed25519');
const envelope = (sequence, bytes, overrides = {}) => {
  const payload = JSON.stringify({ schema: 1, sequence, gameVersion: `1.0.${sequence}`, minShellVersion: 1,
    files: [{ path: 'index.html', sha256: digest(bytes), size: bytes.length }], ...overrides });
  return { payload, signature: sign(null, Buffer.from(payload), keys.privateKey).toString('base64') };
};
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bricks-content-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const bundled = join(root, 'bundle'); await mkdir(bundled);
  const a = Buffer.from('game A'), b = Buffer.from('game B');
  await writeFile(join(bundled, 'index.html'), a);
  await writeFile(join(bundled, 'manifest.json'), JSON.stringify(envelope(1, a)));
  let manifest = envelope(2, b), content = b;
  const options = { root: join(root, 'profile'), bundled, publicKey: keys.publicKey, shellVersion: 1,
    download: async path => Buffer.from(path === 'latest.json' ? JSON.stringify(manifest) : content) };
  return { a, b, options, set: (m, c) => { manifest = m; content = c; } };
}
test('rejects forged, incompatible, traversal and duplicate inventory', () => {
  const bytes = Buffer.from('a'); const signed = envelope(2, bytes);
  assert.throws(() => validateManifest({ ...signed, payload: signed.payload + ' ' }, keys.publicKey, 1));
  assert.throws(() => validateManifest(envelope(2, bytes, { minShellVersion: 2 }), keys.publicKey, 1));
  assert.throws(() => validateManifest(envelope(2, bytes, { files: [{path: '../x',size:1,sha256:digest(bytes)}] }), keys.publicKey, 1));
  assert.throws(() => validateManifest(envelope(2, bytes, { files: [...JSON.parse(signed.payload).files, ...JSON.parse(signed.payload).files] }), keys.publicKey, 1));
});
test('offline bootstrap and atomic update keep active files unchanged until activation', async t => {
  const f = await fixture(t); const store = await new ContentStore(f.options).open();
  assert.equal(await readFile(join(store.active, 'index.html'), 'utf8'), 'game A');
  assert.equal(await store.check(), true);
  assert.equal(await readFile(join(store.active, 'index.html'), 'utf8'), 'game A');
  await store.activate(); await store.healthy();
  const restarted = await new ContentStore(f.options).open();
  assert.equal(await readFile(join(restarted.active, 'index.html'), 'utf8'), 'game B');
  assert.equal(await restarted.check(), false);
});
test('unconfirmed startup rolls back, replay protection survives rollback', async t => {
  const f = await fixture(t); const store = await new ContentStore(f.options).open();
  await store.check(); await store.activate();
  const restarted = await new ContentStore(f.options).open();
  assert.equal(await readFile(join(restarted.active, 'index.html'), 'utf8'), 'game A');
  assert.equal(await restarted.check(), false);
});
test('corrupt or interrupted downloads preserve active release and permit retry', async t => {
  const f = await fixture(t); const store = await new ContentStore(f.options).open();
  f.set(envelope(2, f.b), Buffer.from('corrupt')); await assert.rejects(store.check());
  assert.equal(store.ready, null); assert.equal(store.state.highWater, 0);
  f.set(envelope(2, f.b), f.b); await store.check();
  assert.equal(store.ready.sequence, 2);
});
test('window settings accept listed resolutions and fit smaller monitors', () => {
  assert.deepEqual(windowPreferences({width:NaN,height:-1,fullscreen:'true'}), {width:1280,height:720,fullscreen:false});
  assert.deepEqual(fitWindow(windowPreferences({width:1920,height:1080,fullscreen:false}), {width:1280,height:800}), {width:1280,height:760});
});
