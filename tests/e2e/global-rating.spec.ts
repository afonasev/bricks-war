import { chooseLobbyStyle } from '../helpers/lobbyStyle';
import { GLOBAL_RATING_RULESET } from '../../src/domain/globalRating';
import { openLocalLobby } from '../helpers/localLobby';
import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe.configure({ mode: 'serial' });
const port = Number(process.env.BRICKS_NETWORK_PORT ?? 4391);
const origin = `http://127.0.0.1:${port}`;
const evidence = process.env.BRICKS_RATING_EVIDENCE_DIR ?? 'evidence/add-global-survival-rating/screenshots';
let runtime: ChildProcess;
let directory: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'bricks-rating-browser-'));
  runtime = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, BRICKS_NETWORK_PORT: String(port), BRICKS_RATING_FILE: join(directory, 'rating.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => { runtime.stdout!.once('data', () => resolve()); runtime.once('exit', code => reject(new Error(`Server exited ${code}`))); runtime.once('error', reject); });
  const submit = async (attempts: unknown[]) => { const response = await fetch(`${origin}/api/network/rating-submit`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ attempts, ruleset: GLOBAL_RATING_RULESET }) }); expect(response.ok).toBe(true); };
  for (let i = 0; i < 12; i++) await submit([{ name: `Лидер ${i + 1}`, lineScore: 10000 - i * 100, elapsedMs: 300000, finishedAt: 1700000000000 }]);
  await submit([{ name: 'Алексей', lineScore: 500, elapsedMs: 60000, finishedAt: 1700000000000 }, { name: 'Лена', lineScore: 400, elapsedMs: 50000, finishedAt: 1700000000000 }]);
  await mkdir(evidence, { recursive: true });
});
test.afterAll(async () => {
  if (runtime && runtime.exitCode === null) { runtime.kill('SIGTERM'); await new Promise<void>(resolve => runtime.once('exit', () => resolve())); }
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function setup(page: Page, width: number, height: number, gamepad = false) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(({ gamepad }) => {
    localStorage.setItem('bricks-war:player-names:v1', JSON.stringify(['Алексей', 'Лена', 'P3', 'P4']));
    localStorage.setItem('bricks-war:solo-records:v1', JSON.stringify([{ id: 'old', name: 'LegacyOnly', lineScore: 999999, elapsedMs: 1000, finishedAt: 1700000000000 }]));
    if (gamepad) {
      const pad = { index: 0, id: 'Standard Controller', connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0, touched: false })), timestamp: 0 };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
      Object.assign(window, { ratingTestPad: pad });
    }
  }, { gamepad });
  await page.goto('/?muted=1&playtest-fast=20');
  if (gamepad) {
    await expect(page.locator('[data-play-entry]')).toBeVisible();
    await ratingPadPress(page, 0);
    await expect(page.locator('.unified-lobby')).toBeVisible();
    await expect(page.locator('[data-edit="0"] [data-controller="gamepad"]')).toHaveCount(1);
    // The owning pad starts on the mode control; cycle Battle → Teams → Survival.
    await ratingPadPress(page, 0); await ratingPadPress(page, 0);
    await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','survival');
  } else await openLocalLobby(page,'survival');
  // The unified lobby starts with one human; join the second through its current public editor.
  if (width !== 390) {
    if (gamepad) await page.keyboard.press('w'); else await page.locator('[data-join]').first().click();
    await page.locator('[data-create-name]').click();
    await page.locator('[data-typing-name]').fill('Лена');
    await page.locator('[data-typed-done]').click();
    await chooseLobbyStyle(page, 'classic');
  }
}

async function ratingPadPress(page: Page, button: number) {
  await page.evaluate(b => { (window as any).ratingTestPad.buttons[b] = {pressed:true,value:1}; }, button);
  await page.waitForTimeout(110);
  await page.evaluate(b => { (window as any).ratingTestPad.buttons[b] = {pressed:false,value:0}; }, button);
  await page.waitForTimeout(110);
}

async function openRating(page: Page, gamepad = false) {
  if (!(await page.locator('[data-rating="global"]:visible').count())) {
    if (gamepad) { await ratingPadPress(page,15); await ratingPadPress(page,0); }
    else await page.locator('[data-open-rating]').click();
  }
}

