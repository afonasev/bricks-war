import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`browser actions are suppressed and game controls remain usable at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?muted=1');
    const title = page.locator('h1');
    await expect(title).toHaveCSS('user-select', 'none');
    await expect(page.locator('h1 a, h2 a, h3 a, a:visible')).toHaveCount(0);
    const before = page.url();
    await title.click();
    expect(page.url()).toBe(before);
    const prevented = await title.evaluate((element) => {
      const events = ['contextmenu', 'selectstart', 'dragstart', 'drop', 'auxclick', 'gesturestart'];
      return events.map(type => !element.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })));
    });
    expect(prevented).toEqual(Array(6).fill(true));
    expect(await title.evaluate(el => !el.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, bubbles: true, cancelable: true })))).toBe(true);
    expect(await title.evaluate(el => ['+', '-', '0', 's', 'p', 'f'].every(key => !el.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }))))).toBe(true);
    expect(await title.evaluate(el => !el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ы', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true })))).toBe(true);
    expect(await title.evaluate(el => !el.dispatchEvent(new TouchEvent('touchstart', { touches: [new Touch({ identifier: 1, target: el }), new Touch({ identifier: 2, target: el })], bubbles: true, cancelable: true })))).toBe(true);
    await page.keyboard.press('Control++');
    await page.keyboard.press('Meta+-');
    expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
    await page.getByRole('button', { name: /^Выживание/ }).click();
    const name = page.getByLabel('Имя игрока 1');
    await name.fill('Проверка');
    await name.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Игрок');
    await expect(name).toHaveValue('Игрок');
    await expect(name).toHaveCSS('user-select', 'text');
    expect(await name.evaluate(el => el.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true })))).toBe(true);
    expect(await name.evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })))).toBe(true);
    await page.screenshot({ path: `evidence/block-browser-actions/setup-${viewport.width}.png` });
    if (viewport.width > 760) await page.getByRole('button', { name: 'Удалить Игрок 2', exact: true }).click();
    await page.locator('#start-match').click();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator(viewport.width > 760 ? '#match-clock' : '#mobile-match-timer')).not.toHaveText('00:00', { timeout: 10000 });
    await page.screenshot({ path: `evidence/block-browser-actions/game-${viewport.width}.png` });
    await page.keyboard.press('Escape');
    await expect(page.locator('#return-to-menu')).toBeVisible();
  });
}
