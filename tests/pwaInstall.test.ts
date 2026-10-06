import { describe, expect, it } from 'vitest';
import { dismissIosInstallHint, shouldShowIosInstallHint } from '../src/ui/pwaInstall';

function browser(userAgent: string, options: { standalone?: boolean; dismissed?: boolean } = {}) {
  const values = new Map<string, string>();
  if (options.dismissed) values.set('bricks-war:pwa-install-hint-dismissed:v1', '1');
  return {
    navigator: { userAgent, maxTouchPoints: userAgent.includes('Macintosh') ? 5 : 0 },
    matchMedia: () => ({ matches: options.standalone ?? false }),
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) },
  } as unknown as Window;
}

describe('iOS PWA install hint', () => {
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

  it('appears only in iOS Safari outside standalone mode', () => {
    expect(shouldShowIosInstallHint(browser(safari))).toBe(true);
    expect(shouldShowIosInstallHint(browser(safari, { standalone: true }))).toBe(false);
    expect(shouldShowIosInstallHint(browser('Mozilla/5.0 (Linux; Android 15) Chrome/130.0.0.0 Mobile Safari/537.36'))).toBe(false);
    expect(shouldShowIosInstallHint(browser(safari.replace('Safari/604.1', 'CriOS/130.0.0.0')))).toBe(false);
  });

  it('keeps a dismissed hint hidden', () => {
    const iosSafari = browser(safari);
    dismissIosInstallHint(iosSafari);
    expect(shouldShowIosInstallHint(iosSafari)).toBe(false);
  });
});
