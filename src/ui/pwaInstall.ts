const IOS_INSTALL_HINT_KEY = 'bricks-war:pwa-install-hint-dismissed:v1';

type BrowserWindow = Pick<Window, 'matchMedia' | 'navigator' | 'localStorage'>;

function isStandalone(browser: BrowserWindow): boolean {
  const iosNavigator = browser.navigator as Navigator & { standalone?: boolean };
  return browser.matchMedia('(display-mode: standalone)').matches || iosNavigator.standalone === true;
}

function isIosSafari(browser: BrowserWindow): boolean {
  const { userAgent, maxTouchPoints } = browser.navigator;
  const iosDevice = /iPad|iPhone|iPod/.test(userAgent) || (userAgent.includes('Macintosh') && maxTouchPoints > 1);
  return iosDevice && /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}

export function shouldShowIosInstallHint(browser: BrowserWindow = window): boolean {
  if (!isIosSafari(browser) || isStandalone(browser)) return false;
  try { return browser.localStorage.getItem(IOS_INSTALL_HINT_KEY) !== '1'; } catch { return true; }
}

export function dismissIosInstallHint(browser: BrowserWindow = window): void {
  try { browser.localStorage.setItem(IOS_INSTALL_HINT_KEY, '1'); } catch { /* Storage is optional for this hint. */ }
}
