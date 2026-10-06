import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { digest, validateManifest } from '../../electron/content.mjs';

// Installer publication is explicit. Content-only publication reuses the existing installers.
const installers = process.argv.includes('--installers');
const host = process.env.DEPLOY_HOST ?? 'gfe';
const id = `release-${Date.now()}`;
const base = '/opt/bricks-war-desktop', target = `${base}/${id}`, link = '/opt/bricks-war/desktop';
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const ssh = command => execFileSync('ssh', ['-o', 'BatchMode=yes', host, command], { encoding: 'utf8' }).trim();
const stage = 'build/desktop-publish';
const current = JSON.parse(await readFile(`${stage}/game/latest.json`, 'utf8'));
const sequence = validateManifest(current, await readFile('electron/content-public-key.pem', 'utf8'), 1).sequence;
// Discard previous local preparation payloads; publish exactly one current game release.
for (const entry of await readdir(`${stage}/game`)) if (entry !== String(sequence) && entry !== 'latest.json') await rm(`${stage}/game/${entry}`, { recursive: true, force: true });
if (installers) {
  await rm(`${stage}/installers`, { recursive: true, force: true }); await mkdir(`${stage}/installers`, { recursive: true });
  const catalog = JSON.parse(await readFile('build/github-catalog.json', 'utf8'));
  for (const name of await readdir('build/installers')) {
    if (!/\.(dmg|exe|zip|blockmap)$/.test(name) && !['latest.yml', 'latest-mac.yml'].includes(name)) continue;
    // Keep metadata only: old generic-updater clients follow absolute GitHub URLs.
    if (['latest.yml', 'latest-mac.yml'].includes(name)) {
      const { load, dump } = await import('js-yaml');
      const metadata = load(await readFile(`build/installers/${name}`, 'utf8'));
      const releaseBase = `https://github.com/afonasev/bricks-war/releases/download/v${metadata.version}/`;
      for (const file of metadata.files) file.url = releaseBase + encodeURIComponent(file.url);
      metadata.path = releaseBase + encodeURIComponent(metadata.path);
      await writeFile(`${stage}/installers/${name}`, dump(metadata));
    }
  }
  for (const platform of ['mac', 'win']) {
    if (!catalog[platform]?.url?.startsWith('https://github.com/afonasev/bricks-war/releases/download/')) throw Error('Verified GitHub catalog required');
  }
  await writeFile(`${stage}/latest.json`, JSON.stringify(catalog));
} else {
  // A previous --installers local publication must not accidentally replace current server installers.
  await rm(`${stage}/installers`, { recursive: true, force: true }); await rm(`${stage}/latest.json`, { force: true });
}
const previous = ssh(`if test -L ${quote(link)}; then readlink ${quote(link)}; elif test -e ${quote(link)}; then exit 2; fi`);
if (previous && !/^\/opt\/bricks-war-desktop\/release-\d+$/.test(previous)) throw Error('Foreign desktop deployment path; refusing replacement');
if (!installers && !previous) throw Error('Publish initial installers before content-only releases');
try {
ssh(`set -eu; install -d -m 755 ${quote(target)}; ${!installers ? `cp -a ${quote(`${previous}/installers`)} ${quote(target)}; cp ${quote(`${previous}/latest.json`)} ${quote(target)}` : ':'}`);
const tar = spawn('tar', ['-C', stage, '-czf', '-', '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
const upload = spawn('ssh', ['-o', 'BatchMode=yes', host, `set -eu; tar -xzf - -C ${quote(target)}; find ${quote(target)} -type f -exec chmod 644 {} +`], { stdio: ['pipe', 'inherit', 'inherit'] });
tar.stdout.pipe(upload.stdin);
const done = child => new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(`Upload exited ${code}`))); });
await Promise.all([done(tar), done(upload)]);
ssh(`set -eu; ln -s ${quote(target)} ${quote(`${link}.next`)}; mv -Tf ${quote(`${link}.next`)} ${quote(link)}`);
try {
  const baseUrl = 'https://bricks.afonasev.tech';
  const manifestResponse = await fetch(`${baseUrl}/desktop/game/latest.json`, { cache: 'no-store' });
  if (!manifestResponse.ok || JSON.stringify(await manifestResponse.json()) !== JSON.stringify(current)) throw Error('Public game readback mismatch');
  const catalogResponse = await fetch(`${baseUrl}/desktop/latest.json`, { cache: 'no-store' });
  if (!catalogResponse.ok) throw Error('Public installer catalog missing');
  const catalog = await catalogResponse.json();
  for (const platform of ['mac', 'win']) {
    const file = catalog[platform];
    if (!file?.url || file.url.includes('..')) throw Error('Invalid installer catalog');
    const url = new URL(file.url, baseUrl).href;
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const github = url.startsWith('https://github.com/afonasev/bricks-war/releases/download/');
    if (!github && !file.url.startsWith('/desktop/installers/')) throw Error('Invalid installer origin');
    if (!response.ok) throw Error('Public installer unavailable');
    if (!github) {
      const publicHash = ssh(`curl -fsS --max-time 180 ${quote(url)} | sha256sum`).split(/\s+/)[0];
      if (publicHash !== file.sha256) throw Error('Public installer checksum mismatch');
    }
  }
} catch (error) {
  if (previous) ssh(`ln -s ${quote(previous)} ${quote(`${link}.rollback`)}; mv -Tf ${quote(`${link}.rollback`)} ${quote(link)}`);
  else ssh(`test "$(readlink ${quote(link)})" = ${quote(target)} && rm ${quote(link)}`);
  throw error;
}
if (previous && previous !== target) ssh(`rm -rf -- ${quote(previous)}`);
console.log(`Published ${id}; latest game sequence ${sequence}; old distribution removed only after public checksum readback.`);

} catch (error) {
  // Failed candidates are owned temporary resources, never an installer history.
  const active = ssh(`if test -L ${quote(link)}; then readlink ${quote(link)}; fi`);
  if (active !== target) ssh(`rm -rf -- ${quote(target)}`);
  throw error;
}
