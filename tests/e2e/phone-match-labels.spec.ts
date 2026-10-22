import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

test.use({ hasTouch: true });

const screenshotRoot = process.env.BRICKS_RECORD_SCREENSHOTS;

if (screenshotRoot) mkdirSync(screenshotRoot, { recursive: true });

async function captureSetup(page: Page, viewport: { width: number; height: number }, screenshot: string): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/?muted=1');
  await page.getByRole('button', { name: /^Битва/ }).click();
  if (screenshotRoot) await page.screenshot({ path: join(screenshotRoot, screenshot), fullPage: true });
}

test('desktop Battle setup remains clear at 1440px', async ({ page }) => {
  await captureSetup(page, { width: 1440, height: 960 }, 'setup-1440.png');
  await expect(page.getByText('От двух до четырёх игроков — каждый за себя', { exact: true })).toBeVisible();
});

test('phone Battle setup and natural Results identify touch control', async ({ page }) => {
  test.setTimeout(240_000);
  await captureSetup(page, { width: 390, height: 844 }, 'setup-390.png');
  await expect(page.getByText('Вы против 1–3 ИИ', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Начать матч', exact: true }).click();
  const loading = page.locator('.match-loading');
  await expect(loading).toBeVisible({ timeout: 15_000 });
  await expect(loading).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.arena-screen')).toBeVisible();
  await expect(page.locator('#countdown')).toHaveText('3');
  await expect(page.locator('canvas')).toHaveCount(1);

  const downZone = page.locator('.mobile-touch-zone-down');
  await expect(downZone).toBeVisible();
  const bounds = await downZone.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  try {
    const results = page.locator('.results-panel');
    await expect(results).toBeVisible({ timeout: 180_000 });
    const playerRow = results.locator('.results-list > li').filter({ hasText: 'Игрок 1' });
    await expect(playerRow).toContainText('СЕНСОРНОЕ УПРАВЛЕНИЕ');
    await expect(playerRow).not.toContainText('ИИ · СРЕДНИЙ');
    if (screenshotRoot) await page.screenshot({ path: join(screenshotRoot, 'results-390.png'), fullPage: true });
  } finally {
    await page.mouse.up();
  }
});
