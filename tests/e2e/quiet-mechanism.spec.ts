import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`selects and restores the fourth SFX theme at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?muted=1');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: /Настройки/ }).click();
    const preset = page.locator('#sfx-preset');
    await expect(preset).toHaveValue('soft-toy');
    await page.getByRole('combobox', { name: 'Набор звуковых эффектов' }).click();
    await expect(page.getByRole('option')).toHaveText(['Soft Toy', 'Neon Workshop', 'Original', 'Тихая механика']);
    await page.getByRole('option', { name: 'Тихая механика', exact: true }).click();
    await expect(preset).toHaveValue('quiet-mechanism');
    await page.getByLabel('Громкость музыки').fill('41');
    await page.getByLabel('Громкость эффектов').fill('73');
    await page.reload();
    await page.getByRole('button', { name: /Настройки/ }).click();
    await expect(preset).toHaveValue('quiet-mechanism');
    await expect(page.getByLabel('Громкость музыки')).toHaveValue('41');
    await expect(page.getByLabel('Громкость эффектов')).toHaveValue('73');
    await page.goto('/?muted=1&audio-prototypes=1');
    await page.getByRole('button', { name: /Настройки/ }).click();
    await expect(page.locator('[data-audio-direction="quiet-mechanism"]')).toHaveCount(4);
    await expect(preset).toHaveValue('quiet-mechanism');
  });
}
