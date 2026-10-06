export interface DisplayPreferences { width: number; height: number; fullscreen: boolean; resolutions?: number[][]; }
interface DesktopUpdate { available: boolean; applying: boolean; error: boolean; }
export interface DesktopBridge {
  updateState(): Promise<DesktopUpdate>;
  check(): Promise<DesktopUpdate>;
  apply(): Promise<boolean>;
  setSafeMenu(safe: boolean): void;
  healthy(): Promise<void>;
  display(): Promise<DisplayPreferences>;
  setDisplay(preferences: DisplayPreferences): Promise<DisplayPreferences>;
  exit(): Promise<void>;
}
declare global { interface Window { bricksDesktop?: DesktopBridge; } }
export const desktop = typeof window === 'undefined' ? undefined : window.bricksDesktop;

export function installerPlatform(userAgent: string, platform: string, mobile: boolean): 'mac' | 'win' | null {
  if (mobile || /iPhone|iPad|Android/i.test(userAgent)) return null;
  if (/Mac/i.test(platform)) return 'mac';
  if (/Win/i.test(platform)) return 'win';
  return null;
}

export async function installerDownload(): Promise<{ url: string; platform: string } | null> {
  if (desktop) return null;
  const platform = installerPlatform(navigator.userAgent, navigator.platform, /Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1);
  if (!platform) return null;
  try {
    const response = await fetch('/desktop/latest.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const catalog = await response.json();
    const file = catalog?.[platform];
    if (!file || typeof file.url !== 'string') return null;
    const url = installerUrl(file.url, location.origin);
    return url ? { url, platform } : null;
  } catch { return null; }
}

// Only our release assets and legacy same-origin installer paths are trusted.
export function installerUrl(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    if (url.username || url.password || url.search || url.hash || !/\.(dmg|exe)$/.test(url.pathname)) return null;
    const github = url.protocol === 'https:' && url.hostname === 'github.com' && !url.port
      && /^\/afonasev\/bricks-war\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname);
    const legacy = url.origin === origin && value.startsWith('/desktop/installers/') && !value.includes('..');
    return github || legacy ? url.href : null;
  } catch { return null; }
}
