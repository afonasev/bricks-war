import { openLocalLobby } from '../helpers/localLobby';
import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'evidence/reduce-arena-insets/runtime';

async function pulse(page: Page, button: number) {
  await page.evaluate(button => { (window as any).arenaInsetPad.buttons[button].pressed = true; }, button);
  await page.waitForTimeout(80);
  await page.evaluate(button => { (window as any).arenaInsetPad.buttons[button].pressed = false; }, button);
  await page.waitForTimeout(80);
}

for (const scenario of [
  { name: 'solo', width: 1440, height: 960, count: 1 },
  { name: 'wide-two', width: 1440, height: 960, count: 2 },
  { name: 'wide-three', width: 1440, height: 960, count: 3 },
  { name: 'low-four', width: 1280, height: 480, count: 4 },
  { name: 'dense-controller', width: 960, height: 720, count: 4, controller: true },
  { name: 'phone', width: 390, height: 844, count: 2, mobile: true },
]) test(`larger local fields and decor stay disjoint: ${scenario.name}`, async ({ page }) => {
  await page.setViewportSize({ width: scenario.width, height: scenario.height });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ controller }) => {
    localStorage.setItem('bricks-war:language:v1', 'ru');
    localStorage.setItem('bricks-war:player-names:v1', JSON.stringify(['Саша']));
    if (controller) {
      const pad = { index: 0, id: 'Arena QA virtual pad', mapping: 'standard', connected: true, axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0, touched: false })), timestamp: 0 };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
      Object.assign(window, { arenaInsetPad: pad });
    }
  }, { controller: !!scenario.controller });
  await page.goto('/?muted=1&playtest-anomaly-arrival=1&playtest-arrival-bottom=1&playtest-arrival-capture=500');
  await openLocalLobby(page,scenario.count===1?'survival':'battle');
  let humans = 1;
  if (scenario.controller) {
    await pulse(page, 3);
    await page.locator('[data-draft-name]').fill('Контроллер');
    await page.locator('[data-use-name]').click();
    await page.locator('[data-style="classic"]').click(); humans++;
    await expect(page.locator('[data-controller=gamepad]')).toHaveCount(1);
  }
  for (let i = humans; i < scenario.count; i++) {
    await page.locator('[data-bot]').first().click();
    await page.locator('[data-level="medium"]').click();
    await page.locator('[data-style="classic"]').click();
  }
  await page.locator('#start-match').click();
  await expect(page.locator('.match-loading')).toHaveCount(0);
  await expect(page.locator('#countdown')).toBeHidden();
  if (scenario.count === 1) await expect(page.locator('#arena-event-notice')).toBeHidden({ timeout: 6000 });
  if (scenario.count > 1) await expect(page.locator('#game-stage')).toHaveAttribute('data-arrival-phase', 'burning', { timeout: 10000 });
  if (scenario.controller) await expect(page.locator('.hud-identity [data-controller=gamepad]')).toHaveCount(1);
  const geometry = await page.evaluate(() => {
    const arena = document.querySelector<HTMLElement>('.arena-screen')!;
    const ar = arena.getBoundingClientRect();
    const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const overlap = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => Math.min(a.right, b.right) > Math.max(a.left, b.left) + .1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + .1;
    const contentRect = (element: HTMLElement) => {
      const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const boxes: DOMRect[] = [];
      let node: Node | null;
      while ((node = nodes.nextNode())) if (node.textContent?.trim() && !node.parentElement?.closest('svg')) {
        const range = document.createRange(); range.selectNodeContents(node); boxes.push(...[...range.getClientRects()].filter(r => r.width > 0 && r.height > 0));
      }
      boxes.push(...[...element.querySelectorAll('[data-controller]')].map(el => el.getBoundingClientRect()));
      return { left: Math.min(...boxes.map(r => r.left)), right: Math.max(...boxes.map(r => r.right)), top: Math.min(...boxes.map(r => r.top)), bottom: Math.max(...boxes.map(r => r.bottom)), width: 0, height: 0 };
    };
    const cards = [...document.querySelectorAll<HTMLElement>('.hud-card')];
    const housings = cards.flatMap(card => [...card.querySelectorAll('.wood-panel-shell,.wood-panel-foot')].map(rect));
    const clock = document.querySelector('#match-clock,#mobile-match-timer');
    const clockRect = clock ? rect(clock) : null;
    const decorWidth = parseFloat(getComputedStyle(arena).getPropertyValue('--arena-free-side')) || 0;
    const decorated = arena.classList.contains('has-workshop-corners');
    const masks = decorated ? [{ left: ar.left, right: ar.left + decorWidth, top: ar.top, bottom: ar.bottom, width: decorWidth, height: ar.height }, { left: ar.right - decorWidth, right: ar.right, top: ar.top, bottom: ar.bottom, width: decorWidth, height: ar.height }] : [];
    const issues: string[] = [];
    for (const housing of housings) {
      if (housing.left < -.1 || housing.right > innerWidth + .1 || housing.top < -.1 || housing.bottom > innerHeight + .1) issues.push('housing outside viewport');
      if (clockRect && overlap(clockRect, housing)) issues.push('clock overlaps housing');
      if (masks.some(mask => overlap(mask, housing))) issues.push('decor overlaps housing');
    }
    const headerParts: unknown[] = [];
    for (const card of cards) {
      const elements = [...card.querySelectorAll<HTMLElement>('.hud-identity,.hud-stats,.shield-inventory,.hud-next-piece')].filter(el => el.getBoundingClientRect().width > 0).map(el => el.matches('.hud-identity,.hud-stats') ? contentRect(el) : rect(el));
      headerParts.push(elements);
      for (let i = 0; i < elements.length; i++) for (let j = i + 1; j < elements.length; j++) if (overlap(elements[i]!, elements[j]!)) issues.push(`header elements overlap ${i}/${j}`);
    }
    return { viewport: { width: innerWidth, height: innerHeight }, headerParts, issues, housings, clock: clockRect, masks, decorated, compactClock: arena.classList.contains('has-compact-arena-clock'), cellSize: Number(document.querySelector('#hud-grid')?.getAttribute('data-cell-size')), cards: cards.map(rect) };
  });
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/${scenario.name}.json`, JSON.stringify({ ...geometry, errors }, null, 2));
  await page.screenshot({ path: `${out}/${scenario.name}.png` });
  expect(geometry.issues).toEqual([]);
  expect(errors).toEqual([]);
  if (scenario.name === 'wide-two') expect(geometry.cellSize).toBe(42);
  if (scenario.name === 'low-four') expect(geometry.cellSize).toBe(18);
  if (scenario.name === 'dense-controller') {
    expect(geometry.decorated).toBe(false);
    expect(geometry.compactClock).toBe(true);
    expect(geometry.clock!.height).toBeLessThanOrEqual(24);
    await page.setViewportSize({ width: 1280, height: 480 });
    await expect(page.locator('.arena-screen')).toHaveClass(/has-workshop-corners/);
    await expect(page.locator('.arena-screen')).not.toHaveClass(/has-compact-arena-clock/);
    const clearance = await page.evaluate(() => {
      const arena = document.querySelector<HTMLElement>('.arena-screen')!;
      const r = arena.getBoundingClientRect();
      const side = parseFloat(getComputedStyle(arena).getPropertyValue('--arena-free-side'));
      return [...document.querySelectorAll('.wood-panel-foot')].map(el => { const b = el.getBoundingClientRect(); return { left: b.left - r.left - side, right: r.right - side - b.right }; });
    });
    for (const gap of clearance) { expect(gap.left).toBeGreaterThanOrEqual(32); expect(gap.right).toBeGreaterThanOrEqual(32); }
    await writeFile(`${out}/resize-decor-restored.json`, JSON.stringify(clearance, null, 2));
    await page.screenshot({ path: `${out}/resize-decor-restored.png` });
    await page.setViewportSize({ width: 960, height: 720 });
    await expect(page.locator('.arena-screen')).not.toHaveClass(/has-workshop-corners/);
    await expect(page.locator('.arena-screen')).toHaveClass(/has-compact-arena-clock/);

  }
});
