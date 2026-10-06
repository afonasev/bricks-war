import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BUMP_LEVELS = new Set(['patch', 'minor', 'major']);

export function nextVersion(currentVersion, bump) {
  const match = SEMVER.exec(currentVersion);
  if (!match) throw new Error(`Package version must be a SemVer core version, received "${currentVersion}".`);
  if (!BUMP_LEVELS.has(bump)) throw new Error(`VERSION_BUMP must be patch, minor, or major; received "${bump}".`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export async function prepareDeploy({ root, bump = 'patch', now = new Date() }) {
  const packagePath = resolve(root, 'package.json');
  const lockPath = resolve(root, 'package-lock.json');
  const metadataPath = resolve(root, 'config/deployment-build.json');
  const packageInfo = JSON.parse(await readFile(packagePath, 'utf8'));
  const next = nextVersion(packageInfo.version, bump);
  const lockInfo = JSON.parse(await readFile(lockPath, 'utf8'));
  packageInfo.version = next;
  lockInfo.version = next;
  if (lockInfo.packages?.['']) lockInfo.packages[''].version = next;
  const deployedAt = now.toISOString();
  await Promise.all([
    writeFile(packagePath, `${JSON.stringify(packageInfo, null, 2)}\n`),
    writeFile(lockPath, `${JSON.stringify(lockInfo, null, 2)}\n`),
    writeFile(metadataPath, `${JSON.stringify({ version: next, deployedAt }, null, 2)}\n`),
  ]);
  return { version: next, deployedAt };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const currentPath = fileURLToPath(import.meta.url);
if (invokedPath === currentPath) {
  const root = resolve(dirname(currentPath), '..');
  try {
    const metadata = await prepareDeploy({ root, bump: process.argv[2] ?? 'patch' });
    console.log(`Prepared deployment ${metadata.version} at ${metadata.deployedAt}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
