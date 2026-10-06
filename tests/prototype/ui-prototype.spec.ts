import { expect, test, type Page } from '@playwright/test';

const prototypePath = '/artifacts/ui-prototype/';

async function openPrototype(page: Page): Promise<void> {
  await page.goto(prototypePath);
  await expect(page.locator('[data-screen="menu"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await openPrototype(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('opens directly from the standalone HTML file', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const entry = new URL('../../artifacts/ui-prototype/index.html', import.meta.url).href;
  await page.goto(entry);
  await expect(page.locator('[data-screen="menu"]')).toBeVisible();
  await expect(page.getByText('UX PROTOTYPE · НЕ ИГРОВАЯ СБОРКА')).toBeVisible();
  await context.close();
});

test('navigates the four-choice menu with shared hover and keyboard focus', async ({ page }) => {
  const choices = page.locator('.main-menu [data-focus]');
  await expect(choices).toHaveCount(4);
  await choices.nth(1).hover();
  await expect(choices.nth(1)).toHaveClass(/is-selected/);

  await page.keyboard.press('ArrowDown');
  await expect(choices.nth(2)).toHaveClass(/is-selected/);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="teams"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="menu"]')).toBeVisible();
  await expect(choices.nth(2)).toHaveClass(/is-selected/);
});

test('accepts navigation from any connected gamepad and ignores stick drift', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const pad = {
      connected: true,
      index: 1,
      id: 'Generic USB Gamepad',
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: null,
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [null, pad] });
    (window as unknown as { __prototypePad: typeof pad }).__prototypePad = pad;
  });
  await openPrototype(page);
  const choices = page.locator('.main-menu [data-focus]');

  await page.evaluate(() => { (window as any).__prototypePad.axes[1] = 0.3; });
  await page.waitForTimeout(500);
  await expect(choices.nth(0)).toHaveClass(/is-selected/);

  await page.evaluate(() => { (window as any).__prototypePad.buttons[13].pressed = true; });
  await expect(choices.nth(1)).toHaveClass(/is-selected/);
  await page.evaluate(() => { (window as any).__prototypePad.buttons[13].pressed = false; });
  await page.waitForTimeout(250);
  await page.evaluate(() => { (window as any).__prototypePad.buttons[0].pressed = true; });
  await expect(page.locator('[data-screen="battle"]')).toBeVisible();
  await context.close();
});

test('remembers Survival name only in the prototype namespace', async ({ page }) => {
  await page.getByRole('button', { name: /Выживание/ }).click();
  const name = page.locator('#survival-name');
  await name.fill('Оля');
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: /Выживание/ }).click();
  await expect(page.locator('#survival-name')).toHaveValue('Оля');

  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toEqual(['bricks-war:ui-prototype:v1']);
  await page.getByRole('button', { name: 'НАЧАТЬ' }).click();
  await expect(page.locator('[data-arena-count="1"] .player-panel')).toHaveCount(1);
  await expect(page.locator('.player-name')).toHaveText('Оля');
});

test('keeps Music and Effects independent and opens Controls', async ({ page }) => {
  await page.getByRole('button', { name: /Настройки/ }).click();
  const music = page.locator('#setting-music');
  const effects = page.locator('#setting-effects');
  await music.fill('40');
  await expect(music).toHaveValue('40');
  await expect(effects).toHaveValue('85');

  await page.getByRole('button', { name: /Спокойные эффекты/ }).click();
  await expect(page.locator('body')).toHaveClass(/calm/);
  await page.getByRole('button', { name: /Управление/ }).click();
  await expect(page.locator('[data-screen="controls"]')).toBeVisible();
  await expect(page.locator('.controller')).toBeVisible();
  await expect(page.getByText('КЛАВИАТУРА 1')).toBeVisible();

  const arrowKeys = page.locator('[data-keyboard="arrows"] kbd');
  await expect(arrowKeys).toHaveText(['←', '↑', '↓', '→']);
  const keyBoxes = await arrowKeys.evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x), y: Math.round(box.y) };
  }));
  const [leftKey, upKey, downKey, rightKey] = keyBoxes;
  if (!leftKey || !upKey || !downKey || !rightKey) throw new Error('Expected four arrow-key boxes');
  expect(leftKey.x).toBeLessThan(upKey.x);
  expect(upKey.x).toBe(downKey.x);
  expect(upKey.y).toBeLessThan(downKey.y);
  expect(downKey.x).toBeLessThan(rightKey.x);

  const directionSources = page.locator('[data-direction-source]');
  await expect(directionSources).toHaveCount(2);
  await expect(directionSources.nth(0).locator('.direction')).toHaveText(['↑', '←', '↓', '→']);
  await expect(directionSources.nth(1).locator('.direction')).toHaveText(['↑', '←', '↓', '→']);
  await expect(page.getByText('Левый стик · движение')).toBeVisible();
  await expect(page.getByText('D-pad · движение')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
});

