import { openLocalLobby } from '../helpers/localLobby';
import { expect, test, type Page } from '@playwright/test';

const evidence = process.env.BRICKS_MENU_FOCUS_EVIDENCE ?? 'evidence/menu-button-contour/screenshots';
const pauseScreenshots = process.env.BRICKS_PAUSE_SCREENSHOTS ?? 'evidence/pause-buttons-column/screenshots';

async function expectPauseViewportCoverage(page: Page) {
  const coverage = await page.locator('#pause-overlay').evaluate(overlay => {
    const r = overlay.getBoundingClientRect();
    const timer = document.querySelector('#round-timer')?.getBoundingClientRect();
    const topHit = document.elementFromPoint(1, 1);
    const timerHit = timer && document.elementFromPoint(timer.left + timer.width / 2, timer.top + timer.height / 2);
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight,
      coversTop: Boolean(topHit && overlay.contains(topHit)),
      coversTimer: !timer || Boolean(timerHit && overlay.contains(timerHit)),
      backdrop: getComputedStyle(overlay).backdropFilter };
  });
  expect(coverage.left).toBeCloseTo(0, 1);
  expect(coverage.top).toBeCloseTo(0, 1);
  expect(coverage.right).toBeCloseTo(coverage.width, 1);
  expect(coverage.bottom).toBeCloseTo(coverage.height, 1);
  expect(coverage.coversTop).toBe(true);
  expect(coverage.coversTimer).toBe(true);
  expect(coverage.backdrop).toContain('blur(7px)');
}

async function contour(page: Page, selector = '.is-ui-selected') {
  const selected = page.locator(selector).first();
  await expect(selected).toBeVisible();
  await expect(selected).toHaveCSS('outline-style', 'none');
  await expect(selected).toHaveCSS('background-color', 'rgb(139, 212, 246)');
  await expect(selected).toHaveCSS('color', 'rgb(16, 62, 96)');
}

