import { test, expect } from '@playwright/test';
const notes = 'Read the latest changes.\n' + Array.from({ length: 55 }, (_, i) => `- Improvement ${i + 1}: clearer boards, readable controls and smoother navigation.`).join('\n');
for (const [width, height] of [[1440, 960], [1280, 480], [390, 844]] as const) {
  test(`history right stick and inline close hint ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ notes }) => {
      localStorage.setItem('bricks-war:language:v1', 'en');
      const pad = { index: 0, id: 'Xbox QA', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })), timestamp: 0 };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] }); (window as any).historyPad = pad;
      const display = { width: 1440, height: 960, fullscreen: false, resolutions: [[1440, 960]] };
      (window as any).bricksDesktop = { updateState: async () => ({ phase: 'idle' }), check: async () => ({ phase: 'idle' }), setActivity: async () => {}, setSafeMenu: () => {}, healthy: async () => {}, display: async () => display, history: async () => [{ version: '1.13.2', date: '2026-10-31', text: notes, fallback: false, installed: true }] };
    }, { notes });
    await page.goto('/?muted=1');
    await page.locator('[data-destination="settings"]').click();
    await page.locator('#open-release-history').click();
    const dialog = page.locator('[data-release-history]'), list = page.locator('[data-history-scroll]'), close = page.locator('[data-history-back]');
    await expect(list).toContainText('Improvement 55');
    await expect(dialog.locator('.preferences-guidance-footer')).toHaveCount(0);
    await expect(close.locator('.input-back')).toHaveText('B');
    await page.evaluate(() => { (window as any).historyPad.buttons[13].pressed = true; });
    await expect(close).toBeFocused();
    await page.evaluate(() => { (window as any).historyPad.buttons[13].pressed = false; }); // Reading must not depend on list focus.
    await expect(page.locator('.settings-screen .release-guidance-footer')).toBeHidden();
    await page.evaluate(() => { (window as any).historyPad.axes[3] = 0.65; });
    await expect.poll(() => list.evaluate(e => e.scrollTop)).toBeGreaterThan(20);
    const first = await list.evaluate(e => e.scrollTop);
    await expect.poll(() => list.evaluate(e => e.scrollTop)).toBeGreaterThan(first + 30);
    await page.evaluate(() => { (window as any).historyPad.axes[3] = 0; });
    await page.waitForTimeout(80);
    const stopped = await list.evaluate(e => e.scrollTop);
    await page.waitForTimeout(150);
    expect(await list.evaluate(e => e.scrollTop)).toBe(stopped);
    await page.evaluate(() => { (window as any).historyPad.axes[3] = -0.7; });
    await expect.poll(() => list.evaluate(e => e.scrollTop)).toBeLessThan(stopped);
    await page.evaluate(() => { (window as any).historyPad.axes[3] = 0.1; });
    await page.waitForTimeout(80);
    const deadZone = await list.evaluate(e => e.scrollTop);
    await page.waitForTimeout(150);
    expect(await list.evaluate(e => e.scrollTop)).toBe(deadZone);
    for (const [id, glyph] of [['DualSense', '○'], ['Nintendo Switch', 'A'], ['Generic Controller', 'B'], ['Xbox QA', 'B']] as const) {
      await page.evaluate(id => { (window as any).historyPad.id = id; }, id);
      await expect(close.locator('.input-back')).toHaveText(glyph);
      const fits = await close.evaluate(e => {
        const button = e.getBoundingClientRect(); return Array.from(e.children).every(child => { const r = child.getBoundingClientRect(); return r.left >= button.left && r.right <= button.right && r.top >= button.top && r.bottom <= button.bottom; });
      }); expect(fits).toBe(true);
    }
    await list.evaluate(e => { e.scrollTop = 0; });
    const geometry = await dialog.evaluate(e => {
      const rect = e.getBoundingClientRect(), list = e.querySelector('[data-history-scroll]')!.getBoundingClientRect(), close = e.querySelector('[data-history-back]')!.getBoundingClientRect();
      return { inViewport: rect.top >= 0 && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, separated: list.bottom <= close.top + 1, overflow: e.scrollWidth > e.clientWidth };
    });
    expect(geometry).toEqual({ inViewport: true, separated: true, overflow: false });
    await page.screenshot({ path: `${process.env.BRICKS_LOBBY_EVIDENCE}/history-${width}.png` });
    await page.evaluate(() => { (window as any).historyPad.buttons[1].pressed = true; });
    await expect(dialog).toHaveCount(0);
    await page.evaluate(() => { (window as any).historyPad.buttons[1].pressed = false; });
    await expect(page.locator('#open-release-history')).toBeFocused();
    expect(errors).toEqual([]);
  });
}
