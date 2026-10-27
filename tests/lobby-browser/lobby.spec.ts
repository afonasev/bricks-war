import { openLocalLobby } from '../helpers/localLobby';
import { test, expect, type Page } from '@playwright/test';
const evidence = process.env.BRICKS_LOBBY_EVIDENCE ?? 'evidence/redesign-unified-lobby/runtime';
async function open(page: Page, mode = 'Битва', records = false) {
    await page.addInitScript(({ records }) => {
        localStorage.setItem('bricks-war:language:v1', 'ru');
        if (!localStorage.getItem('bricks-war:player-names:v1'))
            localStorage.setItem('bricks-war:player-names:v1', JSON.stringify(['Саша', 'Лена', 'Гоша', 'Миша']));
        localStorage.setItem('bricks-war:slot-selections:v1', JSON.stringify(['human-1', 'human-2', 'ai-hard', 'ai-expert']));
        localStorage.setItem('bricks-war:match-setup:v2', JSON.stringify({ profiles: { battle: { durationMinutes: 9, options: { battleTimeMode: 'until-victory', battleDifficulty: 'sport' } } } }));
        if (records)
            localStorage.setItem('bricks-war:solo-records:v1', JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: `lobby-${i}`, name: i === 1 ? 'Саша' : `Рекорд ${i + 1}`, lineScore: 18600 - i * 1200, elapsedMs: 720000 - i * 28000, placedPieces: 100, finishedAt: 1792880400000 - i * 3600000 }))));
        const pads = [0, 1].map(index => ({ index, id: 'Identical pad', mapping: 'standard', connected: true, axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0, touched: false })), timestamp: 0 }));
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
        Object.assign(window, { lobbyPads: pads });
    }, { records });
    await page.goto('/?muted=1');
    await openLocalLobby(page,mode);
}
async function bot(page: Page, level = 'medium', style = 'classic') {
    await page.locator('[data-bot]').first().click();
    await page.locator(`[data-level="${level}"]`).click();
    await expect(page.locator('.is-editing')).toHaveCount(0);
    const card = page.locator('.lobby-card:not(.is-empty)').last();
    await expect(card.locator('.lobby-style-label')).toHaveText('Случайный');
    if (style !== 'random') {
        await card.click();
        await page.locator(`[data-level="${level}"]`).click();
        await page.locator(`[data-style="${style}"]`).click();
    }
}
async function pulse(page: Page, index: number, button: number) {
    await page.evaluate(({ index, button }) => { (window as any).lobbyPads[index].buttons[button].pressed = true; }, { index, button });
    await page.waitForTimeout(80);
    await page.evaluate(({ index, button }) => { (window as any).lobbyPads[index].buttons[button].pressed = false; }, { index, button });
    await page.waitForTimeout(80);
}
async function nextMode(page: Page) { await page.locator('[data-cycle-mode]').click(); }
async function assertLayout(page: Page, allowScroll = false) {
    const issues = await page.locator('.unified-lobby').evaluate((root, allowScroll) => {
        const overlay = root.querySelector<HTMLElement>('.lobby-overlay:not([hidden])');
        const scope = overlay ?? root;
        const visible = (e: HTMLElement) => !e.closest('[hidden]') && e.getBoundingClientRect().width > 0;
        const controls = Array.from(scope.querySelectorAll<HTMLElement>('button,input,select')).filter(visible);
        const pairs = controls.flatMap((a, i) => controls.slice(i + 1).filter(b => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return !a.contains(b) && !b.contains(a) && Math.min(x.right, y.right) > Math.max(x.left, y.left) + 1 && Math.min(x.bottom, y.bottom) > Math.max(x.top, y.top) + 1; }).map(b => [a.textContent, b.textContent]));
        const outside = controls.filter(e => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 || !allowScroll && (r.top < -1 || r.bottom > innerHeight + 1); }).map(e => e.textContent);
        const clipped = Array.from(scope.querySelectorAll<HTMLElement>('button,h1,h2,h3,strong,time')).filter(visible).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent);
        return { pairs, outside, clipped, wide: document.documentElement.scrollWidth > innerWidth + 1 };
    }, allowScroll);
    expect(issues).toEqual({ pairs: [], outside: [], clipped: [], wide: false });
}
test('cold defaults, atomic bot and human edits, run memory, start admission and reset', async ({ page }) => {
    await open(page);
    await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(1);
    await expect(page.locator('#match-duration')).toHaveAttribute('data-value', 'until-victory');
    await expect(page.locator('#attack-mode')).toHaveAttribute('data-value', 'all-opponents');
    await expect(page.locator('#battle-difficulty')).toHaveAttribute('data-value', 'normal');
    await expect(page.locator('#start-match')).toBeDisabled();
    await page.locator('[data-bot]').click();
    await expect(page.locator('[data-style]')).toHaveCount(0);
    await expect(page.locator('#start-match')).toBeDisabled();
    await page.locator('[data-cancel]').click();
    await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(1);
    await bot(page, 'expert', 'forest-mosaic');
    await expect(page.locator('#start-match')).toBeEnabled();
    await expect(page.locator('.lobby-card h2').nth(1)).toHaveText('Бот · Эксперт'.toLocaleLowerCase().replace('бот', 'Бот'));
    await page.locator('[data-edit="0"]').click();
    await expect(page.locator('[data-draft-name]')).toHaveCount(0);
    await expect(page.locator('[data-level]')).toHaveCount(0);
    await expect(page.locator('[data-style]')).toHaveCount(7);
    await expect(page.locator('[data-style="random"]')).toHaveAttribute('data-default-choice','true');
    await page.screenshot({path:`${evidence}/player-style-desktop.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:`${evidence}/player-style-phone.png`,fullPage:true});
    await page.setViewportSize({width:1440,height:960});
    await page.locator('[data-cancel]').click();
    await expect(page.locator('.lobby-card h2').first()).toHaveText('Саша');
    await expect(page.locator('.lobby-style-label').first()).toHaveText('Случайный');
    await page.locator('[data-edit="0"]').click();
    await page.locator('[data-style="marmalade"]').click();
    await expect(page.locator('[data-controller="wasd"]')).toHaveCount(1);
    for(let i=0;i<4;i++) await page.locator('#match-duration').click();
    await page.locator('[data-lobby-back]').click();
    await openLocalLobby(page,'battle');
    await expect(page.locator('#match-duration')).toHaveAttribute('data-value', '5');
    await expect(page.locator('.lobby-card h2').first()).toHaveText('Саша');
    await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(2);
    await page.reload();
    await openLocalLobby(page,'battle');
    await expect(page.locator('#match-duration')).toHaveAttribute('data-value', 'until-victory');
    await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(1);
    await expect(page.locator('.lobby-card h2').first()).toHaveText('Саша');

});
test('survival has a join card and restores all hidden bots including style and difficulty', async ({ page }) => {
    await open(page);
    await bot(page, 'easy', 'marmalade');
    await bot(page, 'hard', 'forest-mosaic');
    await bot(page, 'expert', 'stone-fortress');
    await nextMode(page);
    await expect(page.locator('#start-match')).toBeEnabled();
    await nextMode(page);
    await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(1);
    await expect(page.locator('[data-join]')).toHaveCount(1);
    await expect(page.locator('[data-bot]')).toHaveCount(0);
    await expect(page.locator('#match-duration')).toHaveCount(0);
    await expect(page.locator('#start-match')).toBeEnabled();
    await pulse(page, 0, 3);
    await expect(page.locator('.is-editing')).toHaveCount(1);
    await page.locator('[data-use-name]').click();
    await page.locator('[data-style="classic"]').click();
    await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(2);
    await nextMode(page);
    await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(4);
    await expect(page.locator('.lobby-card h2').nth(3)).toContainText('эксперт');
    await expect(page.locator('.lobby-style-label').nth(3)).toHaveText('Каменная крепость');
    await assertLayout(page);
    await page.screenshot({ path: `${evidence}/battle-four.png` });
});
test('simultaneous identical pads own independent in-card editors, cancel, hold-X, bindings and disconnect', async ({ page }) => {
    await open(page, 'Кто больше');
    await page.evaluate(() => { (window as any).lobbyPads.forEach((p: any) => p.buttons[3].pressed = true); });
    await expect(page.locator('.is-editing')).toHaveCount(2);
    await page.evaluate(() => { (window as any).lobbyPads.forEach((p: any) => p.buttons[3].pressed = false); });
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.locator('#start-match')).toBeDisabled();
    await pulse(page, 0, 1);
    await expect(page.locator('.is-editing')).toHaveCount(1);
    await expect(page.locator('[data-lobby-slot="2"]')).toHaveClass(/is-editing/);
    await pulse(page, 0, 3);
    await expect(page.locator('.is-editing')).toHaveCount(2);
    for (const slot of [1, 2]) {
        const card = page.locator(`[data-lobby-slot="${slot}"]`);
        await card.locator('[data-draft-name]').fill(slot === 1 ? 'Первый' : 'Второй');
        await card.locator('[data-use-name]').click();
        await card.locator('[data-style="classic"]').click();
    }
    await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(3);
    await expect(page.locator('#start-match')).toBeEnabled();
    await page.locator('[data-lobby-slot="1"]').hover();
    await page.locator('[data-remove="1"]').click();
    await pulse(page, 0, 3);
    await expect(page.locator('[data-name="Первый"]')).toHaveCount(1);
    await page.evaluate(() => { (window as any).lobbyPads[0].buttons[2].pressed = true; });
    await expect(page.locator('[data-name="Первый"]')).toHaveCount(0, { timeout: 3000 });
    await page.evaluate(() => { (window as any).lobbyPads[0].buttons[2].pressed = false; });
    await page.locator('[data-draft-name]').fill('Первый');
    await page.locator('[data-use-name]').click();
    await page.locator('[data-style="classic"]').click();
    await pulse(page, 0, 3);
    await expect(page.locator('[data-style="classic"]')).toHaveAttribute('data-default-choice','true');
    await expect(page.locator('[data-draft-name]')).toHaveCount(0);
    await pulse(page, 0, 0);
    await expect(page.locator('[data-lobby-slot="1"] h2')).toHaveText('Первый');
    await expect(page.locator('[data-lobby-slot="1"] .lobby-style-label')).toHaveText('Классика');
    await pulse(page, 0, 3);
    await pulse(page, 0, 1);
    await page.evaluate(() => { (window as any).lobbyPads[1].connected = false; });
    await expect(page.locator('.is-disconnected')).toHaveCount(1);
    await expect(page.locator('#start-match')).toBeDisabled();
    await page.evaluate(() => { const p = (window as any).lobbyPads[1]; p.connected = true; p.id = 'Replacement pad'; });
    await expect(page.locator('.is-disconnected')).toHaveCount(1);
    await pulse(page, 1, 3);
    await expect(page.locator('[data-draft-name]')).toHaveCount(0);
    await page.locator('[data-style="classic"]').click();
    await expect(page.locator('.is-disconnected')).toHaveCount(0);
    await expect(page.locator('#start-match')).toBeEnabled();
    await page.screenshot({ path: `${evidence}/survival-three.png` });
});
test('real ranking local/global, ten rows plus own, retry, modal return and responsive width', async ({ page }) => {
    let offline = false;
    await page.route('**/api/network/rating**', async (route) => { if (offline) {
        await route.abort();
        return;
    } await route.fulfill({ json: { top: Array.from({ length: 10 }, (_, i) => ({ name: `Лидер ${i + 1}`, rank: i + 1, lineScore: 48000 - i * 2000, elapsedMs: 600000, finishedAt: 1792880400000 })), own: [{ name: 'Саша', rank: 24, lineScore: 15400, elapsedMs: 600000, finishedAt: 1792880400000 }] } }); });
    await open(page, 'Кто больше', true);
    await expect(page.locator('.lobby-body.with-rating')).toBeVisible();
    await expect(page.locator('.lobby-rating-list li')).toHaveCount(10);
    await expect(page.locator('.lobby-rating-list .is-own-rating')).toHaveCount(1);
    await assertLayout(page);
    await page.screenshot({ path: `${evidence}/desktop-local.png` });
    await page.locator('[data-rating="global"]').click();
    await expect(page.locator('.global-rating-list li')).toHaveCount(11);
    await expect(page.locator('.rating-separated')).toContainText('#24');
    await assertLayout(page);
    await page.screenshot({ path: `${evidence}/desktop-global.png` });
    offline = true;
    await page.locator('[data-rating="local"]').click();
    await page.locator('[data-rating="global"]').click();
    await expect(page.locator('[data-rating-retry]')).toBeVisible();
    await page.screenshot({ path: `${evidence}/desktop-offline.png` });
    offline = false;
    await page.locator('[data-rating-retry]').click();
    await expect(page.locator('.global-rating-list li')).toHaveCount(11);
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(page.locator('aside.lobby-rating')).toHaveCount(0);
    await page.locator('[data-open-rating]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('.global-rating-list li')).toHaveCount(11);
    await assertLayout(page);
    await page.getByRole('button', { name: 'В лобби', exact: true }).click();
    await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(1);
});
test('phone one-column bot cards, modal ten records, canonical rules, and touch match consumer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 'Битва', true);
    await bot(page, 'hard', 'construction-bricks');
    const rects = await page.locator('.lobby-card').evaluateAll(es => es.map(e => e.getBoundingClientRect().toJSON()));
    expect(rects).toHaveLength(3);
    rects.forEach((r, i) => { expect(r.x).toBe(rects[0]!.x); if (i)
        expect(r.y).toBeGreaterThan(rects[i - 1]!.bottom); });
    await assertLayout(page, true);
    await page.screenshot({ path: `${evidence}/phone-battle.png`, fullPage: true });
    await nextMode(page);
    await nextMode(page);
    await expect(page.locator('[data-bot]')).toHaveCount(0);
    await expect(page.locator('aside.lobby-rating')).toHaveCount(0);
    await page.screenshot({ path: `${evidence}/phone-survival.png`, fullPage: true });
    await page.locator('[data-open-rating]').click();
    await expect(page.locator('.lobby-rating-list li')).toHaveCount(10);
    await assertLayout(page, true);
    await page.screenshot({ path: `${evidence}/phone-ranking.png`, fullPage: true });
    await page.getByRole('button', { name: 'В лобби', exact: true }).click();
    await page.locator('[data-open-rules]').click();
    await expect(page.getByRole('dialog')).toContainText('Атак нет');
    await page.getByRole('button', { name: 'Основы игры' }).click();
    await expect(page.locator('.lobby-rule-content svg')).toBeVisible();
    await page.screenshot({ path: `${evidence}/phone-rules.png`, fullPage: true });
    await page.getByRole('button', { name: 'В лобби', exact: true }).click();
    await page.locator('#start-match').click();
    await expect(page.locator('.hud-card')).toHaveCount(1);
    await expect(page.locator('.mobile-touch-zones')).toBeVisible();
    await expect(page.locator('.hud-identity [data-controller=touch]')).toHaveCount(1);
    await expect(page.locator('.match-loading')).toHaveCount(0);await expect(page.locator('#countdown')).toBeHidden();await page.screenshot({path:`${evidence}/phone-hud.png`});
});
test('team opponent reason, 2x2 admission, compact desktop and phone groups', async ({ page }) => {
    await open(page);
    await nextMode(page);
    await bot(page, 'easy');
    await expect(page.locator('#setup-error')).toHaveText('Добавьте соперника в другую команду');
    await bot(page, 'hard');
    await expect(page.locator('#start-match')).toBeDisabled();
    await bot(page, 'expert');
    await expect(page.locator('#start-match')).toBeEnabled();
    await expect(page.locator('.lobby-team')).toHaveCount(2);
    await assertLayout(page);
    await page.screenshot({ path: `${evidence}/desktop-team.png` });
    await page.setViewportSize({ width: 1280, height: 480 });
    await assertLayout(page);
    await page.screenshot({ path: `${evidence}/compact-team.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertLayout(page, true);
    await page.screenshot({ path: `${evidence}/phone-team.png`, fullPage: true });
});
test('pad-only A/Y/B editing stays local while another pad configures, including inline keyboard', async ({ page }) => {
    await open(page, 'Кто больше');
    await page.evaluate(() => { (window as any).lobbyPads.forEach((p: any) => p.buttons[3].pressed = true); });
    await expect(page.locator('.is-editing')).toHaveCount(2);
    await page.evaluate(() => { (window as any).lobbyPads.forEach((p: any) => p.buttons[3].pressed = false); });
    await page.waitForTimeout(80);
    await pulse(page, 0, 0);
    await expect(page.locator('[data-lobby-slot="1"] [data-style]')).toHaveCount(7);
    await expect(page.locator('[data-lobby-slot="2"] [data-draft-name]')).toBeVisible();
    await page.screenshot({ path: `${evidence}/parallel-editors.png` });
    await pulse(page, 1, 1);
    await expect(page.locator('.is-editing')).toHaveCount(1);
    await expect(page.locator('[data-lobby-slot="1"]')).toHaveClass(/is-editing/);
    await pulse(page, 0, 0);
    await expect(page.locator('.is-editing')).toHaveCount(0);
    await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(2);
    await page.locator('[data-lobby-slot="1"]').hover();
    await page.locator('[data-remove="1"]').click();
    await pulse(page, 0, 3); // rejoin to choose a name; existing humans edit only style
    const freeNames = await page.locator('[data-lobby-slot="1"] [data-name]').count();
    for (let i = 0; i < freeNames; i++)
        await pulse(page, 0, 13);
    await pulse(page, 0, 0);
    await expect(page.locator('.lobby-name-keys')).toBeVisible();
    const originalName=await page.locator('.lobby-typed-name').inputValue();
    await pulse(page, 0, 0);
    await expect(page.locator('.lobby-typed-name')).toHaveValue(originalName+'Й');
    await pulse(page, 0, 1);
    await expect(page.locator('.lobby-name-keys')).toHaveCount(0);
    await expect(page.locator('[data-draft-name]')).toHaveValue(originalName);
    await pulse(page, 0, 1);
    await expect(page.locator('.is-editing')).toHaveCount(0);
    await page.locator('[data-open-rules]').click();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('dialog').locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('four distinct local humans reach survival match consumers without expanding input limits', async ({page}) => {
  await open(page,'Кто больше');
  for (const pad of [0,1]) { await pulse(page,pad,3); await pulse(page,pad,0); await pulse(page,pad,0); }
  await page.locator('[data-join]').click(); await page.locator('[data-draft-name]').fill('Стрелки'); await page.locator('[data-use-name]').click(); await page.locator('[data-style="forest-mosaic"]').click();
  await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(4); await expect(page.locator('[data-join]')).toHaveCount(0); await expect(page.locator('aside.lobby-rating')).toHaveCount(0);
  await expect(page.locator('[data-controller=wasd]')).toHaveCount(1);await expect(page.locator('[data-controller=arrows]')).toHaveCount(1);await expect(page.locator('[data-controller=gamepad]')).toHaveCount(2);
  await page.screenshot({path:`${evidence}/desktop-devices.png`});
  await pulse(page,0,9); await expect(page.locator('.hud-card')).toHaveCount(4); await expect(page.locator('.hud-identity strong').last()).toHaveText('Стрелки');await expect(page.locator('.hud-identity [data-controller=gamepad]')).toHaveCount(2);await expect(page.locator('.match-loading')).toHaveCount(0);await expect(page.locator('#countdown')).toBeHidden();await page.screenshot({path:`${evidence}/desktop-hud.png`});
});

test('long names remain readable and disjoint on a narrow phone and compact desktop', async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('bricks-war:player-names:v1',JSON.stringify(['WWWWWWWWWWWWWWWWWWWW','Лена','Гоша','Миша'])));
  await open(page);await page.locator('[data-edit="0"]').click();await page.locator('[data-style="classic"]').click();
  for(const [width,height] of [[360,800],[390,844],[1280,480]]) {
    await page.setViewportSize({width:width!,height:height!});
    const issues=await page.locator('[data-lobby-slot="0"]').evaluate(card=>{
      const bounds=card.getBoundingClientRect();const parts=Array.from(card.querySelectorAll<HTMLElement>('.lobby-card-mark,h2,.lobby-ready,.lobby-well,.lobby-style-label,.lobby-edit,.lobby-remove')).map(e=>({label:e.className||e.tagName,r:e.getBoundingClientRect()}));
      return {outside:parts.filter(({r})=>r.left<bounds.left-1||r.right>bounds.right+1||r.top<bounds.top-1||r.bottom>bounds.bottom+1).map(p=>p.label),overlaps:parts.flatMap((a,i)=>parts.slice(i+1).filter(b=>Math.min(a.r.right,b.r.right)>Math.max(a.r.left,b.r.left)+1&&Math.min(a.r.bottom,b.r.bottom)>Math.max(a.r.top,b.r.top)+1).map(b=>[a.label,b.label]))};
    });expect(issues).toEqual({outside:[],overlaps:[]});await page.screenshot({path:`${evidence}/long-name-${width}.png`,fullPage:true});
  }
});


test('FB1 settings cycle by click and pad A; existing bot retains current selections and device icons', async ({page}) => {
  await open(page);
  await expect(page.locator('.lobby-settings select')).toHaveCount(0);
  await expect(page.locator('[data-controller="wasd"]')).toHaveCount(1);
  for(const value of ['2','3','4','5','6','7','8','9','10','until-victory']) {
    await page.locator('#match-duration').click();
    await expect(page.locator('#match-duration')).toHaveAttribute('data-value',value);
  }
  await pulse(page,0,15); // right from mode to duration in the visible settings row
  await pulse(page,0,0);
  await expect(page.locator('#match-duration')).toHaveAttribute('data-value','2');
  await pulse(page,0,15); await pulse(page,0,0);
  await expect(page.locator('#attack-mode')).toHaveAttribute('data-value','off');
  await pulse(page,0,15); await pulse(page,0,0);
  await expect(page.locator('#battle-difficulty')).toHaveAttribute('data-value','sport');
  await bot(page,'hard','forest-mosaic');
  await page.locator('[data-edit="1"]').click();
  await expect(page.locator('[data-level="hard"]')).toHaveAttribute('data-default-choice','true');
  await page.screenshot({path:`${evidence}/existing-bot-difficulty.png`,fullPage:true});
  await page.locator('[data-level="expert"]').click();
  await expect(page.locator('[data-style="forest-mosaic"]')).toHaveAttribute('data-default-choice','true');
  await page.screenshot({path:`${evidence}/existing-bot-style.png`,fullPage:true});
  await page.locator('[data-cancel]').click();
  await expect(page.locator('[data-lobby-slot="1"] h2')).toContainText('сложная');
  await page.setViewportSize({width:390,height:844}); await assertLayout(page,true);
  await page.screenshot({path:`${evidence}/phone-fb1.png`,fullPage:true});
  await page.locator('[data-edit="1"]').click(); await page.locator('[data-level="hard"]').click();
  // Options outside the bounded scroll viewport are deliberately hidden; check the selected visible option.
  await expect(page.locator('.unified-lobby')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const current=await page.locator('[data-style="forest-mosaic"]').evaluate(e=>{const a=e.getBoundingClientRect(),b=e.parentElement!.getBoundingClientRect();return a.top>=b.top-1 && a.bottom<=b.bottom+1});expect(current).toBe(true);
  await page.screenshot({path:`${evidence}/phone-existing-bot-style.png`,fullPage:true});
});

for (const [width,height,device] of [[1440,960,'arrows'],[390,844,'touch']] as const) test(`FB1 bound device reaches visible HUD and results ${width}`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height});
  await page.addInitScript(()=>localStorage.setItem('bricks-war:language:v1','ru'));
  await page.goto('/?muted=1&playtest-fast=20&playtest-score=123456');
  await openLocalLobby(page,'survival');await page.locator('#start-match').click();
  await expect(page.locator('.survival-results-panel')).toBeVisible({timeout:45000});
  await expect(page.locator(`.result-controller [data-controller="${device}"]`)).toHaveCount(1);
  await page.screenshot({path:`${evidence}/results-${width}.png`,fullPage:true});
});

