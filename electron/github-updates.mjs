import { readFile, writeFile } from 'node:fs/promises';
import { validateManifest } from './content.mjs';
import { CONTENT_REPOSITORY, githubContentDownload } from './update-source.mjs';

export function compareVersions(a, b) {
  const parse = value => { const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? ''); if (!match) throw Error('Invalid stable version'); return match.slice(1).map(Number); };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
export function localizedNotes(body, language = 'ru') {
  const marker = language === 'en' ? 'English' : 'Русский';
  const pattern = new RegExp(`^## ${marker}\\s*\\n([\\s\\S]*?)(?=^## (?:English|Русский)\\s*$|(?![\\s\\S]))`, 'm');
  const selected = pattern.exec(body ?? '')?.[1]?.trim();
  if (selected) return { text: selected, fallback: false };
  const english = /^## English\s*\n([\s\S]*)/m.exec(body ?? '')?.[1]?.trim();
  return { text: english || body?.trim() || 'Описание этой версии недоступно.', fallback: true };
}

export class GithubUpdates {
  constructor({ gate, fetcher = fetch, store, publicKey, cachePath, shell }) {
    Object.assign(this, { gate, fetcher, store, publicKey, cachePath, shell }); this.cache = {}; this.releases = null;
    const raw = githubContentDownload(fetcher);
    this.download = (path, limit, file) => gate.run(signal => raw(path, limit, { ...file,
      signal: file?.signal ? AbortSignal.any([signal,file.signal]) : signal }), file?.signal);
  }
  async api(path) {
    return this.gate.run(async signal => {
      const cached = this.cache[path];
      const response = await this.fetcher(`https://api.github.com/repos/${CONTENT_REPOSITORY}/${path}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), redirect: 'error',
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
      });
      if (response.status === 304 && cached) return cached.value;
      if (!response.ok) { await response.body?.cancel(); throw Error('GitHub unavailable or rate limited'); }
      const reader = response.body.getReader(); let size = 0; const chunks = [];
      try { for (;;) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) throw Error('Oversized GitHub response'); chunks.push(Buffer.from(value)); } }
      finally { await reader.cancel(); }
      const value = JSON.parse(Buffer.concat(chunks)); this.cache[path] = { etag: response.headers.get('etag'), value };
      await writeFile(this.cachePath, JSON.stringify(this.cache)); return value;
    });
  }
  async list() {
    try { this.cache = JSON.parse(await readFile(this.cachePath,'utf8')); } catch { /* first run */ }
    const releases = [];
    for (let page = 1; page <= 10; page++) {
      const entries = await this.api(`releases?per_page=100&page=${page}`);
      if (!Array.isArray(entries)) throw Error('Invalid release list');
      releases.push(...entries.filter(r => !r.draft && !r.prerelease));
      if (entries.length < 100) break;
    }
    this.releases = releases; return releases;
  }
  async discover() {
    const releases = await this.list();
    const shell = await this.shell?.discover(releases); if (shell) return shell;
    for (const release of releases.filter(r => /^content-\d+$/.test(r.tag_name)).sort((a,b) => Number(b.tag_name.slice(8)) - Number(a.tag_name.slice(8)))) {
      const sequence = Number(release.tag_name.slice(8));
      if (sequence <= Math.max(this.store.state.highWater, this.store.manifest.sequence, this.store.ready?.sequence ?? 0)) continue;
      if (!release.assets?.some(a => a.name === 'manifest.json')) continue;
      const envelope = JSON.parse((await this.download('manifest.json',512000,{sequence,sha256:'0'.repeat(64)})).toString());
      let manifest;
      try { manifest = validateManifest(envelope,this.publicKey,this.store.shellVersion); }
      catch (error) { if (error.code === 'INCOMPATIBLE') continue; throw error; }
      if (manifest.game !== 'bricks-war' || manifest.channel !== 'stable' || manifest.component !== 'content' || manifest.sequence !== sequence
        || compareVersions(manifest.gameVersion,this.store.manifest.gameVersion) <= 0) continue;
      if (!manifest.files.every(f => release.assets.some(a => a.name === f.sha256 && a.size === f.size && a.digest === `sha256:${f.sha256}`))) continue;
      return { component: 'content', manifest, envelope, releaseId: release.id, tag: release.tag_name };
    }
    return null;
  }
  async history() {
    const releases = this.releases ?? await this.list();
    const content = releases.filter(r => /^content-\d+$/.test(r.tag_name));
    const installedTag = `content-${this.store.manifest.sequence}`;
    const selected = content.slice(0,5);
    let installed = content.find(r => r.tag_name === installedTag);
    if (!installed) { try { installed = await this.api(`releases/tags/${installedTag}`); } catch { /* installed build may not have a public release */ } }
    if (installed && !selected.some(r => r.tag_name === installedTag)) selected.push(installed);
    const shellReleases = releases.filter(r => /^v\d+\.\d+\.\d+$/.test(r.tag_name));
    const currentShell = `v${this.shell?.version}`;
    const shellRows = shellReleases.slice(0,5);
    let installedShell = shellReleases.find(r => r.tag_name === currentShell);
    if (!installedShell && this.shell) { try { installedShell = await this.api(`releases/tags/${currentShell}`); } catch { /* unavailable legacy release */ } }
    if (installedShell && !shellRows.some(r=>r.tag_name===currentShell)) shellRows.push(installedShell);
    const rows = selected.map(r => ({ tag:r.tag_name, version:r.name?.replace(/^Game content /,'') || r.tag_name, date:r.published_at, ...localizedNotes(r.body), installed:r.tag_name === installedTag }));
    if (!installed) rows.push({ tag:installedTag, version:this.store.manifest.gameVersion, date:null, text:'Описание установленной версии недоступно в GitHub Releases.', fallback:true, installed:true });
    rows.push(...shellRows.map(r=>({tag:r.tag_name,version:`Оболочка ${r.tag_name.slice(1)}`,date:r.published_at,...localizedNotes(r.body),installed:r.tag_name===currentShell})));
    return rows;
  }
}
