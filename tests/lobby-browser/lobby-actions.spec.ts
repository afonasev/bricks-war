import {test,expect,type Page} from '@playwright/test';
const out=process.env.BRICKS_LOBBY_EVIDENCE??'evidence/lobby-actions/runtime';
async function open(page:Page,pad=false,index=0){await page.addInitScript(({pad,index})=>{localStorage.setItem('bricks-war:language:v1','ru');const p={index,id:'Xbox Controller',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0};const pads=pad?Array.from({length:index+1},(_,i)=>i===index?p:null):[];Object.assign(window,{actionPad:p,actionPads:pads});Object.defineProperty(navigator,'getGamepads',{value:()=>pads});localStorage.setItem('bricks-war:gamepad-profiles:v2',JSON.stringify([{id:'old-generic',device:'keyboard',name:'Игрок 2',uses:10},{id:'anya',device:'keyboard',name:'Аня',uses:5}]));},{pad,index});await page.goto('/?muted=1');await expect(page.locator('[data-play-entry]')).toBeVisible();}
async function pulse(page:Page,i:number){await page.evaluate(i=>(window as any).actionPad.buttons[i].pressed=true,i);await page.waitForTimeout(100);await page.evaluate(i=>(window as any).actionPad.buttons[i].pressed=false,i);await page.waitForTimeout(100);}
for(const [width,height] of [[1440,960],[1280,480],[390,844]])test(`explicit card actions and visible hover/hints ${width}`,async({page})=>{
 await page.setViewportSize({width:width!,height:height!});await open(page);if(width!<=760)await expect(page.locator('.input-confirm')).toBeHidden();else await expect(page.locator('.input-confirm')).toBeVisible();await expect(page.locator('.input-back')).toHaveCount(0);await page.locator('[data-play-entry]').click();
 const occupied=page.locator('[data-edit="0"]');await expect(occupied).toBeVisible();await expect(page.locator('.lobby-edit')).toHaveCount(0);await occupied.locator('h2').click();await expect(page.locator('[data-style]')).toHaveCount(7);await expect(page.locator('[data-draft-name]')).toHaveCount(0);await page.locator('[data-cancel="0"]').click();
 const empty=page.locator('.is-empty').first();await empty.locator('.lobby-plus').click();await expect(page.locator('[data-level]')).toHaveCount(4);await page.locator('[data-cancel="1"]').click();
 await empty.click({position:{x:5,y:5}});await expect(page.locator('[data-level]')).toHaveCount(4);await page.locator('[data-cancel="1"]').click();
 const joins=empty.locator('[data-join]'),bots=empty.locator('[data-bot]');await joins.click();await expect(page.locator('[data-level]')).toHaveCount(0);if(width!>760){await expect(page.locator('[data-draft-name]')).toHaveCount(1);await page.locator('[data-cancel="1"]').click();}
 const before=await bots.boundingBox();await bots.hover();await expect(bots).toHaveCSS('background-color','rgb(220, 234, 240)');await expect(bots).toHaveCSS('border-top-style','solid');expect(await bots.boundingBox()).toEqual(before);await page.screenshot({path:`${out}/hover-X-${width}.png`,fullPage:true});await joins.hover();await expect(joins).toHaveCSS('background-color','rgb(220, 234, 240)');
 await bots.click();await page.locator('[data-level="medium"]').click();const bot=page.locator('[data-edit="1"]');await expect(bot).toBeVisible();await bot.locator('h2').click();await expect(page.locator('[data-level]')).toHaveCount(4);await page.locator('[data-level="hard"]').click();await page.locator('[data-style="random"]').click();await bot.locator('[data-remove]').click();await expect(page.locator('[data-edit="1"]')).toHaveCount(0);await expect(page.locator('.is-editing')).toHaveCount(0);
 const hint=occupied.locator('.lobby-card-hint');const well=occupied.locator('.lobby-well');const h=await hint.boundingBox(),w=await well.boundingBox();expect(Boolean(h&&w&&h.x<w.x+w.width&&h.x+h.width>w.x&&h.y<w.y+w.height&&h.y+h.height>w.y)).toBe(false);
 await page.locator('[data-lobby-back]').hover();await expect(page.locator('[data-lobby-back]')).toHaveCSS('background-color','rgb(220, 234, 240)');await page.screenshot({path:`${out}/actions-${width}.png`,fullPage:true});
});
test('keyboard default, W admission and generic names stay unique without history pollution',async({page})=>{
 await open(page);await page.locator('[data-play-entry]').click();await expect(page.locator('[data-edit="0"] [data-controller="arrows"]')).toHaveCount(1);
 await page.keyboard.press('w');await expect(page.locator('.is-editing')).toHaveCount(1);await expect(page.locator('[data-name="Игрок 2"]')).toHaveCount(0);await expect(page.locator('[data-name="Аня"]')).toHaveCount(1);await page.keyboard.press('w');await expect(page.locator('.is-editing')).toHaveCount(1);
 await page.locator('[data-generic-name]').click();await page.locator('[data-style="random"]').click();await expect(page.locator('[data-edit="1"] h2')).toHaveText('Игрок 2');await expect(page.locator('[data-edit="1"] [data-controller="wasd"]')).toHaveCount(1);await page.keyboard.press('w');await expect(page.locator('.is-editing')).toHaveCount(0);
 const names=await page.evaluate(()=>JSON.parse(localStorage.getItem('bricks-war:gamepad-profiles:v2')??'[]'));expect(names.filter((p:any)=>p.name==='Игрок 2')).toHaveLength(1);expect(names.find((p:any)=>p.id==='old-generic').uses).toBe(10);
 await page.locator('[data-lobby-back]').click();await page.locator('[data-play-entry]').click();await expect(page.locator('[data-edit="1"] [data-controller="wasd"]')).toHaveCount(1);
});
test('activating controller owns initial player and later Y uses generic numbering',async({page})=>{
 await open(page,true,1);await pulse(page,0);await expect(page.locator('.unified-lobby')).toBeVisible();await expect(page.locator('[data-edit="0"] [data-controller="gamepad"]')).toHaveCount(1);await expect(page.locator('[data-edit="0"] .lobby-ready')).toContainText('Готов');
 await page.keyboard.press('w');await page.locator('[data-generic-name]').click();await page.locator('[data-style="random"]').click();await expect(page.locator('[data-edit="1"] h2')).toHaveText('Игрок 2');
 await pulse(page,3);await expect(page.locator('[data-lobby-slot="0"].is-editing [data-style]')).toHaveCount(7);await pulse(page,1);await expect(page.locator('.is-editing')).toHaveCount(0);
});

