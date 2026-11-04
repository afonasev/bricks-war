import {manifestReleaseDate,normalizeReleaseDate} from './release-date.mjs';
/** One activity gate owns every update/history transfer. Match entry awaits drain. */
export class TransferGate {
  allowed = true;
  active = new Set();
  waiters = [];
  async run(operation, cancellation) {
    for (;;) {
      cancellation?.throwIfAborted();
      if (!this.allowed) await new Promise((resolve,reject) => { const resume = () => { cancellation?.removeEventListener('abort',abort); resolve(); }; const abort = () => { this.waiters = this.waiters.filter(w => w !== resume); reject(cancellation.reason); }; this.waiters.push(resume); cancellation?.addEventListener('abort',abort,{once:true}); });
      if (!this.allowed) continue;
      const controller = new AbortController();
      const attempt = { controller, done: null };
      attempt.done = Promise.resolve().then(() => operation(controller.signal));
      this.active.add(attempt);
      try { return await attempt.done; }
      catch (error) { if (!controller.signal.aborted) throw error; }
      finally { this.active.delete(attempt); }
    }
  }
  async setAllowed(allowed) {
    this.allowed = allowed;
    if (allowed) { for (const resolve of this.waiters.splice(0)) resolve(); return; }
    const active = [...this.active];
    for (const entry of active) entry.controller.abort();
    await Promise.allSettled(active.map(entry => entry.done));
  }
}

export const STARTUP_DISCOVERY_BUDGET_MS = 3_000;