test('FB2 hover cross, one-card hold X, early release and local identity colors', async ({page})=>{
  await open(page); await bot(page,'hard','classic');
  const human=page.locator('[data-lobby-slot="0"]'), opponent=page.locator('[data-lobby-slot="1"]');
  await page.mouse.move(0,0);
  await expect(opponent.locator('[data-remove]')).toHaveCSS('opacity','0');
  await expect(human.locator('.controller-icon')).toHaveCSS('color','rgb(53, 95, 10)');
  await expect(opponent.locator('.controller-icon')).toHaveCSS('color','rgb(8, 112, 128)');
  await opponent.hover(); await expect(opponent.locator('[data-remove]')).toHaveCSS('opacity','1');
  await assertLayout(page); await page.screenshot({path:`${evidence}/hover-delete.png`});
  await opponent.locator('[data-remove]').click();await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(1);
  await bot(page,'easy','classic');
  await pulse(page,0,15);await pulse(page,0,13);
  await expect(opponent).toHaveClass(/pad-0/);
  await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=true});
  await page.waitForTimeout(300);
  await expect(page.locator('.is-editing')).toHaveCount(0);await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(2);
  await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=false});await page.waitForTimeout(500);
  await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(2);
  await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=true});await page.waitForTimeout(350);
  await page.screenshot({path:`${evidence}/pad-hold-delete.png`});
  await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(1);
  await expect(opponent).toHaveClass(/is-empty/);
  await expect(human.locator('h2')).toHaveText('Саша');
  await page.waitForTimeout(900); // keep X held after roster reflow
  await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(1);await expect(page.locator('.is-editing')).toHaveCount(0);
  await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=false});await page.waitForTimeout(80);
  await pulse(page,0,14);
  await expect(human).toHaveClass(/pad-0/);
  await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=true});
  await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(0);
  await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=false});
  await expect(page.locator('#start-match')).toBeDisabled();
});