test('generic numbers reserve concurrent keyboard and controller drafts',async({page})=>{
 await open(page,true,1);await pulse(page,0);await page.keyboard.press('w');await page.locator('[data-generic-name]').click();
 await page.evaluate(()=>{const w=window as any;const pad={...w.actionPad,index:0,buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false}))};w.actionPads[0]=pad;w.actionPad=pad;});await page.waitForTimeout(100);await pulse(page,3);
 await expect(page.locator('.is-editing')).toHaveCount(2);await page.locator('[data-lobby-slot="2"] [data-generic-name]').click();await page.locator('[data-lobby-slot="2"] [data-style="random"]').click();await expect(page.locator('[data-edit="2"] h2')).toHaveText('Игрок 3');
 await page.locator('[data-lobby-slot="1"] [data-style="random"]').click();await expect(page.locator('[data-edit="1"] h2')).toHaveText('Игрок 2');
});

test('W joins independently while a controller is choosing its name',async({page})=>{
 await open(page,true);await page.locator('[data-play-entry]').click();await pulse(page,3);await expect(page.locator('[data-lobby-slot="1"].is-editing')).toHaveCount(1);
 await page.keyboard.press('w');await expect(page.locator('.is-editing')).toHaveCount(2);await expect(page.locator('[data-lobby-slot="2"] [data-controller="wasd"]')).toHaveCount(1);
 await page.keyboard.press('w');await expect(page.locator('.is-editing')).toHaveCount(2);await page.locator('[data-cancel="2"]').click();await expect(page.locator('[data-lobby-slot="1"].is-editing')).toHaveCount(1);
});
test('A opens the selected whole card while its guidance stays visible',async({page})=>{
 await open(page,true);await page.locator('[data-play-entry]').click();await page.locator('[data-bot]').click();await page.locator('[data-level="medium"]').click();
 await pulse(page,15);await pulse(page,13);const card=page.locator('[data-edit="1"]');await expect(card).toHaveClass(/pad-0/);await expect(card).toHaveCSS('background-color','rgb(139, 212, 246)');await expect(card.locator('.lobby-card-hint')).toBeVisible();const rect=await card.boundingBox();await page.screenshot({path:`${out}/selected-card-pad.png`});
 await pulse(page,0);await expect(page.locator('[data-lobby-slot="1"] [data-level]')).toHaveCount(4);await pulse(page,1);expect(await card.boundingBox()).toEqual(rect);
});

test('held keyboard confirmation never carries into the lobby mode control',async({page})=>{
 await open(page);await page.keyboard.down('Enter');await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','battle');
 await page.keyboard.down('Enter');await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','battle');await page.keyboard.up('Enter');
 await page.keyboard.press('Enter');await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','team-battle');
});

test('Survival empty background never creates a bot',async({page})=>{
 await open(page);await page.locator('[data-play-entry]').click();await page.locator('[data-cycle-mode]').click();await page.locator('[data-cycle-mode]').click();await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','survival');
 await expect(page.locator('[data-empty-bot],[data-bot]')).toHaveCount(0);await page.locator('.is-empty .lobby-plus').click();await expect(page.locator('.is-editing')).toHaveCount(0);
});
