import { expect, test, type Page } from '@playwright/test';

async function track(page: Page) {
  await page.addInitScript(() => {
    const state = (window as any).__startupLoading = { shown: 0, removed: 0, menuReady: false };
    new MutationObserver(records => {
      for (const record of records) for (const node of record.removedNodes) {
        if (node instanceof HTMLElement && node.id === 'startup-loading') {
          state.shown = Number(node.dataset.shownAt); state.removed = performance.now();
          state.menuReady = !!document.querySelector('.main-menu-screen') && !document.querySelector<HTMLElement>('#app')!.inert;
        }
      }
    }).observe(document, { subtree: true, childList: true });
  });
}
for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 480 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`workshop startup paints for two seconds and reveals ready menu ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await track(page); await page.goto('/?muted=1');
    const loading = page.locator('#startup-loading'); await expect(loading).toBeVisible();
    await expect(loading.getByRole('heading')).toHaveAttribute('aria-label', 'Bricks War');
    await expect(loading.locator('p')).toHaveText('Загружаем игру');
    await expect(loading.locator('footer')).toHaveText('© 2026 Evgeniy Afonasev · afonasev.tech');
    expect(await page.locator('#app').evaluate((el: HTMLElement) => el.inert)).toBe(true);
    expect(await loading.locator('.startup-loading-backdrop').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const artRatio = await loading.locator('.startup-loading-backdrop').evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
    if (viewport.width <= 600) expect(artRatio).toBeLessThan(1); else expect(artRatio).toBeGreaterThan(1);
    const layout = await loading.evaluate(el => {
      const nodes = [...el.querySelectorAll<HTMLElement>('h1,p,.startup-loading-indicator,footer')];
      const rects = nodes.map(e => e.getBoundingClientRect());
      return { readable: nodes.every(e => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1),
        inside: rects.every(r => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight),
        overlaps: rects.some((r,i) => rects.slice(i+1).some(q => Math.min(r.right,q.right)-Math.max(r.left,q.left)>1 && Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)) };
    });
    await page.screenshot({ path: `${process.env.BRICKS_STARTUP_SCREENSHOTS ?? 'evidence/add-workshop-startup-loading'}/startup-${viewport.width}x${viewport.height}.png` });
    const metrics = await loading.locator('h1,p,.startup-loading-indicator,footer').evaluateAll(nodes => nodes.map(el => ({ tag: el.tagName, sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight, font: getComputedStyle(el).fontFamily })));
    expect(layout, JSON.stringify(metrics)).toEqual({ readable: true, inside: true, overlaps: false });
    await expect(loading).toHaveCount(0); await expect(page.getByRole('navigation', { name: 'Главное меню' })).toBeVisible();
    const state = await page.evaluate(() => (window as any).__startupLoading);
    expect(state.shown).toBeGreaterThan(0); expect(state.removed-state.shown).toBeGreaterThanOrEqual(2000); expect(state.menuReady).toBe(true);
    await page.getByRole('button', { name: /^Настройки/ }).click(); await page.locator('#settings-back').click();
    await expect(page.getByRole('navigation', { name: 'Главное меню' })).toBeVisible(); await expect(loading).toHaveCount(0);
  });
}

test('slow module loading keeps the HTML workshop visible without another fixed wait', async ({ page }) => {
  await track(page);
  await page.route('**/?muted=1', async route => {
    const response = await route.fetch(); const html = await response.text();
    expect(html).toContain('<script type="module" crossorigin>');
    await route.fulfill({ response, body: html.replace('<script type="module" crossorigin>', '<script type="module" crossorigin>await new Promise(resolve => setTimeout(resolve, 4500));') });
  });
  await page.goto('/?muted=1', { waitUntil: 'commit' });
  await expect(page.locator('#startup-loading')).toBeVisible();
  await page.waitForTimeout(2600); await expect(page.locator('#startup-loading')).toBeVisible();
  await expect(page.locator('#startup-loading')).toHaveCount(0, { timeout: 7000 });
  const state = await page.evaluate(() => (window as any).__startupLoading);
  expect(state.removed-state.shown).toBeGreaterThanOrEqual(4000);
  expect(state.removed-state.shown).toBeLessThan(6000); expect(state.menuReady).toBe(true);
});

test('failure during startup immediately exposes recovery and never starts a stale menu', async ({ page }) => {
  await page.goto('/?muted=1'); await expect(page.locator('#startup-loading')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'Startup loading failure', error: new Error('Startup loading failure') })));
  await expect(page.locator('#startup-loading')).toHaveCount(0);
  await expect(page.locator('#startup-error')).toContainText('Startup loading failure');
  expect(await page.locator('#app').evaluate((el: HTMLElement) => el.inert)).toBe(false);
  await page.waitForTimeout(2400); await expect(page.locator('.main-menu-screen')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeEnabled();
});

test('reduced motion keeps a static workshop and the two-second minimum', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await track(page); await page.goto('/?muted=1');
  await expect(page.locator('#startup-loading')).toBeVisible();
  expect(await page.locator('.startup-loading-indicator i').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await expect(page.locator('#startup-loading')).toHaveCount(0);
  const state = await page.evaluate(() => (window as any).__startupLoading); expect(state.removed-state.shown).toBeGreaterThanOrEqual(2000);
});

test('keyboard and gamepad input cannot activate an unseen menu', async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { id: 'Loading QA pad', connected: true, index: 0, axes: [0,0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })), mapping: 'standard', timestamp: 0 };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
    (window as any).__pressLoadingPad = (pressed: boolean) => { pad.buttons[0] = { pressed, touched: pressed, value: pressed ? 1 : 0 }; };
  });
  await page.goto('/?muted=1'); await expect(page.locator('#startup-loading')).toBeVisible();
  await page.keyboard.press('Enter'); await page.evaluate(() => (window as any).__pressLoadingPad(true));
  await page.waitForTimeout(200); await expect(page.locator('.main-menu-screen')).toHaveCount(0);
  await page.evaluate(() => (window as any).__pressLoadingPad(false));
  await expect(page.locator('#startup-loading')).toHaveCount(0); await expect(page.locator('.main-menu-screen')).toBeVisible();
  await expect(page.locator('#start-match')).toHaveCount(0);
});
