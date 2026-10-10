import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchLoading } from '../src/ui/matchLoading';

// Exercise cancellation and the clock contract without a browser's wall-clock jitter.
let frames: Map<number, FrameRequestCallback>;
let listeners: Map<string, (event: unknown) => void>;
let removed: boolean;
let element: { hidden: boolean; remove: () => void; setAttribute: () => void; innerHTML: string; className: string; classList: { add: () => void } };
async function frame(): Promise<void> {
  const callbacks = [...frames.values()]; frames.clear();
  callbacks.forEach(callback => callback(performance.now()));
  await Promise.resolve(); await Promise.resolve();
}
async function painted(loading: MatchLoading): Promise<void> {
  const ready = loading.painted(); await frame(); await frame(); expect(await ready).toBe(true);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  frames = new Map(); listeners = new Map(); removed = false; let id = 0;
  element = { hidden: false, remove: () => { removed = true; }, setAttribute: () => {}, innerHTML: '', className: '', classList: { add: () => {} } };
  vi.stubGlobal('document', { createElement: () => element, body: { append: () => {} } });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('match loading presentation lifecycle', () => {
  it('keeps a fast ready arena behind loading for a full second after paint', async () => {
    const loading = new MatchLoading(); await painted(loading);
    let done = false; const completion = loading.ready().then(value => { done = value; });
    await vi.advanceTimersByTimeAsync(999); await frame(); expect(done).toBe(false); expect(removed).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(180); await frame(); await completion;
    expect(done).toBe(true); expect(removed).toBe(true); expect(listeners.size).toBe(0);
  });
  it('does not add another second after a slow arena becomes ready', async () => {
    const loading = new MatchLoading(); await painted(loading);
    await vi.advanceTimersByTimeAsync(2_400);
    const completion = loading.ready(); await vi.advanceTimersByTimeAsync(180); await frame(); expect(await completion).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels before paint so abandoned initialization cannot proceed', async () => {
    const loading = new MatchLoading(); const preparation = loading.painted();
    loading.cancel(); expect(await preparation).toBe(false); expect(frames.size).toBe(0); expect(removed).toBe(true);
  });
  it('cancels a ready wait and removes all scheduled work', async () => {
    const loading = new MatchLoading(); await painted(loading);
    const completion = loading.ready(); loading.cancel();
    expect(await completion).toBe(false); expect(vi.getTimerCount()).toBe(0); expect(listeners.size).toBe(0);
  });
  it('lets network recovery supersede the surface without changing readiness', async () => {
    const loading = new MatchLoading(); await painted(loading); loading.suppress();
    expect(loading.visible).toBe(false); expect(element.hidden).toBe(true);
    const completion = loading.ready(); await vi.advanceTimersByTimeAsync(1_000); await frame();
    expect(await completion).toBe(true);
  });
  it('ignores layout notices but clears loading and its owner on fatal startup failure', async () => {
    const failed = vi.fn(); const loading = new MatchLoading(undefined, failed); await painted(loading);
    const handler = listeners.get('error')!;
    handler({ message: 'ResizeObserver loop limit exceeded' }); expect(loading.visible).toBe(true);
    const completion = loading.ready(); handler({ message: 'Renderer initialization failed', error: new Error('Renderer initialization failed') });
    expect(await completion).toBe(false); expect(failed).toHaveBeenCalledOnce(); expect(removed).toBe(true);
  });
});

it('cancels during the closing dissolve without letting stale completion release the arena', async () => {
  const loading = new MatchLoading(); await painted(loading);
  const completion = loading.ready(); await vi.advanceTimersByTimeAsync(1_000);
  loading.cancel(); expect(await completion).toBe(false);
  await vi.advanceTimersByTimeAsync(180); expect(frames.size).toBe(0); expect(listeners.size).toBe(0);
});

it('skips the closing dissolve for reduced motion while keeping the one-second minimum', async () => {
  (window.matchMedia as unknown) = () => ({ matches: true });
  const loading = new MatchLoading(); await painted(loading);
  const completion = loading.ready(); await vi.advanceTimersByTimeAsync(1_000); await frame();
  expect(await completion).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
