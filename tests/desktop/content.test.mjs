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
  assert.deepEqual(windowPreferences({width:NaN,height:-1,fullscreen:'true'}), {width:1280,height:720,fullscreen:false,auto:false});
  assert.deepEqual(fitWindow(windowPreferences({width:1920,height:1080,fullscreen:false}), {width:1280,height:800}), {width:1280,height:760});
});
test('one-time shell replacement uses a newer bundle while retaining a newer cached release', async t => {
  const f = await fixture(t); const store = await new ContentStore(f.options).open();
  await store.check(); await store.activate(); await store.healthy();
  // Reinstalling the same old shell must keep newer downloaded content.
  assert.equal((await new ContentStore(f.options).open()).manifest.sequence, 2);
  const c = Buffer.from('game C');
  await writeFile(join(f.options.bundled, 'index.html'), c);
  await writeFile(join(f.options.bundled, 'manifest.json'), JSON.stringify(envelope(3, c)));
  const replaced = await new ContentStore(f.options).open();
  assert.equal(replaced.manifest.sequence, 3);
  assert.equal(await readFile(join(replaced.active, 'index.html'), 'utf8'), 'game C');
  assert.equal(await replaced.check(), false);
});
test('new shell bundle supersedes obsolete pending content, but preserves newer pending content', async t => {
  const f = await fixture(t); const store = await new ContentStore(f.options).open(); await store.check();
  const c = Buffer.from('game C');
  await writeFile(join(f.options.bundled, 'index.html'), c);
  await writeFile(join(f.options.bundled, 'manifest.json'), JSON.stringify(envelope(3, c)));
  const replaced = await new ContentStore(f.options).open();
  assert.equal(replaced.ready, null); assert.equal(replaced.state.pending, null);
  f.set(envelope(4, f.b), f.b); await replaced.check();
  assert.equal((await new ContentStore(f.options).open()).ready.sequence, 4);
});
test('stage progress and download identity come only from verified inventory', async t => {
  const f = await fixture(t), progress = [], files = [], original = f.options.download;
  f.options.onProgress = phase => progress.push(phase);
  f.options.download = (path, size, file) => { if (file) files.push(file); return original(path, size); };
  const store = await new ContentStore(f.options).open(); await store.check();
  assert.deepEqual(progress, ['checking', 'downloading', 'verifying']);
  assert.deepEqual(files, [{ sequence: 2, sha256: digest(f.b) }]);
});

test('explicit cancel revokes pending activation but a fresh consent may retry the same signed package',async t=>{
 const f=await fixture(t);const store=await new ContentStore(f.options).open();const selected=envelope(2,f.b);await store.prepare(selected);await store.discardPrepared(2);assert.equal(store.ready,null);assert.equal(store.state.pending,null);assert.equal(store.state.highWater,2);assert.equal(await store.check(),false);await store.prepare(selected);assert.equal(store.ready.sequence,2);assert.equal(await readFile(join(store.active,'index.html'),'utf8'),'game A');
});
test('cancel before content preflight cannot transfer a package',async t=>{
 const f=await fixture(t);let calls=0;f.options.download=async()=>{calls++;throw Error('unexpected');};const store=await new ContentStore(f.options).open();const preparing=store.prepare(envelope(2,f.b));store.cancel();await assert.rejects(preparing);assert.equal(calls,0);assert.equal(store.ready,null);
});


test('a complete staged future-shell game survives old startup without becoming active', async t => {
  const f = await fixture(t);
  const options = {...f.options,shellRelease:'1.0.0'};
  const store = await new ContentStore(options).open();
  const future = envelope(2,f.b,{minShellVersion:3,minShellRelease:'2.0.0'});
  f.set(future,f.b);
  await store.prepare(future,()=>{},{abi:3,version:'2.0.0'});
  assert.equal(store.ready,null);assert.equal(store.manifest.sequence,1);assert.equal(await store.activate(),false);
  const old = await new ContentStore(options).open();
  assert.equal(old.ready,null);assert.equal(old.state.pending,'release-2');assert.equal(old.manifest.sequence,1);
  const upgraded = await new ContentStore({...options,shellVersion:3,shellRelease:'2.0.0'}).open();
  assert.equal(upgraded.ready.sequence,2);await upgraded.activate();assert.equal(upgraded.manifest.sequence,2);
  await upgraded.healthy();
  assert.equal((await new ContentStore({...options,shellVersion:3,shellRelease:'2.0.0'}).open()).manifest.sequence,2);
});

test('future-shell staging cannot bypass installed-shell activation and can be discarded', async t => {
  const f=await fixture(t);const store=await new ContentStore(f.options).open();
  const future=envelope(2,f.b,{minShellVersion:3});f.set(future,f.b);
  await assert.rejects(store.prepare(future),{code:'INCOMPATIBLE'});
  await store.prepare(future,()=>{},{abi:3,version:'2.0.0'});
  store.ready=JSON.parse(future.payload);
  await assert.rejects(store.activate(),{code:'INCOMPATIBLE'});assert.equal(store.manifest.sequence,1);
  await store.discardPrepared(2);assert.equal(store.ready,null);assert.equal(store.state.pending,null);
});

test('minimum release checks are signed, validated and fail closed without installed identity',()=>{
  const signed=envelope(2,Buffer.from('b'),{minShellVersion:1,minShellRelease:'1.10.0'});
  for(const release of [undefined,'1.9.9'])assert.throws(()=>validateManifest(signed,keys.publicKey,3,release),{code:'INCOMPATIBLE'});
  assert.equal(validateManifest(signed,keys.publicKey,3,'1.10.0').sequence,2);
  assert.throws(()=>validateManifest(envelope(2,Buffer.from('b'),{minShellVersion:99,minShellRelease:'garbage'}),keys.publicKey,3,'1.10.0'),/stable version/);
});


test('corrupt prepared content is a visible recovery, never a completed update',async t=>{
 const f=await fixture(t);const store=await new ContentStore(f.options).open();await store.check();
 await writeFile(join(store.root,store.state.pending,'index.html'),'corrupt');
 const restarted=await new ContentStore(f.options).open();assert.equal(restarted.recovered,true);assert.equal(restarted.ready,null);assert.equal(restarted.manifest.sequence,1);
});
