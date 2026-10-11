import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { digest, validateManifest } from '../../electron/content.mjs';

export async function contentReleasePlan(directory, publicKey) {
  const bytes = await readFile(join(directory, 'manifest.json'));
  const envelope = JSON.parse(bytes);
  const manifest = validateManifest(envelope, publicKey, 1);
  const assets = new Map();
  for (const file of manifest.files) {
    const path = join(directory, file.path);
    if (!(await lstat(path)).isFile()) throw Error('Invalid local content file');
    const data = await readFile(path);
    if (data.length !== file.size || digest(data) !== file.sha256) throw Error('Local content checksum mismatch');
    assets.set(file.sha256, { name: file.sha256, path, size: file.size, sha256: file.sha256 });
  }
  assets.set('manifest.json', { name: 'manifest.json', path: join(directory, 'manifest.json'), size: bytes.length, sha256: digest(bytes) });
  return { tag: `content-${manifest.sequence}`, manifest, envelope, assets: [...assets.values()] };
}

/** Immutable assets are verified before the only mutable discovery pointer is switched. */
export async function publishContentRelease(plan, remote) {
  let release = await remote.find(plan.tag);
  if (!release) release = await remote.create(plan.tag);
  if (!release.prerelease) throw Error('Content release must be a prerelease');
  for (const asset of plan.assets) {
    const existing = release.assets.find(entry => entry.name === asset.name);
    if (existing) {
      if (existing.size !== asset.size || existing.digest !== `sha256:${asset.sha256}`) throw Error('Existing release asset differs');
    } else {
      if (!release.draft) throw Error('Published release is incomplete; use a new sequence');
      await remote.upload(plan.tag, asset);
    }
  }
  // Refresh uploaded metadata: never publish using an unverified upload response.
  release = await remote.find(plan.tag);
  for (const asset of plan.assets) {
    const actual = release.assets.find(entry => entry.name === asset.name);
    if (!actual || actual.size !== asset.size || actual.digest !== `sha256:${asset.sha256}`) throw Error('Uploaded asset readback mismatch');
  }
  if (release.draft) await remote.publish(plan.tag);
  for (const asset of plan.assets) {
    const data = await remote.download(plan.tag, asset);
    if (data.length !== asset.size || digest(data) !== asset.sha256) throw Error('Public asset readback mismatch');
  }
  await remote.switchPointer(plan);
}
