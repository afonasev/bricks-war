import { ShellUpdate } from './shell-update.mjs';
import { compareVersions } from './compatibility.mjs';
import { createHash, verify, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, rename, statfs } from 'node:fs/promises';
import { join, isAbsolute, dirname } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
const exec = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = value => value && digest(value.digest) && Number.isSafeInteger(value.sequence) && value.sequence > 0
  && typeof value.version === 'string' && /^\d+\.\d+\.\d+$/.test(value.version);

/** Opt-in only after native root supplies both immediate component identities. */
export function nativeContext(environment, version, profile, healthNonce=environment.BRICKS_BOOTSTRAP_NONCE) {
  if (environment.BRICKS_BOOTSTRAP_INSTALLED !== '1') return null;
  const executable = environment.BRICKS_BOOTSTRAP_EXECUTABLE;
  const healthRoot=environment.BRICKS_BOOTSTRAP_HEALTH_ROOT;
  const launcher = JSON.parse(environment.BRICKS_BOOTSTRAP_LAUNCHER_ID || 'null');
  const client = JSON.parse(environment.BRICKS_BOOTSTRAP_CLIENT_ID || 'null');
  if (!healthRoot || !isAbsolute(healthRoot) || !executable || !isAbsolute(executable) || !identity(launcher) || !identity(client) || client.version !== version || !isAbsolute(profile)) throw Error('Invalid installed native context');
  const rootPid = Number(environment.BRICKS_BOOTSTRAP_ROOT_PID);
  if (!Number.isSafeInteger(rootPid) || rootPid < 1) throw Error('Missing original native root process');
  return Object.freeze({ healthNonce, executable, launcher: Object.freeze(launcher), client: Object.freeze(client), profile, rootPid, updateRoot:join(healthRoot,'updates') });
}

export function validateNativeRelease(envelope, key, platform, arch, current, systemVersion=process.getSystemVersion?.() ?? os.release()) {
  if (typeof envelope?.payload !== 'string' || envelope.payload.length > 512000 || typeof envelope.signature !== 'string'
    || !verify(null, Buffer.from(envelope.payload), key, Buffer.from(envelope.signature, 'base64'))) throw Error('Invalid native release signature');
  const manifest = JSON.parse(envelope.payload);
  const incompatible = message => Object.assign(Error(message), { code: 'INCOMPATIBLE' });
  if (manifest.schema !== 1 || manifest.game !== 'bricks-war' || manifest.component !== 'native-release' || manifest.channel !== 'stable'
    || manifest.rootAbi !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.version ?? '') || !Array.isArray(manifest.files)
    || !Number.isSafeInteger(manifest.contentAbi) || manifest.contentAbi < 3 || !Number.isSafeInteger(manifest.contentSequence) || manifest.contentSequence < 1) throw incompatible('Incompatible native release');
  const file = manifest.files.find(file => file.platform === platform && (file.arch === arch || (platform === 'darwin' && file.arch === 'universal')));
  if (!file || !/^\d+\.\d+\.\d+$/.test(file.minimumOS ?? '') || compareVersions(systemVersion.split('.').concat(['0','0']).slice(0,3).join('.'),file.minimumOS)<0 || !/^[a-zA-Z0-9_.-]+\.zip$/.test(file.name) || !digest(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 1024 ** 3
    || !Number.isSafeInteger(file.unpackedSize) || file.unpackedSize < 1 || file.unpackedSize > 8 * 1024 ** 3 || !Array.isArray(file.targets)
    || file.targets.length !== 2 || !['launcher', 'client'].every(component => file.targets.filter(target => target.component === component && identity(target)).length === 1)) throw incompatible('No compatible native package');
  const changed = file.targets.filter(target => target.sequence > current[target.component].sequence);
  for (const target of file.targets) {
    const installed = current[target.component];
    if (target.sequence < installed.sequence || (target.sequence === installed.sequence && target.digest !== installed.digest)) throw incompatible('Native package contains a downgraded or aliased component');
  }
  return { ...manifest, file, changed };
}

