import {test,expect,type Page} from '@playwright/test';
async function set(page:Page,down:boolean){await page.evaluate(down=>{(window as any).shortPad.buttons[2].pressed=down;},down);}
async function pulse(page:Page,button:number){await page.evaluate(i=>{(window as any).shortPad.buttons[i].pressed=true;},button);await page.waitForTimeout(110);await page.evaluate(i=>{(window as any).shortPad.buttons[i].pressed=false;},button);await page.waitForTimeout(110);}
for(const [width,height]of [[1440,960],[1280,480],[390,844]]as const)test(`short X adds and hold X deletes selected bot ${width}`,async({page})=>{
 await page.setViewportSize({width,height});await page.addInitScript(()=>{localStorage.setItem('bricks-war:language:v1','en');const pad={index:0,id:'Xbox gesture QA',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});(window as any).shortPad=pad;});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?muted=1');await expect(page.locator('[data-play-entry]')).toBeVisible();await pulse(page,0);await expect(page.locator('.unified-lobby')).toBeVisible();
 for(let i=0;i<8&&!await page.locator('[data-edit="0"]').evaluate(e=>e.classList.contains('pad-0-target'));i++)await pulse(page,13);
 await expect(page.locator('[data-edit="0"]')).toHaveClass(/pad-0-target/);
 // Short X from a human card opens a new bot, preserving the selected card.
 await pulse(page,2);await expect(page.locator('[data-lobby-slot="1"] [data-level]')).toHaveCount(4);await expect(page.locator('[data-edit="0"]')).toBeVisible();await pulse(page,0);await expect(page.locator('[data-edit="1"]')).toBeVisible();
 await pulse(page,width===390?13:15);await expect(page.locator('[data-edit="1"]')).toHaveClass(/pad-0-target/);
 const before=await page.locator('[data-edit="1"] h2').textContent();
 await set(page,true);await page.waitForTimeout(110);await expect(page.locator('.is-editing')).toHaveCount(0);await set(page,false);
 await expect(page.locator('[data-lobby-slot="2"] [data-level]')).toHaveCount(4);await expect(page.locator('[data-edit="1"] h2')).toHaveText(before!);
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/short-add-${width}.png`});
 // Commit the new bot. Selected original bot remains the removal target.
 await pulse(page,0);await expect(page.locator('[data-edit="2"]')).toBeVisible();await expect(page.locator('[data-edit="1"]')).toHaveClass(/pad-0-target/);
 await set(page,true);await page.waitForTimeout(850);await expect(page.locator('[data-edit="1"]')).toHaveCount(0);
 await page.waitForTimeout(200);await expect(page.locator('[data-edit="2"]')).toBeVisible();await set(page,false);await page.waitForTimeout(150);
 await expect(page.locator('.is-editing')).toHaveCount(0);await expect(page.locator('[data-edit]')).toHaveCount(2);await expect(page.locator('[data-edit="0"]')).toBeVisible();await expect(page.locator('[data-edit="2"]')).toBeVisible();expect(errors).toEqual([]);
});