test('FB2 phone smartphone and directly reachable delete cross preserve disjoint card parts',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);await bot(page,'medium','classic');
  await expect(page.locator('[data-lobby-slot="0"] [data-controller="touch"]')).toHaveCount(1);
  await expect(page.locator('[data-lobby-slot="1"] [data-remove]')).toHaveCSS('opacity','1');
  await assertLayout(page,true);await page.screenshot({path:`${evidence}/phone-icons-delete.png`,fullPage:true});
  await page.locator('[data-lobby-slot="1"] [data-remove]').click();await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(1);
});


test('FB2 an external roster change or overlay cannot retarget a held X',async({page})=>{
  await open(page);await bot(page,'hard');await bot(page,'expert');
  const target=page.locator('[data-lobby-slot="1"]');
  await pulse(page,0,15);await pulse(page,0,13);
  await expect(target).toHaveClass(/pad-0/);
  await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=true});await page.waitForTimeout(250);
  await target.locator('[data-remove]').click();await page.waitForTimeout(900);
  await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(2);
  await expect(page.locator('[data-lobby-slot="2"] h2')).toContainText('эксперт');
  await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=false});await page.waitForTimeout(80);
  await page.locator('[data-open-rules]').click();
  await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=true});await page.waitForTimeout(800);
  await page.getByRole('button',{name:'В лобби',exact:true}).click();await page.waitForTimeout(800);
  await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(2);
  await expect(page.locator('.is-editing')).toHaveCount(0);
  await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=false});
});

