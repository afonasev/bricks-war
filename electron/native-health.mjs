import { open, rename, unlink, lstat } from 'node:fs/promises';
import { isAbsolute, dirname, basename, parse, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const keys = ['BRICKS_BOOTSTRAP_NONCE','BRICKS_BOOTSTRAP_DIGEST','BRICKS_BOOTSTRAP_RECEIPT'];
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Capture once, then prevent helpers/child apps from inheriting this receipt. */
export function captureNativeHealth(environment = process.env) {
  const [nonce, target, receipt] = keys.map(key => environment[key]);
  for (const key of keys) delete environment[key];
  if ([nonce,target,receipt].every(value => value === undefined)) return null;
  if (!digest(nonce) || !digest(target) || typeof receipt !== 'string' || !isAbsolute(receipt)
    || !['client','launcher'].some(component => basename(receipt) === `${component}-${nonce}.json`)) throw Error('Invalid native startup health contract');
  return Object.freeze({nonce,digest:target,receipt});
}

export async function notifyNativeHealth(contract, pid = process.pid) {
  if (!contract) return false;
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid health process identity');
  // Native root provisions this private original-user directory. Refuse linked
  // ancestors and never create a path supplied through the game renderer.
  const parent = dirname(contract.receipt);
  for (let path = parent; ; path = dirname(path)) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Unsafe native health directory');
    if (path === parse(path).root) break;
  }
  const temp = join(parent,`.receipt-${randomBytes(16).toString('hex')}`);
  let file;
  try {
    file = await open(temp,'wx',0o600);
    await file.writeFile(JSON.stringify({nonce:contract.nonce,digest:contract.digest,pid}));
    await file.sync(); await file.close(); file = null;
    await rename(temp,contract.receipt);
    if (process.platform !== 'win32') {
      const directory = await open(parent,'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
    return true;
  } finally {
    await file?.close();
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
