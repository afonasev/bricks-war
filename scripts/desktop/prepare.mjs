import { readFile, writeFile, readdir, mkdir, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { sign, createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { digest, validateManifest } from '../../electron/content.mjs';
const keyPath = process.env.BRICKS_CONTENT_PRIVATE_KEY ?? join(homedir(), '.config', 'bricks-war', 'content-private-key.pem');
const privateKey = await readFile(keyPath, 'utf8');
const publicKey = await readFile('electron/content-public-key.pem', 'utf8');
if (createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) !== publicKey) throw Error('Release key does not match pinned public key');
const sequence = Date.now();
const files = [];
async function inventory(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) await inventory(join(dir, entry.name), `${path}/`);
    else if (entry.isFile()) { const bytes = await readFile(join(dir, entry.name)); files.push({ path, size: bytes.length, sha256: digest(bytes) }); }
    else throw Error('Build contains a symlink');
  }
}
await inventory('dist'); files.sort((a,b) => a.path.localeCompare(b.path));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const payload = JSON.stringify({ schema: 1, sequence, gameVersion: pkg.version, minShellVersion: 1,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), files });
const envelope = { payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') };
validateManifest(envelope, publicKey, 1);
await mkdir('build', { recursive: true });
await rm('build/desktop-content', { recursive: true, force: true });
await cp('dist', 'build/desktop-content', { recursive: true });
await writeFile('build/desktop-content/manifest.json', JSON.stringify(envelope));
await mkdir(`build/desktop-publish/game/${sequence}`, { recursive: true });
await cp('dist', `build/desktop-publish/game/${sequence}`, { recursive: true });
await writeFile('build/desktop-publish/game/latest.json', JSON.stringify(envelope));
console.log(`Prepared signed game ${pkg.version}, sequence ${sequence}, ${files.length} files.`);