test('FB3 physical human cards retain exact geometry across modes and viewport sizes',async({page})=>{
  await open(page);await bot(page,'medium');await pulse(page,0,3);await page.locator('[data-use-name]').click();await page.locator('[data-style="classic"]').click();
  for(const [width,height] of [[1440,960],[1280,480],[390,844],[360,800]]) {
    await page.setViewportSize({width:width!,height:height!});
    const geometry=()=>page.locator('[data-lobby-slot="0"], [data-lobby-slot="2"]').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {slot:(e as HTMLElement).dataset.lobbySlot,x:r.x,y:r.y,width:r.width,height:r.height}}));
    const battle=await geometry();await assertLayout(page,width!<=760);await page.screenshot({path:`${evidence}/stable-battle-${width}.png`,fullPage:true});
    await nextMode(page);expect(await geometry()).toEqual(battle);await expect(page.locator('.lobby-team')).toHaveCount(2);await assertLayout(page,width!<=760);await page.screenshot({path:`${evidence}/stable-team-${width}.png`,fullPage:true});
    await nextMode(page);expect(await geometry()).toEqual(battle);await assertLayout(page,width!<=760);await page.screenshot({path:`${evidence}/stable-survival-${width}.png`,fullPage:true});
    await nextMode(page);expect(await geometry()).toEqual(battle);
  }
});
test('FB3 pointer hover has a soft fill and no contour, navigation retains focus, rating cannot resize cards',async({page})=>{
  await open(page);const duration=page.locator('#match-duration');const controlBounds=await duration.boundingBox();await duration.hover();
  await expect(page.locator('#app')).toHaveAttribute('data-input-mode','pointer');
  await expect(duration).toHaveCSS('outline-style','none');
  expect(await duration.evaluate(e=>{const s=getComputedStyle(e,'::before');return {opacity:s.opacity,top:s.top,right:s.right,bottom:s.bottom,left:s.left}})).toEqual({opacity:'1',top:'0px',right:'0px',bottom:'0px',left:'0px'});
  const hoverShadow=await duration.evaluate(e=>getComputedStyle(e,'::before').boxShadow);expect(hoverShadow).toContain('-4px 0px 0px 4px');expect(hoverShadow).toContain('4px 0px 0px 4px');
  expect(await duration.boundingBox()).toEqual(controlBounds);
  await page.screenshot({path:`${evidence}/hover-padded.png`});
  await duration.click();await expect(duration).toHaveCSS('outline-style','none');
  await expect(page.locator('[data-cycle-mode]')).toHaveCSS('border-bottom-color','rgb(175, 121, 65)');
  await pulse(page,0,15);await expect(duration).toHaveClass(/pad-0/);await expect(duration).toHaveCSS('outline-style','none');await expect(duration).toHaveCSS('background-color','rgb(139, 212, 246)');
  await duration.hover();await expect(duration).toHaveCSS('outline-style','none');
  const before=await page.locator('[data-lobby-slot="0"]').boundingBox();await nextMode(page);await nextMode(page);
  await expect(page.locator('aside.lobby-rating')).toBeVisible();expect(await page.locator('[data-lobby-slot="0"]').boundingBox()).toEqual(before);
  await assertLayout(page);await page.screenshot({path:`${evidence}/hover-no-frame.png`});
});