async function expectLayout(page: Page) {
  const issues = await page.locator('[data-rating-view="global"]').evaluate(panel => {
    const errors: string[] = [];
    for (const el of panel.querySelectorAll<HTMLElement>('.rating-switch button,.global-rating-list li')) {
      const box = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1) errors.push(`clipped: ${el.textContent}`);
      if (box.left < 0 || box.right > innerWidth) errors.push(`offscreen: ${el.textContent}`);
      for (const part of el.querySelectorAll<HTMLElement>('strong,time,.result-place')) {
        const range = document.createRange(); range.selectNodeContents(part);
        if (part.classList.contains('result-place') && range.getClientRects().length > 1) errors.push(`wrapped rank: ${part.textContent}`);
        if (range.getBoundingClientRect().width > part.getBoundingClientRect().width + 1) errors.push(`text: ${part.textContent}`);
      }
    }
    const controls = [...panel.querySelectorAll<HTMLElement>('.rating-switch button')];
    const rows = [...panel.querySelectorAll<HTMLElement>('.global-rating-list li')];
    const content = panel.querySelector('.rating-global-content')!.getBoundingClientRect();
    for (const row of rows) {
      const box = row.getBoundingClientRect();
      if (box.top < content.top - 1 || box.bottom > content.bottom + 1 || box.top < 0 || box.bottom > innerHeight) errors.push(`row not visible: ${row.textContent}`);
    }
    for (const control of controls) for (const row of rows) {
      const a = control.getBoundingClientRect(), b = row.getBoundingClientRect();
      if (Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1) errors.push('overlap');
    }
    return errors;
  });
  expect(issues).toEqual([]);
}

for (const [width, height, gamepad] of [[1440, 960, false], [390, 844, false], [1600, 900, true]] as const) {
  test(`additional rating, real ranks and local records preserved ${width}`, async ({ page }) => {
    await setup(page, width, height, gamepad);
    await openRating(page,gamepad);
    await expect(page.locator('.rating-local-content')).toContainText('LegacyOnly');
    if (gamepad) {
      // The global tab sits directly below the top-right close control; move down, then actual A.
      await ratingPadPress(page,13);
      await expect(page.locator('[data-rating="global"]:visible')).toBeFocused();
      await page.evaluate(() => { (window as any).ratingTestPad.buttons[0] = { pressed: true, touched: true, value: 1 }; });
      await expect(page.locator('[data-rating="global"]:visible')).toHaveAttribute('aria-pressed', 'true');
      await page.evaluate(() => { (window as any).ratingTestPad.buttons[0] = { pressed: false, touched: false, value: 0 }; });
    } else await page.locator('[data-rating="global"]:visible').click();
    const rows = page.locator('.global-rating-list:visible li');
    await expect(rows).toHaveCount(width === 390 ? 11 : 12);
    await expect(rows.nth(10)).toContainText('#13');
    await expect(rows.nth(10)).toContainText('Алексей');
    if (width !== 390) await expect(rows.nth(11)).toContainText('#14');
    await expect(page.locator('.rating-global-content')).not.toContainText('LegacyOnly');
    await expectLayout(page);
    await page.screenshot({ path: `${evidence}/setup-global-${width}.png` });
    if (gamepad) { await ratingPadPress(page,14); await ratingPadPress(page,0); }
    else await page.locator('[data-rating="local"]:visible').click();
    await expect(page.locator('.rating-local-content:visible ol')).toBeVisible();
    await expect(page.locator('.rating-local-content')).toContainText('LegacyOnly');
  });
}

test('new completed match queues every participant offline, survives reload and uploads on online event', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    let observed = false;
    new MutationObserver(() => {
      const button = document.querySelector<HTMLButtonElement>('.results-panel [data-rating="global"]');
      if (!button || observed) return;
      observed = true; button.click();
      Object.assign(window, { ratingGuardView: button.closest('[data-rating-view]')?.getAttribute('data-rating-view') });
    }).observe(document, { subtree: true, childList: true });
  });
  await setup(page, 1440, 960);
  let unavailable = true;
  await page.route('**/api/network/rating-submit', async route => { if (unavailable) await route.abort(); else await route.continue(); });
  await page.locator('#start-match').click();
  await page.keyboard.down('s'); await page.keyboard.down('ArrowDown');
  await expect(page.locator('.results-panel')).toBeVisible({ timeout: 36000 });
  await page.keyboard.up('s'); await page.keyboard.up('ArrowDown');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bricks-war:global-rating-outbox:survival-pressure-v2') ?? '[]').length)).toBe(2);
  await expect(page.locator('#play-again')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).ratingGuardView)).toBe('local');
  await page.locator('[data-rating="global"]:visible').click();
  await expect(page.locator('.global-rating-list:visible li')).toHaveCount(12);
  await expectLayout(page);
  await page.screenshot({ path: `${evidence}/results-global-1440.png` });
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bricks-war:global-rating-outbox:survival-pressure-v2') ?? '[]').length)).toBe(2);
  unavailable = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bricks-war:global-rating-outbox:survival-pressure-v2') ?? '[]').length)).toBe(0);
  expect((await (await fetch(`${origin}/api/network/rating`)).json()).top.some((a: { name: string }) => a.name === 'LegacyOnly')).toBe(false);
});

test('phone results switch remains usable and shows the real extra rank', async ({ page }) => {
  test.setTimeout(60000);
  await setup(page, 390, 844);
  await page.locator('#start-match').click();
  await expect(page.locator('.results-panel')).toBeVisible({ timeout: 36000 });
  await expect(page.locator('#play-again')).toBeEnabled();
  await page.locator('[data-rating="global"]:visible').click();
  await expect(page.locator('.global-rating-list:visible li')).toHaveCount(11);
  await expectLayout(page);
  await page.screenshot({ path: `${evidence}/results-global-390.png` });
});
