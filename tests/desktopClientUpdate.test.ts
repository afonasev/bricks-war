import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.doUnmock('../src/platform/desktop'); vi.resetModules(); });
async function setup() {
  vi.resetModules();
  const bridge = { check: vi.fn(), download: vi.fn(), cancel: vi.fn(), setActivity:vi.fn(), setSafeMenu: vi.fn(), apply: vi.fn() };
  vi.doMock('../src/platform/desktop', () => ({ desktop: bridge }));
  const { ClientUpdate } = await import('../src/pwa/clientUpdate');
  return { bridge, client: new ClientUpdate(vi.fn(), () => false) };
}
it('a failed discovery remains terminal for the session, including force and return to menu', async () => {
  const { bridge,client } = await setup(); bridge.check.mockRejectedValue(Error('offline'));
  const first = client.check(); expect(client.check()).toBe(first); await first;
  await client.check(true); client.refresh(); await client.check();
  expect(bridge.check).toHaveBeenCalledTimes(1);
  expect(client.snapshot()).toMatchObject({error:true,phase:'check-error'});
  expect(bridge.download).not.toHaveBeenCalled(); client.dispose();
});
it('download requires consent in a safe menu and does not recheck discovery', async () => {
  const {bridge,client} = await setup();
  bridge.check.mockResolvedValue({available:true,error:false,applying:false,phase:'available',version:'2.0.0'});
  await client.check(); client.setMenuGuard(()=>false); expect(client.apply()).toBe(false);
  client.setMenuGuard(()=>true); bridge.download.mockResolvedValue({available:true,error:false,applying:false,phase:'downloading'});
  expect(client.apply()).toBe(true); await Promise.resolve();
  expect(bridge.download).toHaveBeenCalledTimes(1); expect(bridge.apply).not.toHaveBeenCalled(); expect(bridge.check).toHaveBeenCalledTimes(1); client.dispose();
});

it('cannot download a target whose required application package is unavailable',async()=>{
 const {bridge,client}=await setup();bridge.check.mockResolvedValue({available:true,error:false,applying:false,phase:'shell-required',requiresShell:true,version:'2.0.0'});
 await client.check();expect(client.apply()).toBe(false);expect(bridge.download).not.toHaveBeenCalled();expect(bridge.apply).not.toHaveBeenCalled();expect(client.snapshot().phase).toBe('shell-required');client.dispose();
});
