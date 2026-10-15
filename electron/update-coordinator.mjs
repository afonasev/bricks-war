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

export class UpdateCoordinator {
  constructor({ store, discover, gate, history, readyShell = () => null }) {
    Object.assign(this, { store, discover, gate, history, readyShell });
    this.phase = (store.ready || readyShell()) ? 'ready' : 'idle'; this.progress = 0;
    const previousProgress=store.onProgress; store.onProgress=phase=>{previousProgress?.(phase);if(phase==='verifying'&&this.consented)this.phase='verifying';};
    this.consented = false; this.available = Boolean(store.ready || readyShell()); this.inMenu = true;
  }
  snapshot() {
    return { available: this.available, applying: false, error: this.phase.endsWith('error'), phase: this.phase,
      progress: this.progress, version: this.readyShell()?.version ?? this.store.ready?.gameVersion ?? this.candidate?.manifest?.gameVersion,
      currentVersion: this.store.manifest.gameVersion, shellVersion: this.shellVersion, component: this.candidate?.component ?? 'content' };
  }
  check() {
    if (this.discovery) return this.discovery;
    this.discovery = (async () => {
      if (!this.store.ready && !this.readyShell()) this.phase = 'checking';
      try {
        this.candidate = await this.discover();
        this.available = Boolean(this.store.ready || this.readyShell() || this.candidate);
        this.phase = (this.store.ready || this.readyShell()) ? 'ready' : this.candidate ? 'available' : this.startupError ? 'install-error' : 'idle';
      } catch { this.phase = (this.store.ready || this.readyShell()) ? 'ready' : 'check-error'; }
      return this.snapshot();
    })();
    return this.discovery;
  }
  download() {
    if (this.operation || !this.candidate || this.phase === 'ready') return this.operation ?? Promise.resolve(this.snapshot());
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
    this.phase = this.candidate ? 'available' : this.startupError ? 'install-error' : 'idle'; this.progress = 0;
    return this.snapshot();
  }
  async setActivity(inMenu) {
    this.inMenu = inMenu;
    if (!inMenu && this.operation) this.phase = 'paused';
    await this.gate.setAllowed(inMenu);
    if (inMenu && this.operation && this.consented) this.phase = 'downloading';
    return this.snapshot();
  }
  async getHistory() {
    if (!this.inMenu) throw Error('History unavailable during match');
    return this.history();
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
