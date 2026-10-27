import {test,expect,type Page} from '@playwright/test';
const out=process.env.BRICKS_LOBBY_EVIDENCE??'evidence/sage-hover/phone-cards/runtime';
async function boot(page:Page,width:number,height:number){
 await page.setViewportSize({width,height});
 await page.addInitScript(()=>{Object.defineProperty(navigator,'getGamepads',{value:()=>[]});localStorage.setItem('bricks-war:language:v1','ru');localStorage.setItem('bricks-war:player-names:v1',JSON.stringify(['Александр Великий','Игрок 2','Игрок 3','Игрок 4']));});
 await page.goto('/?muted=1');await page.locator('[data-play-entry]').click();
}
async function readableCards(page:Page){
 const issues=await page.locator('.lobby-card:not(.is-empty):not(.is-editing)').evaluateAll(cards=>cards.flatMap(card=>{
  const outer=card.getBoundingClientRect();const els=[...card.querySelectorAll<HTMLElement>('h2,.lobby-ready,.lobby-well,.lobby-style-label,.lobby-remove')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');const bad:string[]=[];
  for(const e of els){const r=e.getBoundingClientRect();if(r.left<outer.left||r.right>outer.right+1||r.top<outer.top||r.bottom>outer.bottom+1||e.scrollWidth>e.clientWidth+1)bad.push('clipped '+e.className);}
  for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){const a=els[i]!.getBoundingClientRect(),b=els[j]!.getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)bad.push('overlap '+els[i]!.className+'/'+els[j]!.className);}
  return bad;
 }));expect(issues).toEqual([]);
}
for(const [width,height] of [[320,740],[390,844],[844,390]])test(`phone cards fit content, hide redundant identity and offer bots ${width}`,async({page})=>{
 await boot(page,width!,height!);await expect(page.locator('#app')).toHaveAttribute('data-layout','mobile');
 const first=page.locator('[data-edit="0"]');await expect(first.locator('.lobby-card-mark')).toBeHidden();await expect(first.locator('h2')).toHaveText('Александр Великий');await expect(page.locator('[data-join]').first()).toBeHidden();
 expect((await first.boundingBox())!.height).toBeLessThan(240);expect((await page.locator('.is-empty').first().boundingBox())!.height).toBeLessThan(140);await readableCards(page);
 await page.locator('.lobby-cards').screenshot({path:`${out}/cards-${width}.png`});
 await page.locator('[data-bot]').first().click();await expect(page.locator('[data-level]')).toHaveCount(4);await page.locator('[data-level="medium"]').click();await expect(page.locator('[data-edit="1"] h2')).toContainText('Бот');await readableCards(page);
 if(width===390)await page.locator('.lobby-cards').screenshot({path:`${out}/with-bot.png`});
 await page.locator('[data-remove="1"]').click();await expect(page.locator('[data-bot="1"]')).toBeVisible();
 await first.click();await expect(page.locator('.lobby-theme-list')).toBeVisible();if(width===390)await page.locator('.lobby-cards').screenshot({path:`${out}/style-editor.png`});await page.locator('[data-cancel]').click();
 // No-human recovery stays available after the sole touch player is removed.
 await page.locator('[data-remove="0"]').click();await expect(page.locator('[data-join]').first()).toBeVisible();await page.locator('[data-join]').first().click();await expect(page.locator('[data-wheel-center]')).toBeVisible();await page.locator('[data-cancel]').click();
 // Re-enter a fresh browser state for mode-specific card placement.
 await page.reload();await page.locator('[data-play-entry]').click();
 await page.locator('[data-cycle-mode]').click();await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','team-battle');await readableCards(page);if(width===390)await page.locator('.lobby-cards').screenshot({path:`${out}/team-cards.png`});
 await page.locator('[data-cycle-mode]').click();await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','survival');await expect(page.locator('.is-empty')).toBeHidden();await readableCards(page);if(width===390)await page.locator('.lobby-cards').screenshot({path:`${out}/survival-card.png`});
});
test('desktop keeps controller identity and local Join controls',async({page})=>{
 await boot(page,1440,960);await expect(page.locator('[data-edit="0"] .lobby-card-mark')).toBeVisible();await expect(page.locator('[data-join]').first()).toBeVisible();expect((await page.locator('[data-edit="0"]').boundingBox())!.height).toBe(350);
});
test('phone gamepad navigation skips hidden Join controls',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{localStorage.setItem('bricks-war:language:v1','ru');const pad={index:0,id:'Phone QA pad',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});Object.assign(window,{phonePad:pad});});
 await page.goto('/?muted=1');await expect(page.locator('[data-play-entry]')).toBeVisible();
 async function pulse(button:number){await page.evaluate(i=>(window as any).phonePad.buttons[i].pressed=true,button);await page.waitForTimeout(110);await page.evaluate(i=>(window as any).phonePad.buttons[i].pressed=false,button);await page.waitForTimeout(110);}
 await pulse(0);await expect(page.locator('.unified-lobby')).toBeVisible();await expect(page.locator('[data-join]').first()).toBeHidden();
 for(let i=0;i<12;i++){await pulse(15);const target=page.locator('.unified-lobby [class*="-target"]');await expect(target).toHaveCount(1);await expect(target).toBeVisible();await expect(target).not.toHaveAttribute('data-join',/./);expect(await target.evaluate(e=>e.hasAttribute('data-join'))).toBe(false);}
});
