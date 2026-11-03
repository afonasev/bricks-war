import { test, expect, type Page, type Locator } from '@playwright/test';
import { openLocalLobby } from '../helpers/localLobby';
import { openPreferencesCategory } from '../helpers/preferences';
const focus='rgb(220, 233, 184)', hover='rgb(234, 241, 213)';
async function check(page:Page,button:Locator,name:string,width:number){
 await button.hover();await expect(button).toHaveCSS('background-color',hover);
 const before=await button.boundingBox();await button.press('Shift');await expect(button).toHaveCSS('background-color',focus);
 const after=await button.boundingBox();expect(after!.width).toBeCloseTo(before!.width,1);expect(after!.height).toBeCloseTo(before!.height,1);
 const fits=await button.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1;});expect(fits).toBe(true);
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/${name}-${width}.png`});
}
for(const [width,height]of [[1440,960],[390,844]]as const)test(`shared A styles through local and network screens ${width}`,async({page})=>{
 await page.setViewportSize({width,height});await page.addInitScript(()=>localStorage.setItem('bricks-war:language:v1','en'));
 await page.route('**/api/network/lobbies?*',route=>route.fulfill({json:{rooms:[],next:null}}));
 await page.goto('/?muted=1');await check(page,page.locator('[data-destination="settings"]'),'main',width);
 await page.locator('[data-destination="settings"]').click();
 for(const [category,launch,back,name]of [['controls','#open-controls','#controls-back','controls'],['more','#open-rules','#rules-back','rules'],['more','#open-settings-lab','#close-debug-lab','laboratory'],['more','#open-release-history','[data-history-back]','history']]as const){
  await openPreferencesCategory(page,category);await page.locator(launch).click();await check(page,page.locator(back),name,width);await page.locator(back).click();
 }
 await openPreferencesCategory(page,'more');await page.locator('#reset-local-records').click();await expect(page.locator('[data-record-reset-confirm]')).toBeVisible();await check(page,page.locator('[data-record-reset-cancel]'),'confirmation',width);await page.locator('[data-record-reset-cancel]').click();
 await page.locator('#settings-back').click();await openLocalLobby(page,'battle');await page.locator('[data-bot]').first().click();await page.locator('[data-level="easy"]').click();await check(page,page.locator('#start-match'),'lobby',width);await page.locator('[data-lobby-back]').click();
 await page.locator('[data-network-entry]').click();await check(page,page.locator('[data-net-action="create"]'),'network-list',width);await page.locator('[data-net-action="create"]').click();await check(page,page.locator('#network-form button[type="submit"]'),'network-create',width);
});
for(const [width,height]of [[1440,960],[390,844]]as const)test(`actual pause and match results A ${width}`,async({page})=>{
 test.setTimeout(60000);await page.setViewportSize({width,height});await page.addInitScript(()=>{
  localStorage.setItem('bricks-war:language:v1','en');
  let captured=false;
  new MutationObserver(()=>{
   const panel=document.querySelector('.results-panel');if(!panel||captured)return;captured=true;
   const button=panel.querySelector<HTMLButtonElement>('#play-again')!;
   (window as any).resultGuardCapture={visibility:getComputedStyle(panel.querySelector('.results-actions')!).visibility,disabled:button.disabled};
   button.click();
   for(const type of ['keydown','keyup'])document.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
  }).observe(document,{childList:true,subtree:true});
 });
 await page.goto('/?muted=1&playtest-fast=20');await openLocalLobby(page,'battle');await page.locator('[data-bot]').first().click();await page.locator('[data-level="easy"]').click();
 await page.locator('#match-duration').click();await page.locator('#start-match').click();await expect(page.locator('.arena-screen')).toBeVisible();await expect(page.locator('.match-loading')).toHaveCount(0);await expect(page.locator('#countdown')).toBeHidden();
 if(await page.locator('#manual-pause').isVisible())await page.locator('#manual-pause').click();else await page.keyboard.press('Escape');
 await check(page,page.locator('#pause-settings'),'pause',width);await page.locator('#continue-match').click();
 await expect(page.locator('.results-panel')).toBeVisible({timeout:36000});await expect(page.locator('#play-again')).toBeEnabled({timeout:5000});
 expect(await page.evaluate(()=>(window as any).resultGuardCapture)).toEqual({visibility:'hidden',disabled:true});await expect(page.locator('.results-panel')).toHaveCount(1);
 await check(page,page.locator('#play-again'),'results',width);await check(page,page.locator('#results-main-menu'),'results-menu',width);
});
