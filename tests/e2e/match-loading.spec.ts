import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, mode = 'Выживание'): Promise<void> {
  await page.goto('/?muted=1');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.getByRole('button', { name: new RegExp(`^${mode}`) }).click();
  if (mode !== 'Выживание') {
    for (let i = 0; i < 4; i++) {
      const add = page.locator('.participant-card').nth(i).getByRole('button', { name: 'Добавить ИИ' });
      if (await add.count()) await add.click();
    }
  }
}
async function observe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const samples = { appeared: 0, removed: 0, count: 0, readyCountdown: '', canvasAtRelease: false };
    (window as any).__loadingSamples = samples;
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof Element && node.matches('.match-loading')) { samples.appeared = performance.now(); samples.count++; }
        for (const node of record.removedNodes) if (node instanceof Element && node.matches('.match-loading')) {
          samples.removed = performance.now();
          samples.canvasAtRelease = !!document.querySelector('#game-canvas canvas');
          samples.readyCountdown = document.querySelector('#countdown')?.textContent ?? '';
        }
      }
    }).observe(document.body, { childList: true });
  });
}

for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 480 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`loading paints, stays one second and reveals a fresh countdown ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const mode of (viewport.width <= 760 || (viewport.width <= 900 && viewport.height <= 600)) ? ['Выживание', 'Битва'] : ['Выживание', 'Битва', 'Командный бой']) {
      await setup(page, mode); await observe(page);
      await page.locator('#start-match').click();
      const loading = page.locator('.match-loading'); await expect(loading).toBeVisible();
      await expect(loading.getByRole('heading')).toHaveText('Собираем арену');
      // Countdown remains full while the actual Phaser scene renders behind loading.
      await expect(page.locator('#game-canvas canvas')).toHaveCount(1);
      await expect(page.locator('#countdown')).toBeHidden();
      await expect(page.locator('#countdown')).toHaveText('3');
      const layout = await loading.evaluate(el => {
        const targets = [...el.querySelectorAll<HTMLElement>('.match-loading-brand,h1,p,.match-loading-pattern,.match-loading-indicator')];
        const rects = targets.map(e => e.getBoundingClientRect());
        return { readable: targets.every(e => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1),
          inside: rects.every(r => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight),
          overlaps: rects.some((r, i) => rects.slice(i + 1).some(q => Math.min(r.right, q.right) - Math.max(r.left, q.left) > 1 && Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top) > 1)) };
      });
      expect(layout).toEqual({ readable: true, inside: true, overlaps: false });
      if (mode === 'Выживание') await page.screenshot({ path: `evidence/add-match-loading-screen/screenshots/loading-${viewport.width}x${viewport.height}.png` });
      await expect(loading).toHaveCount(0);
      await expect(page.locator('#countdown')).toBeVisible(); await expect(page.locator('#countdown')).toHaveText('3');
      const samples = await page.evaluate(() => (window as any).__loadingSamples);
      expect(samples.count).toBe(1); expect(samples.removed - samples.appeared).toBeGreaterThanOrEqual(1_000);
      expect(samples.canvasAtRelease).toBe(true); expect(samples.readyCountdown).toBe('3');
    }
  });
}

test('repeated Start initializes once and Escape cancels pending preparation', async ({ page }) => {
  await setup(page); await observe(page);
  await page.locator('#start-match').evaluate((el: HTMLButtonElement) => { el.click(); el.click(); el.click(); });
  await expect(page.locator('.match-loading')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.match-loading')).toHaveCount(0); await expect(page.locator('#start-match')).toBeVisible();
  await page.waitForTimeout(1_200); await expect(page.locator('canvas')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__loadingSamples.count)).toBe(1);
});

test('reduced motion is static, startup errors clear loading, and a rematch loads afresh', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await setup(page);
  await page.locator('#start-match').click(); await expect(page.locator('.match-loading')).toBeVisible();
  expect(await page.locator('.loading-piece').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.screenshot({ path: 'evidence/add-match-loading-screen/screenshots/loading-reduced-motion.png' });
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'Loading QA failure', error: new Error('Loading QA failure') })));
  await expect(page.locator('.match-loading')).toHaveCount(0); await expect(page.locator('#startup-error')).toContainText('Loading QA failure');
  await setup(page); await page.locator('#start-match').click(); await expect(page.locator('.match-loading')).toHaveCount(0);
  await expect(page.locator('#countdown')).toBeHidden({ timeout: 6_000 });
  await page.getByRole('button', { name: 'Поставить матч на паузу' }).click();
  await page.locator('#restart-match').click(); await expect(page.locator('.match-loading')).toBeVisible();
  await expect(page.locator('.match-loading')).toHaveCount(0); await expect(page.locator('#countdown')).toHaveText('3');
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('keyboard Start preserves the running audio context across deferred initialization', async ({ page }) => {
  await page.addInitScript(() => {
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(options?: AudioContextOptions) { super(options); (window as any).__loadingAudioContext = this; }
    };
  });
  await page.goto('/'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.getByRole('button', { name: /^Выживание/ }).click();
  await page.locator('#start-match').hover(); await page.keyboard.press('Enter');
  await expect(page.locator('.match-loading')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__loadingAudioContext?.state)).toBe('running');
  await expect(page.locator('.match-loading')).toHaveCount(0); await expect(page.locator('#countdown')).toHaveText('3');
  expect(await page.evaluate(() => (window as any).__loadingAudioContext.state)).toBe('running');
});
