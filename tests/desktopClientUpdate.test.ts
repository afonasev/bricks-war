import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.doUnmock('../src/platform/desktop'); vi.resetModules(); });
async function setup() {
  vi.resetModules();
  const bridge = { check: vi.fn(), setSafeMenu: vi.fn(), apply: vi.fn() };
  vi.doMock('../src/platform/desktop', () => ({ desktop: bridge }));
  const { ClientUpdate } = await import('../src/pwa/clientUpdate');
  return { bridge, client: new ClientUpdate(vi.fn(), () => false) };
}
it('deduplicates native checks, exposes checking and a failed check retry', async () => {
  const { bridge, client } = await setup();
  let reject!: (e: Error) => void;
  bridge.check.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  const first = client.check(); const second = client.check();
  expect(first).toBe(second); expect(bridge.check).toHaveBeenCalledTimes(1);
  expect(client.snapshot().phase).toBe('checking');
  reject(Error('offline')); await first;
  expect(client.snapshot()).toMatchObject({ available: false, error: true, phase: 'error' });
  bridge.check.mockResolvedValue({ available: true, error: false, applying: false, phase: 'ready' });
  await client.check(true);
  expect(client.snapshot()).toMatchObject({ available: true, error: false, phase: 'ready' });
  expect(bridge.apply).not.toHaveBeenCalled(); client.dispose();
});
it('failed native check preserves a verified ready update and requires safe-menu consent', async () => {
  const { bridge, client } = await setup();
  bridge.check.mockResolvedValue({ available: true, error: false, applying: false, phase: 'ready' });
  await client.check(); bridge.check.mockRejectedValue(Error('offline')); await client.check();
  expect(client.snapshot()).toMatchObject({ available: true, error: true });
  client.setMenuGuard(() => false); expect(client.apply()).toBe(false);
  expect(bridge.apply).not.toHaveBeenCalled();
  client.setMenuGuard(() => true); bridge.apply.mockResolvedValue(true);
  expect(client.apply()).toBe(true);
  await Promise.resolve(); expect(bridge.apply).toHaveBeenCalledTimes(1); client.dispose();
});
