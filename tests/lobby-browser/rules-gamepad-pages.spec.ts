import { test, expect } from '@playwright/test';
for (const [width, height, id] of [[1440, 960, 'Xbox QA'], [1280, 480, 'DualSense'], [390, 844, 'Nintendo Switch']] as const) {
  test(`rules controller page arrows ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(id => {
      localStorage.setItem('bricks-war:language:v1', 'en');
      const pad = { index: 0, id, mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })), timestamp: 0 };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] }); (window as any).rulesPad = pad;
    }, id);
    await page.goto('/?muted=1');
    await page.locator('[data-destination="settings"]').click(); await page.locator('#open-rules').click();
    const progress = page.locator('#rules-progress');
    await expect(progress).toHaveText('1 / 8');
    const press = async (button: number, expected: string) => {
      await page.evaluate(button => { (window as any).rulesPad.buttons[button].pressed = true; }, button);
      await expect(progress).toHaveText(expected);
      await page.waitForTimeout(80);
      await page.evaluate(button => { (window as any).rulesPad.buttons[button].pressed = false; }, button);
      await page.waitForTimeout(80);
    };
    await press(14, '1 / 8'); // First page cannot wrap.
    await page.locator('#rules-back').focus();
    await page.evaluate(() => { (window as any).rulesPad.buttons[15].pressed = true; });
    await expect(progress).toHaveText('2 / 8');
    await page.waitForTimeout(250); await expect(progress).toHaveText('2 / 8');
    await page.evaluate(() => { (window as any).rulesPad.buttons[15].pressed = false; }); await page.waitForTimeout(80);
    for (let n = 3; n <= 8; n++) await press(15, `${n} / 8`);
    await press(15, '8 / 8'); await expect(page.locator('#rules-next')).toHaveCount(0);
    await press(14, '7 / 8');
    await page.evaluate(() => { (window as any).rulesPad.axes[0] = -0.9; });
    await expect(progress).toHaveText('6 / 8');
    await page.waitForTimeout(150); await expect(progress).toHaveText('6 / 8');
    await page.evaluate(() => { (window as any).rulesPad.axes[0] = 0; }); await page.waitForTimeout(80);
    await page.evaluate(() => { (window as any).rulesPad.axes[0] = 0.9; }); await expect(progress).toHaveText('7 / 8');
    await page.evaluate(() => { (window as any).rulesPad.axes[0] = 0; }); await page.waitForTimeout(80);
    await page.locator('[data-rule-topic="2"]').click(); await expect(progress).toHaveText('3 / 8');
    await page.keyboard.press('ArrowRight'); await expect(progress).toHaveText('4 / 8');
    await page.keyboard.press('ArrowLeft'); await expect(progress).toHaveText('3 / 8');
    await page.screenshot({ path: `${process.env.BRICKS_LOBBY_EVIDENCE}/rules-${width}.png` });
    await page.evaluate(() => { (window as any).rulesPad.buttons[1].pressed = true; });
    await expect(page.locator('[data-screen="settings"]')).toBeVisible();
    await expect(page.locator('[data-screen="rules"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
