import { expect, test, type Page } from '@playwright/test';
const key = 'bricks-war:gamepad-profiles:v2';
const device = JSON.stringify(['Same Pad', 'standard', 16, 2]);
async function installPads(page: Page, profiles: unknown = [], identical = true, blocked = false) {
  await page.addInitScript(({ profiles, identical, key, blocked }) => {
    const pads = [0, 1].map((index) => ({ index, id: identical ? 'Same Pad' : `Wireless Controller With A Very Long Vendor And Product Name (STANDARD GAMEPAD Vendor: 1234 Product: abcd) ${index}`, connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: 0 }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
    Object.assign(window, { rosterPads: pads });
    if (localStorage.getItem(key) === null) localStorage.setItem(key, typeof profiles === 'string' ? profiles : JSON.stringify(profiles));
    if (blocked) {
      Storage.prototype.getItem = () => { throw new Error('blocked'); };
      Storage.prototype.setItem = () => { throw new Error('blocked'); };
    }
  }, { profiles, identical, key, blocked });
  await page.goto('/?muted=1');
}
async function press(page: Page, index: number, button = 3) {
  await page.evaluate(({ index, button }) => {
    const pads = (window as any).rosterPads;
    pads[index].buttons[button].pressed = true;
  }, { index, button });
  await page.waitForTimeout(60);
  await page.evaluate(({ index, button }) => { (window as any).rosterPads[index].buttons[button].pressed = false; }, { index, button });
  await page.waitForTimeout(60);
}
async function emptySlot(page: Page, index: number) {
  await page.locator(`[data-remove-slot="${index}"]`).click();
}
async function select(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  const list = page.getByRole('listbox', { name: label, exact: true });
  const item = list.getByRole('option', { name: option, exact: true });
  while (!(await item.isVisible())) await list.getByRole('button', { name: 'Следующие →', exact: true }).click();
  await item.click();
}
for (const mode of ['Выживание', 'Битва', 'Командный бой']) {
  test(`Y joins and moves named players in ${mode}`, async ({ page }) => {
    if (mode === 'Выживание') await page.addInitScript(() => localStorage.setItem('bricks-war:slot-selections:v1', JSON.stringify(['human-1', 'human-2', 'off', 'off'])));
    await installPads(page, [], false);
    await page.getByRole('button', { name: new RegExp(`^${mode}`) }).click();
    if (mode !== 'Выживание') await emptySlot(page, 2);
    await press(page, 0);
    await expect(page.locator('[data-slot="2"]')).toHaveValue('gamepad-0');
    await page.getByLabel('Имя игрока 3').fill('Александр Великий');
    await select(page, 'Стиль участника 3', 'Морские кристаллы');
    await press(page, 0);
    await expect(page.locator('[data-slot="3"]')).toHaveValue('gamepad-0');
    await expect(page.getByLabel('Имя игрока 4')).toHaveValue('Александр Великий');
    await expect(page.locator('[data-tile-style="3"]')).toHaveValue('sea-crystals');
    // Both newly pressed devices are processed in the same frame.
    await page.evaluate(() => { (window as any).rosterPads.forEach((pad: any) => { pad.buttons[3].pressed = true; }); });
    await expect(page.locator('[data-slot="2"]')).toHaveValue('gamepad-0');
    await expect(page.locator('[data-slot="3"]')).toHaveValue('gamepad-1');
    await page.evaluate(() => { (window as any).rosterPads.forEach((pad: any) => { pad.buttons[3].pressed = false; }); });
    await page.waitForTimeout(60);
    await press(page, 0);
    await expect(page.locator('[data-slot="2"]')).toHaveValue('gamepad-0');
    await expect(page.locator('[data-player-name="2"]')).toHaveValue('Александр Великий');
    await press(page, 0, 2);
    await expect(page.locator('.hud-card')).toHaveCount(4);
    await expect(page.locator('.hud-identity strong').nth(2)).toHaveText('Александр Великий');
    await press(page, 0);
    await expect(page.locator('.hud-identity strong').nth(2)).toHaveText('Александр Великий');
  });
}

test('requires explicit name choice for identical pads in reversed connection order and rechecks disconnect', async ({ page }) => {
  await installPads(page, [{ id: 'a', device, name: 'Александр Великий' }, { id: 'b', device, name: 'Второй игрок' }]);
  await page.getByRole('button', { name: /^Битва/ }).click();
  await press(page, 1);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-slot-card="3"].empty')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await press(page, 1);
  await page.getByRole('button', { name: 'Александр Великий', exact: true }).click();
  await expect(page.locator('[data-slot="3"]')).toHaveValue('gamepad-1');
  await expect(page.getByLabel('Имя игрока 4')).toHaveValue('Александр Великий');
  await emptySlot(page, 2);
  await press(page, 0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Александр Великий', exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).rosterPads[0].connected = false; });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-slot-card="2"].empty')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.locator('[data-slot-card="3"].empty')).toBeVisible();
  await press(page, 0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-slot="2"]')).toHaveValue('gamepad-0');
});

