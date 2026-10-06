import { test, expect } from '@playwright/test';

const key = 'bricks-war:release-settings:v1';
for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`saves SFX preference before pending decode and restores it at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      // Hold decoding pending; real fetch/body cancellation during reload remains possible.
      AudioContext.prototype.decodeAudioData = function () {
        return new Promise<AudioBuffer>(() => {});
      };
    });
    await page.goto('/?muted=1');
    await page.getByRole('button', { name: /Настройки/ }).click();
    await page.getByRole('combobox', { name: 'Набор звуковых эффектов' }).click();
    await page.getByRole('option', { name: 'Тихая механика', exact: true }).click();
    await page.getByLabel('Громкость музыки').fill('41');
    await page.getByLabel('Громкость эффектов').fill('73');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key))
      .toMatchObject({ sfxPreset: 'quiet-mechanism', music: .41, effects: .73 });
    await page.reload();
    await page.getByRole('button', { name: /Настройки/ }).click();
    await expect(page.locator('#sfx-preset')).toHaveValue('quiet-mechanism');
    await expect(page.getByRole('combobox', { name: 'Набор звуковых эффектов' })).toContainText('Тихая механика');
    await expect(page.getByLabel('Громкость музыки')).toHaveValue('41');
    await expect(page.getByLabel('Громкость эффектов')).toHaveValue('73');
  });
}

test('failed buffered preset keeps previous complete pack and stored preference', async ({ page }) => {
  await page.addInitScript(() => {
    AudioContext.prototype.decodeAudioData = function () {
      return new Promise<AudioBuffer>((_, reject) => setTimeout(() => reject(new Error('Deliberate decode failure')), 300));
    };
  });
  await page.goto('/?muted=1');
  await page.getByRole('button', { name: /Настройки/ }).click();
  const control = page.getByRole('combobox', { name: 'Набор звуковых эффектов' });
  await control.click();
  await page.getByRole('option', { name: 'Original', exact: true }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).sfxPreset, key)).toBe('original');
  await control.click();
  await page.getByRole('option', { name: 'Тихая механика', exact: true }).click();
  await expect(page.locator('#sfx-preset')).toHaveValue('quiet-mechanism');
  await expect(page.locator('#sfx-preset')).toHaveValue('original');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).sfxPreset, key)).toBe('original');
});
