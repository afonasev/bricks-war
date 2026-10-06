import { test, expect } from '@playwright/test';
// @ts-expect-error Node-only release fixture has no TS declaration.
import { startClientUpdateServer } from '../helpers/clientUpdateServer.mjs';
// This scenario requires no ready web update. Real PWA discovery/priority is covered by client-update.spec.ts.
test.use({ serviceWorkers: 'block' });
test('desktop download automatically selects OS and stays absent on phone', async ({ page }) => {
  await page.route('**/desktop/latest.json', route => route.fulfill({ json: {
    mac: { url: 'https://github.com/afonasev/bricks-war/releases/download/v1.1.1/Bricks-War-1.1.1-mac-universal.dmg' },
    win: { url: 'https://github.com/afonasev/bricks-war/releases/download/v1.1.1/Bricks-War-1.1.1-win-x64.exe' },
  } }));
  await page.goto('/?muted=1');
  const download = page.getByRole('button', { name: 'Скачать игру для установки' });
  await expect(download).toBeVisible();
  const platform = await page.evaluate(() => navigator.platform);
  await page.route('https://github.com/afonasev/bricks-war/releases/download/**', route => route.fulfill({ body: 'installer fixture', contentType: 'application/octet-stream', headers: { 'Content-Disposition': 'attachment' } }));
  const downloaded = page.waitForEvent('download');
  await download.click();
  expect((await downloaded).url()).toMatch(new RegExp(platform.includes('Mac') ? 'mac-universal.dmg$' : 'win-x64.exe$'));
  await expect(page.locator('#desktop-exit')).toHaveCount(0);
  for (const [width, height] of [[1440, 960], [1280, 480]]) {
    await page.setViewportSize({ width: width!, height: height! });
    const overlap = await download.evaluate(link => {
      const a = link.getBoundingClientRect(), h = document.querySelector('.main-menu-brand h1')!.getBoundingClientRect();
      return a.right > innerWidth || a.bottom > innerHeight || (Math.min(a.right,h.right)-Math.max(a.left,h.left)>1 && Math.min(a.bottom,h.bottom)-Math.max(a.top,h.top)>1);
    });
    expect(overlap).toBe(false);
    await page.screenshot({ path: `evidence/block-browser-actions/web-download-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // The download catalog must not expose the desktop installation action on the phone layout.
  await expect(download).toBeHidden();
  await expect(page.locator('#desktop-resolution')).toHaveCount(0);
  await page.screenshot({ path: 'evidence/block-browser-actions/web-phone.png' });
});

test.describe('download and real PWA priority', () => {
  test.use({ serviceWorkers: 'allow' });
  test('a ready web release replaces the download action', async ({ page }) => {
    const server = await startClientUpdateServer();
    try {
      server.setRelease('A');
      await page.route('**/desktop/latest.json', route => route.fulfill({ json: {
        mac: { url: '/desktop/installers/current.dmg' }, win: { url: '/desktop/installers/current.exe' },
      } }));
      await page.goto(`${server.origin}/?muted=1`);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.reload();
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      await expect(page.locator('.desktop-download')).toBeVisible();
      server.setRelease('B');
      await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update(); });
      await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeVisible();
      await expect(page.locator('.desktop-download')).toBeHidden();
      await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'A');
    } finally { await server.close(); }
  });
});
