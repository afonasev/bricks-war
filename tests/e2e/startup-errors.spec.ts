import { expect, test } from '@playwright/test';

test('ignores ResizeObserver loop errors without consuming startup error handling', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/?muted=1');
    const menu = page.getByRole('navigation', { name: 'Главное меню' });
    await expect(menu).toBeVisible();
    await expect(page.locator('#startup-error')).toHaveCount(0);

    for (const message of [
      'ResizeObserver loop completed with undelivered notifications.',
      'ResizeObserver loop limit exceeded',
    ]) {
      await page.evaluate((errorMessage) => {
        window.dispatchEvent(new ErrorEvent('error', { message: errorMessage }));
      }, message);
      await expect(menu).toBeVisible();
      await expect(page.locator('#startup-error')).toHaveCount(0);
    }

    await page.evaluate(() => {
      const message = 'Test startup failure';
      window.dispatchEvent(new ErrorEvent('error', { message, error: new Error(message) }));
    });
    await expect(page.locator('#startup-error')).toContainText('Test startup failure');
    await expect(page.getByRole('heading', { name: 'Игра не запустилась' })).toBeVisible();
  }
});
