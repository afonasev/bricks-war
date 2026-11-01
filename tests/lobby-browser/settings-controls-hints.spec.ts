import { test, expect } from '@playwright/test';
for(const [width,height] of [[1440,960],[1280,480],[390,844],[844,390]] as const)test(`shared section navigation and centered controls ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width,height});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('bricks-war:language:v1','en');const pad={index:0,id:'Xbox QA',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});(window as any).hintPad=pad;});
 await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();
 const settings=page.locator('.settings-screen');await expect(page.locator('#settings-back .input-back')).toHaveText('B');await expect(settings.locator('footer [data-hint-action]')).toHaveCount(0);
 const fits=async(selector:string)=>page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});
 expect(await fits('#settings-back')).toBe(true);
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/settings-${width}.png`});
 await page.locator('#open-controls').click();
 await expect(page.locator('#controls-back .input-back')).toHaveText('B');await expect(page.locator('[data-screen="controls"] footer')).toHaveCount(0);await expect(page.locator('[data-screen="controls"]')).toHaveCSS('border-radius','0px');await expect(page.locator('.controls-family-note')).toHaveCount(0);expect(await fits('#controls-back')).toBe(true);
 if(await page.locator('.approved-gamepad-artwork').count()){
  const geometry=await page.locator('.approved-gamepad-artwork').evaluate(e=>{const image=e.getBoundingClientRect(),panel=e.parentElement!.getBoundingClientRect();return {centerError:Math.abs((image.top+image.bottom-panel.top-panel.bottom)/2),fits:image.left>=panel.left-1&&image.right<=panel.right+1&&image.top>=panel.top-1&&image.bottom<=panel.bottom+1};});
  expect(geometry.centerError).toBeLessThanOrEqual(1);expect(geometry.fits).toBe(true);
 }else await expect(page.locator('.phone-controls-diagram')).toBeVisible();
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/controls-${width}.png`});
 await page.evaluate(()=>{(window as any).hintPad.buttons[1].pressed=true;});await expect(settings).toBeVisible();await page.evaluate(()=>{(window as any).hintPad.buttons[1].pressed=false;});
 await page.locator('#settings-back').click();await expect(page.locator('.main-menu-screen')).toBeVisible();expect(errors).toEqual([]);
});
