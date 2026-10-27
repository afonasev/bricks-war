import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const output=process.env.BRICKS_LOBBY_EVIDENCE??'evidence/release-history-images/browser';
const base='https://raw.githubusercontent.com/afonasev/bricks-war/ebfa9780baf783bf4359b7dd961b0e7e157b6efb/docs/release-notes/1.12.1/';
const notes='### Улучшения\n- Команды стали заметнее.\n\n![Контраст команд]('+base+'teams-1440.png)\n\n- Подписи и текст сохранены.\n\n![Пример недоступного кадра]('+base+'missing.png)\n\n<img src=x onerror="window.notesExecuted=true">\n- Конец описания'+('\n- Дополнительное изменение для проверки прокрутки.').repeat(20);
for(const [width,height,native] of [[1440,960,true],[1280,480,true],[390,844,false]] as const)test(`release images fit, fail gracefully and retain focus ${width} native${native}`,async({page})=>{
 await page.setViewportSize({width,height});
 await page.addInitScript(({native,notes})=>{
  localStorage.setItem('bricks-war:language:v1','ru');
  const controller={index:0,id:'Xbox QA',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};
  Object.defineProperty(navigator,'getGamepads',{value:()=>[controller]});(window as any).imagePad=controller;
  if(native){const display={width:1440,height:960,fullscreen:false,resolutions:[[1440,960]]};(window as any).bricksDesktop={updateState:async()=>({phase:'idle'}),check:async()=>({phase:'idle'}),setActivity:async()=>{},setSafeMenu:()=>{},healthy:async()=>{},display:async()=>display,setDisplay:async()=>display,confirmDisplay:async()=>display,history:async()=>[{version:'1.12.1',date:'2026-10-27',text:notes,fallback:false,installed:true}]};}
 },{native,notes});
 await page.route('https://api.github.com/repos/afonasev/bricks-war/releases?*',route=>route.fulfill({json:[{tag_name:'content-1793113422125',name:'Game content 1.12.1',body:'## Русский\n'+notes}],headers:{'access-control-allow-origin':'*'}}));
 const png=readFileSync('docs/release-notes/1.12.1/teams-1440.png');
 const imageRoute=async(route:import('@playwright/test').Route)=>route.request().url().includes('missing')?route.fulfill({status:404}):route.fulfill({body:png,contentType:'image/png'});
 await page.route('https://raw.githubusercontent.com/**',imageRoute);await page.route('**/__release-image?*',imageRoute);
 await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();await page.locator('#open-release-history').click();
 const list=page.locator('[data-history-scroll]'),image=list.locator('img').first();
 await expect.poll(()=>image.evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth>0)).toBe(true);
 await expect(list).toContainText('Контраст команд');await expect(list).toContainText('Подписи и текст сохранены.');
 const bounds=await image.boundingBox();const scroll=await list.boundingBox();expect(bounds!.width).toBeLessThanOrEqual(scroll!.width);expect(bounds!.x).toBeGreaterThanOrEqual(scroll!.x);
 await page.screenshot({path:`${output}/images-${width}-native${native}.png`});
 await list.focus();await list.press('End');
 await expect(list.locator('.release-image-unavailable').last()).toBeVisible();
 await expect(list).toContainText('Изображение недоступно.');await expect(list).toContainText('<img src=x onerror=');expect(await page.evaluate(()=>(window as any).notesExecuted)).toBeUndefined();
 await expect(list.locator('img')).toHaveCount(2);
 await page.screenshot({path:`${output}/unavailable-${width}-native${native}.png`});
 await list.press('Home');await page.evaluate(()=>(window as any).imagePad.buttons[15].pressed=true);await page.waitForTimeout(120);await page.evaluate(()=>(window as any).imagePad.buttons[15].pressed=false);
 await expect.poll(()=>list.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
 await page.keyboard.press('Escape');await expect(page.locator('[data-release-history]')).toHaveCount(0);await expect(page.locator('#open-release-history')).toBeFocused();
});
