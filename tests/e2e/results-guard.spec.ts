import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

test.use({ hasTouch: true });

async function finishBattle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const records: unknown[] = [];
    Object.assign(window, { guardOpened: records });
    let previous: Element | null = null;
    new MutationObserver(() => {
      const panel = document.querySelector('.results-panel');
      if (!panel || panel === previous) return;
      previous = panel;
      const actions = panel.querySelector<HTMLElement>('.results-actions')!;
      const button = panel.querySelector<HTMLButtonElement>('#play-again')!;
      records.push({ visibility: getComputedStyle(actions).visibility, disabled: button.disabled, box: panel.getBoundingClientRect().toJSON() });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
      button.click();
      const setButton = (window as any).setGuardButton;
      if (setButton) { setButton(0, 0, true); setButton(0, 1, true); }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/?muted=1&playtest-fast=20');
  await page.getByRole('button', { name: /^Битва/ }).click();
  await page.getByRole('combobox', { name: 'Длительность матча', exact: true }).click();
  await page.getByRole('option', { name: '2 мин', exact: true }).click();
  await page.getByRole('button', { name: /^Начать/ }).click();
  await page.keyboard.down('Enter');
  await expect(page.locator('.results-panel')).toBeVisible({ timeout: 36000 });
}

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`results guard hides actions, discards input and keeps layout ${viewport.width}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    await finishBattle(page);
    const panel = page.locator('.results-panel');
    const actions = page.locator('.results-actions');
    const opened = await page.evaluate(() => (window as any).guardOpened[0]);
    expect(opened.visibility).toBe('hidden');
    expect(opened.disabled).toBe(true);
    const before = { x: opened.box.x, y: opened.box.y, width: opened.box.width, height: opened.box.height };
    await expect(panel).toBeVisible();
    mkdirSync('evidence/guard-match-results', { recursive: true });
    if (await actions.evaluate(element => getComputedStyle(element).visibility === 'hidden')) {
      await page.screenshot({ path: `evidence/guard-match-results/${viewport.width}-locked.png` });
    }
    await expect(actions).toHaveCSS('visibility', 'visible');
    await expect(page.locator('#play-again')).toBeEnabled();
    await page.keyboard.down('Enter'); // native autorepeat of the carried press
    await expect(panel).toBeVisible();
    const after = (await panel.boundingBox())!;
    for (const dimension of ['x', 'y', 'width', 'height'] as const) expect(after[dimension]).toBeCloseTo(before[dimension], 2);
    const layoutProblems = await panel.evaluate(element => {
      const outer = element.getBoundingClientRect();
      return [...element.querySelectorAll<HTMLElement>('h2, strong, time, button')].filter(item => {
        const box = item.getBoundingClientRect();
        const text = document.createRange();
        text.selectNodeContents(item);
        // Score strike-through extends four pixels by design; measure actual text.
        const clipped = item.tagName === 'TIME' ? text.getBoundingClientRect().width > box.width + 1 : item.scrollWidth > item.clientWidth + 1;
        return clipped || box.left < outer.left - 1 || box.right > outer.right + 1;
      }).map(item => item.textContent);
    });
    expect(layoutProblems).toEqual([]);
    const overlaps = await panel.evaluate(element => {
      const boxes = [...element.querySelectorAll('li, .results-actions button')].map(item => item.getBoundingClientRect());
      return boxes.flatMap((a, index) => boxes.slice(index + 1).filter(b => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1));
    });
    expect(overlaps).toEqual([]);
    await page.screenshot({ path: `evidence/guard-match-results/${viewport.width}-ready.png` });
    await page.keyboard.up('Enter');
    if (viewport.width < 500) await page.locator('#play-again').tap();
    else await page.keyboard.press('Enter');
    await expect(panel).toHaveCount(0);
    await expect(page.locator('.hud-card').first()).toBeVisible();
    await expect(panel).toBeVisible({ timeout: 36000 });
    const repeated = await page.evaluate(() => (window as any).guardOpened[1]);
    expect(repeated.visibility).toBe('hidden');
    expect(repeated.disabled).toBe(true);
    await expect(actions).toHaveCSS('visibility', 'visible');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Выживание/ })).toBeVisible();
  });
}

test('held gamepad controls stay blocked independently while a fresh second gamepad works', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const pads = [0, 1].map(index => ({ id: `Guard ${index}`, index, connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })) }));
    Object.defineProperty(navigator, 'getGamepads', { value: () => pads });
    Object.assign(window, { setGuardButton: (index: number, button: number, down: boolean) => { pads[index]!.buttons[button]!.pressed = down; } });
  });
  await finishBattle(page);
  await expect(page.locator('.results-actions')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.results-panel')).toBeVisible();
  await page.evaluate(() => (window as any).setGuardButton(0, 0, false));
  await page.waitForTimeout(100);
  await expect(page.locator('.results-panel')).toBeVisible(); // releasing A must not expose held B
  await page.evaluate(() => (window as any).setGuardButton(1, 0, true));
  await expect(page.locator('.results-panel')).toHaveCount(0);
  await expect(page.locator('.hud-card').first()).toBeVisible();
});
