import { describe, it, expect } from 'vitest';
import { installerPlatform, installerUrl } from '../src/platform/desktop';
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