for (const [width, height] of [[1440, 960], [1280, 480], [390, 844], [844, 390]]) {
  test(`menu blue fill stays inside every visible button ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.route('**/api/network/lobbies**', route => route.fulfill({ json: { rooms: [], next: null } }));
    await page.goto('/?muted=1');
    await page.locator('main').waitFor();
    let audited = 0;
    async function audit(screen: string) {
      await page.keyboard.press('Tab');
      const buttons = page.locator('button:visible:not(:disabled)');
      for (const button of await buttons.all()) {
        const before = await button.boundingBox();
        await button.focus();
        await contour(page, 'button:focus');
        const after = await button.boundingBox();
        expect(after?.width).toBe(before?.width);
        expect(after?.height).toBe(before?.height);
        audited++;
      }
      // Return to the first control for a readable screenshot of the same state.
      await page.keyboard.press('ArrowDown');
      await contour(page, '.unified-lobby button:focus, .is-ui-selected');
      if (['main', 'settings', 'network-create'].includes(screen)) {
        await page.screenshot({ path: `${evidence}/${screen}-${width}x${height}.png` });
      }
    }
    await audit('main');
    for (const mode of ['Кто больше', 'Битва', 'Командный бой']) {
      await openLocalLobby(page,mode);
      await audit(mode);
      await page.locator('[data-lobby-back], button#setup-back').click();
    }
    await page.getByRole('button', { name: /^Настройки/ }).click();
    await audit('settings');
    await page.getByRole('button', { name: /^Правила/ }).click();
    await audit('rules');
    await page.locator('#rules-back').click();
    await page.locator('#settings-back').click();
    await page.getByRole('button', { name: /^Сетевая игра/ }).click();
    await audit('network-list');
    await page.getByRole('button', { name: 'Создать лобби', exact: true }).click();
    await audit('network-create');
    expect(audited).toBeGreaterThan(25);
  });
}

test('phone touch clears keyboard and gamepad focus across menu transitions', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const pad = { index: 0, id: 'Standard Controller', connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: 0 };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
    Object.assign(window, { focusTestPad: pad });
  });
  await page.goto('/?muted=1');
  await page.locator('main').waitFor();
  await expect(page.locator('.is-ui-selected')).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#app')).toHaveAttribute('data-input-mode', 'keyboard');
  await contour(page);
  await page.screenshot({ path: `${evidence}/phone-keyboard.png` });
  await page.getByRole('button', { name: /^Настройки/ }).tap();
  await expect(page.locator('#app')).toHaveAttribute('data-input-mode', 'pointer');
  await expect(page.locator('.is-ui-selected')).toHaveCount(0);
  expect(await page.locator('button:focus').evaluateAll(buttons => buttons.every(button => getComputedStyle(button).outlineStyle === 'none'))).toBe(true);
  await page.screenshot({ path: `${evidence}/phone-touch.png` });
  await page.keyboard.press('Tab');
  await expect(page.locator('#app')).toHaveAttribute('data-input-mode', 'keyboard');
  await contour(page, 'button:focus');
  await page.locator('#settings-back').tap();
  await page.evaluate(() => { (window as any).focusTestPad.buttons[13].pressed = true; });
  await expect(page.locator('#app')).toHaveAttribute('data-input-mode', 'gamepad');
  await contour(page);
  await page.evaluate(() => { (window as any).focusTestPad.buttons[13].pressed = false; });
  await page.screenshot({ path: `${evidence}/phone-gamepad.png` });
  await page.locator('[data-play-entry]').tap();
  await expect(page.locator('.is-ui-selected')).toHaveCount(0);
  await page.locator('[data-cycle-mode]').tap();
  await expect(page.locator('.is-ui-selected')).toHaveCount(0);
  await context.close();
});

for (const [width, height] of [[1440, 960], [1280, 480], [390, 844], [844, 390]]) {
  test(`pause buttons use the blue menu focus ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto('/?muted=1');
    await openLocalLobby(page,'survival');
    await page.locator('#start-match').click();
    await expect(page.locator('.arena-screen #game-canvas canvas')).toBeVisible();
    await expect(page.locator('.match-loading')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-overlay')).toBeVisible();
    await expectPauseViewportCoverage(page);
    const layout = await page.locator('#pause-menu-panel').evaluate(panel => {
      const controls = [...panel.querySelectorAll<HTMLElement>('button')].filter(b => b.getClientRects().length);
      const rects = controls.map(b => b.getBoundingClientRect());
      const scale = rects[0]!.width / controls[0]!.offsetWidth;
      return {
        count: controls.length,
        widths: rects.map(r => r.width),
        lefts: rects.map(r => r.left),
        gaps: rects.slice(1).map((r, i) => (r.top - rects[i]!.bottom) / scale),
        clipped: controls.filter(b => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1 || getComputedStyle(b).textOverflow === 'ellipsis').map(b => b.id),
        offscreen: rects.filter(r => r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1).length,
        minimumHeights: controls.map(b => getComputedStyle(b).minHeight),
      };
    });
    expect(layout.count).toBe(4);
    for (const w of layout.widths) expect(w).toBeCloseTo(layout.widths[0]!, 1);
    for (const left of layout.lefts) expect(left).toBeCloseTo(layout.lefts[0]!, 1);
    for (const gap of layout.gaps) expect(gap).toBeCloseTo(8, 1);
    expect(layout.clipped).toEqual([]);
    expect(layout.offscreen).toBe(0);
    expect(layout.minimumHeights).toEqual(['44px', '44px', '44px', '44px']);
    await page.keyboard.press('Tab');
    for (const button of await page.locator('#pause-overlay button:visible:not(:disabled)').all()) {
      await button.focus();
      await contour(page, '#pause-overlay button:focus');
    }
    await page.keyboard.press('ArrowUp');
    await page.screenshot({ path: `${pauseScreenshots}/pause-${width}x${height}.png` });
    await page.locator('#pause-settings').click();
    await expect(page.locator('#pause-settings-panel')).toBeVisible();
    await expectPauseViewportCoverage(page);
    await page.screenshot({ path: `${pauseScreenshots}/settings-${width}x${height}.png` });
    await page.locator('#pause-settings-back').click();
    await expectPauseViewportCoverage(page);
    await page.locator('#continue-match').click();
    await expect(page.locator('#pause-overlay')).toBeHidden();
  });
}
