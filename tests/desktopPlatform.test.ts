import { describe, it, expect, vi, afterEach } from 'vitest';
import { installerPlatform, installerUrl, installerDownload } from '../src/platform/desktop';
describe('installer platform selection', () => {
  it('chooses macOS and Windows and rejects phones/unknown OS', () => {
    expect(installerPlatform('Macintosh', 'MacIntel', false)).toBe('mac');
    expect(installerPlatform('Windows NT 10', 'Win32', false)).toBe('win');
    expect(installerPlatform('iPad Macintosh', 'MacIntel', true)).toBeNull();
    expect(installerPlatform('Linux', 'Linux x86_64', false)).toBeNull();
  });
});

describe('installer release URL trust', () => {
  const origin = 'https://bricks.afonasev.tech';
  it('allows our GitHub release assets and existing installer links', () => {
    expect(installerUrl('https://github.com/afonasev/bricks-war/releases/download/v1.1.1/Bricks-War-1.1.1-win-x64.exe', origin)).toContain('github.com');
    expect(installerUrl('/desktop/installers/old.dmg', origin)).toBe(`${origin}/desktop/installers/old.dmg`);
  });
  it('rejects foreign repositories, credentials and non-installer paths', () => {
    for (const value of ['https://github.com/other/bricks-war/releases/download/v1/x.exe', 'https://github.com.evil.test/afonasev/bricks-war/releases/download/v1/x.exe', 'https://user@github.com/afonasev/bricks-war/releases/download/v1/x.exe', 'https://github.com/afonasev/bricks-war/releases/download/v1/x.exe?x=1', '/desktop/installers/../x.exe', 'https://evil.test/x.exe']) expect(installerUrl(value, origin)).toBeNull();
  });
});


describe('installer discovery without VPS', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  function browser(platform = 'MacIntel', userAgent = 'Macintosh', maxTouchPoints = 0) {
    vi.stubGlobal('navigator', { platform, userAgent, maxTouchPoints });
    vi.stubGlobal('location', { origin: 'https://bricks.afonasev.tech' });
  }
  it('selects the latest native GitHub asset without requesting the VPS', async () => {
    browser();
    const url = 'https://github.com/afonasev/bricks-war/releases/download/v1.14.0/Bricks-War-1.14.0-mac-universal.dmg';
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: 'v1.14.0', assets: [{ name: 'Bricks-War-1.14.0-mac-universal.dmg', browser_download_url: url }] }) });
    vi.stubGlobal('fetch', fetcher);
    expect(await installerDownload()).toEqual({ url, platform: 'mac' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.github.com/repos/afonasev/bricks-war/releases/latest');
  });
  it.each(['offline', 'rate-limit', 'invalid', 'foreign', 'content', 'draft'])('retains a verified Windows installer on %s', async failure => {
    browser('Win32', 'Windows NT 10');
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure === 'offline') throw Error('offline');
      return { ok: failure !== 'rate-limit', json: async () => {
        if (failure === 'invalid') throw Error('invalid JSON');
        return { tag_name: failure === 'content' ? 'content-123' : 'v1.14.0', draft: failure === 'draft', assets: [{ name: 'Bricks-War-1.14.0-win-x64.exe', browser_download_url: failure === 'foreign' ? 'https://evil.test/installer.exe' : 'https://github.com/afonasev/bricks-war/releases/download/v1.14.0/Bricks-War-1.14.0-win-x64.exe' }] };
      } };
    }));
    expect(await installerDownload()).toEqual({ url: 'https://github.com/afonasev/bricks-war/releases/download/v1.13.0/Bricks-War-1.13.0-win-x64.exe', platform: 'win' });
  });
  it('bounds a stalled response body and aborts the request', async () => {
    browser(); vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    vi.stubGlobal('fetch', fetcher);
    const pending = installerDownload();
    await vi.advanceTimersByTimeAsync(2500);
    expect((await pending)?.url).toContain('/v1.13.0/');
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
  });
  it('does not discover installers on phones or unknown platforms', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    browser('MacIntel', 'iPad Macintosh', 5); expect(await installerDownload()).toBeNull();
    browser('Linux', 'Linux'); expect(await installerDownload()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
