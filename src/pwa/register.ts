import { onParticipationChange } from './participation';
import { ClientUpdate, clientUpdate } from './clientUpdate';
export interface ServiceWorkerNavigator {
  serviceWorker?: Pick<ServiceWorkerContainer, 'register'> & Partial<Pick<ServiceWorkerContainer, 'controller' | 'addEventListener'>>;
}

export function registerPwaServiceWorker(
  browser: ServiceWorkerNavigator = navigator,
  pageUrl: string = window.location.href,
  production: boolean = import.meta.env.PROD,
  reload?: () => void,
  updates: ClientUpdate = reload ? new ClientUpdate(reload) : clientUpdate,
): Promise<ServiceWorkerRegistration | undefined> {
  if (!production || !browser.serviceWorker) return Promise.resolve(undefined);
  let hadController = Boolean(browser.serviceWorker.controller);
  browser.serviceWorker.addEventListener?.('controllerchange', () => {
    if (!hadController) {
      hadController = Boolean(browser.serviceWorker?.controller);
      return;
    }
    updates.controllerChanged();
  });
  return browser.serviceWorker.register(new URL('./sw.js', pageUrl).toString(), { updateViaCache: 'none' }).then(registration => {
    updates.attach(registration);
    if (typeof window !== 'undefined') {
      const check = () => {
        updates.refresh();
        if (document.visibilityState === 'visible' && navigator.onLine) void updates.check();
      };
      let checks: ReturnType<typeof setInterval> | undefined;
      let guards: ReturnType<typeof setInterval> | undefined;
      const start = () => {
        clearInterval(checks); clearInterval(guards);
        checks = setInterval(check, 60_000);
        guards = setInterval(() => updates.refresh(), 2_000);
        check();
      };
      window.addEventListener('focus', check);
      window.addEventListener('online', check);
      document.addEventListener('visibilitychange', check);
      window.addEventListener('pageshow', start);
      window.addEventListener('storage', () => updates.refresh());
      window.addEventListener('pagehide', () => { clearInterval(checks); clearInterval(guards); });
      onParticipationChange(() => updates.refresh());
      start();
    }
    return registration;
  });
}
