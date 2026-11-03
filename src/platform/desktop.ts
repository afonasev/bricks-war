export interface DisplayPreferences { width: number; height: number; fullscreen: boolean; auto?: boolean; resolutions?: number[][]; }
export interface DesktopUpdate {
  available: boolean; applying: boolean; error: boolean;
  phase?: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'paused' | 'ready' | 'error' | 'check-error' | 'download-error' | 'install-error' | 'shell-required';
  progress?: number; version?: string; currentVersion?: string; shellVersion?: string; component?: string; requiresShell?: boolean;
}
export interface DesktopBridge {
  updateState(): Promise<DesktopUpdate>;
  check(): Promise<DesktopUpdate>;
  download(): Promise<DesktopUpdate>;
  cancel(): Promise<DesktopUpdate>;
  setActivity(inMenu: boolean): Promise<DesktopUpdate>;
  history(locale?: string): Promise<{version:string; date:string|null; text:string; fallback:boolean; installed:boolean; component?: 'shell'; notesUnavailable?: 'installed'|'release'}[]>;
  apply(): Promise<boolean>;
  setSafeMenu(safe: boolean): void;
  healthy(): Promise<void>;
  display(): Promise<DisplayPreferences>;
  setDisplay(preferences: DisplayPreferences): Promise<DisplayPreferences>;
  confirmDisplay(confirm: boolean): Promise<DisplayPreferences>;
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
  // Public, verified recovery installers: never require the multiplayer VPS.
  const version = '1.13.0';
  const name = `Bricks-War-${version}-${platform === 'mac' ? 'mac-universal.dmg' : 'win-x64.exe'}`;
  const fallback = { url: `https://github.com/afonasev/bricks-war/releases/download/v${version}/${name}`, platform };
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Race the entire response/body read, so even a stalled API cannot hide the action.
    return await Promise.race([
      (async () => {
        const response = await fetch('https://api.github.com/repos/afonasev/bricks-war/releases/latest', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return fallback;
        const release = await response.json();
        if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return fallback;
        const expected = `Bricks-War-${release.tag_name.slice(1)}-${platform === 'mac' ? 'mac-universal.dmg' : 'win-x64.exe'}`;
        const file = Array.isArray(release.assets) ? release.assets.find((asset: { name?: string }) => asset.name === expected) : null;
        const url = typeof file?.browser_download_url === 'string' ? installerUrl(file.browser_download_url, location.origin) : null;
        return url?.startsWith(`https://github.com/afonasev/bricks-war/releases/download/${release.tag_name}/`) ? { url, platform } : fallback;
      })(),
      new Promise<typeof fallback>(resolve => { timeout = setTimeout(() => { controller.abort(); resolve(fallback); }, 2500); }),
    ]);
  } catch { return fallback; }
  finally { clearTimeout(timeout); controller.abort(); }
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
