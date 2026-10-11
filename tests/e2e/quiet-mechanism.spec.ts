import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`uses one sound theme and preserves levels at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?muted=1');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('bricks-war:release-settings:v1', JSON.stringify({ sfxPreset: 'quiet-mechanism', music: .41, effects: .73 }));
    });
    await page.reload();
    await page.getByRole('button', { name: /Настройки/ }).click();
    await expect(page.locator('#sfx-preset')).toHaveCount(0);
    await expect(page.getByLabel('Громкость музыки')).toHaveValue('41');
    await expect(page.getByLabel('Громкость эффектов')).toHaveValue('73');
    await page.getByLabel('Громкость музыки').fill('42');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bricks-war:release-settings:v1')!).sfxPreset)).toBe('soft-toy');
    await page.reload();
    await page.getByRole('button', { name: /Настройки/ }).click();
    await expect(page.getByLabel('Громкость музыки')).toHaveValue('42');
    await expect(page.getByLabel('Громкость эффектов')).toHaveValue('73');
    if (process.env.BRICKS_RECORD_SCREENSHOTS) await page.screenshot({ path: `${process.env.BRICKS_RECORD_SCREENSHOTS}/settings-${viewport.width}x${viewport.height}.png` });
    await page.goto('/?muted=1&audio-prototypes=1');
    await page.getByRole('button', { name: /Настройки/ }).click();
    await expect(page.locator('[data-audio-direction="quiet-mechanism"]')).toHaveCount(0);
    await expect(page.locator('[data-audio-direction="original"]')).toHaveCount(0);
    await expect(page.locator('[data-audio-preview="tactile"]')).toHaveCount(1);
  });
}
