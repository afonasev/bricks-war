import { test, expect } from '@playwright/test';

test('startup mute precedes Web Audio and survives menu actions, network navigation and reload', async ({ page }) => {
  const savedSettings = JSON.stringify({ music: 0.37, effects: 0.62, muted: false });
  await page.addInitScript(settings => {
    localStorage.setItem('bricks-war:release-settings:v1', settings);
    (window as Window & { audioContextCreations?: number }).audioContextCreations = 0;
    const forbidden = function AudioContextBeforeQuietStartup(): never {
      (window as Window & { audioContextCreations?: number }).audioContextCreations!++;
      throw new Error('AudioContext was constructed during a muted startup');
    };
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: forbidden });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: forbidden });
  }, savedSettings);

  await page.goto('/?muted=1');
  await page.locator('[data-destination="settings"]').click();
  await expect(page.locator('.audio-toggle')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as Window & { audioContextCreations?: number }).audioContextCreations)).toBe(0);
  await page.locator('#master-volume').press('End');
  await expect(page.locator('.audio-toggle')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bricks-war:release-settings:v1')!))).toMatchObject({music:0.37,effects:0.62,muted:false});

  await page.locator('#settings-back').click();
  await page.locator('[data-network-entry]').click();
  await expect(page.getByRole('heading', { name: /сетевая игра/i })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { audioContextCreations?: number }).audioContextCreations)).toBe(0);
  await page.reload();
  await page.locator('[data-destination="settings"]').click();
  await expect(page.locator('.audio-toggle')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as Window & { audioContextCreations?: number }).audioContextCreations)).toBe(0);
  expect(new URL(page.url()).searchParams.get('muted')).toBe('1');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bricks-war:release-settings:v1')!))).toMatchObject({music:0.37,effects:0.62,muted:false});
});
