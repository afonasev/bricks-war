import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startAfterLoading } from '../src/ui/startupLoading';

let loading: { isConnected: boolean; dataset: { shownAt?: string }; remove: () => void };
let root: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
  loading = { isConnected: true, dataset: { shownAt: '0' }, remove: () => { loading.isConnected = false; } };
  root = { inert: true, removeAttribute: vi.fn() } as unknown as HTMLElement;
  vi.stubGlobal('document', { getElementById: () => loading });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('blocks app startup until 2000ms after paint and reveals only after start completes', async () => {
  const start = vi.fn(() => expect(loading.isConnected).toBe(true));
  const result = startAfterLoading(root, start);
  await vi.advanceTimersByTimeAsync(1999); expect(start).not.toHaveBeenCalled(); expect(root.inert).toBe(true);
  await vi.advanceTimersByTimeAsync(1); expect(await result).toBe(true);
  expect(start).toHaveBeenCalledOnce(); expect(root.inert).toBe(false); expect(loading.isConnected).toBe(false);
});
it('adds no fixed wait after a slow import', async () => {
  await vi.advanceTimersByTimeAsync(2500);
  const start = vi.fn(); expect(await startAfterLoading(root, start)).toBe(true); expect(start).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('does not resurrect a failed startup while waiting', async () => {
  const start = vi.fn(); const result = startAfterLoading(root, start);
  loading.remove(); await vi.advanceTimersByTimeAsync(2000);
  expect(await result).toBe(false); expect(start).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('lets initialization errors reach the existing recovery handler with the loader removed', async () => {
  await vi.advanceTimersByTimeAsync(2000);
  await expect(startAfterLoading(root, () => { throw new Error('Initialization failed'); })).rejects.toThrow('Initialization failed');
  expect(root.inert).toBe(false); expect(loading.isConnected).toBe(false);
});
it('waits for the initial HTML paint marker before measuring the minimum', async () => {
  delete loading.dataset.shownAt;
  const callbacks: Array<() => void> = [];
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callbacks.push(callback); return 1; });
  const start = vi.fn(); const result = startAfterLoading(root, start);
  await vi.advanceTimersByTimeAsync(800); loading.dataset.shownAt = String(performance.now()); callbacks.shift()!();
  await Promise.resolve(); await vi.advanceTimersByTimeAsync(1999); expect(start).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(await result).toBe(true);
});
