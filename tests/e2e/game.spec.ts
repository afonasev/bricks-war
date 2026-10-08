import { expect, test, type Page } from '@playwright/test';

async function resetAndOpen(page: Page, destination: 'Битва' | 'Командный бой', query = '?muted=1'): Promise<void> {
  await page.goto(`/${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: new RegExp(`^${destination}`) }).click();
}

async function fillBattle(page: Page, count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const addAi = page.locator('.participant-card').nth(index).getByRole('button', { name: 'Добавить ИИ' });
    if (await addAi.count()) await addAi.click();
  }
}

async function chooseMenuOption(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).click();
  const list = page.getByRole('listbox', { name: label });
  const item = list.getByRole('option', { name: option, exact: true });
  while (!(await item.isVisible())) await list.getByRole('button', { name: 'Следующие →', exact: true }).click();
  await item.click();
}

test('launches four compact fields with complete unframed previews and stable personal colors', async ({ page }) => {
  await resetAndOpen(page, 'Битва', '?muted=1&playtest-score=123456');
  await fillBattle(page);
  await page.getByLabel('Имя игрока 1').fill('Аня');
  await page.getByLabel('Имя игрока 2').fill('Аня');
  await page.getByRole('button', { name: 'Начать' }).click();

  const cards = page.locator('.hud-card');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toHaveClass(/hud-palette-slot-1/);
  await expect(cards.nth(0)).toHaveCSS('border-color', 'rgb(120, 170, 24)');
  await expect(page.locator('.hud-next-piece')).toHaveCount(4);
  await expect(page.locator('.hud-next-cell')).toHaveCount(16);
  await expect(page.getByText('NEXT', { exact: true })).toHaveCount(0);
  await expect(page.locator('.arena-topline')).toHaveCSS('height', '62px');
  await expect(page.locator('.arena-brand')).toContainText('BRICKS WAR');
  await expect(page.locator('.arena-brand')).toContainText(/ПОДГОТОВКА|УРОВЕНЬ 1/);
  await expect(page.locator('.arena-utilities')).toContainText('АВТОПАУЗА ВКЛАДКИ');
  await expect(page.locator('#round-timer')).toHaveCSS('background-image', /linear-gradient/);
  expect(await cards.evaluateAll((items) => items.every((card) => card.scrollWidth <= card.clientWidth))).toBe(true);
  const names = cards.locator('.hud-identity strong');
  await expect(names.nth(0)).toHaveText('Аня');
  await expect(names.nth(1)).toHaveText('Аня');
  await expect(names.nth(0)).toHaveCSS('color', 'rgb(53, 95, 10)');
  expect(await names.nth(0).evaluate((element) => getComputedStyle(element).color))
    .not.toBe(await names.nth(1).evaluate((element) => getComputedStyle(element).color));
  expect((await cards.allTextContents()).join(' ')).not.toMatch(/КЛАВИАТУРА|СТРЕЛКИ|WASD/);
});

test('keeps a one-player Survival surface tightly around the maximum-height board', async ({ page }) => {
  await page.goto('/?muted=1');
  await page.getByRole('button', { name: /^Выживание/ }).click();
  await page.getByRole('button', { name: 'Удалить Игрок 2' }).click();
  await page.getByRole('button', { name: 'Начать' }).click();

  await expect(page.locator('#round-timer')).toHaveAttribute('aria-label', 'Прошедшее время матча');
  await expect(page.locator('#round-timer small')).toHaveText('ПРОШЛО ВРЕМЕНИ');
  await expect(page.locator('#match-clock')).toHaveText('00:00');

  const stage = page.locator('.game-stage');
  const card = page.locator('.hud-card');
  await expect(card).toHaveCount(1);
  const [stageBox, cardBox] = await Promise.all([stage.boundingBox(), card.boundingBox()]);
  expect(stageBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(cardBox!.width).toBeLessThan(stageBox!.width * 0.5);
  expect(cardBox!.height).toBeGreaterThan(stageBox!.height * 0.9);
  expect(Math.abs((cardBox!.x + cardBox!.width / 2) - (stageBox!.x + stageBox!.width / 2))).toBeLessThan(1);
  const grid = page.locator('.hud-grid');
  expect(await grid.evaluate((element) => getComputedStyle(element).getPropertyValue('--arena-card-width').trim()))
    .toBe(`${cardBox!.width}px`);
  await expect(page.locator('#results-layer')).toBeHidden();
});

test('does not mount a Survival anomaly-arrival notice', async ({ page }) => {
  await page.goto('/?muted=1&playtest-survival-level-up=1');
  await page.getByRole('button', { name: /^Выживание/ }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('#countdown')).toBeHidden({ timeout: 6000 });
  await page.waitForTimeout(450);
  await expect(page.locator('[data-event-kind="level-up"]')).toHaveCount(0);
  await expect(page.locator('.player-event-notice')).toHaveCount(0);
});

test('counts down the selected duration in competitive modes and freezes on pause', async ({ page }) => {
  await resetAndOpen(page, 'Битва');
  await chooseMenuOption(page, 'Длительность матча', '2 мин');
  await page.getByRole('button', { name: 'Начать' }).click();

  const timer = page.locator('#round-timer');
  const clock = page.locator('#match-clock');
  await expect(timer).toHaveAttribute('aria-label', 'Оставшееся время матча');
  await expect(timer.locator('small')).toHaveText('ОСТАЛОСЬ ВРЕМЕНИ');
  await expect(clock).toHaveText('02:00');
  await expect(clock).not.toHaveText('02:00', { timeout: 6_000 });

  await page.getByRole('button', { name: 'Поставить матч на паузу' }).click();
  const pausedClock = await clock.textContent();
  await page.waitForTimeout(1_100);
  await expect(clock).toHaveText(pausedClock ?? '');
});

test('keeps shared team surfaces but personal names and non-numeric team cues', async ({ page }) => {
  await resetAndOpen(page, 'Командный бой');
  await fillBattle(page);
  await page.getByLabel('Имя игрока 1').fill('Аня');
  await page.getByLabel('Имя игрока 2').fill('Аня');
  await page.getByRole('button', { name: 'Начать' }).click();

  const cards = page.locator('.hud-card');
  await expect(cards.nth(0)).toHaveClass(/hud-palette-team-1/);
  await expect(cards.nth(1)).toHaveClass(/hud-palette-team-1/);
  await expect(cards.nth(2)).toHaveClass(/hud-palette-team-2/);
  await expect(cards.nth(0)).toContainText('СОЛНЦЕ');
  await expect(cards.nth(2)).toContainText('НЕБО');
  const firstColor = await cards.nth(0).locator('.hud-identity strong').evaluate((element) => getComputedStyle(element).color);
  const secondColor = await cards.nth(1).locator('.hud-identity strong').evaluate((element) => getComputedStyle(element).color);
  expect(firstColor).not.toBe(secondColor);
});

test('uses a compact red current-sender caption and sword without resizing a field', async ({page}) => {
  await resetAndOpen(page,'Битва','?muted=1&playtest-conflict=3');
  await fillBattle(page);await page.getByLabel('Имя игрока 1').fill('Аня');
  await page.getByRole('button',{name:'Начать'}).click();
  const target=page.locator('.hud-card.is-conflict-target').first(),before=await target.boundingBox();
  const notice=target.locator('.player-event-notice');
  await expect(notice).toContainText('Аня');await expect(notice).toContainText('3');
  await expect(notice.locator('strong .match-event-icon')).toHaveAttribute('data-icon','attack');
  await expect(notice.locator('strong')).toHaveCSS('color','rgb(180, 42, 64)');
  await expect(notice).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  const caption=await notice.boundingBox();expect(caption!.y).toBeGreaterThan(before!.y+35);expect(caption!.width).toBeLessThan(before!.width);
  expect(await target.boundingBox()).toEqual(before);
});

test('shows Final Push without anomaly copy in the timed global plaque without opening pause UI', async ({ page }) => {
  await resetAndOpen(page, 'Битва', '?muted=1&playtest-global-combined');
  await page.getByRole('combobox', { name: 'Длительность матча', exact: true }).click();
  await page.getByRole('option', { name: /5 мин$/ }).click();
  await expect(page.locator('#match-duration')).toHaveValue('5');
  await fillBattle(page, 2);
  await page.getByRole('button', { name: 'Начать' }).click();

  const plaque = page.locator('#arena-event-notice');
  await expect(plaque).toBeVisible({ timeout: 6_000 });
  await expect(plaque).toContainText('Финальный рывок');
  await expect(plaque).not.toContainText('Уровень');
  await expect(plaque.locator('.match-event-icon')).toHaveAttribute('data-icon', 'pressure');
  await expect(page.locator('#pause-overlay')).toBeHidden();
  const clock = await page.locator('#match-clock').textContent();
  await page.waitForTimeout(300);
  await expect(page.locator('#match-clock')).toHaveText(clock ?? '');
});

test.describe('reduced-motion match events', () => {
  test('keeps event scope, icon, color, and copy while removing travel animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await resetAndOpen(page, 'Битва', '?muted=1&playtest-conflict=3');
    await fillBattle(page, 2);
    await page.getByRole('button', { name: 'Начать' }).click();
    const notice = page.locator('.player-event-notice').first();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('3');
    await expect(notice.locator('strong .match-event-icon')).toHaveAttribute('data-icon', 'attack');
    await expect(notice).toHaveCSS('animation-name', 'none');
    await expect(notice).toHaveCSS('opacity', '1');
  });
});

test('keeps the arena paused while Settings opens and restores it with Back', async ({ page }) => {
  await resetAndOpen(page, 'Битва');
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: 'Поставить матч на паузу' }).click();

  const overlay = page.locator('#pause-overlay');
  await expect(overlay).toBeVisible();
  expect(await page.locator('.pause-panel:visible').evaluate((panel) => getComputedStyle(panel).backgroundImage))
    .not.toContain('radial-gradient');
  await expect(overlay.getByRole('button')).toContainText(['Продолжить', 'Заново', 'Настройки', 'Главное меню']);
  await page.keyboard.press('ArrowDown');
  await expect(overlay.locator('.is-ui-selected')).toHaveCount(1);
  await expect(page.locator('.arena-topline .is-ui-selected')).toHaveCount(0);
  const pausedClock = await page.locator('#match-clock').textContent();
  await overlay.getByRole('button', { name: 'Настройки' }).click();
  await expect(page.getByLabel('Громкость музыки')).toBeVisible();
  await page.setViewportSize({ width: 820, height: 1_000 });
  const typography = await page.locator('#pause-settings-panel').evaluate((panel) => {
    const heading = panel.querySelector(':scope > span');
    const volumeLabel = panel.querySelector('.volume-control span');
    const settingTitle = panel.querySelector('.settings-action strong');
    const description = panel.querySelector('.settings-action small');
    if (!heading || !volumeLabel || !settingTitle || !description) throw new Error('Pause Settings typography nodes are missing');
    const panelBox = panel.getBoundingClientRect();
    const contained = [heading, volumeLabel, settingTitle, description].every((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= panelBox.left && box.right <= panelBox.right && box.top >= panelBox.top && box.bottom <= panelBox.bottom;
    });
    return {
      heading: Number.parseFloat(getComputedStyle(heading).fontSize),
      volumeLabel: Number.parseFloat(getComputedStyle(volumeLabel).fontSize),
      settingTitle: Number.parseFloat(getComputedStyle(settingTitle).fontSize),
      description: Number.parseFloat(getComputedStyle(description).fontSize),
      contained,
    };
  });
  expect(typography.heading).toBeGreaterThan(typography.settingTitle);
  expect(typography.settingTitle).toBeGreaterThan(typography.description);
  expect(typography.volumeLabel).toBeLessThan(typography.heading);
  expect(typography.contained).toBe(true);
  await expect(page.locator('#pause-settings-panel .is-ui-selected')).toHaveCount(1);
  await expect(page.locator('#pause-menu-panel .is-ui-selected')).toHaveCount(0);
  await page.getByLabel('Громкость музыки').fill('42');
  await page.keyboard.press('Escape');
  await expect(overlay.getByRole('button', { name: 'Продолжить' })).toBeVisible();
  await page.waitForTimeout(150);
  expect(await page.locator('#match-clock').textContent()).toBe(pausedClock);
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
});

test('restarts with the same roster and exits pause to the real main menu', async ({ page }) => {
  await resetAndOpen(page, 'Битва');
  await page.getByLabel('Имя игрока 1').fill('Мира');
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: 'Поставить матч на паузу' }).click();
  await page.getByRole('button', { name: 'Заново' }).click();
  await expect(page.locator('.hud-card').first()).toContainText('Мира');
  await expect(page.locator('#countdown')).toBeVisible();
  await page.getByRole('button', { name: 'Поставить матч на паузу' }).click();
  await page.getByRole('button', { name: 'Главное меню' }).click();
  await expect(page.locator('[data-screen="main-menu"]')).toBeVisible();
});

test('offers only Repeat and Main Menu in results and Repeat preserves identities', async ({ page }) => {
  test.setTimeout(50_000);
  await resetAndOpen(page, 'Битва', '?muted=1&playtest-fast=20');
  await page.getByLabel('Имя игрока 1').fill('Мира');
  await chooseMenuOption(page, 'Длительность матча', '2 мин');
  await page.getByRole('button', { name: 'Начать' }).click();
  const results = page.locator('.results-panel');
  await expect(results).toBeVisible({ timeout: 36_000 });
  expect(await results.evaluate((panel) => getComputedStyle(panel).backgroundImage))
    .not.toContain('radial-gradient');
  await expect(results.locator('.eyebrow')).not.toContainText(/SOLO|TIME|LAST/);
  await expect(results.locator('.eyebrow')).toContainText(/ЛИЧНЫЙ|ВРЕМЯ|ПОСЛЕДНИЙ/);
  await expect(results.locator('#play-again')).toBeVisible();
  await expect(results.getByRole('button')).toHaveCount(2);
  await expect(results.getByRole('button')).toContainText(['Повторить', 'Главное меню']);
  await results.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.locator('.hud-card').first()).toContainText('Мира');
  await expect(page.locator('#countdown')).toBeVisible();
});

test('uses the Menu gamepad button to pause and shared gamepad focus to continue', async ({ page }) => {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: 'Family Pad', index: 0, connected: true, axes: [0, 0], buttons, mapping: 'standard', timestamp: 0 };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    Object.defineProperty(window, '__padButton', { configurable: true, value: (index: number, pressed: boolean) => { buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 }; } });
  });
  await resetAndOpen(page, 'Битва');
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.evaluate(() => (window as typeof window & { __padButton: (index: number, pressed: boolean) => void }).__padButton(9, true));
  await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.evaluate(() => (window as typeof window & { __padButton: (index: number, pressed: boolean) => void }).__padButton(9, false));
  await page.waitForTimeout(80);
  await page.evaluate(() => (window as typeof window & { __padButton: (index: number, pressed: boolean) => void }).__padButton(0, true));
  await expect(page.locator('#pause-overlay')).toBeHidden();
});

test('retains board geometry without overflow at wide and narrow supported viewports', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 960 }, { width: 900, height: 720 }]) {
    await page.setViewportSize(viewport);
    await resetAndOpen(page, 'Битва');
    await fillBattle(page);
    await page.getByRole('button', { name: 'Начать' }).click();
    await expect(page.locator('.hud-card')).toHaveCount(4);
    expect(await page.locator('.hud-card').evaluateAll((cards) => cards.every((card) => card.scrollWidth <= card.clientWidth))).toBe(true);
    const stage = await page.locator('.game-stage').boundingBox();
    expect(stage?.height).toBe(viewport.height - 62);
    await page.getByRole('button', { name: 'Поставить матч на паузу' }).click();
    await page.getByRole('button', { name: 'Главное меню' }).click();
  }
});

for (const viewport of [{width: 1440, height: 960}, {width: 390, height: 844}]) {
  test(`attack notice and frame end with the three-second warning at ${viewport.width}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await resetAndOpen(page, 'Битва', '?muted=1&playtest-conflict=3&playtest-conflict-timed');
    await page.getByRole('button', {name: /^Начать/}).click();
    const target = page.locator('.hud-card.is-conflict-target').first();
    await expect(target).toBeVisible();
    await expect(target).toHaveAttribute('data-event-kind', 'incoming-attack');
    await expect(page.locator('#countdown')).toBeHidden();
    await expect(page.locator('#arena-event-notice')).toBeHidden();
    const recipient = page.locator('.hud-card').first();
    await expect(recipient.locator('.player-event-notice')).toHaveCSS('opacity', '1');
    await expect(recipient.locator('.player-event-notice')).toHaveCSS('animation-name', 'none');
    await page.screenshot({path: `evidence/increase-attack-defense-window/warning-${viewport.width}.png`});
    await expect(recipient).not.toHaveClass(/is-conflict-target/, {timeout: 8_000});
    await expect(recipient).not.toHaveAttribute('data-event-kind', 'incoming-attack');
    await expect(recipient).not.toHaveCSS('border-color', 'rgb(201, 71, 97)');
    expect(await recipient.evaluate(el => getComputedStyle(el, '::after').borderColor)).toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({path: `evidence/increase-attack-defense-window/after-${viewport.width}.png`});
  });
}
