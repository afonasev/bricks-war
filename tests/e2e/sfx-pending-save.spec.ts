import { test, expect } from '@playwright/test';

const key = 'bricks-war:release-settings:v1';
for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  for (const decode of ['pending', 'failed'] as const) {
    test(`single theme keeps settings responsive with ${decode} decode at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(decode => {
        AudioContext.prototype.decodeAudioData = function () {
          return decode === 'pending' ? new Promise<AudioBuffer>(() => {}) : Promise.reject(new Error('Deliberate decode failure'));
        };
      }, decode);
      await page.goto('/?muted=1');
      await page.evaluate(key => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify({ sfxPreset: 'original', muted: true }));
      }, key);
      await page.reload();
      await page.getByRole('button', { name: /Настройки/ }).click();
      await page.getByLabel('Громкость музыки').fill('41');
      await page.getByLabel('Громкость эффектов').fill('73');
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key))
        .toMatchObject({ sfxPreset: 'soft-toy', music: .41, effects: .73, muted: true });
      await page.reload();
      await page.getByRole('button', { name: /Настройки/ }).click();
      await expect(page.locator('#sfx-preset')).toHaveCount(0);
      await expect(page.getByLabel('Громкость музыки')).toHaveValue('41');
      await expect(page.getByLabel('Громкость эффектов')).toHaveValue('73');
    });
  }
}
