import { sign, createPublicKey } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateReleaseNotes } from './release-notes.mjs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { digest } from '../../electron/content.mjs';
import { load } from 'js-yaml';
const repo = 'afonasev/bricks-war';
const config = load(await readFile('electron-builder.yml', 'utf8'));
const version = config.extraMetadata.version, tag = `v${version}`;
const gh = args => execFileSync('gh', args, { encoding: 'utf8' });
const names = (await readdir('build/installers')).filter(name => /\.(dmg|exe|zip|blockmap)$/.test(name) || ['latest.yml', 'latest-mac.yml'].includes(name)).sort();
const privateKey = await readFile(process.env.BRICKS_CONTENT_PRIVATE_KEY ?? join(homedir(),'.config/bricks-war/content-private-key.pem'),'utf8');
const publicKey = await readFile('electron/content-public-key.pem','utf8');
if (createPublicKey(privateKey).export({type:'spki',format:'pem'}) !== publicKey) throw Error('Wrong release signing key');
const catalog = {}, hashes = new Map(); const shellFiles = [];
for (const name of names) {
  if (!name.includes(version) && !name.endsWith('.yml')) throw Error(`Stale build asset: ${name}`);
  const hash = digest(await readFile(`build/installers/${name}`)); hashes.set(name, hash);
  if (name.endsWith('.zip') || name.endsWith('.exe')) shellFiles.push({name,sha256:hash,size:(await readFile(`build/installers/${name}`)).length,platform:name.endsWith('.zip')?'darwin':'win32',arch:name.endsWith('.zip')?'universal':'x64',minimumOS:name.endsWith('.zip')?'13.0.0':'10.0.0'});
  const platform = name.endsWith('.dmg') ? 'mac' : name.endsWith('.exe') ? 'win' : null;
  if (platform) {
    if (catalog[platform]) throw Error('Multiple installers for platform');
    catalog[platform] = { url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`, sha256: hash };
  }
}
if (!catalog.mac || !catalog.win || !names.includes('latest.yml') || !names.includes('latest-mac.yml')) throw Error('Both platforms and updater metadata required');
const shellPayload = JSON.stringify({schema:1,game:'bricks-war',component:'shell',channel:'stable',updaterAbi:1,version,files:shellFiles});
const shellEnvelope = JSON.stringify({payload:shellPayload,signature:sign(null,Buffer.from(shellPayload),privateKey).toString('base64')});
await writeFile('build/installers/shell-manifest.json',shellEnvelope); names.push('shell-manifest.json'); hashes.set('shell-manifest.json',digest(Buffer.from(shellEnvelope)));
await writeFile('build/installers/SHA256SUMS', [...hashes].map(([name, hash]) => `${hash}  ${name}`).join('\n') + '\n');
// Content prereleases may fill the first page; native draft recovery must see all releases.
const releases = () => JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`])).flat();
const published = releases();
let release = published.find(release => release.tag_name === tag);
const previous = published.filter(r=>!r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name) && r.tag_name !== tag).sort((a,b)=>new Date(b.published_at)-new Date(a.published_at))[0];
let previousSource;
if (previous) previousSource = Buffer.from(gh(['api',`repos/${repo}/contents/SOURCE_REVISION?ref=${encodeURIComponent(previous.tag_name)}`,'--jq','.content']),'base64').toString().trim();
const notes = await generateReleaseNotes(previousSource);

if (!release) {
  const request = 'build/github-native-release-request.json';
  await writeFile(request, JSON.stringify({ tag_name: tag, target_commitish: 'main', draft: true,
    prerelease: false, make_latest: 'false', name: `Bricks War ${version}`,
    body: notes + '\nmacOS/Windows: test distribution; platform acceptance pending. macOS is unsigned, without Developer ID/notarization.' }));
  release = JSON.parse(gh(['api', '--method', 'POST', `repos/${repo}/releases`, '--input', request]));
}
// Resume a draft safely: never replace an asset already carrying a different digest.
for (const [name, hash] of hashes) {
  const asset = release.assets.find(asset => asset.name === name);
  if (asset && asset.digest !== `sha256:${hash}`) throw Error(`Existing release asset mismatch: ${name}`);
}
const missing = [...names, 'SHA256SUMS'].filter(name => !release.assets.some(asset => asset.name === name));
if (missing.length) gh(['release', 'upload', tag, ...missing.map(name => `build/installers/${name}`), '-R', repo]);
release = JSON.parse(gh(['api', `repos/${repo}/releases/${release.id}`]));
for (const [name, hash] of hashes) {
  const asset = release.assets.find(asset => asset.name === name);
  if (asset?.digest !== `sha256:${hash}`) throw Error(`GitHub asset digest mismatch: ${name}; draft retained`);
}
if (release.draft) gh(['release', 'edit', tag, '-R', repo, '--draft=false', '--latest']);
for (const file of Object.values(catalog)) {
  const response = await fetch(file.url, { method: 'HEAD' });
  if (!response.ok) throw Error('Public GitHub download unavailable; VPS untouched');
}
await writeFile('build/github-catalog.json', JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ tag, url: release.html_url, hashes: Object.fromEntries(hashes), catalog }, null, 2));
