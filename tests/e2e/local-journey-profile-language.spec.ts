import { openLocalLobby } from '../helpers/localLobby';
import {test,expect} from '@playwright/test';
import {LOCALES} from '../../src/i18n/locale';
import {catalogs} from '../../src/i18n/catalogs';
for(const locale of LOCALES) test(`localized controller profile preserves identity ${locale}`,async({browser})=>{
 const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale,viewport:{width:1280,height:480}});
 const page=await context.newPage();
 await page.addInitScript(()=>{
  const device=JSON.stringify(['Locale QA Pad','standard',16,2]);
  localStorage.setItem('bricks-war:gamepad-profiles:v2',JSON.stringify([{id:'a',device,name:'<b>Анна中</b>'},{id:'b',device,name:'Другой игрок'}]));
  const pad={index:0,id:'Locale QA Pad',connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,touched:false,value:0})),timestamp:0};
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});
  Object.assign(window,{localeProfilePad:pad});
 });
 await page.route('**/api/network/**',route=>route.fulfill({status:503,body:'local QA offline fixture'}));
 try {
  await page.goto('/?muted=1');await openLocalLobby(page,'battle');
  await page.evaluate(()=>{(window as any).localeProfilePad.buttons[3].pressed=true;});
  const dialog=page.locator('[data-profile-choice]');await expect(dialog).toBeVisible();
  await page.evaluate(()=>{(window as any).localeProfilePad.buttons[3].pressed=false;});
  await expect(dialog.locator('h2')).toHaveText(catalogs[locale].profileChooseName);
  await expect(dialog.locator('[data-profile-new]')).toHaveText(catalogs[locale].profileSave);
  await expect(dialog.locator('[data-profile-cancel]')).toHaveText(catalogs[locale].journeyCancel);
  await expect(dialog.locator('[data-profile-id="a"]')).toHaveText('<b>Анна中</b>');
  await expect(dialog.locator('[data-profile-name]')).toHaveAttribute('aria-label',catalogs[locale].profileNewName);
  const geometry=await dialog.boundingBox();expect(geometry).not.toBeNull();
  expect(geometry!.y).toBeGreaterThanOrEqual(0);expect(geometry!.y+geometry!.height).toBeLessThanOrEqual(480);
  await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/setup-hud-screenshots/${locale}-profile-1280x480.png`});
  await dialog.locator('[data-profile-id="a"]').click();await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-slot="3"]')).toHaveValue('gamepad-0');
  await expect(page.locator('[data-player-name="3"]')).toHaveValue('<b>Анна中</b>');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bricks-war:gamepad-profiles:v2')!).map((p:any)=>({id:p.id,name:p.name})))).toEqual([{id:'a',name:'<b>Анна中</b>'},{id:'b',name:'Другой игрок'}]);
 } finally {await context.close();}
});