test('preserves manual controller replacement name and forgets live assignment on reused index', async ({ page }) => {
  await installPads(page, [], false);
  await page.getByRole('button', { name: /^Битва/ }).click();
  await page.getByLabel('Имя игрока 1').fill('Лена');
  await select(page, 'Участник 1', 'Геймпад 1');
  await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Лена');
  await expect(page.locator('[data-slot="0"]')).toHaveValue('gamepad-0');
  await expect(page.getByRole('combobox', { name: 'Участник 1', exact: true }).locator('.menu-select-value')).toHaveText('Геймпад 1');
  for (const [width, height] of [[1440, 960], [1280, 480]] as const) {
    await page.setViewportSize({ width, height });
    const control = page.getByRole('combobox', { name: 'Участник 1', exact: true });
    expect(await control.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
    await page.screenshot({ path: `evidence/short-gamepad-labels/controller-${width}x${height}.png` });
  }
  await emptySlot(page, 0);
  await press(page, 0);
  await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Лена');
  await page.evaluate(() => { (window as any).rosterPads[0].connected = false; });
  await expect(page.locator('[data-slot-card="0"].empty')).toBeVisible();
  await page.evaluate(() => { const pad = (window as any).rosterPads[0]; pad.connected = true; pad.id = 'Different Pad'; });
  await expect(page.locator('[data-slot-card="0"].empty')).toBeVisible();
  await press(page, 0);
  await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Игрок 1');
});

for (const blocked of [false, true]) {
  test(`uses deterministic names with ${blocked ? 'inaccessible' : 'malformed'} storage`, async ({ page }) => {
    await installPads(page, '{malformed', false, blocked);
    await page.getByRole('button', { name: /^Битва/ }).click();
    await press(page, 0);
    await expect(page.getByLabel('Имя игрока 4')).toHaveValue('Игрок 4');
    await page.getByLabel('Имя игрока 4').fill('Имя в памяти');
    await emptySlot(page, 3);
    await press(page, 0);
    await expect(page.getByLabel('Имя игрока 4')).toHaveValue('Имя в памяти');
  });
}

test('phone solo ignores Y and keeps only the touch player', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installPads(page);
  await page.getByRole('button', { name: /^Выживание/ }).click();
  await page.getByLabel('Имя игрока 1').fill('Александр Великий');
  await press(page, 0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.locator('.hud-card')).toHaveCount(1);
  await expect(page.locator('.hud-identity strong')).toHaveText('Александр Великий');
});

