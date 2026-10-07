import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?muted=1');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('bricks-war:solo-records:v1', JSON.stringify([
      { id: 'phone-record', name: 'Женя', elapsedMs: 97_000, lineScore: 5_400, total: 5_400, finishedAt: 1_700_000_000_000, placedPieces: 31 },
    ]));
  });
  await page.reload();
});

test('keeps the supported phone release flow touch-accessible', async ({ page }) => {
  const mainMenuMetrics = await page.locator('.main-menu-screen').evaluate((screen) => {
    const footer = screen.querySelector<HTMLElement>('.release-guidance-footer');
    return {
      clientHeight: screen.clientHeight,
      scrollHeight: screen.scrollHeight,
      overflow: getComputedStyle(screen).overflowY,
      footerHeight: footer?.getBoundingClientRect().height ?? 0,
      footerBottom: footer?.getBoundingClientRect().bottom ?? 0,
    };
  });
  expect(mainMenuMetrics.scrollHeight).toBe(mainMenuMetrics.clientHeight);
  expect(mainMenuMetrics.overflow).toBe('hidden');
  expect(mainMenuMetrics.footerHeight).toBeLessThanOrEqual(90);
  expect(mainMenuMetrics.footerBottom).toBeLessThanOrEqual(mainMenuMetrics.clientHeight);
  await expect(page.locator('.release-build-info')).toHaveText(/^Версия \d+\.\d+\.\d+(?:-dev)?(?: · Деплой .+)?$/);

  const menu = page.getByRole('navigation', { name: 'Главное меню' });
  await expect(menu.getByRole('button')).toHaveCount(4);
  await expect(menu.getByRole('button')).toContainText(['Выживание', 'Битва', 'Сетевая игра', 'Настройки']);
  await expect(page.locator('.main-menu-screen .is-ui-selected')).toHaveCount(0);
  await menu.getByRole('button', { name: /^Битва/ }).hover();
  await expect(page.locator('.main-menu-screen .is-ui-selected')).toHaveCount(0);
  await expect(page.locator('.input-badge')).toHaveCount(0);

  await page.getByRole('button', { name: /^Выживание/ }).click();
  await expect(page.locator('.mobile-survival-records')).toContainText('Женя');
  await expect(page.locator('.mobile-survival-records')).toContainText('5 400');
  await expect(page.getByLabel('Имя игрока 1')).toBeVisible();
  await expect(page.locator('[data-mobile-setting="inputMode"], [data-mobile-tilt-setup]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible();
  await expect(page.locator('.is-ui-selected')).toHaveCount(0);
  await page.getByRole('button', { name: 'Начать' }).hover();
  await expect(page.locator('.is-ui-selected')).toHaveCount(0);
  await expect(page.locator('.footer-start kbd')).toHaveCount(0);

  await page.getByRole('button', { name: 'Начать' }).click();
  const pause = page.getByRole('button', { name: 'Поставить матч на паузу' });
  await expect(pause).toBeVisible();
  const touchZones = page.locator('.mobile-touch-zones');
  await expect(touchZones).toBeVisible();
  const touchZoneMetrics = await touchZones.evaluate((zones) => {
    const box = zones.getBoundingClientRect();
    return { width: box.width, height: box.height, columns: getComputedStyle(zones).gridTemplateColumns };
  });
  expect(touchZoneMetrics.width).toBeGreaterThan(300);
  expect(touchZoneMetrics.height).toBeGreaterThan(700);
  expect(touchZoneMetrics.columns).toContain('px');
  await expect(page.getByRole('button', { name: '← В меню' })).toHaveCount(0);
  await pause.click();
  await expect(page.locator('#pause-overlay')).toBeVisible();
  await expect(page.locator('.mobile-match-actions')).toBeHidden();
  await expect(page.locator('.mobile-touch-zones')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Заново' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Главное меню' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#pause-overlay')).toBeHidden();
});

test('explains phone controls and omits desktop-only fullscreen settings', async ({ page }) => {
  await page.getByRole('button', { name: /^Настройки/ }).click();
  await expect(page.getByRole('button', { name: /Полноэкранный режим/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Управление/ })).toHaveCount(0);
  await expect(page.locator('.mobile-controls-reference')).toHaveCount(0);
});

test('keeps phone Battle context in side zones and makes Pause exclusive', async ({ page }) => {
  await page.getByRole('button', { name: /^Битва/ }).click();
  const attackMode = page.getByRole('combobox', { name: 'Режим атаки' });
  await expect(attackMode).toContainText('Всем соперникам');
  await attackMode.click();
  await page.getByRole('option', { name: 'Только лидеру' }).click();
  await expect(attackMode).toContainText('Только лидеру');
  await page.getByRole('combobox', { name: 'Соперники' }).click();
  await page.getByRole('option', { name: /3 ИИ/ }).click();
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.locator('.hud-card')).toHaveCount(4);
  await expect(page.locator('.arena-screen')).toHaveAttribute('data-conflict', 'on');

  const cards = await page.locator('.hud-card').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
  }));
  const [player, firstAi, secondAi, thirdAi] = cards;
  expect(player!.width).toBeGreaterThan(firstAi!.width);
  expect(firstAi!.left).toBeGreaterThan(player!.right);
  expect(secondAi!.left).toBeGreaterThan(player!.right);
  expect(thirdAi!.left).toBeGreaterThan(player!.right);
  expect(firstAi!.bottom).toBeLessThanOrEqual(secondAi!.top);
  expect(secondAi!.bottom).toBeLessThanOrEqual(thirdAi!.top);

  await page.getByRole('button', { name: 'Поставить матч на паузу' }).click();
  await expect(page.locator('.mobile-match-actions')).toBeHidden();
  await expect(page.locator('.mobile-touch-zones')).toBeHidden();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  const settings = page.locator('#pause-settings-panel');
  const settingsBounds = await settings.evaluate((panel) => {
    const box = panel.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight };
  });
  expect(settingsBounds.top).toBeGreaterThanOrEqual(0);
  expect(settingsBounds.bottom).toBeLessThanOrEqual(844);
  expect(settingsBounds.scrollHeight).toBe(settingsBounds.clientHeight);
});

