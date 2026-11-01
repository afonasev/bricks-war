import {test,expect} from '@playwright/test';
for(const width of [1440,390])test(`unknown controller uses Xbox hints ${width}`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:960});
 await page.addInitScript(()=>{localStorage.setItem('bricks-war:language:v1','en');const pad={index:0,id:'Generic USB Gamepad (Vendor: 1234 Product: 5678)',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});(window as any).unknownPad=pad;});
 await page.goto('/?muted=1');await expect(page.locator('.main-menu-screen .input-confirm')).toHaveText('A');
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/main-${width}.png`});
 await page.locator('[data-destination="settings"]').click();await expect(page.locator('#settings-back .input-back')).toHaveText('B');await expect(page.locator('[data-reset-preferences] .input-reset')).toHaveText('Y');
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/settings-${width}.png`});
 await page.locator('#open-controls').click();await expect(page.locator('#controls-back .input-back')).toHaveText('B');
 await page.evaluate(()=>{(window as any).unknownPad.buttons[1].pressed=true;});await expect(page.locator('.settings-screen')).toBeVisible();
});
