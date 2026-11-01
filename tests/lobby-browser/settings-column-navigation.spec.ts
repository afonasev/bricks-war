import {test,expect} from '@playwright/test';
import {openLocalLobby} from '../helpers/localLobby';
for(const context of ['menu','native-menu','pause'])test(`every setting crosses columns ${context}`,async({page})=>{
 await page.setViewportSize({width:1440,height:960});await page.addInitScript(native=>{localStorage.setItem('bricks-war:language:v1','en');const pad={index:0,id:'Xbox QA',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});(window as any).columnPad=pad;if(native){const display={width:1440,height:960,fullscreen:false,auto:true,resolutions:[[1440,960]]};(window as any).bricksDesktop={updateState:async()=>({phase:'idle'}),check:async()=>({phase:'idle'}),setActivity:async()=>({phase:'idle'}),setSafeMenu:()=>{},healthy:async()=>{},display:async()=>display};}},context==='native-menu');await page.goto('/?muted=1');
 if(context==='pause'){await openLocalLobby(page,'survival');await page.locator('#start-match').click();await expect(page.locator('.match-loading')).toHaveCount(0);await expect(page.locator('#countdown')).toBeHidden();await page.keyboard.press('Escape');await page.locator('#pause-settings').click();}else await page.locator('[data-destination="settings"]').click();
 const columns=page.locator(context==='pause'?'.pause-preferences-column':'.settings-columns');await expect(columns).toHaveCount(2);
 const values=()=>page.locator(context==='pause'?'#pause-settings-panel input,#pause-settings-panel select':'.settings-screen input,.settings-screen select').evaluateAll(es=>es.map(e=>({value:(e as HTMLInputElement).value,checked:(e as HTMLInputElement).checked})));
 const initial=await values();
 for(const source of [0,1]){
  const targets=columns.nth(source).locator('[data-ui-focus]:visible');const count=await targets.count();expect(count).toBeGreaterThan(0);
  for(let i=0;i<count;i++){
   const control=targets.nth(i);await control.hover();await expect(control).toBeFocused();await page.evaluate(button=>{(window as any).columnPad.buttons[button].pressed=true;},source===0?15:14);
   await expect.poll(()=>columns.nth(1-source).evaluate(e=>e.contains(document.activeElement))).toBe(true);await page.evaluate(button=>{(window as any).columnPad.buttons[button].pressed=false;},source===0?15:14);await page.waitForTimeout(90);expect(await values()).toEqual(initial);await expect(page.locator('[data-gamepad-editing]')).toHaveCount(0);
  }
 }
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/columns-${context}.png`});
});