for (const width of [1440, 390]) test(`new bot commits random style immediately; editing retains two steps ${width}`, async ({page}) => {
    await page.setViewportSize({width,height:width===1440?960:844});
    await open(page);
    if (width===1440) {
        const empty=page.locator('.is-empty');
        await pulse(page,0,15);await pulse(page,0,13);
        await expect(empty).toHaveClass(/pad-0/);
        await pulse(page,0,2);
        await expect(page.locator('[data-level="medium"]')).toHaveAttribute('data-default-choice','true');
        await pulse(page,0,0);
    } else {
        await page.locator('[data-bot]').click();
        await page.locator('[data-level="medium"]').click();
    }
    const card=page.locator('[data-lobby-slot="1"]');
    await expect(page.locator('.is-editing')).toHaveCount(0);
    await expect(page.locator('[data-style]')).toHaveCount(0);
    await expect(card.locator('.lobby-style-label')).toHaveText('Случайный');
    await expect(page.locator('#start-match')).toBeEnabled();
    await page.screenshot({path:`${evidence}/bot-added-${width}.png`,fullPage:true});
    await card.click();
    await expect(page.locator('[data-level="medium"]')).toHaveAttribute('data-default-choice','true');
    await expect(page.locator('[data-style]')).toHaveCount(0);
    await page.locator('[data-level="hard"]').click();
    await expect(page.locator('[data-style="random"]')).toHaveAttribute('data-default-choice','true');
    await page.screenshot({path:`${evidence}/bot-edit-style-${width}.png`,fullPage:true});
    await page.locator('[data-cancel]').click();
    await expect(card.locator('h2')).toContainText('средняя');
    await card.click();
    await page.locator('[data-level="hard"]').click();
    await page.locator('[data-style="marmalade"]').click();
    await expect(card.locator('h2')).toContainText('сложная');
    await expect(card.locator('.lobby-style-label')).toHaveText('Мармелад');
});

