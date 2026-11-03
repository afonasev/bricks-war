import { test, expect, type Page } from '@playwright/test';
import { openLocalLobby } from '../helpers/localLobby';

const nativeFixture = () => {
  localStorage.setItem('bricks-war:language:v1','en');
  const display={width:1280,height:720,fullscreen:false,auto:true,resolutions:[[1280,720],[1920,1080],[3840,2160]]};
  (window as any).bricksDesktop={updateState:async()=>({phase:'idle'}),check:async()=>({phase:'idle'}),setActivity:async()=>{},setSafeMenu:()=>{},healthy:async()=>{},display:async()=>display,history:async()=>[]};
  const pad={index:0,id:'Xbox QA',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};
  Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]}); (window as any).responsivePad=pad;
};
async function geometry(page:Page) {
 return page.evaluate(()=>{
  const panel=document.querySelector('.section-shell[data-screen="settings"],.pause-settings-panel:not([hidden])')!;
  const controls=[...panel.querySelectorAll<HTMLElement>('button,input:not([hidden]),[data-preferences-category]')].filter(e=>e.getClientRects().length&&!e.closest('[hidden]'));
  return {overflow:[panel,...panel.querySelectorAll<HTMLElement>('.section-content,.settings-list,.pause-preferences-scroll')].filter(e=>e.clientWidth>0).filter(e=>e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2).map(e=>({class:e.className,h:[e.scrollHeight,e.clientHeight],w:[e.scrollWidth,e.clientWidth]})),outside:controls.filter(e=>{const r=e.getBoundingClientRect();return r.left < -1||r.right>innerWidth+1||r.top < -1||r.bottom>innerHeight+1}).map(e=>e.id||e.className),overlaps:controls.flatMap((a,i)=>controls.slice(i+1).filter(b=>{if(a.contains(b)||b.contains(a))return false;const r=a.getBoundingClientRect(),q=b.getBoundingClientRect();return Math.min(r.right,q.right)>Math.max(r.left,q.left)+1&&Math.min(r.bottom,q.bottom)>Math.max(r.top,q.top)+1;}).map(b=>[a.id||a.className,b.id||b.className])),clipped:controls.filter(e=>e.tagName==='BUTTON'&&e.scrollWidth>e.clientWidth+2).map(e=>e.textContent)};
 });
}
for(const [width,height] of [[1440,960],[1280,720],[854,480],[640,360],[390,844],[844,390]] as const) test(`responsive native settings ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width,height});await page.addInitScript(nativeFixture);await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();
 const tabs=page.locator('.preferences-tabs');
 if(width<=1000||height<=760){
  await expect(tabs).toBeVisible();
  for(const tab of await tabs.getByRole('tab').all()){
   await tab.click();await expect(tab).toHaveAttribute('aria-selected','true');
   expect(await geometry(page)).toEqual({overflow:[],outside:[],overlaps:[],clipped:[]});
   await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/settings-${width}x${height}-${await tab.getAttribute('aria-controls')}.png`});
  }
  await tabs.getByRole('tab').first().click();
 } else {await expect(tabs).toBeHidden();expect(await geometry(page)).toEqual({overflow:[],outside:[],overlaps:[],clipped:[]});}
 const value=await page.locator('#music-volume').inputValue();await page.keyboard.press('Tab');await page.locator('#music-volume').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#music-volume').locator('..')).toHaveCSS('background-color','rgb(220, 233, 184)');
 if(width<=1000||height<=760){await tabs.getByRole('tab').nth(1).click();await expect(page.locator('#music-volume')).toBeHidden();await tabs.getByRole('tab').first().click();await expect(page.locator('#music-volume')).toHaveValue(value);}
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/settings-${width}x${height}-focus.png`});
 // Resizing reveals existing controls and preserves the last category.
 await page.setViewportSize({width:1440,height:960});await expect(page.locator('[data-preferences-category="display"]')).toBeVisible();
 await page.setViewportSize({width,height});await expect(page.locator('#music-volume')).toHaveValue(value);
});

test('compact pause settings preserve slider edit cancel and tabs',async({page})=>{
 await page.setViewportSize({width:640,height:360});await page.addInitScript(nativeFixture);await page.goto('/?muted=1');await openLocalLobby(page,'survival');await page.locator('#start-match').click();await expect(page.locator('.arena-screen')).toBeVisible();await expect(page.locator('.match-loading')).toHaveCount(0);await expect(page.locator('#countdown')).toBeHidden({timeout:20000});await page.keyboard.press('Escape');await page.locator('#pause-settings').click();
 const panel=page.locator('#pause-settings-panel');await expect(panel.locator('.preferences-tabs')).toBeVisible();
 for(const tab of await panel.getByRole('tab').all()){await tab.click();await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/pause-${await tab.getAttribute('aria-controls')}.png`});expect(await geometry(page)).toEqual({overflow:[],outside:[],overlaps:[],clipped:[]});}
 await panel.getByRole('tab').first().click();const input=panel.locator('#music-volume'),original=await input.inputValue();await input.focus();await input.press('Enter');
 const press=async(index:number)=>{await page.evaluate(i=>(window as any).responsivePad.buttons[i].pressed=true,index);await page.waitForTimeout(90);await page.evaluate(i=>(window as any).responsivePad.buttons[i].pressed=false,index);await page.waitForTimeout(90);};
 await press(0);await expect(input).toHaveAttribute('data-gamepad-editing','true');await press(14);await expect(input).not.toHaveValue(original);await press(1);await expect(input).toHaveValue(original);await expect(input).not.toHaveAttribute('data-gamepad-editing','true');
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/pause-640-focus.png`});
});

test('DPR 3 native window keeps every category inside 1280x720 logical pixels',async({browser})=>{
 const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:3});const page=await context.newPage();
 try{await page.addInitScript(nativeFixture);await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();expect(await page.evaluate(()=>devicePixelRatio)).toBe(3);
 for(const tab of await page.getByRole('tab').all()){await tab.click();expect(await geometry(page)).toEqual({overflow:[],outside:[],overlaps:[],clipped:[]});}
 await page.getByRole('tab').first().click();await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/settings-DPR3.png`});
 }finally{await context.close();}
});
for(const locale of ['ru','fr','de','es','zh-Hans','ja'])test(`compact native localized categories ${locale}`,async({page})=>{
 await page.setViewportSize({width:640,height:360});await page.addInitScript(nativeFixture);await page.addInitScript(locale=>localStorage.setItem('bricks-war:language:v1',locale),locale);await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();
 for(const tab of await page.getByRole('tab').all()){await tab.click();expect(await geometry(page)).toEqual({overflow:[],outside:[],overlaps:[],clipped:[]});}
});
