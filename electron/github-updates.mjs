import { readFile, writeFile } from 'node:fs/promises';
import { validateManifest } from './content.mjs';
import { CONTENT_REPOSITORY, githubContentDownload } from './update-source.mjs';
import { abortable } from './abortable.mjs';

import { compareVersions, supportsContent } from './compatibility.mjs';
export { compareVersions } from './compatibility.mjs';
const noteMarkers = { ru:'Русский', en:'English', fr:'Français', de:'Deutsch', es:'Español', ja:'日本語', 'zh-Hans':'简体中文' };
export function localizedNotes(body, language = 'ru') {
  const marker = noteMarkers[language] ?? noteMarkers.en;
  const sections = new Map();
  // Only locale headings end a translated section; nested content headings stay intact.
  const headings = [...(body ?? '').matchAll(/^## (Русский|English|Français|Deutsch|Español|日本語|简体中文)\s*$/gm)];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    sections.set(heading[1], body.slice(heading.index + heading[0].length, headings[i+1]?.index).trim());
  }
  const selected = sections.get(marker);
  if (selected) return { text: selected, fallback: false };
  const text = sections.get('English') || body?.trim();
  return { text: text || '', fallback: true, ...(!text ? {notesUnavailable:'release'} : {}) };
}

export class GithubUpdates {
  constructor({ gate, fetcher = fetch, store, publicKey, cachePath, shell }) {
    Object.assign(this, { gate, fetcher, store, publicKey, cachePath, shell }); this.cache = {}; this.releases = null;
    const raw = githubContentDownload(fetcher);
    this.download = (path, limit, file) => gate.run(signal => raw(path, limit, { ...file,
      signal: file?.signal ? AbortSignal.any([signal,file.signal]) : signal }), file?.signal);
  }
  async api(path, options = {}) {
    const { signal: cancellation, assertActive = () => cancellation?.throwIfAborted() } = options;
    assertActive();
    return this.gate.run(async activitySignal => {
      const signal = AbortSignal.any([activitySignal, AbortSignal.timeout(30000), ...(cancellation ? [cancellation] : [])]);
      assertActive();
      const cached = this.cache[path];
      const response = await abortable(() => this.fetcher(`https://api.github.com/repos/${CONTENT_REPOSITORY}/${path}`, {
        signal, redirect: 'error',
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
      }), signal);
      assertActive();
      if (response.status === 304 && cached) return cached.value;
      if (!response.ok) { await abortable(() => response.body?.cancel(), signal); throw Error('GitHub unavailable or rate limited'); }
      const reader = response.body.getReader(); let size = 0; const chunks = [];
      try { for (;;) { const {value,done} = await abortable(() => reader.read(), signal); assertActive(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) throw Error('Oversized GitHub response'); chunks.push(Buffer.from(value)); } }
      finally {
        const cancelled = reader.cancel(); cancelled.catch(() => {});
        if (!signal.aborted) await abortable(() => cancelled, signal);
      }
      const value = JSON.parse(Buffer.concat(chunks)); assertActive(); this.cache[path] = { etag: response.headers.get('etag'), value };
      await abortable(() => writeFile(this.cachePath, JSON.stringify(this.cache)), signal); assertActive(); return value;
    }, cancellation);
  }
  async list(options = {}) {
    const active = () => { options.signal?.throwIfAborted(); options.assertActive?.(); };
    active();
    try { this.cache = JSON.parse(await readFile(this.cachePath,'utf8')); } catch { /* first run */ }
    active();
    const releases = [];
    for (let page = 1; page <= 10; page++) {
      active();
      const entries = await this.api(`releases?per_page=100&page=${page}`, options);
      active();
      if (!Array.isArray(entries)) throw Error('Invalid release list');
      releases.push(...entries.filter(r => !r.draft && !r.prerelease));
      if (entries.length < 100) break;
    }
    this.releases = releases; return releases;
  }
  async discover(options = {}) {
    const active = () => { options.signal?.throwIfAborted(); options.assertActive?.(); };
    active();
    const releases = await this.list(options);
    active();
    for (const release of releases.filter(r => /^content-\d+$/.test(r.tag_name)).sort((a,b) => Number(b.tag_name.slice(8)) - Number(a.tag_name.slice(8)))) {
      const sequence = Number(release.tag_name.slice(8));
      const pending = this.store.state.pending === `release-${sequence}` || this.store.state.cancelledSequence === sequence;
      if (sequence <= this.store.manifest.sequence || sequence < this.store.state.highWater
        || (!pending && sequence <= Math.max(this.store.state.highWater, this.store.ready?.sequence ?? 0))) continue;
      if (!release.assets?.some(a => a.name === 'manifest.json')) continue;
      active();
      const bytes = await this.download('manifest.json',512000,{sequence,sha256:'0'.repeat(64), signal:options.signal});
      active();
      const envelope = JSON.parse(bytes.toString());
      let manifest, requiresShell = false;
      try { manifest = validateManifest(envelope,this.publicKey,this.store.shellVersion,this.store.shellRelease); }
      catch (error) { if (error.code !== 'INCOMPATIBLE') throw error; manifest = error.manifest; requiresShell = true; }
      if (manifest.game !== 'bricks-war' || manifest.channel !== 'stable' || manifest.component !== 'content' || manifest.sequence !== sequence
        || compareVersions(manifest.gameVersion,this.store.manifest.gameVersion) <= 0) continue;
      if (!manifest.files.every(f => release.assets.some(a => a.name === f.sha256 && a.size === f.size && a.digest === `sha256:${f.sha256}`))) continue;
      active();
      const content = { component:'content', manifest, envelope, releaseId:release.id, tag:release.tag_name, publishedAt:release.published_at };
      if (!requiresShell) return content;
      const shell = await this.shell?.discover(releases, options);
      active();
      if (!shell?.compatibility || !supportsContent(manifest,shell.compatibility.abi,shell.compatibility.version)) {
        // Do not hide an authenticated newer game behind an older compatible release.
        return { ...content, component:'shell-required', requiresShell:true };
      }
      // A full installer already contains the same or a newer game: do not stage an older overlay.
      if (compareVersions(shell.manifest.gameVersion,manifest.gameVersion) >= 0) return shell;
      if (shell.compatibility.bundledSequence >= manifest.sequence) return { ...content,component:'shell-required',requiresShell:true };
      let cancelled = false;
      return { ...content, component:'shell', requiresShell:true,
        prepare:async (progress,phase) => {
          cancelled = false;
          const plan = await shell.prepare(value=>progress(value*0.8),phase,{deferReady:true});
          if (cancelled) throw new DOMException('Cancelled','AbortError');
          phase('downloading');
          await this.store.prepare(envelope,value=>progress(80+value*0.2),shell.compatibility);
          if (cancelled) throw new DOMException('Cancelled','AbortError');
          // No shell activation receipt exists until the whole application is ready.
          await shell.commit(plan);
        },
        cancel:()=>{cancelled=true;shell.cancel();this.store.cancel();},
        discard:async()=>{await shell.discard();await this.store.discardPrepared(manifest.sequence);},
      };
    }
    const shell = await this.shell?.discover(releases, options);
    active();
    if (!shell) return null;
    if (!supportsContent(this.store.manifest,shell.compatibility?.abi ?? 2,shell.compatibility?.version)) return null;
    if (compareVersions(shell.manifest.gameVersion,this.store.manifest.gameVersion) < 0) {
      if (shell.compatibility?.bundledSequence >= this.store.manifest.sequence) return null;
      return {...shell,manifest:{...shell.manifest,gameVersion:this.store.manifest.gameVersion}};
    }
    return shell;
  }
  async history(language = 'ru') {
    const releases = this.releases ?? await this.list();
    const content = releases.filter(r => /^content-\d+$/.test(r.tag_name));
    const installedTag = `content-${this.store.manifest.sequence}`;
    const selected = [...content];
    let installed = content.find(r => r.tag_name === installedTag);
    if (!installed) { try { installed = await this.api(`releases/tags/${installedTag}`); } catch { /* installed build may not have a public release */ } }
    if (installed && !selected.some(r => r.tag_name === installedTag)) selected.push(installed);
    const rows = selected.map(r => ({ tag:r.tag_name, version:r.name?.replace(/^Game content /,'') || r.tag_name, date:r.published_at, ...localizedNotes(r.body, language), installed:r.tag_name === installedTag }));
    if (!installed) rows.push({ tag:installedTag, version:this.store.manifest.gameVersion, date:null, text:'', notesUnavailable:'installed', fallback:true, installed:true });
    const versions = new Map();
    for (const row of rows) if (!versions.has(row.version) || row.installed) versions.set(row.version,row);
    return [...versions.values()];
  }
}
