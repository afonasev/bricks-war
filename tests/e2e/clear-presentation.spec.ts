import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Uses the configured preview server and its local deterministic scenarios.

async function openFire(page: Page, lines: number): Promise<void> {
  await page.goto(`/?playtest-clear=fire-${lines}&muted=1`);
  await page.getByRole('button', { name: /^Выживание/ }).click();
  const removeSecond = page.getByRole('button', { name: 'Удалить Игрок 2' });
  if (await removeSecond.count()) await removeSecond.click();
  await page.locator('#start-match').click();
  const score = [0, 100, 300, 500, 800][lines];
  await page.waitForFunction((expected) => document.querySelector('#hud-grid')?.textContent?.includes(`${expected} очков`), score);
  await expect.poll(async()=>Number(await page.locator('#game-stage').getAttribute('data-burn-remaining-ms'))).toBeGreaterThan(0);
}

async function startCycle(page: Page, mode: 'normal' | 'fire', lines: number): Promise<void> {
  await page.goto(`/?playtest-clear=${mode}-${lines}&muted=1`);
  await page.getByRole('button', { name: /^Выживание/ }).click();
  const removeSecond = page.getByRole('button', { name: 'Удалить Игрок 2' });
  if (await removeSecond.count()) await removeSecond.click();
  await page.locator('#start-match').click();
}

async function saveReviewFrame(page: Page, name: string): Promise<void> {
  const directory = process.env.BRICKS_F3_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name) });
}

async function waitClearPhase(page: Page, phase: string): Promise<void> {
  await page.waitForFunction((expected) => document.querySelector('#game-stage')?.getAttribute('data-clear-phase') === expected, phase);
}

test('keeps authoritative HUD and field changes at each visual landing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startCycle(page, 'normal', 2);
  const stage = page.locator('#game-stage');
  await waitClearPhase(page, 'highlight');
  await expect(page.locator('#hud-grid')).toContainText('0 очков');
  await saveReviewFrame(page, 'wide-f3-normal-before.png');
  await waitClearPhase(page, 'fall');
  await expect(page.locator('#hud-grid')).toContainText('0 очков');
  await saveReviewFrame(page, 'wide-f3-normal-fall.png');
  await waitClearPhase(page, '');
  await expect(page.locator('#hud-grid')).toContainText('300 очков');
  await saveReviewFrame(page, 'wide-f3-normal-after.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await startCycle(page, 'fire', 4);
  await waitClearPhase(page, 'highlight');
  await expect(page.locator('#hud-grid')).toContainText('0 очков');
  await saveReviewFrame(page, 'phone-f3-fire-before.png');
  await expect.poll(async () => Number(await stage.getAttribute('data-burn-remaining-ms'))).toBeGreaterThan(0);
  await expect(page.locator('#hud-grid')).toContainText('800 очков');
  await saveReviewFrame(page, 'phone-f3-fire-burn.png');
  await waitClearPhase(page, 'fall');
  await saveReviewFrame(page, 'phone-f3-fire-fall.png');
  await waitClearPhase(page, '');
  await saveReviewFrame(page, 'phone-f3-fire-after.png');
});

test('pauses the real burn frame and resumes its remaining time', async ({ page }) => {
  await openFire(page, 2);
  await page.waitForTimeout(220);
  await page.locator('#manual-pause').click();
  await expect(page.locator('#pause-overlay')).toBeVisible();
  const stage = page.locator('#game-stage');
  const paused = Number(await stage.getAttribute('data-burn-remaining-ms'));
  expect(paused).toBeGreaterThan(0);
  await page.waitForTimeout(370);
  expect(Number(await stage.getAttribute('data-burn-remaining-ms'))).toBe(paused);
  await page.locator('#continue-match').click();
  await expect(page.locator('#pause-overlay')).toBeHidden();
  await expect.poll(async () => Number(await stage.getAttribute('data-burn-remaining-ms'))).toBeLessThan(paused);
  await expect(page.getByText('Сгорит рядов: 2')).toHaveCount(0, { timeout: 3_000 });
});

test('keeps the burn band stable with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFire(page, 4);
  await page.waitForTimeout(120);
  const card = await page.locator('.hud-card').boundingBox();
  expect(card).not.toBeNull();
  const clip = {
    x: Math.floor(card!.x + 8),
    y: Math.floor(card!.y + card!.height - 4 * ((card!.width - 8) / 10) - 3),
    width: Math.floor(card!.width - 16),
    height: Math.floor(4 * ((card!.width - 8) / 10)),
  };
  const first = await page.screenshot({ clip });
  await page.waitForTimeout(230);
  expect((await page.screenshot({ clip })).equals(first)).toBe(true);
});

test('freezes the burn while the tab is hidden', async ({ page }) => {
  await openFire(page, 1);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const stage = page.locator('#game-stage');
  const hiddenMs = Number(await stage.getAttribute('data-burn-remaining-ms'));
  await page.waitForTimeout(330);
  expect(Number(await stage.getAttribute('data-burn-remaining-ms'))).toBe(hiddenMs);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => Number(await stage.getAttribute('data-burn-remaining-ms'))).toBeLessThan(hiddenMs);
});