for (const width of [1440,390]) test(`occupied and reserved human names stay hidden and typed duplicates cannot commit ${width}`,async({page})=>{
    await page.setViewportSize({width,height:width===1440?960:844});
    await open(page);
    await pulse(page,0,3);await pulse(page,1,3);
    const first=page.locator('[data-lobby-slot="1"]'), second=page.locator('[data-lobby-slot="2"]');
    await expect(page.locator('[data-name="Саша"]')).toHaveCount(0);
    await first.locator('[data-draft-name]').fill('  САША  ');
    await expect(first.locator('[data-use-name]')).toBeDisabled();
    await expect(first.locator('[data-draft-name]')).toHaveAttribute('aria-invalid','true');
    await first.locator('[data-name="Гоша"]').click();
    await expect(first.locator('[data-style]')).toHaveCount(7);
    await expect(second.locator('[data-name="Гоша"]')).toHaveCount(0);
    await second.locator('[data-draft-name]').fill('гоша');
    await expect(second.locator('[data-use-name]')).toBeDisabled();
    await page.screenshot({path:`${evidence}/unique-name-${width}.png`,fullPage:true});
    await first.locator('[data-cancel]').click();
    await expect(second.locator('[data-name="Гоша"]')).toHaveCount(1);
    await second.locator('[data-name="Гоша"]').click();
    await pulse(page,0,3);
    await expect(first.locator('[data-name="Гоша"]')).toHaveCount(0);
    await second.locator('[data-cancel]').click();
    await expect(first.locator('[data-name="Гоша"]')).toHaveCount(1);
    await first.locator('[data-name="Гоша"]').click();
    await first.locator('[data-style="classic"]').click();
    await pulse(page,1,3);
    await expect(second.locator('[data-name="Гоша"]')).toHaveCount(0);
    await first.hover();await first.locator('[data-remove]').click();
    await expect(second.locator('[data-name="Гоша"]')).toHaveCount(1);
    await second.locator('[data-name="Гоша"]').click();
    await second.locator('[data-style="classic"]').click();
    await expect(page.locator('.lobby-card h2',{hasText:'Гоша'})).toHaveCount(1);
    await expect(page.locator('.lobby-card h2').first()).toHaveText('Саша');
    if(width===1440) {
        await pulse(page,0,3);
        const freeNames=await first.locator('[data-name]').count();
        for(let i=0;i<freeNames;i++) await pulse(page,0,13);
        await pulse(page,0,0);
        await expect(first.locator('.lobby-name-keys')).toBeVisible();
        await first.locator('[data-typing-name]').fill('');
        for(const letter of ['С','А','Ш','А']) await first.locator(`[data-letter="${letter}"]`).click();
        await expect(first.locator('[data-typed-done]')).toBeDisabled();
        await expect(first.locator('[data-style]')).toHaveCount(0);
        await pulse(page,0,1);await pulse(page,0,1);
    }
});

