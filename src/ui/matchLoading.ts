import './matchLoading.css';

export const MATCH_LOADING_MINIMUM_MS = 1_000;

/** Loading owns only presentation time; it never changes server time. */
export class MatchLoading {
  private readonly element = document.createElement('section');
  private readonly frames = new Set<number>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly pending = new Set<(active: boolean) => void>();
  private shownAt = 0;
  private active = true;
  private suppressed = false;
  private readonly previousInert: boolean;
  private readonly previousBusy: string | null;

  constructor(private readonly root?: HTMLElement, private readonly onFailure?: () => void, private readonly onBack?: () => void) {
    this.previousInert = root?.inert ?? false;
    this.previousBusy = root?.getAttribute('aria-busy') ?? null;
    if (root) { root.inert = true; root.setAttribute('aria-busy', 'true'); }
    this.element.className = 'match-loading';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.element.innerHTML = `<div class="match-loading-brand">BRICKS <b>WAR</b></div>
      <div class="match-loading-content">
        <div class="match-loading-pattern" aria-hidden="true">
          <div class="loading-piece loading-piece-blue"><i></i><i></i><i></i><i></i></div>
          <div class="loading-piece loading-piece-lime"><i></i><i></i><i></i><i></i></div>
          <div class="loading-piece loading-piece-coral"><i></i><i></i><i></i><i></i></div>
          <div class="loading-piece loading-piece-purple"><i></i><i></i><i></i><i></i></div>
        </div>
        <h1>Собираем арену</h1><p>Скоро начнём</p>
        <div class="match-loading-indicator" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      </div>`;
    document.body.append(this.element);
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  get visible(): boolean { return this.active && !this.suppressed; }

  /** Two frame boundaries let the browser paint before synchronous preparation. */
  async painted(): Promise<boolean> {
    if (!await this.frame()) return false;
    if (!await this.frame()) return false;
    this.shownAt = performance.now();
    return true;
  }

  /** Call only after the renderer has presented its first complete arena frame. */
  async ready(): Promise<boolean> {
    if (!this.active) return false;
    const remaining = Math.max(0, MATCH_LOADING_MINIMUM_MS - (performance.now() - this.shownAt));
    if (remaining > 0 && !await this.delay(remaining)) return false;
    if (!this.suppressed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.element.classList.add('is-ready');
      if (!await this.delay(180)) return false;
    }
    if (!await this.frame()) return false;
    this.dispose(true);
    return true;
  }

  /** Recovery/paused state takes priority over the cosmetic minimum. */
  suppress(): void {
    this.suppressed = true;
    this.element.hidden = true;
    this.restoreRoot();
  }

  cancel(): void { this.dispose(false); }

  private frame(): Promise<boolean> {
    if (!this.active) return Promise.resolve(false);
    return new Promise(resolve => {
      this.pending.add(resolve);
      const id = requestAnimationFrame(() => {
        this.frames.delete(id); this.pending.delete(resolve); resolve(this.active);
      });
      this.frames.add(id);
    });
  }

  private delay(ms: number): Promise<boolean> {
    return new Promise(resolve => {
      this.pending.add(resolve);
      const id = setTimeout(() => {
        this.timers.delete(id); this.pending.delete(resolve); resolve(this.active);
      }, ms);
      this.timers.add(id);
    });
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.onBack || event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation(); this.onBack();
  };

  private restoreRoot(): void {
    if (!this.root) return;
    this.root.inert = this.previousInert;
    if (this.previousBusy === null) this.root.removeAttribute('aria-busy');
    else this.root.setAttribute('aria-busy', this.previousBusy);
  }

  private onError = (event: ErrorEvent): void => {
    if (!event.error && /^ResizeObserver loop/.test(event.message)) return;
    this.cancel();
    this.onFailure?.();
  };
  private onRejection = (): void => { this.cancel(); this.onFailure?.(); };

  private dispose(completed: boolean): void {
    this.active = false;
    this.element.remove();
    this.restoreRoot();
    for (const id of this.frames) cancelAnimationFrame(id);
    for (const id of this.timers) clearTimeout(id);
    for (const resolve of this.pending) resolve(completed);
    this.frames.clear(); this.timers.clear(); this.pending.clear();
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
    window.removeEventListener('keydown', this.onKeyDown, true);
  }
}
