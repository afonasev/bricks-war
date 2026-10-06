import { expect, test, type Page } from '@playwright/test';
// @ts-expect-error Test-only Node fixture has no TS declaration.
import { startClientUpdateServer } from '../helpers/clientUpdateServer.mjs';

let server: Awaited<ReturnType<typeof startClientUpdateServer>>;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { server = await startClientUpdateServer(); });
test.afterAll(async () => { await server?.close(); });
test.beforeEach(() => { server.setRelease('A'); });

async function loadControlled(page: Page) {
  await page.goto(`${server.origin}/?muted=1`);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'A');
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeHidden();
  await expect(page.locator('.client-update-announcement')).toBeHidden();
}
async function discover(page: Page) {
  server.setRelease('B');
  await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; await r.update(); });
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting)).toBe(true);
}

for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 480 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`manual update fits ${viewport.width}x${viewport.height}, applies new shell and retains offline settings`, async ({ page, context }) => {
    await page.setViewportSize(viewport); await loadControlled(page);
    await page.evaluate(() => localStorage.setItem('qa-settings-preserved', 'yes'));
    const firstChoice = page.locator('[data-destination="survival"]');
    const choiceBeforeUpdate = await firstChoice.boundingBox();
    await discover(page);
    const button = page.getByRole('button', { name: 'Обновить', exact: true });
    await expect(button).toBeVisible(); await expect(button).toBeEnabled();
    await expect(page.locator('.client-update-announcement')).toHaveText('Вышла новая версия игры, готовы обновиться?');
    await expect(page.locator('.client-update-announcement')).toBeVisible();
    if (viewport.width > 900) expect(await firstChoice.boundingBox()).toEqual(choiceBeforeUpdate);
    await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'A');
    const layout = await page.locator('.main-menu-screen').evaluate(screen => {
      const candidates = [...screen.querySelectorAll<HTMLElement>('button, .client-update-announcement, .client-update-slot, .main-menu-brand, .main-menu-brand h1, .release-guidance-footer')]
        .filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height && !e.hidden && !e.closest('[hidden]'));
      const rects = candidates.map(e => ({ element: e, name: e.textContent?.trim(), rect: e.getBoundingClientRect().toJSON() }));
      const overlaps = rects.flatMap((a, i) => rects.slice(i + 1).filter(b => Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1 && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1 && !a.element.contains(b.element) && !b.element.contains(a.element)).map(b => [a.name, b.name]));
      const clipped = candidates.filter(e => {
        const r = e.getBoundingClientRect(); return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || (e.matches('.client-update-button') && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1));
      }).map(e => e.textContent?.trim());
      const textClipped = [...screen.querySelectorAll<HTMLElement>('.mode-copy strong, .mode-copy small, .client-update-button, .client-update-announcement')].filter(e => {
        if (!e.getBoundingClientRect().width || e.closest('[hidden]')) return false;
        const range = document.createRange(); range.selectNodeContents(e);
        const text = range.getBoundingClientRect(), box = (e.closest('button') ?? e).getBoundingClientRect();
        return text.left < box.left || text.right > box.right || text.top < box.top || text.bottom > box.bottom || getComputedStyle(e).textOverflow === 'ellipsis';
      }).map(e => e.textContent?.trim());
      return { overlaps, clipped, textClipped };
    });
    expect(layout).toEqual({ overlaps: [], clipped: [], textClipped: [] });
    await page.screenshot({ path: `evidence/add-client-update-button/menu-${viewport.width}x${viewport.height}.png` });
    await button.click();
    await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'B');
    expect(await page.evaluate(() => localStorage.getItem('qa-settings-preserved'))).toBe('yes');
    await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeHidden();
    await context.setOffline(true); await page.reload();
    await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'B');
    await expect(page.getByRole('button', { name: /^Выживание/ })).toBeVisible();
  });
}

test('other tab update never reloads a local match and offers refresh on return to menu', async ({ page, context }) => {
  await loadControlled(page);
  const other = await context.newPage(); await loadControlled(other);
  await other.getByRole('button', { name: /^Выживание/ }).click();
  await other.getByRole('button', { name: /^Начать/ }).click();
  await expect(other.locator('#game-stage')).toBeVisible();
  await discover(page); await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'B');
  await expect(other.locator('#game-stage')).toBeVisible();
  await expect(other.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'A');
  await other.getByRole('button', { name: 'Поставить матч на паузу' }).click();
  await other.getByRole('button', { name: 'Главное меню', exact: true }).click();
  const update = other.getByRole('button', { name: 'Обновить', exact: true });
  await expect(update).toBeVisible(); await update.click();
  await expect(other.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'B');
});

test('network guard does not queue automatic activation after release', async ({ page }) => {
  await loadControlled(page); await discover(page);
  await page.evaluate(() => { localStorage.setItem('bricks-network-active-qa', String(Date.now() + 36_000)); dispatchEvent(new StorageEvent('storage')); });
  const update = page.getByRole('button', { name: 'Обновить', exact: true });
  await expect(update).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText('Сначала завершите сетевую игру');
  for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 480 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const statusLayout = await page.locator('.client-update-status').evaluate(e => {
      const r = e.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(e); const text = range.getBoundingClientRect();
      const peers = [...document.querySelectorAll('.main-menu-brand h1, .mode-choice, .release-guidance-footer')].filter(x => x.getBoundingClientRect().width);
      return { clipped: text.left < r.left || text.right > r.right + 1 || text.top < r.top || text.bottom > r.bottom + 1 || r.right > innerWidth || r.bottom > innerHeight,
        overlapping: peers.some(x => { const b = x.getBoundingClientRect(); return Math.min(r.right, b.right) - Math.max(r.left, b.left) > 1 && Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 1; }) };
    });
    expect(statusLayout).toEqual({ clipped: false, overlapping: false });
  }
  await page.evaluate(() => { localStorage.removeItem('bricks-network-active-qa'); dispatchEvent(new StorageEvent('storage')); });
  await expect(update).toBeEnabled();
  await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'A');
  await update.click(); await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'B');
});

 test('visible online client discovers downloaded release through its minute timer', async ({ page }) => {
  await loadControlled(page);
  await page.clock.install();
  server.setRelease('B');
  await page.clock.fastForward(60_001);
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeVisible();
  await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'A');
});

test('new header action preserves the existing keyboard selection', async ({ page }) => {
  await loadControlled(page);
  await expect(page.locator('.is-ui-selected')).toContainText('Выживание');
  await discover(page);
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Начать/ })).toBeVisible();
  await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'A');
});