for(const [width,height] of [[1440,960],[1280,720],[1280,480],[390,844]]) test(`grid keyboard Y applies B restores X inert ${width}x${height}`,async({page})=>{
    await page.setViewportSize({width:width!,height:height!});await open(page);
    await pulse(page,0,3);
    const card=page.locator('[data-lobby-slot="1"]');
    const original=await card.locator('[data-draft-name]').inputValue();
    const names=await card.locator('[data-name]').count() + 1;
    for(let i=0;i<names;i++) await pulse(page,0,13);
    await pulse(page,0,0);
    await expect(card.locator('[data-typing-name]')).toHaveValue(original);
    await expect(card.locator('.lobby-key-row').first()).toHaveText('ЙЦУКЕНГШЩЗХЪ');
    await expect(card.locator('[data-letter="Й"]')).toHaveClass(/pad-selected/);
    await expect(card.locator('[data-letter="Й"]')).toHaveCSS('outline-style','none');
    await expect(card.locator('[data-letter="Й"]')).toHaveCSS('background-color','rgb(139, 212, 246)');
    await pulse(page,0,15);await pulse(page,0,15);await pulse(page,0,15);
    await expect(card.locator('[data-letter="К"]')).toHaveClass(/pad-selected/);
    await pulse(page,0,13);await expect(card.locator('.lobby-key-row').nth(1).locator('.pad-selected')).toHaveCount(1);
    await pulse(page,0,12);await expect(card.locator('[data-letter="К"]')).toHaveClass(/pad-selected/);
    await card.locator('[data-typing-name]').fill('Аня');
    await pulse(page,0,2);await expect(card.locator('[data-typing-name]')).toHaveValue('Аня');
    await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=true});await page.waitForTimeout(800);
    await expect(card.locator('[data-typing-name]')).toHaveValue('Аня');
    await page.evaluate(()=>{(window as any).lobbyPads[0].buttons[2].pressed=false});
    await pulse(page,0,13);
    const keyboardFits=await card.evaluate(card=>{
        const list=card.querySelector('.lobby-editor-options')!.getBoundingClientRect();
        const box=card.getBoundingClientRect(), footer=card.querySelector('.lobby-editor-hint')!.getBoundingClientRect();
        return [...card.querySelectorAll('.lobby-key-row button,[data-typing-name]')].every(e=>{const r=e.getBoundingClientRect();return r.left>=list.left-1&&r.right<=list.right+1&&r.top>=list.top-1&&r.bottom<=list.bottom+1;})
            && list.bottom<=footer.top+1 && footer.bottom<=box.bottom && footer.right<=box.right;
    });expect(keyboardFits).toBe(true);
    await page.screenshot({path:`${evidence}/keyboard-grid-${width}x${height}.png`,fullPage:true});
    await pulse(page,0,1);await expect(card.locator('[data-draft-name]')).toHaveValue(original);
    await expect(card.locator('.lobby-name-keys')).toHaveCount(0);
    await card.locator('[data-draft-name]').click();
    await card.locator('[data-typing-name]').fill('Аня');
    await pulse(page,0,3);await expect(card.locator('[data-style]')).toHaveCount(7);
    await expect(card.locator('.lobby-name-keys')).toHaveCount(0);
    await card.locator('[data-style="classic"]').click();
    await expect(card.locator('h2')).toHaveText('Аня');
});

