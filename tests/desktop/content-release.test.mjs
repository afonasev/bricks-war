import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { contentReleasePlan, publishContentRelease } from '../../scripts/desktop/content-release.mjs';
import { digest } from '../../electron/content.mjs';

test('plan validates local signatures/hashes and deduplicates identical file bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bricks-release-plan-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keys = generateKeyPairSync('ed25519'), bytes = Buffer.from('same');
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), bytes);
  await writeFile(join(directory, 'assets/copy'), bytes);
  const payload = JSON.stringify({ schema: 1, sequence: 42, minShellVersion: 1, gameVersion: '1.4.1',
    files: ['index.html', 'assets/copy'].map(path => ({ path, sha256: digest(bytes), size: bytes.length })) });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ payload,
    signature: sign(null, Buffer.from(payload), keys.privateKey).toString('base64') }));
  const plan = await contentReleasePlan(directory, keys.publicKey);
  assert.equal(plan.tag, 'content-42');
  assert.deepEqual(plan.assets.map(a => a.name), [digest(bytes), 'manifest.json']);
  await writeFile(join(directory, 'index.html'), 'changed');
  await assert.rejects(contentReleasePlan(directory, keys.publicKey), /checksum/);
});

function fixture(fail = '') {
  const bytes = Buffer.from('game'), sha256 = digest(bytes);
  const plan = { tag: 'content-42', assets: [{ name: sha256, path: 'x', sha256, size: bytes.length }] };
  const events = []; let release = null;
  const remote = {
    find: async () => release,
    create: async () => { events.push('create'); return release = { draft: true, prerelease: true, assets: [] }; },
    upload: async (_tag, asset) => {
      events.push('upload'); if (fail === 'upload') throw Error('upload failed');
      release.assets.push({ name: asset.name, size: asset.size, digest: fail === 'digest' ? 'bad' : `sha256:${sha256}` });
    },
    publish: async () => { events.push('publish'); release.draft = false; },
    download: async () => { events.push('download'); return fail === 'public' ? Buffer.from('bad!') : bytes; },
    switchPointer: async () => { events.push('pointer'); },
  };
  return { plan, remote, events, get release() { return release; } };
}
test('publisher switches discovery only after complete upload, digest and public-byte verification; retries reuse assets', async () => {
  const f = fixture();
  await publishContentRelease(f.plan, f.remote);
  assert.deepEqual(f.events, ['create', 'upload', 'publish', 'download', 'pointer']);
  f.events.length = 0;
  await publishContentRelease(f.plan, f.remote);
  assert.deepEqual(f.events, ['download', 'pointer']);
});
test('upload, digest and public-byte failures leave discovery unchanged', async () => {
  for (const failure of ['upload', 'digest', 'public']) {
    const f = fixture(failure);
    await assert.rejects(publishContentRelease(f.plan, f.remote));
    assert.ok(!f.events.includes('pointer'));
    if (failure !== 'public') assert.ok(!f.events.includes('publish'));
  }
});
test('published incomplete or conflicting assets cannot be overwritten', async () => {
  const f = fixture();
  await f.remote.create();
  f.release.draft = false;
  await assert.rejects(publishContentRelease(f.plan, f.remote), /incomplete/);
  f.release.assets.push({ name: f.plan.assets[0].name, size: 4, digest: 'sha256:bad' });
  await assert.rejects(publishContentRelease(f.plan, f.remote), /differs/);
  assert.ok(!f.events.includes('upload')); assert.ok(!f.events.includes('pointer'));
});
test('stable shell release cannot be used as a content publication', async () => {
  const f = fixture(); await f.remote.create(); f.release.prerelease = false;
  await assert.rejects(publishContentRelease(f.plan, f.remote), /prerelease/);
});
