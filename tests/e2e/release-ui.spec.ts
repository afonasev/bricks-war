import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?muted=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('updates the fixed main-menu showcase for pointer and keyboard selection', async ({ page }) => {
  expect(await page.locator('.main-menu-screen').evaluate((screen) => `${getComputedStyle(screen).backgroundImage} ${getComputedStyle(screen, '::before').backgroundImage}`))
    .not.toContain('radial-gradient');
  const menu = page.getByRole('navigation', { name: 'Главное меню' });
  const choices = menu.getByRole('button');
  await expect(choices).toHaveCount(5);
  expect(await choices.evaluateAll(els => els.flatMap(el => ['::before', '::after'].map(p => getComputedStyle(el, p).content)))).toEqual(Array(10).fill('none'));
  if (process.env.BRICKS_RECORD_SCREENSHOTS) await page.screenshot({path: `${process.env.BRICKS_RECORD_SCREENSHOTS}/menu-1440x960.png`});
  await expect(choices).toContainText(['Выживание', 'Битва', 'Командный бой', 'Сетевая игра', 'Настройки']);
  await expect(page.locator('.main-menu-layout')).toBeVisible();
  const showcase = page.locator('.menu-showcase');
  await expect(showcase).toBeVisible();
  await expect(showcase).toHaveAttribute('data-preview', 'survival');
  await expect(showcase).toHaveAttribute('aria-label', /Выживание/);
  await expect(page.locator('.survival-showcase .mini-board')).toHaveCount(1);
  await expect(page.locator('.showcase-callouts')).toContainText('Каждый играет независимо');
  await expect(page.locator('.showcase-callouts')).toContainText('щиты копятся сериями линий');
  await expect(page.locator('.showcase-callouts')).toContainText('Аномалии очищают нижние ряды');
  await expect(page.locator('.showcase-callouts')).not.toContainText(/атак/i);
  await expect(page.locator('.showcase-callouts > div')).toHaveCount(3);
  const before = await choices.nth(0).boundingBox();
  const showcaseBefore = await showcase.boundingBox();
  await choices.nth(1).hover();
  await expect(choices.nth(1)).toHaveClass(/is-ui-selected/);
  await expect(choices.nth(0)).not.toBeFocused();
  await expect(page.locator('.mode-choice.is-ui-selected')).toHaveCount(1);
  await expect(choices.nth(1).locator('.mode-forward')).toHaveCSS('opacity', '1');
  await expect(showcase).toHaveAttribute('data-preview', 'battle');
  await expect(showcase).toHaveAttribute('aria-label', /Битва/);
  await expect(page.locator('.mini-boards .mini-board')).toHaveCount(4);
  await expect(page.locator('.showcase-callouts')).toContainText('Каждый сам за себя');
  await expect(page.locator('.showcase-callouts')).toContainText('Атакуйте соперников');
  await expect(page.locator('.showcase-callouts')).toContainText('щиты копятся сериями линий');
  await expect(page.locator('.showcase-callouts')).toContainText('аномалии очищают нижние ряды');
  await expect(page.locator('.showcase-callouts')).toContainText('Выживите и наберите как можно больше очков');
  await expect(page.locator('.mini-boards [aria-label="Победитель"]')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(choices.nth(2)).toHaveClass(/is-ui-selected/);
  await expect(showcase).toHaveAttribute('data-preview', 'team-battle');
  await expect(page.locator('.showcase-callouts')).toContainText('Две команды по два игрока');
  await expect(page.locator('.showcase-callouts')).toContainText('Атакуйте команду соперников');
  await expect(page.locator('.showcase-callouts')).toContainText('щиты копятся сериями линий');
  await expect(page.locator('.showcase-callouts')).toContainText('аномалии очищают нижние ряды');
  await expect(page.locator('.team-showcase [aria-label="Победившая команда"]')).toHaveCount(1);
  await expect(page.locator('.team-showcase')).not.toContainText(/Команда Солнца|Команда Неба/);
  const after = await choices.nth(0).boundingBox();
  const showcaseAfter = await showcase.boundingBox();
  expect(after).toEqual(before);
  expect(showcaseAfter).toEqual(showcaseBefore);
  await page.mouse.move(1200, 500);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="team-battle"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="main-menu"]')).toBeVisible();
  await expect(page.locator('.menu-showcase')).toHaveAttribute('data-preview', 'team-battle');
  await expect(page.locator('.is-ui-selected')).toHaveCount(1);
});

