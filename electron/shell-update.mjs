import {failedShellVersions,recordShellFailure} from './shell-helper.mjs';
import os from 'node:os';
import { verify, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, statfs } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compareVersions } from './github-updates.mjs';
import { CONTENT_REPOSITORY } from './update-source.mjs';

const exec = promisify(execFile);
export function validateShell(envelope, key, platform, arch, version, systemVersion = process.getSystemVersion?.() ?? os.release()) {
  if (typeof envelope?.payload !== 'string' || envelope.payload.length > 512000 || typeof envelope.signature !== 'string'
    || !verify(null,Buffer.from(envelope.payload),key,Buffer.from(envelope.signature,'base64'))) throw Error('Invalid shell signature');
  const manifest = JSON.parse(envelope.payload);
  if (manifest.contentAbi !== undefined && (!Number.isSafeInteger(manifest.contentAbi) || manifest.contentAbi < 1)) throw Error('Invalid shell content ABI');
  if (manifest.contentAbi >= 3 && (!Number.isSafeInteger(manifest.contentSequence) || manifest.contentSequence < 1)) throw Error('Invalid bundled content identity');
  if (manifest.schema !== 1 || manifest.game !== 'bricks-war' || manifest.component !== 'shell' || manifest.channel !== 'stable'
    || compareVersions(manifest.version,version) <= 0 || manifest.updaterAbi !== 1 || !Array.isArray(manifest.files)) throw Object.assign(Error('Incompatible shell update'),{code:'INCOMPATIBLE'});
  const file = manifest.files.find(f => f.platform === platform && (f.arch === arch || f.arch === 'universal'));
  if (!file || (file.minimumOS && compareVersions(systemVersion.split('.').concat(['0','0']).slice(0,3).join('.'),file.minimumOS) < 0) || !/^[a-zA-Z0-9_.-]+\.(zip|exe)$/.test(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256)
    || !/^\d+\.\d+\.\d+$/.test(file.minimumOS ?? '') || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 1024*1024*1024) throw Object.assign(Error('No compatible shell package'),{code:'INCOMPATIBLE'});
  return { ...manifest, file };
}