test('shows only the three release-facing settings in Battle and Team Battle', async ({ page }) => {
  await page.getByRole('button', { name: /Битва/ }).click();
  let cards = page.locator('.mode-settings .setting-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('small')).toHaveText(['Длительность', 'Атаки', 'Ускорение']);
  await expect(page.getByText('Финальное давление', { exact: true })).toHaveCount(0);

  await cards.nth(0).hover();
  await expect(cards.nth(0)).toHaveClass(/is-selected/);
  await page.keyboard.press('ArrowDown');
  await expect(cards.nth(1)).toHaveClass(/is-selected/);
  await page.keyboard.press('ArrowDown');
  await expect(cards.nth(2)).toHaveClass(/is-selected/);
  await cards.nth(0).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bricks-war:ui-prototype:v1') || '{}'));
  expect(stored.battle).not.toHaveProperty('pressure');
  expect(stored.teams).not.toHaveProperty('pressure');

  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: /Командный бой/ }).click();
  cards = page.locator('.mode-settings .setting-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('small')).toHaveText(['Длительность', 'Атаки', 'Ускорение']);
  await expect(page.getByText('Финальное давление', { exact: true })).toHaveCount(0);
});

test('reflows three mode settings into one column at the narrow breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 900 });
  await page.getByRole('button', { name: /Битва/ }).click();
  const cards = page.locator('.mode-settings .setting-card');
  const boxes = await cards.evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) };
  }));
  expect(new Set(boxes.map(box => box.x)).size).toBe(1);
  expect(new Set(boxes.map(box => box.y)).size).toBe(3);
  expect(boxes.every(box => box.width > 600)).toBe(true);
});

test('joins Battle slot and demonstrates arena feedback, pause, and results', async ({ page }) => {
  await page.getByRole('button', { name: /Битва/ }).click();
  await expect(page.locator('.player-slot')).toHaveCount(4);
  const summary = page.locator('[data-rules-summary]');
  await expect(summary).toContainText('Матч: 5 мин');
  await page.locator('[data-cycle="battle.duration"]').click();
  await expect(summary).toContainText('Матч: 7 мин');
  await page.getByRole('button', { name: '+ Добавить ИИ', exact: true }).click();
  await expect(page.locator('.player-slot.empty')).toHaveCount(0);
  await expect(page.locator('.player-slot').last()).toContainText('ИИ · средний');
  await page.getByRole('button', { name: 'НАЧАТЬ БИТВУ' }).click();
  await expect(page.locator('[data-arena-count="4"] .player-panel')).toHaveCount(4);

  await page.getByRole('button', { name: 'ДЕМО-СОСТОЯНИЯ' }).click();
  await page.getByRole('button', { name: 'Атака', exact: true }).click();
  await expect(page.getByText('Вас атакует Аня +3')).toBeVisible();
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.locator('[data-screen="arena"]')).toBeVisible();

  await page.getByRole('button', { name: 'ДЕМО-СОСТОЯНИЯ' }).click();
  await page.getByRole('button', { name: 'Результаты' }).click();
  await expect(page.locator('[data-screen="results"]')).toBeVisible();
  await expect(page.locator('.modal-actions button')).toHaveCount(2);
  await page.getByRole('button', { name: 'ПОВТОРИТЬ' }).click();
  await expect(page.locator('[data-arena-count="4"] .player-panel')).toHaveCount(4);
});

test('requires four Team Battle slots and keeps four fields in one row when wide', async ({ page }) => {
  await page.getByRole('button', { name: /Командный бой/ }).click();
  await expect(page.getByRole('button', { name: /НУЖНЫ 4 УЧАСТНИКА/ })).toBeDisabled();
  await page.getByRole('button', { name: /Нажмите A, чтобы войти/ }).click();
  const start = page.getByRole('button', { name: 'НАЧАТЬ БОЙ' });
  await expect(start).toBeEnabled();
  await start.click();

  const panels = page.locator('.player-panel');
  await expect(panels).toHaveCount(4);
  const boxes = await panels.evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) };
  }));
  expect(new Set(boxes.map(box => box.y)).size).toBe(1);
  expect(boxes.every(box => box.width > 250)).toBe(true);
});

test('reflows the four-player arena into two rows on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole('button', { name: /Командный бой/ }).click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.getByRole('button', { name: /Нажмите A, чтобы войти/ }).click();
  await page.getByRole('button', { name: 'НАЧАТЬ БОЙ' }).click();
  const panels = page.locator('.player-panel');
  await expect(panels).toHaveCount(4);
  const rows = await panels.evaluateAll(elements => new Set(elements.map(element => Math.round(element.getBoundingClientRect().y))).size);
  expect(rows).toBe(2);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(800);
});
