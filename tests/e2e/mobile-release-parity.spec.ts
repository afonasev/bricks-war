import { openLocalLobby } from '../helpers/localLobby';
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
  await expect(page.locator('.release-build-info')).toHaveText(/^Версия \d+\.\d+\.\d+(?:-dev)?(?: · .+)?$/);

  const menu = page.getByRole('navigation', { name: 'Главное меню' });
  await expect(menu.getByRole('button')).toHaveCount(3);
  await expect(menu.getByRole('button')).toContainText(['Играть', 'Сетевая игра', 'Настройки']);
  await expect(page.locator('.main-menu-screen .is-ui-selected')).toHaveCount(0);
  await menu.getByRole('button', { name: /^Играть/ }).hover();
  await expect(page.locator('.main-menu-screen .is-ui-selected')).toHaveCount(0);
  await expect(page.locator('.input-confirm')).toHaveText('A');
  await expect(page.locator('.input-confirm')).toBeHidden();
  await expect(page.locator('.input-back')).toHaveCount(0);

  await openLocalLobby(page,'survival');
  await page.locator('[data-open-rating]').click();
  await expect(page.locator('.lobby-dialog')).toContainText('Женя');
  await expect(page.locator('.lobby-dialog')).toContainText('5 400');
  await page.getByRole('button', { name: 'В лобби', exact: true }).click();
  await expect(page.getByRole('button', {name:'Настроить участника 1',exact:true})).toBeVisible();
  await expect(page.locator('[data-mobile-setting="inputMode"], [data-mobile-tilt-setup]')).toHaveCount(0);
  await expect(page.locator('#start-match')).toBeVisible();
  await expect(page.locator('.is-ui-selected')).toHaveCount(0);
  await page.locator('#start-match').hover();
  await expect(page.locator('.is-ui-selected')).toHaveCount(0);
  await expect(page.locator('.footer-start kbd')).toHaveCount(0);

  await page.locator('#start-match').click();
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
  expect(await page.locator('.pause-panel:visible').evaluate(el => ['::before', '::after'].map(p => getComputedStyle(el, p).content))).toEqual(['none', 'none']);
  if (process.env.BRICKS_RECORD_SCREENSHOTS) {
    await page.screenshot({path: `${process.env.BRICKS_RECORD_SCREENSHOTS}/pause-390x844.png`});
    await page.setViewportSize({width:1920,height:1080});
    await expect(page.locator('#app')).toHaveAttribute('data-layout','desktop');
    await page.screenshot({path: `${process.env.BRICKS_RECORD_SCREENSHOTS}/pause-1920x1080.png`});
    await page.setViewportSize({width:390,height:844});
    await expect(page.locator('#app')).toHaveAttribute('data-layout','mobile');
  }
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
  await expect(page.locator('#open-controls')).toBeVisible();
  await page.locator('#open-controls').click();
  await expect(page.locator('[data-phone-controls-help]')).toBeVisible();
  await expect(page.locator('.phone-controls-diagram')).toHaveAttribute('data-bottom-zone-fraction', '0.21875');
  await expect(page.locator('.phone-controls-rotate-area')).toContainText('Коснитесь — повернуть');
  await expect(page.locator('.phone-controls-pause')).toContainText('Нажмите кнопку паузы в матче.');
  await page.locator('#controls-back').click();
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  await expect(page.locator('#open-controls')).toBeVisible();
  await expect(page.locator('.mobile-controls-reference')).toHaveCount(0);
});