test('updates the main-menu showcase from a connected gamepad', async ({ page }) => {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: 'Family Pad', index: 0, connected: true, axes: [0, 0], buttons, mapping: 'standard', timestamp: 0 };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    Object.defineProperty(window, '__pressPadDown', { configurable: true, value: (pressed: boolean) => { buttons[13] = { pressed, touched: pressed, value: pressed ? 1 : 0 }; } });
  });
  await page.reload();
  await expect(page.locator('.menu-showcase')).toHaveAttribute('data-preview', 'survival');
  await page.evaluate(() => (window as typeof window & { __pressPadDown: (pressed: boolean) => void }).__pressPadDown(true));
  await expect(page.locator('.menu-showcase')).toHaveAttribute('data-preview', 'battle');
  await page.evaluate(() => (window as typeof window & { __pressPadDown: (pressed: boolean) => void }).__pressPadDown(false));
  await expect(page.getByRole('button', { name: /^Битва/ })).toHaveClass(/is-ui-selected/);
});

test('keeps the menu gamepad as navigation owner while Y joins and cycles gamepad slots', async ({ page }) => {
  await page.addInitScript(() => {
    const pad = (index: number) => ({
      id: `Family Pad ${index + 1}`,
      index,
      connected: true,
      axes: [0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
      mapping: 'standard',
      timestamp: 0,
    });
    const pads = [pad(0), pad(1)];
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
    Object.defineProperty(window, '__setFamilyPadButton', { configurable: true, value: (padIndex: number, button: number, pressed: boolean) => {
      pads[padIndex]!.buttons[button] = { pressed, touched: pressed, value: pressed ? 1 : 0 };
    } });
  });
  await page.reload();
  const setButton = async (padIndex: number, button: number, pressed: boolean) => page.evaluate(({ padIndex, button, pressed }) => {
    (window as typeof window & { __setFamilyPadButton: (pad: number, button: number, pressed: boolean) => void }).__setFamilyPadButton(padIndex, button, pressed);
  }, { padIndex, button, pressed });

  await setButton(0, 13, true);
  await expect(page.locator('.menu-showcase')).toHaveAttribute('data-preview', 'battle');
  await setButton(0, 13, false);
  await page.waitForTimeout(50);

  await setButton(0, 0, true);
  await expect(page.locator('[data-screen="battle"]')).toBeVisible();
  await expect(page.locator('[data-slot-card="3"].empty')).toBeVisible();
  await setButton(0, 0, false);
  await page.waitForTimeout(50);

  await setButton(0, 3, true);
  await expect(page.locator('[data-slot="3"]')).toHaveValue('gamepad-0');
  const joinedName = await page.locator('[data-player-name="3"]').inputValue();
  await setButton(0, 3, true);
  await expect(page.locator('[data-slot="3"]')).toHaveValue('gamepad-0');
  await expect(page.locator('[data-slot-card="2"]')).toContainText('ИИ');

  await setButton(0, 3, false);
  await page.waitForTimeout(50);
  await setButton(0, 3, true);
  await expect(page.locator('[data-slot="2"]')).toHaveValue('gamepad-0');
  await expect(page.locator('[data-player-name="2"]')).toHaveValue(joinedName);
  await expect(page.locator('[data-slot-card="3"]')).toContainText('ИИ');
  const slotThreeAi = await page.locator('[data-slot="3"]').inputValue();

  await setButton(1, 3, true);
  await expect(page.locator('[data-slot="3"]')).toHaveValue(slotThreeAi);
  await setButton(1, 3, false);
  await page.waitForTimeout(50);
  await page.locator('[data-remove-slot="3"]').click();
  await expect(page.locator('[data-slot-card="3"].empty')).toBeVisible();
  await setButton(1, 3, true);
  await expect(page.locator('[data-slot="3"]')).toHaveValue('gamepad-1');
  await expect(page.locator('[data-slot="2"]')).toHaveValue('gamepad-0');
  await expect(page.locator('[data-screen="battle"]')).toBeVisible();
});

test('keeps every redesigned main-menu destination routed and reflows the preview', async ({ page }) => {
  for (const [label, screen] of [
    ['Выживание', 'survival'],
    ['Битва', 'battle'],
    ['Командный бой', 'team-battle'],
    ['Настройки', 'settings'],
  ] as const) {
    await page.getByRole('button', { name: new RegExp(`^${label}(?:\\s|$)`) }).click();
    await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
    await expect(page.locator(`[data-screen="${screen}"]`)).toHaveClass(/premium-surface/);
    expect(await page.locator(`[data-screen="${screen}"]`).evaluate((surface) => `${getComputedStyle(surface).backgroundImage} ${getComputedStyle(surface, '::after').backgroundImage}`))
      .not.toContain('radial-gradient');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen="main-menu"]')).toBeVisible();
  }

  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole('button', { name: /Настройки/ }).hover();
  await expect(page.locator('.menu-showcase')).toHaveAttribute('data-preview', 'settings');
  await expect(page.locator('.settings-showcase')).toBeVisible();
  await expect(page.locator('.settings-showcase')).toContainText('Управление');
  await expect(page.locator('.settings-showcase kbd')).toHaveCount(0);
  await expect(page.locator('.showcase-callouts')).toContainText('Автор Афонасьев Евгений');
  await expect(page.locator('.showcase-callouts')).toContainText('при поддержке Codex');
  await expect(page.locator('.showcase-callouts')).toContainText('2026 год');
  await expect(page.locator('.menu-showcase[data-preview="settings"] .showcase-callouts > div').first().locator('span')).toHaveCSS('white-space', 'nowrap');
  const primary = await page.locator('.main-menu-primary').boundingBox();
  const showcase = await page.locator('.menu-showcase').boundingBox();
  expect(primary).not.toBeNull();
  expect(showcase).not.toBeNull();
  expect(showcase?.x ?? 0).toBeGreaterThanOrEqual((primary?.x ?? 0) + (primary?.width ?? 0));
  expect(Math.max(primary?.y ?? 0, showcase?.y ?? 0)).toBeLessThan(Math.min((primary?.y ?? 0) + (primary?.height ?? 0), (showcase?.y ?? 0) + (showcase?.height ?? 0)));
  await expect(page.locator('.main-menu-footer')).toBeVisible();
  await expect(page.locator('.release-build-info')).toHaveText(/^Версия \d+\.\d+\.\d+(?:-dev)?(?: · Деплой .+)?$/);
});

