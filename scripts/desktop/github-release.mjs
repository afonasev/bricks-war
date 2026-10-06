import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { digest } from '../../electron/content.mjs';
import { load } from 'js-yaml';
const repo = 'afonasev/bricks-war';
const config = load(await readFile('electron-builder.yml', 'utf8'));
const version = config.extraMetadata.version, tag = `v${version}`;
const gh = args => execFileSync('gh', args, { encoding: 'utf8' });
const names = (await readdir('build/installers')).filter(name => /\.(dmg|exe|zip|blockmap)$/.test(name) || ['latest.yml', 'latest-mac.yml'].includes(name));
const catalog = {}, hashes = new Map();
for (const name of names) {
  if (!name.includes(version) && !name.endsWith('.yml')) throw Error(`Stale build asset: ${name}`);
  const hash = digest(await readFile(`build/installers/${name}`)); hashes.set(name, hash);
  const platform = name.endsWith('.dmg') ? 'mac' : name.endsWith('.exe') ? 'win' : null;
  if (platform) {
    if (catalog[platform]) throw Error('Multiple installers for platform');
    catalog[platform] = { url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`, sha256: hash };
  }
}
if (!catalog.mac || !catalog.win || !names.includes('latest.yml') || !names.includes('latest-mac.yml')) throw Error('Both platforms and updater metadata required');
await writeFile('build/installers/SHA256SUMS', [...hashes].map(([name, hash]) => `${hash}  ${name}`).join('\n') + '\n');
gh(['release', 'create', tag, '-R', repo, '--target', 'main', '--draft', '--title', `Bricks War ${version}`, '--notes', 'Windows: system Program Files installation, game icon, desktop shortcut and launch options together on the finish page. macOS: universal build. Unsigned builds; native platform acceptance remains pending.']);
gh(['release', 'upload', tag, ...names.map(name => `build/installers/${name}`), 'build/installers/SHA256SUMS', '-R', repo]);
const release = JSON.parse(gh(['api', `repos/${repo}/releases/tags/${tag}`]));
for (const [name, hash] of hashes) {
  const asset = release.assets.find(asset => asset.name === name);
  if (asset?.digest !== `sha256:${hash}`) throw Error(`GitHub asset digest mismatch: ${name}; draft retained`);
}
gh(['release', 'edit', tag, '-R', repo, '--draft=false', '--latest']);
for (const file of Object.values(catalog)) {
  const response = await fetch(file.url, { method: 'HEAD' });
  if (!response.ok) throw Error('Public GitHub download unavailable; VPS untouched');
}
await writeFile('build/github-catalog.json', JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ tag, url: release.html_url, hashes: Object.fromEntries(hashes), catalog }, null, 2));