for (const width of [1440, 800, 390]) {
  test(`keeps full-length names and lobby controls readable without overlap at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.goto('/?muted=1');
    for (const mode of width === 390 ? ['Выживание', 'Битва'] : ['Выживание', 'Битва', 'Командный бой']) {
      await page.getByRole('button', { name: new RegExp(`^${mode}`) }).click();
      await page.getByLabel('Имя игрока 1').fill('ШШШШШШШШШШШШШШШШШШ');
      await expect.poll(async () => page.getByLabel('Имя игрока 1').evaluate((input) => {
        const el = input as HTMLInputElement;
        const style = getComputedStyle(el);
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = style.font;
        const pencil = el.classList.contains('editable-player-name') ? 24 : 0;
        if (el instanceof HTMLTextAreaElement && el.rows === 2) return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
        return context.measureText(el.value).width <= el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - pencil + 1;
      })).toBe(true);
      // Mobile scrolls; desktop checks full rectangles without clipping.
      for (const end of width === 390 ? [false, true] : [false]) {
        await page.locator('.setup-scroll').evaluate((main, end) => { main.scrollTop = end ? main.scrollHeight : 0; }, end);
        const layout = await page.evaluate(() => {
          const main = document.querySelector('.setup-scroll')!.getBoundingClientRect();
          const footer = document.querySelector('.release-guidance-footer')!.getBoundingClientRect();
          const controls = [...document.querySelectorAll<HTMLElement>('input, button, .menu-select-trigger')].filter(el => !el.closest('[hidden]') && !el.closest('.release-guidance-footer') && el.getBoundingClientRect().width > 0);
          const rects = controls.map(el => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: innerWidth <= 760 ? Math.max(r.top, main.top) : r.top, bottom: innerWidth <= 760 ? Math.min(r.bottom, main.bottom) : r.bottom, label: el.getAttribute('aria-label') || el.textContent };
          }).filter(r => r.bottom > r.top);
          const overlap = rects.flatMap((a, index) => rects.slice(index + 1).filter(b => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1).map(b => [a.label, b.label]));
          return { overlap, footerOverlap: rects.filter(r => r.bottom > footer.top + 1).map(r => r.label), horizontalOverflow: rects.filter(r => r.left < -1 || r.right > innerWidth + 1).map(r => r.label) };
        });
        expect(layout).toEqual({ overlap: [], footerOverlap: [], horizontalOverflow: [] });
      }
      await page.getByRole('button', { name: '← Главное меню' }).click();
    }
  });
}

test('queues simultaneous saved-name choices and rechecks the destination before confirmation', async ({ page }) => {
  await installPads(page, [{ id: 'a', device, name: 'Первый игрок' }, { id: 'b', device, name: 'Второй игрок' }]);
  await page.getByRole('button', { name: /^Битва/ }).click();
  await page.evaluate(() => { (window as any).rosterPads.forEach((pad: any) => { pad.buttons[3].pressed = true; }); });
  await expect(page.getByRole('dialog')).toContainText('Геймпад 1');
  await page.evaluate(() => { (window as any).rosterPads.forEach((pad: any) => { pad.buttons[3].pressed = false; }); });
  await page.waitForTimeout(60);
  await press(page, 0, 0);
  await expect(page.locator('[data-slot="3"]')).toHaveValue('gamepad-0');
  await expect(page.getByRole('dialog')).toContainText('Геймпад 2');
  await expect(page.getByRole('button', { name: 'Первый игрок', exact: true })).toHaveCount(0);
  // The first confirmed join consumed the only empty slot. A second confirmation cannot displace AI.
  await press(page, 1, 0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-slot="2"]')).toHaveValue('ai-medium');
  await expect(page.locator('[data-slot="3"]')).toHaveValue('gamepad-0');
  await emptySlot(page, 2);
  await press(page, 1);
  await expect(page.getByRole('dialog')).toBeVisible();
  await press(page, 1, 1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-slot-card="2"].empty')).toBeVisible();
});


test('gamepad selection always opens name choice, supports new names and durable deletion without renaming a live player', async ({ page }) => {
  await installPads(page, [{ id: 'a', device, name: 'Сохранённое имя' }]);
  await page.getByRole('button', { name: /^Битва/ }).click();
  // First navigation from Back selects the keyboard player's name, even before Y joins.
  await press(page, 0, 13);
  await expect(page.getByRole('dialog')).toBeVisible();
  await press(page, 0, 0);
  await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Сохранённое имя');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Confirm the same highlighted name field, then enter a distinct name.
  await press(page, 0, 0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('textbox', { name: 'Новое имя', exact: true }).fill('Новое имя игрока');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Новое имя игрока');
  await press(page, 0);
  await page.getByRole('button', { name: 'Сохранённое имя', exact: true }).click();
  await expect(page.getByLabel('Имя игрока 4')).toHaveValue('Сохранённое имя');
  // Navigate to the assigned pad's name using its own focused card.
  await page.getByLabel('Имя игрока 4').hover();
  await press(page, 0, 0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Удалить сохранённое имя Сохранённое имя', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранённое имя', exact: true })).toHaveCount(0);
  await press(page, 0, 1);
  await expect(page.getByLabel('Имя игрока 4')).toHaveValue('Сохранённое имя');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).map((profile: any) => profile.name), key)).toEqual(['Новое имя игрока']);
  await page.reload();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await press(page, 0, 13);
  await expect(page.getByRole('button', { name: 'Сохранённое имя', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Новое имя игрока', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).rosterPads[0].connected = false; });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const size of [{ width: 1440, height: 720 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
  test(`reserves actual footer height at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?muted=1');
    await page.getByRole('button', { name: /^Битва/ }).click();
    await page.locator('.setup-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const layout = await page.evaluate(() => {
      const content = document.querySelector('.setup-scroll')!.getBoundingClientRect();
      const footer = document.querySelector('.release-guidance-footer')!.getBoundingClientRect();
      const settings = document.querySelector('.mode-settings, .mobile-mode-options')?.getBoundingClientRect() ?? content;
      const actions = [...document.querySelectorAll<HTMLElement>('.release-footer-action, .footer-start, .release-guidance-footer small')].map(el => el.getBoundingClientRect());
      return { overlap: content.bottom > footer.top + 1, settingsCovered: settings.bottom > footer.top + 1, footerOffscreen: footer.bottom > innerHeight + 1, actionOverlap: actions.some((a, i) => actions.slice(i + 1).some(b => Math.min(a.right,b.right) > Math.max(a.left,b.left) + 1 && Math.min(a.bottom,b.bottom) > Math.max(a.top,b.top) + 1)) };
    });
    expect(layout).toEqual({ overlap: false, settingsCovered: false, footerOffscreen: false, actionOverlap: false });
    if (size.width > 700) await expect(page.locator('.input-roster')).toHaveText('Y');
  });
}

