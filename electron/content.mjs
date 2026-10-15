import { createHash, verify } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, lstat, readdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_FILE = 32 * 1024 * 1024;
export const MAX_RELEASE = 128 * 1024 * 1024;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const safePath = path => typeof path === 'string' && /^[a-zA-Z0-9_./-]+$/.test(path)
  && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..');

export function validateManifest(envelope, publicKey, shellVersion) {
  if (!envelope || typeof envelope.payload !== 'string' || envelope.payload.length > 512_000
    || typeof envelope.signature !== 'string' || !verify(null, Buffer.from(envelope.payload), publicKey, Buffer.from(envelope.signature, 'base64'))) throw Error('Invalid content signature');
  const m = JSON.parse(envelope.payload);
  if (m.schema !== 1 || !Number.isSafeInteger(m.sequence) || m.sequence < 1 || typeof m.gameVersion !== 'string'
    || !Number.isSafeInteger(m.minShellVersion)
    || !Array.isArray(m.files) || m.files.length < 1 || m.files.length > 1000) throw Error('Incompatible content manifest');
  if (m.schema === 1 && m.game !== undefined && (m.game !== 'bricks-war' || m.component !== 'content' || m.channel !== 'stable')) throw Error('Wrong game or channel');
  if (m.minShellVersion > shellVersion) throw Object.assign(Error('Content requires a newer shell'), {code:'INCOMPATIBLE'});
  const paths = new Set(); let size = 0;
  for (const f of m.files) {
    if (!safePath(f.path) || paths.has(f.path) || !/^[a-f0-9]{64}$/.test(f.sha256)
      || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > MAX_FILE) throw Error('Invalid file inventory');
    paths.add(f.path); size += f.size;
  }
  if (!paths.has('index.html') || size > MAX_RELEASE) throw Error('Invalid release size');
  return m;
}

async function atomicJson(path, data) {
  await writeFile(`${path}.tmp`, JSON.stringify(data)); await rename(`${path}.tmp`, path);
}