async function extract(platform, archive, destination, signal) {
  if (platform === 'darwin') await exec('/usr/bin/ditto', ['-x', '-k', archive, destination], { signal });
  else await exec('tar.exe', ['-xf', archive, '-C', destination], { signal, windowsHide: true });
}
export class NativeUpdate extends ShellUpdate {
  constructor(options) {
    super(options);
    this.context = options.context; this.legacyPending=options.legacyPending; this.legacyHealth = options.legacyHealth ?? (async () => {});
    this.extract = options.extract ?? extract;
    this.verifyTree = options.verifyTree ?? (async (component, path) => JSON.parse((await exec(this.context.executable, ['verify-tree', component, path], { windowsHide: true, maxBuffer: 65536 })).stdout));
    this.status = options.status ?? (async () => JSON.parse((await exec(this.context.executable, ['native-status'], { windowsHide: true, maxBuffer: 65536 })).stdout));
  }
  legacyCandidate(){return {component:'shell-required',requiresShell:true,manifest:{gameVersion:this.legacyPending.version},tag:`v${this.legacyPending.version}`};}
  async discover(releases, options = {}) {
    const active = () => { options.signal?.throwIfAborted(); options.assertActive?.(); }; active();
    for (const release of releases.filter(release => /^v\d+\.\d+\.\d+$/.test(release.tag_name) && release.assets?.some(asset => asset.name === 'native-manifest.json'))
      .sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))) {
      const envelope = JSON.parse(await this.bytes(release.tag_name, 'native-manifest.json', 512000, options.signal)); active();
      let manifest;
      try { manifest = validateNativeRelease(envelope, this.publicKey, this.platform, this.arch, this.context); }
      catch (error) { if (error.code === 'INCOMPATIBLE') continue; throw error; }
      if (manifest.version !== release.tag_name.slice(1) || !manifest.changed.length || manifest.changed.some(target => this.blocked?.has(target.digest))
        || !release.assets.some(asset => asset.name === manifest.file.name && asset.size === manifest.file.size && asset.digest === `sha256:${manifest.file.sha256}`)) continue;
      active(); this.selected = { release, manifest, envelope };
      const client = manifest.file.targets.find(target => target.component === 'client');
      return { component: 'shell', tag: release.tag_name, requiresShell: true, manifest: { gameVersion: client.version },
        compatibility: { abi: manifest.contentAbi, version: client.version, bundledSequence: manifest.contentSequence },
        prepare: (progress, phase, options) => this.prepare(progress, phase, options), commit: plan => this.commitPrepared(plan),
        cancel: () => this.controller?.abort(), discard: () => this.discard() };
    }
    return null;
  }
  async prepare(progress, phase = () => {}, { deferReady = false } = {}) {
    this.controller = new AbortController(); const signal = this.controller.signal;
    const { manifest, release, envelope } = this.selected;
    await mkdir(this.root, { recursive: true });
    const space = await statfs(this.root);
    if (space.bavail * space.bsize < manifest.file.unpackedSize * 2 + manifest.file.size + 64 * 1024 ** 2) throw Error('Not enough space for native update');
    this.progress = progress;
    const bytes = await this.bytes(release.tag_name, manifest.file.name, manifest.file.size, signal, {payload:true});
    phase('verifying');
    if (bytes.length !== manifest.file.size || hash(bytes) !== manifest.file.sha256) throw Error('Native package hash mismatch');
    signal.throwIfAborted();
    const stage = join(this.root, `prepared-${randomBytes(16).toString('hex')}`); await mkdir(stage); this.staging=stage;
    try {
    const archive = join(stage, 'package.zip'); await writeFile(archive, bytes); const payload = join(stage, 'payload'); await mkdir(payload);
    await this.extract(this.platform, archive, payload, signal); signal.throwIfAborted();
    const sources = []; let unpacked = 0;
    for (const target of manifest.file.targets) {
      const path = join(payload, target.component); const verified = await this.verifyTree(target.component, path); signal.throwIfAborted();
      if (!identity(verified.identity) || verified.identity.digest !== target.digest || verified.identity.sequence !== target.sequence || verified.identity.version !== target.version
        || !Number.isSafeInteger(verified.unpackedSize) || verified.unpackedSize < 0) throw Error('Native tree identity mismatch');
      unpacked += verified.unpackedSize;
      if (manifest.changed.some(changed => changed.component === target.component)) sources.push({ component: target.component, path, digest: target.digest });
    }
    if (unpacked > manifest.file.unpackedSize) throw Error('Native unpacked size mismatch');
    const plan = { schema: 1, sources, profile: this.context.profile, parent_pid: process.pid, root_pid: this.context.rootPid,
      args: this.args, relaunch: false };
    await writeFile(join(stage, 'native-manifest.json'), JSON.stringify(envelope));
    this.prepared = { stage, plan };
    if (!deferReady) await this.commitPrepared(plan);
    return plan;
    } catch(error) {if (!this.workerActive) await rm(stage,{recursive:true,force:true});this.staging=null;throw error;}
  }
  async commitPrepared(plan) {
    this.controller?.signal.throwIfAborted();
    if (plan !== this.prepared?.plan) throw Error('Native consent target changed');
    const temp = join(this.root, `ready-${randomBytes(12).toString('hex')}.tmp`);
    await writeFile(temp, JSON.stringify(plan), { flag: 'wx', mode: 0o600 }); await rename(temp, join(this.root, 'ready.json')); this.ready = plan;
  }
  async discard() {
    const plan = this.ready; this.ready = null;
    if (plan) {
      try { if (JSON.stringify(JSON.parse(await readFile(join(this.root, 'ready.json'), 'utf8'))) === JSON.stringify(plan)) await rm(join(this.root, 'ready.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!this.workerActive && this.staging) {await rm(this.staging,{recursive:true,force:true});this.staging=null;}
    // A spawned worker retains its source bytes until it has completed; an
    // activation failure never deletes data an independent worker could use.
  }
  async open() {
    await mkdir(this.root, { recursive: true });
    const status = await this.status(); this.blocked = new Set(status.failed ?? []); this.recoveryNonce=status.nonce;
    let acknowledged;try{acknowledged=JSON.parse(await readFile(join(this.root,'recovery-ack.json'),'utf8'));}catch{/* first recovery */}
    // The candidate must reach game health before this very transaction can
    // commit. Its own pending decision is not a previous failed startup.
    const ownPending = status.phase === 'pending' && digest(status.nonce)
      && this.context.healthNonce === hash(`${status.nonce}:client`);
    this.recoveryRequired = !ownPending && status.recoveryRequired === true && (!digest(status.nonce)||acknowledged?.nonce!==status.nonce);
    if(this.legacyPending){this.legacyBinding=hash(JSON.stringify({version:this.legacyPending.version,file:this.legacyPending.file}));try{const ack=JSON.parse(await readFile(join(this.root,'legacy-ack.json'),'utf8'));if(ack.binding===this.legacyBinding)this.legacyPending=null;}catch{/* unreviewed legacy package */}}
    this.ready = null;
    try {
      const plan = JSON.parse(await readFile(join(this.root, 'ready.json'), 'utf8'));
      if (plan.schema !== 1 || !Array.isArray(plan.sources) || !plan.sources.length || plan.sources.length > 2 || plan.profile !== this.context.profile) throw Error('Invalid native ready plan');
      const components=new Set(plan.sources.map(source=>source.component));if(components.size!==plan.sources.length)throw Error('Duplicate native ready component');
      const stage=dirname(dirname(plan.sources[0].path));
      if (dirname(stage)!==this.root || !/^prepared-[a-f0-9]{32}$/.test(stage.split(/[\\/]/).pop())) throw Error('Native ready tree is outside its owned preparation');
      const envelope=JSON.parse(await readFile(join(stage,'native-manifest.json'),'utf8'));
      const manifest=validateNativeRelease(envelope,this.publicKey,this.platform,this.arch,this.context);
      if(manifest.changed.length!==plan.sources.length)throw Error('Native consent component set changed');
      for (const source of plan.sources) {
        if (!['launcher', 'client'].includes(source.component) || !digest(source.digest) || !isAbsolute(source.path) || this.blocked.has(source.digest)) throw Error('Invalid native ready source');
        const target=manifest.changed.find(target=>target.component===source.component);
        if(!target || target.digest!==source.digest || source.path!==join(stage,'payload',source.component))throw Error('Native consent identity changed');
        const result = await this.verifyTree(source.component, source.path);
        if (result.identity.digest !== source.digest || result.identity.sequence <= this.context[source.component].sequence) throw Error('Stale native ready source');
      }
      // Caller PID/flags always come from this original-user process, never a
      // stale persisted executable path or another user's session.
      this.ready = { ...plan, parent_pid: process.pid, root_pid: this.context.rootPid, args: this.args };
      await writeFile(join(this.root, 'ready.json'), JSON.stringify(this.ready));
    } catch { this.ready = null; }
    return this;
  }
  async acknowledgeLegacyPending(){if(this.legacyPending){await writeFile(join(this.root,'legacy-ack.json'),JSON.stringify({binding:this.legacyBinding}),{mode:0o600});this.legacyPending=null;}}
  async acknowledgeRecovery(){if(this.recoveryNonce)await writeFile(join(this.root,'recovery-ack.json'),JSON.stringify({nonce:this.recoveryNonce}),{mode:0o600});this.recoveryRequired=false;}
  async healthy() { await this.legacyHealth(); }
  async startWorker(plan) {
    await mkdir(this.root, { recursive: true });
    const path = join(this.root, 'apply.json'); const nonce=randomBytes(32).toString('hex');this.workerNonce=nonce; await writeFile(path, JSON.stringify({...plan,request_nonce:nonce}), { mode: 0o600 });
    await rm(join(this.root, 'helper-started'), { force: true });
    await rm(join(this.root,'worker.json'),{force:true});
    const environment = { ...process.env };
    for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'BRICKS_BOOTSTRAP_NONCE', 'BRICKS_BOOTSTRAP_DIGEST', 'BRICKS_BOOTSTRAP_RECEIPT']) delete environment[key];
    const worker = spawn(this.context.executable, ['native-worker', path], { detached: true, stdio: 'ignore', windowsHide: true, env: environment });
    worker.on('error', () => {}); worker.unref(); this.helperPid = worker.pid;this.workerActive=Boolean(worker.pid);
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if ((await readFile(join(this.root, 'helper-started'), 'utf8')).trim() === String(process.pid)) {const receipt=JSON.parse(await readFile(join(this.root,'worker.json'),'utf8'));if(receipt.parent_pid===process.pid&&receipt.request_nonce===nonce&&Number.isSafeInteger(receipt.worker_pid)&&receipt.worker_pid>0){this.helperPid=receipt.worker_pid;return true;}} } catch { /* handshake not ready */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await writeFile(join(this.root,`cancelled-${nonce}`),'cancelled',{mode:0o600});
    this.ready=null;await rm(join(this.root,'ready.json'),{force:true});
    throw Error('Independent native worker failed to acknowledge');
  }
  async launchHelper() { await this.open(); if (!this.ready) throw Error('Prepared native target is no longer valid'); return this.startWorker(this.ready); }
  async relaunch() { return this.startWorker({ schema: 1, sources: [], profile: this.context.profile, parent_pid: process.pid, root_pid: this.context.rootPid, args: this.args, relaunch: true }); }
}
