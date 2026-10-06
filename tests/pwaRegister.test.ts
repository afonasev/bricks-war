import { describe, expect, it, vi } from 'vitest';
import { registerPwaServiceWorker } from '../src/pwa/register';

describe('PWA service worker registration', () => {
  it('does nothing without a service worker container', async () => {
    await expect(registerPwaServiceWorker({}, 'https://example.com/game/', true)).resolves.toBeUndefined();
  });

  it('registers the worker beside the deployed page in production', async () => {
    const register = vi.fn().mockResolvedValue({});
    await registerPwaServiceWorker({ serviceWorker: { register } }, 'https://example.com/game/index.html', true);
    expect(register).toHaveBeenCalledWith('https://example.com/game/sw.js', { updateViaCache: 'none' });
  });

  it('does not reload when another tab replaces an existing controller', async () => {
    const register = vi.fn().mockResolvedValue({});
    const serviceWorker = { scriptURL: 'https://example.com/game/sw.js' } as ServiceWorker;
    let controller: ServiceWorker | null = serviceWorker;
    let onControllerChange: (() => void) | undefined;
    const addEventListener = vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === 'controllerchange' && typeof listener === 'function') {
        onControllerChange = () => listener(new Event('controllerchange'));
      }
    });
    const reload = vi.fn();

    await registerPwaServiceWorker({ serviceWorker: { register, addEventListener, get controller() { return controller; } } }, 'https://example.com/game/', true, reload);
    controller = { scriptURL: 'https://example.com/game/sw.js?updated' } as ServiceWorker;
    onControllerChange?.();
    onControllerChange?.();

    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the first worker takes control', async () => {
    const register = vi.fn().mockResolvedValue({});
    const serviceWorker = { scriptURL: 'https://example.com/game/sw.js' } as ServiceWorker;
    let controller: ServiceWorker | null = null;
    let onControllerChange: (() => void) | undefined;
    const addEventListener = vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === 'controllerchange' && typeof listener === 'function') {
        onControllerChange = () => listener(new Event('controllerchange'));
      }
    });
    const reload = vi.fn();

    await registerPwaServiceWorker({ serviceWorker: { register, addEventListener, get controller() { return controller; } } }, 'https://example.com/game/', true, reload);
    controller = serviceWorker;
    onControllerChange?.();

    expect(reload).not.toHaveBeenCalled();
  });
});