test('keeps release footer lines, badges, and geometry synchronized across screens', async ({ page }) => {
  const readFooter = async () => page.locator('.release-guidance-footer').evaluate((footer) => {
    const box = footer.getBoundingClientRect();
    const style = getComputedStyle(footer);
    const children = [...footer.querySelector('.release-footer-inner')!.children];
    const boxes = children.map((child) => child.getBoundingClientRect());
    const overlaps = boxes.some((left, index) => boxes.slice(index + 1).some((right) => (
      left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
    )));
    return {
      x: Math.round(box.x),
      top: Math.round(box.top),
      bottom: Math.round(box.bottom),
      width: Math.round(box.width),
      height: Math.round(box.height),
      viewportHeight: window.innerHeight,
      position: style.position,
      borderTopColor: style.borderTopColor,
      backgroundColor: style.backgroundColor,
      overflow: footer.scrollWidth > footer.clientWidth,
      overlaps,
    };
  });

  const main = await readFooter();
  const sharedGeometry = {
    x: main.x,
    width: main.width,
    height: main.height,
    borderTopColor: main.borderTopColor,
    backgroundColor: main.backgroundColor,
    overflow: false,
    overlaps: false,
  };
  await expect(page.locator('.release-guidance-footer .input-badge')).toHaveText(['A', 'B']);
  expect(main).toMatchObject({ x: 16, width: 1408, overflow: false, overlaps: false });

  await page.getByRole('button', { name: /^Битва/ }).click();
  const setup = await readFooter();
  await expect(page.locator('.release-guidance-footer .input-badge')).toHaveText(['A', 'B', 'Y']);
  const { height: mainHeight, ...sharedSetupGeometry } = sharedGeometry;
  expect(setup).toMatchObject(sharedSetupGeometry);
  expect(setup.height).toBeGreaterThanOrEqual(mainHeight);
  const setupContentBottom = await page.locator('.setup-scroll').evaluate(el => el.getBoundingClientRect().bottom);
  expect(setupContentBottom).toBeLessThanOrEqual(setup.top + 1);

  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const tallSetup = await readFooter();
  expect(tallSetup.bottom).toBe(1102);
  expect(tallSetup.position).toBe('relative');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Настройки/ }).click();
  const settings = await readFooter();
  await expect(page.locator('.release-guidance-footer .input-badge')).toHaveText(['A', 'B']);
  expect(settings).toMatchObject(sharedGeometry);

  await page.setViewportSize({ width: 800, height: 620 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.evaluate(() => window.scrollTo(0, 0));
  const settingsBeforeScroll = await readFooter();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const settingsAfterScroll = await readFooter();
  const lastSettingBottom = await page.locator('.settings-list > :last-child').evaluate((control) => Math.round(control.getBoundingClientRect().bottom));
  expect(settingsBeforeScroll).toMatchObject({ bottom: 529, position: 'relative' });
  expect(settingsAfterScroll).toMatchObject({ bottom: 529, position: 'relative' });
  expect(lastSettingBottom).toBeLessThanOrEqual(settingsAfterScroll.top);

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  await page.getByRole('button', { name: /Управление/ }).click();
  const controls = await readFooter();
  await expect(page.locator('.release-guidance-footer .input-badge')).toHaveText(['B']);
  expect(controls).toMatchObject(sharedGeometry);

  await page.setViewportSize({ width: 800, height: 900 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const narrowControls = await readFooter();
  expect(narrowControls).toMatchObject({ x: 16, width: 768, overflow: false, overlaps: false });
  expect(narrowControls.borderTopColor).toBe(main.borderTopColor);
  expect(narrowControls.backgroundColor).toBe(main.backgroundColor);

  await page.setViewportSize({ width: 800, height: 620 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const scrollingControls = await readFooter();
  const controlsBottom = await page.locator('.controls-reference').evaluate((controls) => Math.round(controls.getBoundingClientRect().bottom));
  expect(scrollingControls).toMatchObject({ bottom: 529, position: 'relative' });
  expect(controlsBottom).toBeLessThanOrEqual(scrollingControls.top);
});

test('persists independent release settings and opens the controls reference', async ({ page }) => {
  await page.getByRole('button', { name: /Настройки/ }).click();
  await expect(page.locator('.audio-prototype-wrap')).toHaveCount(0);
  await page.getByLabel('Громкость музыки').fill('61');
  await page.getByLabel('Громкость эффектов').fill('34');
  await page.getByRole('combobox', { name: 'Набор звуковых эффектов' }).click();
  await expect(page.getByRole('option')).toContainText(['Soft Toy', 'Neon Workshop', 'Original']);
  await page.getByRole('option', { name: 'Original' }).click();
  await page.getByLabel('Спокойные эффекты').check();
  await page.reload();
  await page.getByRole('button', { name: /Настройки/ }).click();
  await expect(page.getByLabel('Громкость музыки')).toHaveValue('61');
  await expect(page.getByLabel('Громкость эффектов')).toHaveValue('34');
  await expect(page.locator('#sfx-preset')).toHaveValue('original');
  await expect(page.getByLabel('Спокойные эффекты')).toBeChecked();
  await page.getByRole('button', { name: /Управление/ }).click();
  await expect(page.locator('.keyboard-cluster.arrows kbd')).toHaveText(['↑', '←', '↓', '→']);
  const arrowRows = await page.locator('.keyboard-cluster.arrows kbd').evaluateAll((keys) => keys.map((key) => Math.round(key.getBoundingClientRect().top)));
  expect(arrowRows[0]).toBeLessThan(arrowRows[1] ?? 0);
  expect(new Set(arrowRows.slice(1)).size).toBe(1);
  await expect(page.locator('.keyboard-cluster')).toHaveCount(2);
  const artwork = page.locator('.approved-gamepad-artwork');
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveAttribute('alt', /левый стик или D-pad/);
  expect(await artwork.evaluate((image: HTMLImageElement) => ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })))
    .toEqual({ complete: true, width: 1000, height: 720 });
  await expect(page.getByRole('heading', { name: 'Управление', exact: true })).toHaveCount(1);
  const wideContainment = await artwork.evaluate((image) => {
    const imageBox = image.getBoundingClientRect();
    const cardBox = image.parentElement?.getBoundingClientRect();
    return {
      contained: Boolean(cardBox && imageBox.left >= cardBox.left && imageBox.right <= cardBox.right && imageBox.top >= cardBox.top && imageBox.bottom <= cardBox.bottom),
      ratio: imageBox.width / imageBox.height,
    };
  });
  expect(wideContainment.contained).toBe(true);
  expect(wideContainment.ratio).toBeCloseTo(1000 / 720, 2);
  await page.setViewportSize({ width: 800, height: 900 });
  const narrowContainment = await artwork.evaluate((image) => {
    const imageBox = image.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    return {
      contained: imageBox.left >= 0 && imageBox.right <= viewportWidth,
      ratio: imageBox.width / imageBox.height,
    };
  });
  expect(narrowContainment.contained).toBe(true);
  expect(narrowContainment.ratio).toBeCloseTo(1000 / 720, 2);
});

test('keeps the audio prototype gallery behind its local review flag', async ({ page }) => {
  await page.goto('/?muted=1&audio-prototypes=1');
  await page.getByRole('button', { name: /Настройки/ }).click();
  await expect(page.locator('.audio-prototype-wrap')).toBeVisible();
  await expect(page.locator('[data-audio-preview="gameplay-music"]')).toHaveCount(5);
});

test('keeps release settings aligned and the primary setup action compact', async ({ page }) => {
  await page.getByRole('button', { name: /Настройки/ }).click();
  const audio = page.locator('.settings-list .setup-audio-controls');
  const music = page.locator('.settings-list .volume-control').first();
  const effects = page.locator('.settings-list .volume-control').last();
  const [audioBox, musicBox, effectsBox] = await Promise.all([audio.boundingBox(), music.boundingBox(), effects.boundingBox()]);
  expect(audioBox).not.toBeNull();
  expect(musicBox?.x).toBe(effectsBox?.x);
  expect(musicBox?.width).toBe(effectsBox?.width);
  await page.getByRole('button', { name: /Назад/ }).click();
  await page.getByRole('button', { name: /^Выживание/ }).click();
  const startButton = page.getByRole('button', { name: 'Начать' });
  const start = await startButton.boundingBox();
  const viewport = page.viewportSize();
  expect(start?.width ?? Infinity).toBeLessThan((viewport?.width ?? 1280) / 2);
  expect(await startButton.evaluate((button) => button.closest('.release-guidance-footer') !== null)).toBe(true);
  await expect(page.locator('.release-guidance-footer')).toContainText('X · начать');
});

test('shows mode-specific setup and removes participants reversibly', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('bricks-war:solo-records:v1', JSON.stringify([
    { id: 'fixture-record', name: 'Тест', elapsedMs: 128_000, lineScore: 6_800, total: 6_800, finishedAt: 1_700_000_000_000, placedPieces: 42 },
    { id: 'legacy-record', name: 'Старый', elapsedMs: 64_000, lineScore: 2_400, total: 2_400 },
  ])));
  await page.getByRole('button', { name: /^Выживание/ }).click();
  await expect(page.locator('.survival-rules li')).toHaveCount(5);
  await expect(page.locator('.mode-setup-screen > .mechanics-panel')).toHaveCount(0);
  await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Игрок 1');
  await expect(page.getByLabel('Имя игрока 2')).toHaveValue('Игрок 2');
  await expect(page.locator('.survival-lobby .participant-card')).toHaveCount(4);
  await expect(page.locator('.survival-lobby [data-add-ai]')).toHaveCount(0);
  await expect(page.locator('.survival-rules')).toContainText('Каждый играет независимо, фигуры идут в одном порядке');
  await expect(page.locator('.survival-rules')).toContainText('Серии очищенных линий заряжают щиты');
  await expect(page.locator('.survival-rules')).toContainText('Закрытие линий аномалиями очищает нижние ряды');
  await expect(page.locator('.survival-rules')).toContainText('Атак нет. Рекорд — по очкам');
  await expect(page.locator('#attack-mode')).toHaveCount(0);
  await expect(page.locator('.survival-mini-board')).toHaveCount(0);
  await expect(page.getByText('Имя', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Лучшие результаты' })).toBeVisible();
  await expect(page.locator('.survival-records')).toContainText('Тест');
  await expect(page.locator('.survival-records .record-duration')).toHaveText(['◷ 02:08', '◷ 01:04']);
  await expect(page.locator('.survival-records')).not.toContainText('Дата неизвестна');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bricks-war:solo-records:v1')!)[0].placedPieces)).toBe(42);
  await expect(page.getByRole('button', { name: 'Начать' })).toBeEnabled();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('.hud-card')).toHaveCount(2);
  await page.goto('/?muted=1');

  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.locator('.participant-card')).toHaveCount(4);
  await expect(page.locator('.battle-player .battle-lobby')).toHaveCount(1);
  await expect(page.locator('.battle-player > h2')).toHaveText('От 2 до 4 игроков');
  await expect(page.locator('.mode-rules')).toHaveCount(1);
  await expect(page.locator('.mode-rules')).toContainText(/КАК ИГРАТЬ[\s\S]*Каждый сам за себя[\s\S]*Атакуйте соперников[\s\S]*щиты[\s\S]*аномалиями[\s\S]*До последнего выжившего; одновременно — по очкам/i);
  await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Игрок 1');
  await expect(page.getByLabel('Имя игрока 2')).toHaveValue('Игрок 2');
  await expect(page.locator('.player-name-control')).toHaveCount(0);
  const playerOneCard = page.locator('.participant-card.player-1');
  await expect(playerOneCard).toHaveCSS('background-color', 'rgb(221, 246, 161)');
  await expect(playerOneCard).toHaveCSS('border-color', 'rgb(120, 170, 24)');
  await expect(playerOneCard.locator('.player-name')).toHaveCSS('color', 'rgb(53, 95, 10)');
  const playerOneName = page.getByLabel('Имя игрока 1');
  const playerOneNameField = playerOneCard.locator('.editable-name-field');
  await expect(playerOneName).toHaveCSS('background-color', 'rgba(255, 252, 241, 0.86)');
  await expect(playerOneNameField).toHaveCSS('position', 'relative');
  await expect(playerOneNameField).toHaveCount(1);
  const removePlayerOne = playerOneCard.getByRole('button', { name: 'Удалить Игрок 1' });
  await expect(removePlayerOne.locator('svg')).toHaveCount(1);
  await expect(removePlayerOne).toHaveText('');
  const removePlayerOneBox = await removePlayerOne.boundingBox();
  const menuScale = (await page.locator(".desktop-menu-stage").boundingBox())!.width / 1120;
  expect(removePlayerOneBox!.width / menuScale).toBeLessThanOrEqual(34.01);
  expect(removePlayerOneBox!.height / menuScale).toBeLessThanOrEqual(34.01);
  await playerOneName.fill('Аня');
  await playerOneName.focus();
  await page.keyboard.press('Backspace');
  await expect(playerOneName).toHaveValue('Ан');
  await expect(page.locator('[data-screen="battle"]')).toBeVisible();
  const editAffordance = await playerOneNameField.evaluate((field) => {
    const fieldBox = field.getBoundingClientRect();
    const inputBox = field.querySelector('input, textarea')?.getBoundingClientRect();
    const pencil = getComputedStyle(field, '::after');
    return {
      content: pencil.content,
      contained: Boolean(inputBox && inputBox.left >= fieldBox.left && inputBox.right <= fieldBox.right),
    };
  });
  expect(editAffordance).toEqual({ content: '"✎"', contained: true });
  await playerOneName.fill('Александра-Игрок');
  await page.getByRole('button', { name: /Главное меню/ }).click();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Александра-Игрок');
  await expect(page.locator('.mode-settings label')).toHaveCount(3);
  await expect(page.getByText('Финальное давление', { exact: true })).toHaveCount(0);
  const aiCard = page.locator('.participant-card').nth(2);
  await aiCard.getByRole('button', { name: /Удалить/ }).click();
  await expect(page.locator('.participant-card').nth(2).getByRole('button', { name: 'Добавить ИИ' })).toBeVisible();
  await page.locator('.participant-card').nth(2).getByRole('button', { name: 'Добавить ИИ' }).click();
  await expect(page.locator('.participant-card').nth(2).getByRole('button', { name: /Удалить/ })).toBeVisible();

  await page.getByRole('button', { name: /Главное меню/ }).click();
  await page.getByRole('button', { name: /^Командный бой/ }).click();
  await expect(page.locator('.mode-rules')).toHaveCount(1);
  await expect(page.locator('.mode-rules')).toContainText(/Две команды по два игрока[\s\S]*Атакуйте команду соперников[\s\S]*До последней команды; одновременно — по очкам/);
  await expect(page.locator('.team-group')).toHaveCount(2);
  await expect(page.locator('.team-group > header')).toHaveCount(0);
  await expect(page.getByText(/Команда Солнца|Команда Неба|Слоты слева|Слоты справа/)).toHaveCount(0);
  await expect(page.locator('.versus')).toHaveText('VS');
  const [firstTeam, secondTeam, versus] = await Promise.all([
    page.locator('.team-group').nth(0).boundingBox(),
    page.locator('.team-group').nth(1).boundingBox(),
    page.locator('.versus').boundingBox(),
  ]);
  expect(firstTeam?.y ?? Infinity).toBeLessThan(versus?.y ?? 0);
  expect(versus?.y ?? Infinity).toBeLessThan(secondTeam?.y ?? 0);
  await expect(page.getByRole('button', { name: 'Начать' })).toBeDisabled();
});