test('two typing owners keep independent buffers and Y B actions',async({page})=>{
    await open(page);await pulse(page,0,3);await pulse(page,1,3);
    const first=page.locator('[data-lobby-slot="1"]'),second=page.locator('[data-lobby-slot="2"]');
    const originals=[await first.locator('[data-draft-name]').inputValue(),await second.locator('[data-draft-name]').inputValue()];
    for(const [index,card] of [[0,first],[1,second]] as const){
        const names=await card.locator('[data-name]').count() + 1;for(let i=0;i<names;i++)await pulse(page,index,13);await pulse(page,index,0);
    }
    await expect(page.locator('.lobby-name-keys')).toHaveCount(2);
    await pulse(page,0,0);await expect(first.locator('[data-typing-name]')).toHaveValue(originals[0]+'Й');
    await expect(second.locator('[data-typing-name]')).toHaveValue(originals[1]!);
    await pulse(page,1,0);await expect(second.locator('[data-typing-name]')).toHaveValue(originals[1]+'Й');
    await pulse(page,0,3);await expect(first.locator('[data-style]')).toHaveCount(7);
    await expect(second.locator('[data-typing-name]')).toHaveValue(originals[1]+'Й');
    await pulse(page,1,1);await expect(second.locator('[data-draft-name]')).toHaveValue(originals[1]!);
    await expect(first.locator('[data-style]')).toHaveCount(7);
});

for(const width of [1440,390])test(`selected occupied card shows full blue fill with static hints and still opens with A ${width}`,async({page})=>{
    await page.setViewportSize({width,height:width===1440?960:844});await open(page);await bot(page,'hard','classic');
    const card=page.locator('[data-lobby-slot="1"]');const before=await card.boundingBox();
    if(width===1440){await pulse(page,0,15);await pulse(page,0,13);}
    else for(let i=0;i<12 && !await card.evaluate(e=>e.classList.contains('pad-0'));i++)await pulse(page,0,13);
    await expect(card).toHaveClass(/pad-0/);
    await expect(card).toHaveCSS('background-color','rgb(139, 212, 246)');
    await expect(card).toHaveCSS('outline-style','none');
    await expect(card.locator('button[data-edit]')).toHaveCount(0);
    await expect(card.locator('.lobby-card-hint')).toBeVisible();
    expect(await card.boundingBox()).toEqual(before);
    await page.screenshot({path:`${evidence}/selected-card-${width}.png`,fullPage:true});
    await pulse(page,0,0);await expect(card.locator('[data-level="hard"]')).toHaveAttribute('data-default-choice','true');
    await pulse(page,0,1);await expect(card.locator('h2')).toContainText('сложная');
    await card.hover();await expect(card).toHaveAttribute('data-edit','1');await expect(card.locator('.lobby-card-hint')).toBeVisible();
});