test('saved-name pages preserve drafts and expose deletion and cancellation to gamepad', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await installPads(page, Array.from({ length: 100 }, (_, i) => ({ id: `profile-${i}`, device, name: `Сохранённый ${i}` })));
  await page.getByRole('button', { name: /^Битва/ }).click();
  await press(page, 0, 13);
  await expect(page.getByRole('dialog')).toBeVisible();
  const input = page.locator('[data-profile-name]');
  await input.fill('Черновик');
  await page.getByRole('button',{name:'Следующие имена →',exact:true}).click();
  await expect(input).toHaveValue('Черновик');
  await expect(page.getByRole('button',{name:'Сохранённый 4',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Удалить сохранённое имя Сохранённый 4',exact:true}).click();
  await expect(input).toHaveValue('Черновик');
  await page.setViewportSize({width:1024,height:600});
  await expect(input).toHaveValue('Черновик');
  // B remains reachable regardless of current page and does not commit the draft.
  await press(page,0,1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Имя игрока 1')).not.toHaveValue('Черновик');
});


test('name fields offer other-device and occupied names without sharing player profiles', async ({ page }) => {
  await installPads(page, [{ id: 'a', device, name: 'Анна' }, { id: 'b', device: 'Other pad', name: 'Борис' }]);
  await page.getByRole('button', { name: /^Битва/ }).click();
  await press(page, 0);
  await page.getByRole('button', { name: 'Анна', exact: true }).click();
  await page.getByLabel('Имя игрока 1').hover();
  await press(page, 0, 0);
  await expect(page.getByRole('button', { name: 'Анна', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Борис', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Анна', exact: true }).click();
  await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Анна');
  await expect(page.getByLabel('Имя игрока 4')).toHaveValue('Анна');
  await page.getByLabel('Имя игрока 1').fill('Вера');
  await page.getByRole('heading', { name: 'Битва', exact: true }).click();
  await expect(page.getByLabel('Имя игрока 4')).toHaveValue('Анна');
  await page.reload();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await press(page, 0, 13);
  await expect(page.getByRole('button', { name: 'Вера', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible();
  await page.screenshot({ path: 'evidence/reuse-player-names/chooser-wide.png' });
  await press(page, 0, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'evidence/reuse-player-names/phone.png' });
});


test('two live gamepad players reuse one name and later rename independently', async ({ page }) => {
  await installPads(page, [{ id: 'a', device, name: 'Анна' }]);
  await page.getByRole('button', { name: /^Битва/ }).click();
  await press(page, 0);
  await page.getByRole('button', { name: 'Анна', exact: true }).click();
  await emptySlot(page, 2);
  await press(page, 1);
  await page.getByLabel('Имя игрока 3').hover();
  await press(page, 1, 0);
  await page.getByRole('button', { name: 'Анна', exact: true }).click();
  await expect(page.getByLabel('Имя игрока 3')).toHaveValue('Анна');
  await expect(page.getByLabel('Имя игрока 4')).toHaveValue('Анна');
  await page.getByLabel('Имя игрока 3').fill('Вера');
  await page.getByRole('heading', { name: 'Битва', exact: true }).click();
  await expect(page.getByLabel('Имя игрока 4')).toHaveValue('Анна');
  const profiles = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
  expect(profiles.find((profile: any) => profile.id === 'a').name).toBe('Анна');
  expect(profiles.some((profile: any) => profile.id !== 'a' && profile.device === device && profile.name === 'Вера')).toBe(true);
});


for (const mode of ['Выживание', 'Битва', 'Командный бой']) {
  test(`mouse opens saved-name menu without gamepads in ${mode}`, async ({ page }) => {
    await page.addInitScript(({ key, device }) => {
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] });
      localStorage.setItem(key, JSON.stringify([{ id: 'mouse-saved', device, name: 'Аня' }]));
    }, { key, device });
    await page.goto('/?muted=1');
    await page.getByRole('button', { name: new RegExp(`^${mode}`) }).click();
    await page.getByLabel('Имя игрока 1').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).not.toContainText('Геймпад');
    await page.getByRole('button', { name: 'Аня', exact: true }).click();
    await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Аня');
    await page.getByLabel('Имя игрока 2').click();
    await page.getByRole('button', { name: 'Аня', exact: true }).click();
    await expect(page.getByLabel('Имя игрока 2')).toHaveValue('Аня');
    await page.getByLabel('Имя игрока 1').click();
    await page.getByRole('textbox', { name: 'Новое имя', exact: true }).fill('Лена');
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Аня');
    await page.getByLabel('Имя игрока 1').click();
    await page.getByRole('textbox', { name: 'Новое имя', exact: true }).fill('Лена');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Лена');
    await expect(page.getByLabel('Имя игрока 2')).toHaveValue('Аня');
    if (mode === 'Битва') {
      await page.getByLabel('Имя игрока 1').click();
      await page.screenshot({ path: 'evidence/mouse-name-menu/desktop.png' });
      await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    }
  });
}

test('phone pointer still edits a name directly and persists it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?muted=1');
  await page.getByRole('button', { name: /^Битва/ }).click();
  await page.getByLabel('Имя игрока 1').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Имя игрока 1').fill('Лена');
  await page.getByRole('heading', { name: 'Битва', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.getByLabel('Имя игрока 1')).toHaveValue('Лена');
  await page.screenshot({ path: 'evidence/mouse-name-menu/phone.png' });
});
