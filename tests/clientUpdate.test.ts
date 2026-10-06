import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientUpdate } from '../src/pwa/clientUpdate';

const controllers: ClientUpdate[] = [];
function setup(active = false, menu = true) {
  const reload = vi.fn();
  const postMessage = vi.fn();
  const update = vi.fn().mockResolvedValue(undefined);
  const registration = { waiting: { postMessage }, update, addEventListener: vi.fn() } as unknown as ServiceWorkerRegistration;
  const updates = new ClientUpdate(reload, () => active);
  updates.setMenuGuard(() => menu);
  controllers.push(updates);
  updates.attach(registration);
  return { updates, reload, postMessage, update, registration, setActive: (value: boolean) => { active = value; }, setMenu: (value: boolean) => { menu = value; } };
}
afterEach(() => { controllers.splice(0).forEach(c => c.dispose()); vi.useRealTimers(); });

describe('manual client update', () => {
  it('offers ready update without activation and applies only on click, once', () => {
    const s = setup();
    expect(s.updates.snapshot().available).toBe(true);
    expect(s.postMessage).not.toHaveBeenCalled();
    expect(s.reload).not.toHaveBeenCalled();
    expect(s.updates.apply()).toBe(true);
    expect(s.updates.apply()).toBe(false);
    expect(s.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' });
    s.updates.controllerChanged(); s.updates.controllerChanged();
    expect(s.reload).toHaveBeenCalledTimes(1);
  });
  it('does not reload on another tab activation, later reloads even with no waiting worker', () => {
    const s = setup();
    Object.assign(s.registration, { waiting: null });
    s.updates.controllerChanged();
    expect(s.updates.snapshot().available).toBe(true);
    expect(s.reload).not.toHaveBeenCalled();
    s.updates.apply();
    expect(s.reload).toHaveBeenCalledTimes(1);
    expect(s.postMessage).not.toHaveBeenCalled();
  });
  it('blocks active network and retained participation without queuing consent', () => {
    const s = setup(true);
    expect(s.updates.apply()).toBe(false);
    s.setActive(false); s.updates.refresh();
    expect(s.postMessage).not.toHaveBeenCalled();
    expect(s.reload).not.toHaveBeenCalled();
    s.updates.apply();
    expect(s.postMessage).toHaveBeenCalledTimes(1);
  });
  it('checks menu and network safety again after asynchronous activation', () => {
    const s = setup();
    s.updates.apply(); s.setMenu(false); s.updates.controllerChanged();
    expect(s.reload).not.toHaveBeenCalled();
    s.setMenu(true); s.setActive(true); s.updates.refresh();
    expect(s.reload).not.toHaveBeenCalled();
    s.setActive(false); s.updates.refresh();
    expect(s.reload).toHaveBeenCalledTimes(1);
  });
  it('returns to retry after timeout; late activation does not reload without a new click', () => {
    vi.useFakeTimers(); const s = setup();
    s.updates.apply(); vi.advanceTimersByTime(15_000);
    expect(s.updates.snapshot()).toMatchObject({ available: true, applying: false, error: true });
    s.updates.controllerChanged(); expect(s.reload).not.toHaveBeenCalled();
    s.updates.apply(); expect(s.reload).toHaveBeenCalledTimes(1);
  });
  it('preserves a ready update when a discovery check fails and deduplicates checks', async () => {
    const s = setup(); s.update.mockRejectedValue(new Error('offline'));
    const a = s.updates.check(); const b = s.updates.check();
    expect(a).toBe(b); await a;
    expect(s.update).toHaveBeenCalledTimes(1);
    expect(s.updates.snapshot()).toMatchObject({ available: true, error: false });
    await s.updates.check(); expect(s.update).toHaveBeenCalledTimes(1);
  });
  it('recovers a failed activation without dropping availability', () => {
    const s = setup(); s.postMessage.mockImplementationOnce(() => { throw new Error('redundant'); });
    expect(s.updates.apply()).toBe(false);
    expect(s.updates.snapshot()).toMatchObject({ available: true, applying: false, error: true });
    expect(s.updates.apply()).toBe(true);
  });
});

it('observes waiting-worker activation even without a controllerchange', () => {
  const s = setup();
  let stateChange: (() => void) | undefined;
  const worker = { state: 'installed', postMessage: s.postMessage, addEventListener: (_: string, fn: () => void) => { stateChange = fn; } };
  Object.assign(s.registration, { waiting: worker }); s.updates.refresh();
  s.updates.apply(); worker.state = 'activated'; stateChange?.();
  expect(s.reload).toHaveBeenCalledTimes(1);
});