export class ContentStore {
  constructor({ root, bundled, publicKey, shellVersion, download, onProgress = () => {} }) {
    Object.assign(this, { root, bundled, publicKey, shellVersion, download, onProgress });
    this.state = { highWater: 0, current: null, previous: null, pending: null, trial: false };
    this.active = bundled; this.ready = null;
  }
  async inventory(dir) {
    const m = validateManifest(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')), this.publicKey, this.shellVersion);
    for (const f of m.files) {
      const path = join(dir, f.path);
      // Downloaded files are created by us; reject symlinks before serving after restart.
      if (!(await lstat(path)).isFile() || digest(await readFile(path)) !== f.sha256) throw Error('Corrupt release');
    }
    return m;
  }
  async open() {
    await mkdir(this.root, { recursive: true });
    this.bundledManifest = await this.inventory(this.bundled);
    try { this.state = JSON.parse(await readFile(join(this.root, 'state.json'), 'utf8')); } catch { /* Initial state. */ }
    if (!Number.isSafeInteger(this.state.highWater) || this.state.highWater < 0) throw Error('Invalid content state');
    for (const k of ['current', 'previous', 'pending']) if (this.state[k] != null && !/^release-\d+$/.test(this.state[k])) throw Error('Invalid content state path');
    if (this.state.trial) { this.state.current = this.state.previous; this.state.trial = false; this.state.pending = null; }
    if (this.state.current) {
      try {
        const current = await this.inventory(join(this.root, this.state.current));
        if (current.sequence > this.bundledManifest.sequence) this.active = join(this.root, this.state.current);
        else { this.state.previous = this.state.current; this.state.current = null; }
      }
      catch { this.state.current = null; }
    }
    this.manifest = await this.inventory(this.active);
    if (this.state.pending) {
      try {
        const pending = await this.inventory(join(this.root, this.state.pending));
        if (pending.sequence > this.manifest.sequence) this.ready = pending;
        else this.state.pending = null;
      }
      catch { this.state.pending = null; }
    }
    await this.save();
    return this;
  }
  save() { return atomicJson(join(this.root, 'state.json'), this.state); }
  enqueue(operation) {
    this.operations = (this.operations ?? Promise.resolve()).catch(() => {}).then(operation);
    return this.operations;
  }
  async check() {
    if (this.checking) return this.checking;
    this.checking = this.enqueue(() => this.stage()).finally(() => { this.checking = null; });
    return this.checking;
  }
  cancel() { this.downloadController?.abort(); }
  async discardPrepared(sequence) {
    if (this.ready?.sequence !== sequence) return;
    const pending = this.state.pending; this.ready = null; this.state.pending = null; await this.save();
    if (pending && pending !== this.state.current && pending !== this.state.previous) await rm(join(this.root,pending),{recursive:true,force:true});
  }
  prepare(envelope, onBytes = () => {}) {
    if (this.preparing) return this.preparing;
    this.downloadController = new AbortController();
    this.preparing = this.enqueue(() => this.stage(envelope, onBytes, this.downloadController.signal)).finally(() => { this.preparing = null; });
    return this.preparing;
  }
  async stage(selectedEnvelope, onBytes = () => {}, signal) {
    this.onProgress('checking');
    const envelope = selectedEnvelope ?? JSON.parse((await this.download('latest.json', 512_000)).toString());
    const m = validateManifest(envelope, this.publicKey, this.shellVersion);
    if (selectedEnvelope) { if (m.sequence <= this.manifest.sequence || m.sequence < this.state.highWater) return false; if ((this.ready?.sequence ?? 0) >= m.sequence) return true; }
    else if (m.sequence <= Math.max(this.state.highWater, this.manifest.sequence, this.ready?.sequence ?? 0)) return false;
    const name = `release-${m.sequence}`, stage = join(this.root, `${name}.staging`);
    await mkdir(stage, { recursive: true });
    const space = await statfs(this.root); const required = m.files.reduce((total,f) => total + f.size,0);
    if (space.bavail * space.bsize < required + 1024 * 1024) throw Error('Not enough space');
    let completed = 0;
    try {
      this.onProgress('downloading');
      for (const f of m.files) {
        signal?.throwIfAborted();
        const existing = join(stage, f.path);
        try { const bytes = await readFile(existing); if (bytes.length === f.size && digest(bytes) === f.sha256) { completed += f.size; onBytes(required ? completed / required * 100 : 100); continue; } } catch { /* incomplete file */ }
        const bytes = await this.download(`${m.sequence}/${f.path}`, f.size, { sequence: m.sequence, sha256: f.sha256, ...(signal ? {signal} : {}) });
        signal?.throwIfAborted();
        if (bytes.length !== f.size || digest(bytes) !== f.sha256) throw Error('Content hash mismatch');
        const path = join(stage, f.path); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, bytes);
        completed += f.size; onBytes(required ? completed / required * 100 : 100);
      }
      signal?.throwIfAborted();
      this.onProgress('verifying');
      await writeFile(join(stage, 'manifest.json'), JSON.stringify(envelope));
      // A crash between rename and state commit may leave an unreferenced complete release.
      if (![this.state.current, this.state.previous, this.state.pending].includes(name)) await rm(join(this.root, name), { recursive: true, force: true });
      await rename(stage, join(this.root, name));
      // Persist replay protection before advertising readiness.
      const oldPending = this.state.pending;
      this.state.highWater = m.sequence; this.state.pending = name;
      await this.save(); this.ready = m;
      if (oldPending && oldPending !== name && oldPending !== this.state.current && oldPending !== this.state.previous)
        await rm(join(this.root, oldPending), { recursive: true, force: true });
      return true;
    } catch (error) { if (signal?.aborted) await rm(stage, { recursive: true, force: true }); throw error; }
  }
  activate() { return this.enqueue(() => this.activateReady()); }
  async activateReady() {
    if (!this.ready || !this.state.pending) return false;
    await this.inventory(join(this.root, this.state.pending));
    this.state.previous = this.state.current; this.state.current = this.state.pending;
    this.state.pending = null; this.state.trial = true; await this.save();
    this.active = join(this.root, this.state.current); this.manifest = this.ready; this.ready = null;
    return true;
  }
  healthy() { return this.enqueue(() => this.confirmHealthy()); }
  async confirmHealthy() {
    if (this.state.trial) { this.state.trial = false; await this.save(); }
    const keep = new Set([this.state.current, this.state.previous, this.state.pending]);
    for (const name of await readdir(this.root)) if (/^release-\d+$/.test(name) && !keep.has(name))
      await rm(join(this.root, name), { recursive: true, force: true });
  }
}