test('starts a valid setup with the gamepad X button', async ({ page }) => {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: 'Start Pad', index: 0, connected: true, axes: [0, 0], buttons, mapping: 'standard', timestamp: 0 };
    Object.defineProperty(window, '__startPad', { configurable: true, value: pad });
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  });
  await page.reload();
  await page.getByRole('button', { name: /^Выживание/ }).click();
  await expect(page.getByRole('button', { name: 'Начать' })).toBeEnabled();
  await page.evaluate(() => {
    const pad = (window as typeof window & { __startPad: { buttons: Array<{ pressed: boolean }> } }).__startPad;
    pad.buttons[2]!.pressed = true;
  });
  await expect(page.locator('.arena-screen')).toBeVisible();
});

test('starts Survival with four distinct human controllers and no AI', async ({ page }) => {
  await page.addInitScript(() => {
    const pad = (index: number) => ({ id: `Family Pad ${index + 1}`, index, connected: true, axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })), mapping: 'standard', timestamp: 0 });
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad(0), pad(1)] });
  });
  await page.reload();
  await page.getByRole('button', { name: /^Выживание/ }).click();
  await page.getByRole('button', { name: 'Добавить игрока' }).first().click();
  await page.getByRole('button', { name: 'Добавить игрока' }).first().click();
  await expect(page.locator('.survival-lobby .participant-card.occupied')).toHaveCount(4);
  await expect(page.locator('.survival-lobby [data-add-ai]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Начать' })).toBeEnabled();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('.hud-card')).toHaveCount(4);
});

