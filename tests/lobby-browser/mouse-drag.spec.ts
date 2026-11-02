import { test, expect, type Page } from '@playwright/test';
const out = process.env.BRICKS_LOBBY_EVIDENCE!;
async function open(page: Page) {
  await page.goto('/?muted=1');
  await page.locator('[data-play-entry]').click();
  await page.locator('[data-bot="1"]').click();
  await page.locator('[data-level="hard"]').click();
}
const card = (page: Page, slot: number) => page.locator(`[data-lobby-slot="${slot}"]`);
async function point(page: Page, slot: number) {
  const box = await card(page, slot).boundingBox();
  return { x: box!.x + box!.width / 2, y: box!.y + 80 };
}
async function begin(page: Page, from: number, to: number) {
  const a = await point(page, from), b = await point(page, to);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
}
for (const [width, height] of [[1440,960], [1280,480]]) test(`mouse exchanges identities, moves to empty and preserves click ${width}`, async ({page}) => {
  await page.setViewportSize({width: width!, height: height!}); await open(page);
  const playerName = await card(page,0).locator('h2').innerText();
  const botName = await card(page,1).locator('h2').innerText();
  await card(page,0).locator('h2').click();
  await page.locator('[data-wheel-down]').click();
  await page.locator('[data-style]').click();
  const style = await card(page,0).locator('.lobby-style-content').innerText();
  await begin(page,0,1);
  await expect(page.locator('.lobby-drag-ghost')).toBeVisible();
  await expect(card(page,1)).toHaveClass(/is-drop-destination/);
  await expect(card(page,1)).toHaveCSS('outline-color','rgb(234, 179, 44)');
  await page.screenshot({path:`${out}/drag-${width}.png`,fullPage:true});
  await page.mouse.up();
  await expect(card(page,1).locator('h2')).toHaveText(playerName);
  await expect(card(page,1).locator('[data-controller="arrows"]')).toHaveCount(1);
  await expect(card(page,1).locator('.lobby-style-content')).toHaveText(style);
  await expect(card(page,0).locator('h2')).toContainText(/Bot|Бот/);
  await expect(card(page,0).locator('h2')).toHaveText(botName);
  await expect(page.locator('.is-editing,.lobby-drag-ghost,.is-drop-destination')).toHaveCount(0);
  await page.screenshot({path:`${out}/swapped-${width}.png`,fullPage:true});
  await begin(page,1,2); await page.mouse.up();
  await expect(card(page,1)).toHaveClass(/is-empty/);
  await expect(card(page,2).locator('h2')).toHaveText(playerName);
  await card(page,2).locator('h2').click();
  await expect(card(page,2)).toHaveClass(/is-editing/);
  await page.locator('[data-cancel="2"]').click();
  // The production start consumer must receive the moved controller identity.
  await page.locator('#start-match').click();
  await expect(page.locator('.arena-screen')).toBeVisible();
});

test('outside, Escape, blur and small movements leave roster intact; editor blocks dragging', async ({page}) => {
  await open(page); const original = await card(page,0).locator('h2').innerText();
  await begin(page,0,1); await page.mouse.move(5,5); await page.mouse.up();
  await expect(card(page,0).locator('h2')).toHaveText(original);
  await begin(page,0,1); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(card(page,0).locator('h2')).toHaveText(original);
  await begin(page,0,1); await page.evaluate(()=>window.dispatchEvent(new Event('blur'))); await page.mouse.up();
  await expect(card(page,0).locator('h2')).toHaveText(original);
  await expect(page.locator('.lobby-drag-ghost,.is-drop-destination,.is-drag-source')).toHaveCount(0);
  const p = await point(page,0); await page.mouse.move(p.x,p.y); await page.mouse.down(); await page.mouse.move(p.x+2,p.y+2); await page.mouse.up();
  await expect(card(page,0)).toHaveClass(/is-editing/);
  await begin(page,1,2); await page.mouse.up();
  await expect(page.locator('.lobby-drag-ghost')).toHaveCount(0);
  await expect(card(page,1).locator('h2')).toContainText(/Bot|Бот/);
});

test('mouse can move a gamepad card without taking over its editor', async ({page}) => {
  await page.addInitScript(()=>{
    const pad={index:0,id:'Xbox Controller',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0};
    Object.assign(window,{dragPad:pad}); Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});
  });
  await open(page);
  const pulse=async(i:number)=>{await page.evaluate(i=>(window as any).dragPad.buttons[i].pressed=true,i); await page.waitForTimeout(100); await page.evaluate(i=>(window as any).dragPad.buttons[i].pressed=false,i); await page.waitForTimeout(100);};
  await pulse(3); await pulse(0); await pulse(0);
  await expect(card(page,2).locator('[data-controller="gamepad"]')).toHaveCount(1);
  await begin(page,2,1); await page.mouse.up();
  await expect(card(page,1).locator('[data-controller="gamepad"]')).toHaveCount(1);
  await card(page,1).locator('h2').click(); await expect(page.locator('.is-editing')).toHaveCount(0);
  await pulse(3); // controller still owns its short-Y move after the mouse exchange
  await expect(card(page,2).locator('[data-controller="gamepad"]')).toHaveCount(1);
});

test('touch scroll/input does not start a mouse drag',async({page})=>{
  await page.setViewportSize({width:390,height:844}); await open(page);
  await card(page,0).dispatchEvent('pointerdown',{pointerType:'touch',pointerId:7,button:0,clientX:100,clientY:250});
  await card(page,1).dispatchEvent('pointermove',{pointerType:'touch',pointerId:7,buttons:1,clientX:300,clientY:250});
  await card(page,1).dispatchEvent('pointerup',{pointerType:'touch',pointerId:7});
  await expect(page.locator('.lobby-drag-ghost,.is-drop-destination')).toHaveCount(0);
  await page.screenshot({path:`${out}/phone.png`,fullPage:true});
});


test('portrait phone blocks mouse drag; landscape allows it; rotation cancels it', async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await open(page);
  const original = await card(page,0).locator('h2').innerText();
  await begin(page,0,1);
  await expect(page.locator('.lobby-drag-ghost,.is-drop-destination')).toHaveCount(0);
  await page.mouse.up();
  await expect(card(page,0).locator('h2')).toHaveText(original);
  await expect(card(page,0)).not.toHaveCSS('cursor','grab');
  await card(page,0).locator('h2').click();
  await expect(card(page,0)).toHaveClass(/is-editing/);
  await page.locator('[data-cancel="0"]').click();
  await page.screenshot({path:`${out}/portrait-no-drag.png`,fullPage:true});
  await page.setViewportSize({width:844,height:390});
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await card(page,0).scrollIntoViewIfNeeded();
  await expect(card(page,0)).toHaveCSS('cursor','grab');
  const landscapePoint = await point(page,0);
  await page.mouse.move(landscapePoint.x,landscapePoint.y); await page.mouse.down();
  await page.mouse.move(landscapePoint.x+30,landscapePoint.y+5,{steps:5});
  await expect(page.locator('.lobby-drag-ghost')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.lobby-drag-ghost,.is-drop-destination')).toHaveCount(0);
  await page.mouse.up();
  await expect(card(page,0).locator('h2')).toHaveText(original);
  await expect(card(page,0)).not.toHaveCSS('cursor','grab');
});