/** Prepares packages only; activation runs outside the closing application. */
export class ShellUpdate {
  constructor({ root, gate, fetcher, publicKey, version, platform = process.platform, arch = process.arch, executable = process.execPath, args = process.argv.slice(1), helper }) {
    Object.assign(this, { root, gate, fetcher, publicKey, version, platform, arch, executable, args, helper });
  }
  async bytes(tag, name, limit, signal) {
    const origin = `https://github.com/${CONTENT_REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
    return this.gate.run(async activitySignal => {
      let url = origin;
      const combined = signal ? AbortSignal.any([signal,activitySignal,AbortSignal.timeout(120000)]) : AbortSignal.any([activitySignal,AbortSignal.timeout(30000)]);
      for (let hop = 0; hop <= 5; hop++) {
        const response = await this.fetcher(url,{signal:combined,redirect:'manual'});
        if ([301,302,303,307,308].includes(response.status)) {
          const location = response.headers.get('location'); await response.body?.cancel();
          const next = new URL(location ?? '',url);
          if (!location || hop === 5 || next.protocol !== 'https:' || next.username || next.password || next.port
            || !['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(next.hostname)) throw Error('Untrusted shell redirect');
          url = next.href; continue;
        }
        if (!response.ok || !response.body) { await response.body?.cancel(); throw Error('Shell package unavailable'); }
        if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body.cancel(); throw Error('Oversized shell package'); }
        const chunks = []; let size = 0; const reader = response.body.getReader();
        try { for (;;) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > limit) throw Error('Oversized shell package'); chunks.push(Buffer.from(value)); this.progress?.(limit ? size/limit*100 : 0); } }
        finally { await reader.cancel(); }
        return Buffer.concat(chunks);
      }
      throw Error('Shell download redirect limit');
    },signal);
  }
  async discover(releases) {
    if (!['darwin','win32'].includes(this.platform)) return null;
    const blocked=await failedShellVersions(this.root);
    const candidates = releases.filter(r => /^v\d+\.\d+\.\d+$/.test(r.tag_name) && r.assets?.some(a => a.name === 'shell-manifest.json'));
    candidates.sort((a,b) => compareVersions(b.tag_name.slice(1),a.tag_name.slice(1)));
    for (const release of candidates) {
      if (compareVersions(release.tag_name.slice(1),this.version) <= 0 || blocked.includes(release.tag_name.slice(1))) continue;
      const envelope = JSON.parse(await this.bytes(release.tag_name,'shell-manifest.json',512000));
      let manifest;try{manifest=validateShell(envelope,this.publicKey,this.platform,this.arch,this.version);}catch(error){if(error.code==='INCOMPATIBLE')continue;throw error;}
      if (manifest.version !== release.tag_name.slice(1) || !release.assets.some(a => a.name === manifest.file.name && a.size === manifest.file.size && a.digest === `sha256:${manifest.file.sha256}`)) continue;
      this.selected = { release,manifest,envelope };
      return { component:'shell',requiresShell:true,manifest:{gameVersion:manifest.version}, compatibility:{abi:manifest.contentAbi ?? 2,version:manifest.version,bundledSequence:manifest.contentSequence},
        prepare: (progress,phase,options) => this.prepare(progress,phase,options), commit:plan=>this.commitPrepared(plan),
        cancel:() => this.controller?.abort(),discard:async()=>{ this.ready=null; await rm(join(this.root,'ready.json'),{force:true}); } };
    }
    return null;
  }
  async prepare(progress,phase=()=>{}, {deferReady=false}={}) {
    this.controller = new AbortController();
    const {release,manifest,envelope} = this.selected;
    await mkdir(this.root,{recursive:true});
    const space = await statfs(this.root); if (space.bavail * space.bsize < manifest.file.size * 4) throw Error('Not enough space');
    this.controller.signal.throwIfAborted(); this.progress = progress;
    const bytes = await this.bytes(release.tag_name,manifest.file.name,manifest.file.size,this.controller.signal);
    phase('verifying');
    if (bytes.length !== manifest.file.size || createHash('sha256').update(bytes).digest('hex') !== manifest.file.sha256) throw Error('Shell hash mismatch');
    this.controller.signal.throwIfAborted();
    const file = join(this.root,manifest.file.name); await writeFile(file,bytes);
    await writeFile(join(this.root,'shell-manifest.json'),JSON.stringify(envelope));
    this.controller.signal.throwIfAborted();
    if (this.platform === 'darwin') {
      const stage = join(this.root,'staged'); await rm(stage,{recursive:true,force:true}); await mkdir(stage);
      await exec('/usr/bin/ditto',['-x','-k',file,stage],{signal:this.controller.signal});
      const application = join(stage,'Bricks War.app');
      const identifier = (await exec('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',join(application,'Contents/Info.plist')])).stdout.trim();
      const version = (await exec('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',join(application,'Contents/Info.plist')])).stdout.trim();
      if (identifier !== 'tech.afonasev.brickswar' || version !== manifest.version) throw Error('Wrong application bundle');
      this.application = application;
    }
    this.controller.signal.throwIfAborted();
    const plan = {version:manifest.version,file,application:this.application,platform:this.platform,executable:this.executable,args:this.args,parentPid:process.pid,root:this.root};
    if (!deferReady) await this.commitPrepared(plan);
    return plan;
  }
  async commitPrepared(plan) {
    this.controller.signal.throwIfAborted();
    await writeFile(join(this.root,'ready.json'),JSON.stringify(plan)); this.ready = plan;
  }
  async open() {
    await mkdir(this.root,{recursive:true});
    this.recoveryRequired = (await failedShellVersions(this.root)).some(version=>compareVersions(version,this.version)>0);
    try {
      const plan = JSON.parse(await readFile(join(this.root,'ready.json'),'utf8'));
      const envelope = JSON.parse(await readFile(join(this.root,'shell-manifest.json'),'utf8'));
      const manifest = validateShell(envelope,this.publicKey,this.platform,this.arch,this.version);
      if((await failedShellVersions(this.root)).includes(manifest.version)){this.ready=null;return this;}
      const file = join(this.root,manifest.file.name); const bytes = await readFile(file);
      if (bytes.length !== manifest.file.size || createHash('sha256').update(bytes).digest('hex') !== manifest.file.sha256) throw Error('Changed prepared shell');
      this.ready = {...plan,file,version:manifest.version,root:this.root,executable:this.executable,args:this.args,parentPid:process.pid};
    } catch { this.ready = null; }
    return this;
  }
  async healthy() { await writeFile(join(this.root,'healthy-version'),this.version); }
  async launchHelper() {
    await this.open();
    if (!this.ready) throw Error('Prepared shell no longer valid');
    if (this.platform === 'darwin') {
      const stage = join(this.root,'activation'); await rm(stage,{recursive:true,force:true}); await mkdir(stage);
      await exec('/usr/bin/ditto',['-x','-k',this.ready.file,stage]);
      this.ready.application = join(stage,'Bricks War.app');
    }
    // The helper is copied out of the app that will be replaced; it survives rename.
    const helperPath = join(this.root,this.platform === 'win32' ? 'shell-helper.ps1' : 'shell-helper.mjs'); await writeFile(helperPath,await readFile(this.platform === 'win32' ? join(dirname(this.helper),'shell-helper.ps1') : this.helper));
    const plan = {...this.ready,parentPid:process.pid,args:this.args,executable:this.executable};
    await writeFile(join(this.root,'apply.json'),JSON.stringify(plan));
    await writeFile(join(this.root,'launch-args.json'),JSON.stringify({version:plan.version,args:this.args}));
    await rm(join(this.root,'helper-started'),{force:true});
    const child = this.platform === 'win32' ? spawn('powershell.exe',['-NoProfile','-File',helperPath,join(this.root,'apply.json')],{detached:true,stdio:'ignore',windowsHide:true}) : spawn(this.executable,[helperPath,join(this.root,'apply.json')],{detached:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}); this.helperPid=child.pid; child.on('error',()=>{}); child.unref();
    for(let attempt=0;attempt<30;attempt++){try{if((await readFile(join(this.root,'helper-started'),'utf8')).trim()===String(process.pid))return true;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
    await recordShellFailure(this.root,plan.version,'helper-start-failed');
    await rm(join(this.root,'ready.json'),{force:true});
    throw Error('Update helper failed to start');
  }
}