test('keeps phone Battle context in side zones and makes Pause exclusive', async ({ page }) => {
  await openLocalLobby(page,'battle');
  const attackMode = page.getByRole('combobox', { name: 'Режим атаки' });
  await expect(attackMode).toContainText('Всем соперникам');
  await attackMode.click();
  await page.getByRole('option', { name: 'Только лидеру' }).click();
  await expect(attackMode).toContainText('Только лидеру');
  await page.getByRole('combobox', { name: 'Соперники' }).click();
  await page.getByRole('option', { name: /3 ИИ/ }).click();
  await page.locator('#start-match').click();
  await expect(page.locator('.hud-card')).toHaveCount(4);
  await expect(page.locator('#countdown')).toBeHidden();
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
  const controls = await page.locator('.mobile-match-actions').boundingBox();
  expect(controls).not.toBeNull();
  expect(cards.every((card) => controls!.y + controls!.height <= card.top)).toBe(true);
  await expect(page.locator('.mobile-match-timer')).toBeVisible();

  expect(firstAi!.left).toBe(secondAi!.left);
  expect(secondAi!.left).toBe(thirdAi!.left);
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
  await page.getByRole('button', { name: '← Назад к паузе' }).click();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#pause-overlay')).toBeHidden();
  await expect(page.locator('.mobile-match-actions')).toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#hud-grid')).toHaveAttribute('data-cell-size', '14');
  const landscapeCards = await page.locator('.hud-card').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
  }));
  const [landscapePlayer, landscapeFirstAi, landscapeSecondAi, landscapeThirdAi] = landscapeCards;
  expect(landscapePlayer!.width).toBeGreaterThan(landscapeFirstAi!.width);
  expect(landscapePlayer!.top).toBeGreaterThanOrEqual(48);
  expect(landscapeFirstAi!.left).toBeGreaterThan(landscapePlayer!.right);
  expect(landscapeSecondAi!.left).toBeGreaterThan(landscapePlayer!.right);
  expect(landscapeThirdAi!.left).toBeGreaterThan(landscapePlayer!.right);
  expect(landscapeFirstAi!.top).toBe(landscapeSecondAi!.top);
  expect(landscapeSecondAi!.top).toBe(landscapeThirdAi!.top);
  expect(landscapeFirstAi!.right).toBeLessThanOrEqual(landscapeSecondAi!.left);
  expect(landscapeSecondAi!.right).toBeLessThanOrEqual(landscapeThirdAi!.left);
  const landscapeAiText = await page.locator('.mobile-ai-card').evaluateAll((elements) => elements.map((card) => {
    const label = card.querySelector<HTMLElement>('.hud-identity strong');
    const score = card.querySelector<HTMLElement>('.hud-stats b');
    return [label, score].map((element) => ({
      text: element?.textContent?.trim() ?? '',
      fits: Boolean(element && element.scrollWidth <= element.clientWidth),
      textOverflow: element ? getComputedStyle(element).textOverflow : '',
    }));
  }));
  expect(landscapeAiText.flat().every((item) => item.text.length > 0 && item.fits && item.textOverflow !== 'ellipsis')).toBe(true);
  const landscapeControls = await page.locator('.mobile-match-actions').boundingBox();
  expect(landscapeControls).not.toBeNull();
  expect(landscapeCards.every((card) => landscapeControls!.y + landscapeControls!.height <= card.top)).toBe(true);
  await page.getByRole('button', { name: 'Поставить матч на паузу' }).click();
  await expect(page.locator('#pause-overlay')).toBeVisible();
  await expect(page.locator('.mobile-match-actions')).toBeHidden();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(settings).toBeVisible();
  const landscapeSettings = await settings.evaluate((panel) => {
    const bounds = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    };
    const body = panel.querySelector<HTMLElement>('.pause-preferences-scroll')!;
    return { panel: bounds(panel), heading: bounds(panel.querySelector('h2')!),
      back: bounds(panel.querySelector('#pause-settings-back')!), body: bounds(body),
      scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight,
      scrollWidth: body.scrollWidth, clientWidth: body.clientWidth };
  });
  expect(landscapeSettings.panel.top).toBeGreaterThanOrEqual(0);
  expect(landscapeSettings.panel.bottom).toBeLessThanOrEqual(390);
  expect(landscapeSettings.panel.left).toBeGreaterThanOrEqual(0);
  expect(landscapeSettings.panel.right).toBeLessThanOrEqual(844);
  expect(landscapeSettings.scrollHeight).toBe(landscapeSettings.clientHeight);
  expect(landscapeSettings.scrollWidth).toBe(landscapeSettings.clientWidth);
  expect(landscapeSettings.heading.bottom).toBeLessThanOrEqual(landscapeSettings.body.top);
  expect(landscapeSettings.body.bottom).toBeLessThanOrEqual(landscapeSettings.back.top);
  const languageSpacing = await settings.locator('.settings-language-section').evaluate((section) => {
    const box = (element: Element) => element.getBoundingClientRect();
    const caption = box(section.querySelector('strong')!);
    const hint = box(section.querySelector('small')!);
    const value = box(section.querySelector('.menu-select-value')!);
    const trigger = box(section.querySelector('[data-menu-select-trigger]')!);
    const card = box(section);
    return { captionLeft: caption.left, hintLeft: hint.left, valueLeft: value.left,
      insetX: caption.left - card.left, insetY: caption.top - card.top,
      triggerTop: trigger.top, triggerBottom: trigger.bottom };
  });
  expect(languageSpacing.insetX).toBeGreaterThanOrEqual(12);
  expect(languageSpacing.insetY).toBeGreaterThanOrEqual(8);
  expect(languageSpacing.captionLeft).toBe(languageSpacing.valueLeft);
  expect(languageSpacing.hintLeft).toBe(languageSpacing.valueLeft);
  expect(languageSpacing.triggerTop).toBeGreaterThanOrEqual(landscapeSettings.body.top);
  expect(languageSpacing.triggerBottom).toBeLessThanOrEqual(landscapeSettings.body.bottom);
  const deadzone = settings.locator('[data-stick="stickDeadzone"]');
  await deadzone.scrollIntoViewIfNeeded();
  const lastControl = await deadzone.boundingBox();
  expect(lastControl).not.toBeNull();
  expect(lastControl!.y).toBeGreaterThanOrEqual(landscapeSettings.body.top);
  expect(lastControl!.y + lastControl!.height).toBeLessThanOrEqual(landscapeSettings.body.bottom);
  const sliderPairs = await settings.locator('.volume-control').evaluateAll((rows) => rows.map((row) => {
    const label = row.querySelector('span')!;
    const range = document.createRange(); range.selectNodeContents(label);
    const text = range.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    const slider = row.querySelector('input')!.getBoundingClientRect();
    const overlap = Math.max(0, Math.min(text.right, slider.right) - Math.max(text.left, slider.left))
      * Math.max(0, Math.min(text.bottom, slider.bottom) - Math.max(text.top, slider.top));
    return { text: label.textContent, overlap, fits: text.left >= labelBox.left && text.right <= labelBox.right };
  }));
  expect(sliderPairs).toHaveLength(5);
  expect(sliderPairs.every((pair) => pair.overlap === 0 && pair.fits)).toBe(true);
  const fixedBack = await settings.locator('#pause-settings-back').boundingBox();
  expect(fixedBack).not.toBeNull();
  expect(fixedBack!.y).toBe(landscapeSettings.back.top);
  await page.getByRole('button', { name: '← Назад к паузе' }).click();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#pause-overlay')).toBeHidden();
  await expect(page.locator('.mobile-match-actions')).toBeVisible();
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
  await openLocalLobby(page,'survival');
  const scrolling = await page.locator('.setup-scroll, .mobile-survival-records ol').evaluateAll(elements => elements.filter(el => el.scrollHeight > el.clientHeight + 1 || el.scrollTop !== 0).map(el => el.className));
  expect(scrolling).toEqual([]);
  await expect(page.locator('.mobile-survival-records li:visible')).toHaveCount(10);
  const [lastRecord, start] = await Promise.all([
    page.locator('.mobile-survival-records li').last().boundingBox(),
    page.locator('#start-match').boundingBox(),
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
  await openLocalLobby(page,'battle');
  await expect(page.locator('[data-mobile-setting="inputMode"], [data-mobile-tilt-setup]')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Соперники' })).toContainText('3 ИИ');
  await expect(page.getByRole('combobox', { name: 'Сложность ИИ' })).toContainText('Сложная');
  await expect(page.locator('.mobile-solo-setup')).not.toContainText('Наклоны');
  await page.locator('#start-match').click();
  await expect(page.locator('.mobile-touch-zones')).toBeVisible();
  await expect(page.locator('[data-mobile-tilt-status]')).toHaveCount(0);
});
