import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
const path = process.env.BRICKS_CONTENT_PRIVATE_KEY ?? join(homedir(), '.config', 'bricks-war', 'content-private-key.pem');
try { await access(path); throw Error('A release key already exists. Preserve it; never rotate existing clients silently.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
await writeFile(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
await writeFile('electron/content-public-key.pem', publicKey.export({ type: 'spki', format: 'pem' }));
console.log('Release key created outside the repository; public key pinned in electron/content-public-key.pem.');
