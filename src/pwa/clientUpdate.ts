import { isNetworkParticipationActive } from './participation';
import { desktop } from '../platform/desktop';

export interface ClientUpdateState {
  available: boolean;
  applying: boolean;
  blocked: boolean;
  error: boolean;
}

/** Update consent belongs to this document, never to other tabs. */
export class ClientUpdate {
  private registration?: ServiceWorkerRegistration;
  private obsolete = false;
  private nativeState = { available: false, applying: false, error: false };
  private requested = false;
  private reloaded = false;
  private error = false;
  private timeout?: ReturnType<typeof setTimeout>;
  private checking?: Promise<void>;
  private lastCheck = -Infinity;
  private guard = () => true;
  private readonly listeners = new Set<(state: ClientUpdateState) => void>();
  private lastState = '';
  private readonly watched = new WeakSet<ServiceWorker>();

  constructor(
    private readonly reload: () => void = () => window.location.reload(),
    private readonly networkActive: () => boolean = isNetworkParticipationActive,
  ) {}

  setMenuGuard(guard: () => boolean): void { this.guard = guard; }

  snapshot(): ClientUpdateState {
    if (desktop) return { ...this.nativeState, blocked: this.networkActive() };
    return {
      available: this.obsolete || Boolean(this.registration?.waiting),
      applying: this.requested,
      blocked: this.networkActive(),
      error: this.error,
    };
  }

  subscribe(listener: (state: ClientUpdateState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  attach(registration: ServiceWorkerRegistration): void {
    this.registration = registration;
    const watchInstalling = () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        // Read waiting after the browser has completed the install transition.
        if (installing.state === 'installed' || installing.state === 'redundant') this.refresh();
      });
    };
    registration.addEventListener?.('updatefound', watchInstalling);
    watchInstalling();
    this.refresh();
  }

  controllerChanged(): void {
    this.obsolete = true;
    this.refresh();
  }

  refresh(): void {
    desktop?.setSafeMenu(this.guard() && !this.networkActive());
    const waiting = this.registration?.waiting;
    if (waiting && !this.watched.has(waiting)) {
      this.watched.add(waiting);
      waiting.addEventListener?.('statechange', () => {
        // A document without a controller can still request a waiting update.
        if (waiting.state === 'activated') this.controllerChanged();
        else this.refresh();
      });
    }
    if (this.requested && this.obsolete && this.guard() && !this.networkActive() && !this.reloaded) {
      this.reloaded = true;
      clearTimeout(this.timeout);
      this.reload();
    }
    const state = this.snapshot();
    const key = JSON.stringify(state);
    if (key === this.lastState) return;
    this.lastState = key;
    for (const listener of this.listeners) listener(state);
  }

  apply(): boolean {
    if (!this.snapshot().available || this.snapshot().applying || this.requested || this.reloaded || !this.guard() || this.networkActive()) {
      this.refresh();
      return false;
    }
    if (desktop) {
      desktop.setSafeMenu(this.guard() && !this.networkActive());
      this.nativeState.applying = true;
      this.refresh();
      void desktop.apply().then(ok => { this.nativeState.applying = false; this.nativeState.error = !ok; this.refresh(); })
        .catch(() => { this.nativeState.applying = false; this.nativeState.error = true; this.refresh(); });
      return true;
    }
    this.error = false;
    this.requested = true;
    this.timeout = setTimeout(() => {
      this.requested = false;
      this.error = true;
      this.refresh();
    }, 15_000);
    this.refresh();
    try {
      // Another tab may have consumed waiting already: reload our obsolete document.
      if (!this.obsolete) this.registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      clearTimeout(this.timeout);
      this.requested = false;
      this.error = true;
      this.refresh();
      return false;
    }
    return true;
  }

  check(force = false): Promise<void> {
    if (desktop) return desktop.check().then(state => { this.nativeState = state; this.refresh(); }).catch(() => undefined);
    if (!this.registration?.update) return Promise.resolve();
    if (this.checking) return this.checking;
    if (!force && Date.now() - this.lastCheck < 15_000) return Promise.resolve();
    this.lastCheck = Date.now();
    this.checking = Promise.resolve().then(() => this.registration!.update()).then(() => undefined)
      .catch(() => undefined).finally(() => { this.checking = undefined; this.refresh(); });
    return this.checking;
  }

  dispose(): void { clearTimeout(this.timeout); this.listeners.clear(); }

  startDesktop(): void {
    if (!desktop) return;
    const poll = () => { void desktop!.updateState().then(state => { this.nativeState = state; this.refresh(); }); };
    poll(); void this.check();
    setInterval(poll, 2_000);
    setInterval(() => { void this.check(); }, 60_000);
    window.addEventListener('online', () => { void this.check(); });
  }
}

export const clientUpdate = new ClientUpdate();
