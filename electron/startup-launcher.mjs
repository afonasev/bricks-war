/** UI-independent ownership of one pre-game update decision and game launch. */
export class StartupLauncherSession {
  constructor({ coordinator, ui, activate, launchGame, quit, recoverWorking }) {
    Object.assign(this, { coordinator, ui, activate, launchGame, quit, recoverWorking });
    this.phase = 'discovering';
    this.cancelled = false;
    this.finished = null;
  }

  snapshot() {
    return { ...this.coordinator.snapshot(), launcherPhase: this.phase,
      cancellable: this.phase === 'preparing' };
  }

  run() {
    if (!this.operation) this.operation = this.start();
    return this.operation;
  }

  async start() {
    const state = await this.coordinator.check();
    this.target = this.coordinator.candidate;
    if (state.phase === 'ready') return this.applyReady(); // Previously consented preparation.
    if (this.coordinator.startupError) {
      this.phase = 'recovery';
      const action = await this.ui.failure(this.snapshot(), { retry: false, recovery: true });
      return this.finish(this.choice(action, ['play', 'quit']));
    }
    if (!state.available) return this.finish('play');
    if (state.phase === 'shell-required') {
      this.phase = 'unavailable';
      const action = await this.ui.failure(this.snapshot(), { retry: false, unavailable: true });
      return this.finish(this.choice(action, ['play', 'quit']));
    }
    this.phase = 'offer';
    const action = this.choice(await this.ui.offer(this.snapshot()), ['update', 'play', 'quit']);
    if (action !== 'update') return this.finish(action);
    return this.prepareTarget();
  }

  choice(action, allowed) {
    if (!allowed.includes(action)) throw Error('Invalid launcher transition');
    return action;
  }

  async prepareTarget() {
    for (;;) {
      if (!this.target || this.coordinator.candidate !== this.target) throw Error('Launcher target changed after consent');
      this.phase = 'preparing';
      this.cancelled = false;
      this.cancellation = null;
      try {
        await this.ui.progress(this.snapshot(), () => this.cancel());
        if (!this.cancelled) await this.coordinator.download();
        if (this.cancellation) await this.cancellation;
      } catch (error) {
        return this.recover(error);
      }
      if (this.cancelled) return this.finish('play');
      if (this.coordinator.snapshot().phase === 'ready') return this.applyReady();
      this.phase = 'error';
      const action = this.choice(await this.ui.failure(this.snapshot(), { retry: true }), ['retry', 'play', 'quit']);
      if (action !== 'retry') return this.finish(action);
    }
  }

  cancel() {
    if (this.cancellation) return this.cancellation;
    if (this.phase !== 'preparing') return Promise.resolve();
    this.cancelled = true;
    this.phase = 'cancelling';
    this.cancellation = Promise.resolve().then(() => this.coordinator.cancel());
    return this.cancellation;
  }

  async applyReady() {
    this.phase = 'activating';
    const selected = this.snapshot();
    await this.ui.installing(selected);
    try {
      const result = await this.activate();
      if (result?.handoff) return this.finish('handoff');
      if (result?.activated !== true) throw Error('Update activation not confirmed');
      this.coordinator.completeActivation(selected.version);
    } catch (error) {
      return this.recover(error);
    }
    return this.finish('play');
  }

  async recover(error) {
    this.phase = 'recovery';
    // Installation adapters must confirm the working version before it is offered.
    let restored = false;
    try { restored = await this.recoverWorking(error); } catch { /* Recovery cannot be assumed. */ }
    if (restored !== true) {
      await this.ui.failure(this.snapshot(), { retry: false, recovery: true, playable: false });
      return this.finish('quit');
    }
    const action = await this.ui.failure(this.snapshot(), { retry: false, recovery: true, playable: true });
    return this.finish(this.choice(action, ['play', 'quit']));
  }

  async finish(action) {
    if (this.finished) return this.finished;
    this.finished = action;
    this.phase = 'finished';
    if (action === 'play') this.coordinator.finishSilentStartup();
    await this.ui.close();
    if (action === 'play') await this.launchGame();
    else await this.quit(); // Quit old process after an acknowledged full-shell handoff.
    return action;
  }
}