test('shows all ten Survival records above Start without scrolling', async ({ page }) => {
  await page.evaluate(() => {
    const records = Array.from({ length: 10 }, (_, index) => ({
      id: `scroll-record-${index}`,
      name: `Рекорд ${index + 1}`,
      elapsedMs: 60_000 + index * 1_000,
      lineScore: 10_000 - index * 100,
      total: 10_000 - index * 100,
      finishedAt: 1_700_000_000_000,
      placedPieces: 20 + index,
    }));
    localStorage.setItem('bricks-war:solo-records:v1', JSON.stringify(records));
  });
  await page.reload();
  await page.getByRole('button', { name: /^Выживание/ }).click();
  const scrolling = await page.locator('.setup-scroll, .mobile-survival-records ol').evaluateAll(elements => elements.filter(el => el.scrollHeight > el.clientHeight + 1 || el.scrollTop !== 0).map(el => el.className));
  expect(scrolling).toEqual([]);
  await expect(page.locator('.mobile-survival-records li:visible')).toHaveCount(10);
  const [lastRecord, start] = await Promise.all([
    page.locator('.mobile-survival-records li').last().boundingBox(),
    page.getByRole('button', { name: 'Начать', exact: true }).boundingBox(),
  ]);
  expect(lastRecord).not.toBeNull();
  expect(start).not.toBeNull();
  const recordList = await page.locator('.mobile-survival-records ol').boundingBox();
  expect(lastRecord!.y).toBeGreaterThanOrEqual(recordList!.y);
  expect(lastRecord!.y + lastRecord!.height).toBeLessThanOrEqual(recordList!.y + recordList!.height + 1);
  expect(lastRecord!.y + lastRecord!.height).toBeLessThanOrEqual(start!.y - 8);
});


test('legacy tilt preference still offers screen controls only', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('bricks-war:mobile-settings:v1', JSON.stringify({ inputMode: 'tilt', aiCount: 3, aiDifficulty: 'hard' })));
  await page.reload();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.locator('[data-mobile-setting="inputMode"], [data-mobile-tilt-setup]')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Соперники' })).toContainText('3 ИИ');
  await expect(page.getByRole('combobox', { name: 'Сложность ИИ' })).toContainText('Сложная');
  await expect(page.locator('.mobile-solo-setup')).not.toContainText('Наклоны');
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.locator('.mobile-touch-zones')).toBeVisible();
  await expect(page.locator('[data-mobile-tilt-status]')).toHaveCount(0);
});