test('uses premium dropdowns with pointer keyboard and gamepad', async ({ page }) => {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: 'Family Pad', index: 0, connected: true, axes: [0, 0], buttons, mapping: 'standard', timestamp: 0 };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    Object.defineProperty(window, '__setMenuPadButton', { configurable: true, value: (index: number, pressed: boolean) => {
      buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 };
    } });
  });
  await page.reload();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.locator('select:visible')).toHaveCount(0);

  const duration = page.getByRole('combobox', { name: 'Длительность матча' });
  await duration.click();
  const durationList = page.getByRole('listbox', { name: 'Длительность матча' });
  await expect(durationList).toBeVisible();
  await expect(durationList.getByRole('option', { name: /До победы$/ })).toHaveClass(/is-highlighted/);
  await expect(durationList).toHaveCSS('background-color', 'rgb(255, 250, 240)');
  await durationList.getByRole('option', { name: /2 мин/ }).click();
  await expect(page.locator('#match-duration')).toHaveValue('2');

  const attacks = page.getByRole('combobox', { name: 'Режим атаки' });
  await attacks.focus();
  await attacks.press('Enter');
  await expect(attacks).toHaveAttribute('aria-expanded', 'true');
  await attacks.press('ArrowUp');
  await expect(page.getByRole('listbox', { name: 'Режим атаки' }).getByRole('option', { name: /Только лидеру/ })).toHaveClass(/is-highlighted/);
  await attacks.press('Enter');
  await expect(page.locator('#attack-mode')).toHaveValue('hunt-leader');

  const battleDifficulty = page.getByRole('combobox', { name: 'Сложность битвы' });
  await battleDifficulty.hover();
  const setPad = async (index: number, pressed: boolean) => {
    await page.evaluate(({ index, pressed }) => (window as typeof window & { __setMenuPadButton: (button: number, down: boolean) => void }).__setMenuPadButton(index, pressed), { index, pressed });
    await page.waitForTimeout(80);
  };
  await setPad(0, true);
  await setPad(0, false);
  await expect(battleDifficulty).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('listbox', { name: 'Сложность битвы' }).getByRole('option', { name: /Обычный\. Стандартный темп битвы/ })).toBeVisible();
  await setPad(13, true);
  await setPad(13, false);
  await setPad(0, true);
  await setPad(0, false);
  await expect(page.locator('#battle-difficulty')).toHaveValue('sport');
  await setPad(0, true);
  await setPad(0, false);
  await setPad(1, true);
  await setPad(1, false);
  await expect(battleDifficulty).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-screen="battle"]')).toBeVisible();
});