export class UpdateCoordinator {
  constructor({ store, discover, gate, history, readyShell = () => null,
    clock = { now: () => performance.now(), setTimeout, clearTimeout } }) {
    Object.assign(this, { store, discover, gate, history, readyShell, clock });
    this.startupError = Boolean(store.recovered);
    this.phase = (store.ready || readyShell()) ? 'ready' : this.startupError ? 'install-error' : 'idle'; this.progress = 0;
    const previousProgress=store.onProgress; store.onProgress=phase=>{previousProgress?.(phase);if(phase==='verifying'&&this.consented)this.phase='verifying';};
    this.consented = false; this.available = Boolean(store.ready || readyShell()); this.inMenu = true;
  }
  snapshot() {
    return { available: this.available, applying: false, error: this.phase.endsWith('error'), phase: this.phase,
      progress: this.progress, version: this.candidate?.manifest?.gameVersion ?? this.store.ready?.gameVersion ?? this.readyShell()?.version,
      requiresShell: this.candidate?.requiresShell ?? Boolean(this.readyShell()),
      currentVersion: this.store.manifest.gameVersion, currentDate: manifestReleaseDate(this.store.manifest),
      versionDate: manifestReleaseDate(this.candidate?.manifest ?? this.store.ready) ?? normalizeReleaseDate(this.candidate?.publishedAt), shellVersion: this.shellVersion, component: this.candidate?.component ?? 'content',
      checkOutcome: this.checkOutcome };
  }
  check({ signal } = {}) {
    if (this.discovery) return this.discovery;
    if (this.store.ready || this.readyShell()) {
      // A previously consented transaction owns startup; do not discover a competing target.
      this.candidate = null;
      this.available = true;
      this.phase = 'ready';
      this.checkOutcome = 'prepared';
      this.discovery = Promise.resolve(this.snapshot());
      return this.discovery;
    }
    const controller = new AbortController();
    const deadline = this.clock.now() + STARTUP_DISCOVERY_BUDGET_MS;
    const expired = () => new DOMException('Startup update check deadline', 'TimeoutError');
    const assertActive = () => {
      controller.signal.throwIfAborted();
      if (this.clock.now() >= deadline) throw expired();
    };
    if (!this.store.ready && !this.readyShell()) this.phase = 'checking';
    this.discovery = new Promise(resolve => {
      let settled = false, timer;
      const finish = (candidate, error) => {
        if (settled) return;
        if (this.clock.now() >= deadline) error = expired();
        if (signal?.aborted) error = signal.reason;
        settled = true;
        this.clock.clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        if (error) {
          controller.abort(error);
          this.candidate = null;
          this.available = Boolean(this.store.ready || this.readyShell());
          this.checkOutcome = error?.name === 'TimeoutError' ? 'timeout' : error?.name === 'AbortError' ? 'aborted' : 'failed';
          this.phase = this.available ? 'ready' : 'check-error';
          resolve(this.snapshot());
          return;
        }
        this.candidate = candidate;
        this.available = Boolean(this.store.ready || this.readyShell() || this.candidate);
        this.checkOutcome = candidate ? 'available' : 'current';
        this.phase = this.candidate?.component === 'shell-required' ? 'shell-required'
          : (this.store.ready || this.readyShell()) ? 'ready' : this.candidate ? 'available' : this.startupError ? 'install-error' : 'idle';
        resolve(this.snapshot());
      };
      const aborted = () => finish(null, signal.reason);
      if (signal?.aborted) { finish(null, signal.reason); return; }
      signal?.addEventListener('abort', aborted, { once: true });
      timer = this.clock.setTimeout(() => finish(null, expired()), STARTUP_DISCOVERY_BUDGET_MS);
      Promise.resolve().then(() => {
        assertActive();
        return this.discover({ signal: controller.signal, assertActive });
      }).then(candidate => finish(candidate), error => finish(null, error));
    });
    return this.discovery;
  }
  completeActivation(expectedVersion) {
    if ((expectedVersion && this.store.manifest.gameVersion !== expectedVersion)
      || this.store.ready || this.readyShell()) throw Error('Activated application identity was not confirmed');
    this.candidate = null;
    this.available = false;
    this.consented = false;
    this.progress = 0;
    this.phase = 'idle';
    this.checkOutcome = 'installed';
    this.discovery = Promise.resolve(this.snapshot());
  }
  completeRecovery() {
    // The host has reopened and verified the preserved inventory. Consume the failed
    // transaction so the game's memoized check cannot advertise a stale Restart.
    if (!this.store.manifest || this.store.ready || this.readyShell()) throw Error('Recovery identity was not confirmed');
    this.candidate = null;
    this.available = false;
    this.consented = false;
    this.progress = 0;
    this.startupError = false;
    this.phase = 'idle';
    this.checkOutcome = 'recovered';
    this.discovery = Promise.resolve(this.snapshot());
  }
  finishSilentStartup() {
    if (!['failed', 'timeout', 'aborted'].includes(this.checkOutcome) || this.startupError
      || this.candidate || this.store.ready || this.readyShell()) return;
    // Quiet fallback is not a successful freshness check: retain its diagnostic outcome.
    this.phase = 'idle';
    this.available = false;
    this.discovery = Promise.resolve(this.snapshot());
  }
  download() {
    if (this.operation || !this.candidate || this.phase === 'ready' || this.candidate.component === 'shell-required') return this.operation ?? Promise.resolve(this.snapshot());
    this.consented = true;
    this.phase = this.inMenu ? 'downloading' : 'paused';
    this.operation = (async () => {
      try {
        if (this.candidate.component === 'shell') await this.candidate.prepare(value => { this.progress = value; }, phase=>{if(this.consented)this.phase=phase;});
        else await this.store.prepare(this.candidate.envelope, value => { this.progress = value; });
        if (this.consented) { this.progress = 100; this.phase = 'ready'; }
      } catch (error) { if (this.consented) this.phase = error.name === 'AbortError' ? 'available' : 'download-error'; }
      finally { this.operation = null; }
      return this.snapshot();
    })();
    return this.operation;
  }
  async cancel() {
    this.consented = false;
    this.store.cancel();
    this.candidate?.cancel?.();
    await this.operation;
    if (this.candidate?.component === 'shell') await this.candidate.discard?.();
    else await this.store.discardPrepared?.(this.candidate?.manifest?.sequence);
    this.phase = this.candidate?.component === 'shell-required' ? 'shell-required' : this.candidate ? 'available' : this.startupError ? 'install-error' : 'idle'; this.progress = 0;
    return this.snapshot();
  }
  async setActivity(inMenu) {
    this.inMenu = inMenu;
    if (!inMenu && this.operation) this.phase = 'paused';
    await this.gate.setAllowed(inMenu);
    if (inMenu && this.operation && this.consented) this.phase = 'downloading';
    return this.snapshot();
  }
  async getHistory(locale) {
    if (!this.inMenu) throw Error('History unavailable during match');
    return this.history(locale);
  }
}

/** Explicit restart / pending-at-next-launch share one acknowledged helper operation. */
export class ShellActivation {
  constructor(shell,onFailure=()=>{}) { this.shell=shell;this.onFailure=onFailure;this.pending=false;this.acknowledged=false; }
  start() {
    if(this.promise && this.acknowledged && this.shell.helperPid){try{process.kill(this.shell.helperPid,0);}catch{this.promise=null;this.acknowledged=false;}}
    if(this.promise)return this.promise;
    this.pending=true;
    this.promise=Promise.resolve().then(()=>this.shell.launchHelper()).then(()=>{this.acknowledged=true;this.pending=false;return true;},error=>{this.pending=false;this.promise=null;this.onFailure(error);throw error;});
    return this.promise;
  }
}