test('carries the premium release shell through controls and the local laboratory', async ({ page }) => {
  const expectContainedLaboratoryHeader = async () => {
    const layout = await page.locator('.debug-lab-header').evaluate((header) => {
      const headerBox = header.getBoundingClientRect();
      const children = Array.from(header.children).map((child) => {
        const box = child.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      });
      const overlaps = children.some((box, index) => children.slice(index + 1).some((other) => (
        Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1
        && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1
      )));
      return {
        contained: children.every((box) => box.left >= headerBox.left - 1 && box.right <= headerBox.right + 1 && box.top >= headerBox.top - 1 && box.bottom <= headerBox.bottom + 1),
        overlaps,
        overflow: header.scrollWidth > header.clientWidth + 1,
      };
    });
    expect(layout).toEqual({ contained: true, overlaps: false, overflow: false });
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole('button', { name: /Настройки/ }).click();
  await expect(page.locator('[data-screen="settings"]')).toHaveClass(/premium-surface/);
  await page.getByRole('button', { name: /Управление/ }).click();
  await expect(page.locator('[data-screen="controls"]')).toHaveClass(/premium-surface/);
  await page.getByRole('button', { name: /Настройки/ }).click();
  await page.getByRole('button', { name: /Лаборатория дизайна/ }).click();
  await expect(page.locator('[data-screen="laboratory"]')).toHaveClass(/premium-surface/);
  expect(await page.locator('[data-screen="laboratory"]').evaluate((surface) => getComputedStyle(surface).backgroundImage))
    .not.toContain('radial-gradient');
  await expectContainedLaboratoryHeader();
  await page.setViewportSize({ width: 800, height: 900 });
  await expectContainedLaboratoryHeader();
  await expect(page.locator('.debug-group h2')).toHaveText([
    'Движение фигур',
    'Ритм матча',
    'Сложность битвы',
    'Компьютерные игроки',
    'Наклоны телефона',
    'Сообщения матча',
  ]);
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible();
});

test('lets an unassigned gamepad confirm the focused Back action with A without joining', async ({ page }) => {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: 'Family Pad', index: 0, connected: true, axes: [0, 0], buttons, mapping: 'standard', timestamp: 0 };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    Object.defineProperty(window, '__pressPadA', { configurable: true, value: (pressed: boolean) => { buttons[0] = { pressed, touched: pressed, value: pressed ? 1 : 0 }; } });
  });
  await page.reload();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await page.evaluate(() => (window as typeof window & { __pressPadA: (pressed: boolean) => void }).__pressPadA(true));
  await page.waitForTimeout(80);
  await page.evaluate(() => (window as typeof window & { __pressPadA: (pressed: boolean) => void }).__pressPadA(false));
  await expect(page.locator('[data-screen="main-menu"]')).toBeVisible();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.locator('[data-slot-card="3"].empty')).toBeVisible();
});
