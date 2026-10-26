import {test,expect,type Page} from '@playwright/test';
import {LOCALES} from '../../src/i18n/locale';
import {catalogs} from '../../src/i18n/catalogs';
import type {GameTuning} from '../../src/domain/gameTuning';
import {readFileSync} from 'node:fs';
const DEFAULT_GAME_TUNING=JSON.parse(readFileSync('config/game-tuning.json','utf8')) as GameTuning;
const shots='evidence/localize-help-and-laboratory/screenshots';
async function openSettings(page:Page){await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();}
async function textFits(page:Page,selector:string){return page.locator(selector).evaluateAll(elements=>elements.filter(e=>e.getClientRects().length>0).map(e=>{const range=document.createRange();range.selectNodeContents(e);const t=range.getBoundingClientRect(),b=e.getBoundingClientRect();return {text:e.textContent,fits:t.left>=b.left-1&&t.right<=b.right+1};}));}
for(const locale of LOCALES){
 test(`localized Controls fits ${locale}`,async({browser})=>{
  const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale});const page=await context.newPage();
  try{
   await openSettings(page);await page.locator('#open-controls').click();
   await expect(page.locator('.controls-screen h1')).toHaveText(catalogs[locale].controls);
   await expect(page.locator('.keyboard-reference-card h2')).toHaveText([1,2].map(index=>catalogs[locale].controlsKeyboard.replace('{index}',String(index))));
   for(const viewport of [{width:1440,height:960},{width:1280,height:480}]){
    await page.setViewportSize(viewport);
    const geometry=await page.locator('.keyboard-help-connections').evaluateAll(svgs=>svgs.map(svg=>{const b=svg.getBoundingClientRect();return [...svg.querySelectorAll('text')].map(t=>({text:t.textContent,fits:t.getBoundingClientRect().left>=b.left-1&&t.getBoundingClientRect().right<=b.right+1}));}));
    await test.info().attach('keyboard-labels',{body:JSON.stringify(geometry),contentType:'application/json'});
    expect(geometry.flat().every(t=>t.fits)).toBe(true);
    if(locale!=='ru'){
     await expect(page.locator('[data-gamepad-label]')).toHaveCount(4);
     expect(await page.locator('.controls-screen').innerText()).not.toMatch(/[А-Яа-яЁё]/);
    }
    await page.screenshot({path:`${shots}/${locale}-controls-${viewport.width}x${viewport.height}.png`});
   }
   await page.locator('#controls-back').click();await expect(page.locator('[data-screen="settings"]')).toBeVisible();
   await page.setViewportSize({width:390,height:844});await page.locator('#open-controls').click();
   await expect(page.locator('[data-phone-controls-help]')).toBeVisible();
   await expect(page.locator('.phone-controls-diagram')).toHaveAttribute('aria-label',catalogs[locale].phoneControlsDiagram);
   await page.screenshot({path:`${shots}/${locale}-controls-phone.png`});
  }finally{await context.close();}
 });
 test(`localized illustrated Rules all cards fit ${locale}`,async({browser})=>{
  test.setTimeout(90_000);
  const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale});const page=await context.newPage();
  try{
   await openSettings(page);await page.locator('#open-rules').click();
   await expect(page.locator('.rules-heading h1')).toHaveText(catalogs[locale].rulesTitle);
   for(const viewport of [{width:1440,height:960},{width:1280,height:480},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    for(let i=0;i<8;i++){
     await page.locator(`[data-rule-topic="${i}"]`).click();
     await expect(page.locator('#rules-progress')).toHaveText(`${i+1} / 8`);
     await expect(page.locator('.rules-art')).toHaveAttribute('aria-label',new RegExp('.{30}'));
     const boxes=await page.locator('.rules-art svg').evaluate(svg=>{const b=svg.getBoundingClientRect();return [...svg.querySelectorAll('text')].map(t=>({text:t.textContent,fits:t.getBoundingClientRect().left>=b.left-1&&t.getBoundingClientRect().right<=b.right+1}));});
     await test.info().attach(`svg-${viewport.width}-${i}`,{body:JSON.stringify(boxes),contentType:'application/json'});
     expect(boxes.every(t=>t.fits)).toBe(true);
     if(locale!=='ru')expect(await page.locator('#rules-card').textContent()).not.toMatch(/[А-Яа-яЁё]/);
     const size=await page.locator('.rules-screen').evaluate(e=>({w:e.scrollWidth,cw:e.clientWidth,h:e.scrollHeight,ch:e.clientHeight}));
     expect(size.w).toBe(size.cw);expect(size.h).toBe(size.ch);
     await page.screenshot({path:`${shots}/${locale}-rules-${viewport.width}x${viewport.height}-${i+1}.png`});
    }
   }
   await expect(page.locator('#rules-next')).toBeDisabled();await page.locator('#rules-back').click();await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  }finally{await context.close();}
 });
 test(`localized Laboratory values and custom text survive ${locale}`,async({browser})=>{
  test.setTimeout(90_000);
  const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale});const page=await context.newPage();
  const tuning=structuredClone(DEFAULT_GAME_TUNING);tuning.messages.shieldBlock='Мой щит <b>中</b>';tuning.messages.levelUp='Уровень пользователя {level}';
  await context.addInitScript(value=>localStorage.setItem('bricks-war:game-tuning:v1',JSON.stringify(value)),tuning);
  try{
   await openSettings(page);await page.locator('#open-settings-lab').click();
   await expect(page.locator('.debug-lab-header h1')).toHaveText(catalogs[locale].labTitle);
   await expect(page.locator('[data-tuning-key="minimumGravityMs"]')).toHaveValue(String(tuning.minimumGravityMs));
   await expect(page.locator('[data-message-key="roundStart"]')).toHaveValue(catalogs[locale].noticeRoundStart);
   await expect(page.locator('[data-message-key="shieldBlock"]')).toHaveValue(tuning.messages.shieldBlock);
   await expect(page.locator('[data-message-key="levelUp"]')).toHaveValue(tuning.messages.levelUp);
   for(const viewport of [{width:1440,height:960},{width:1280,height:480}]){
    await page.setViewportSize(viewport);
    const pageCount=Number((await page.locator('.desktop-lab-pages output').innerText()).match(/^\d+ \/ (\d+)/)![1]);expect(pageCount).toBeGreaterThan(10);
    // Return to the first page before checking every existing field/page.
    while(await page.locator('[data-lab-previous]').isEnabled())await page.locator('[data-lab-previous]').click();
    for(let i=0;i<pageCount;i++){
     const geometry=await textFits(page,'.debug-field b,.debug-field small');
     await test.info().attach(`lab-${viewport.width}-${i}`,{body:JSON.stringify(geometry),contentType:'application/json'});
     expect(geometry.every(t=>t.fits)).toBe(true);
     if(i===0||i===2||i===9||i===pageCount-1)await page.screenshot({path:`${shots}/${locale}-lab-${viewport.width}x${viewport.height}-${i+1}.png`});
     if(i<pageCount-1)await page.locator('[data-lab-next]').click();
    }
   }
   await page.locator('#save-debug-tuning').click();
   await expect(page.locator('#debug-save-status')).toHaveText(catalogs[locale].labSavedLocal);
   expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bricks-war:game-tuning:v1')!))).toEqual(tuning);
   await page.setViewportSize({width:390,height:844});
   await expect(page.locator('.desktop-lab-pages')).toHaveCount(0);
   await page.locator('[data-message-key="shieldBlock"]').scrollIntoViewIfNeeded();
   await page.locator('[data-message-key="shieldBlock"]').fill('Custom <b>text</b> 中 {rows}');
   await page.screenshot({path:`${shots}/${locale}-lab-phone-custom.png`});
   await page.locator('#save-debug-tuning').click();
   expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bricks-war:game-tuning:v1')!).messages.shieldBlock)).toBe('Custom <b>text</b> 中 {rows}');
  }finally{await context.close();}
 });
}

for(const locale of LOCALES)test(`Rules caption regions ${locale}`,async({browser})=>{
 const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale,viewport:{width:1440,height:960}});const page=await context.newPage();
 try{
  await openSettings(page);await page.locator('#open-rules').click();const all=[];
  for(let i=0;i<8;i++){
   await page.locator(`[data-rule-topic="${i}"]`).click();
   const metrics=await page.locator('.rules-art svg').evaluate(svg=>[...svg.querySelectorAll('text')].filter(t=>['28','287','277'].includes(t.getAttribute('x')??'')).map(t=>{const b=t.getBBox(),x=Number(t.getAttribute('x'));return {text:t.textContent,x,right:b.x+b.width,limit:x===28?254:x===287?423:344};}));
   all.push({card:i+1,metrics});
  }
  await test.info().attach('caption-regions',{body:JSON.stringify(all),contentType:'application/json'});
  expect(all.flatMap(c=>c.metrics).filter(m=>m.right>m.limit)).toEqual([]);
 }finally{await context.close();}
});

for(const locale of LOCALES)test(`Laboratory localized failures and public guard ${locale}`,async({browser})=>{
 const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale,viewport:{width:1440,height:960}});const page=await context.newPage();
 await context.addInitScript(()=>{Storage.prototype.setItem=()=>{throw new Error('local QA storage blocked');};Storage.prototype.removeItem=()=>{throw new Error('local QA storage blocked');};});
 let releaseSuccess=false;
 await page.route('**/__debug/game-tuning',route=>route.fulfill({status:releaseSuccess?200:503,contentType:'application/json',body:JSON.stringify(releaseSuccess?{ok:true,file:'config/game-tuning.json'}:{ok:false,error:'Local QA failure'})}));
 try{
  await openSettings(page);await page.locator('#open-settings-lab').click();
  await page.locator('#save-debug-tuning').click();await expect(page.locator('#debug-save-status')).toHaveText(catalogs[locale].labSaveFailed);
  await page.locator('#reset-debug-tuning').click();await expect(page.locator('#debug-save-status')).toHaveText(catalogs[locale].labResetFailed);
  await page.locator('#save-release-tuning').click();await expect(page.locator('#debug-save-status')).toHaveText(catalogs[locale].labSaveError.replace('{error}','Local QA failure'));
  await expect(page.locator('#save-release-tuning')).toBeEnabled();
  releaseSuccess=true;await page.locator('#save-release-tuning').click();await expect(page.locator('#debug-save-status')).toHaveText(catalogs[locale].labSavedRelease.replace('{file}','config/game-tuning.json'));
  await page.screenshot({path:`${shots}/${locale}-lab-storage-service-errors.png`});
  // Alternate loopback origin exercises the non-localhost guard in a browser secure context; requests are fulfilled from our own Vite server.
  await page.route('http://127.0.0.2:4291/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:`http://127.0.0.1:4291${url.pathname}${url.search}`});await route.fulfill({response});});
  await page.goto('http://127.0.0.2:4291/?muted=1');await page.locator('[data-destination="settings"]').click();await page.locator('#open-settings-lab').click();
  await expect(page.locator('.laboratory-unavailable h2')).toHaveText(catalogs[locale].labPublicHeading);
  await expect(page.locator('.laboratory-unavailable p')).toHaveText(catalogs[locale].labPublicDescription);
  await expect(page.locator('#save-release-tuning')).toHaveCount(0);
  await page.screenshot({path:`${shots}/${locale}-lab-public-guard.png`});
 }finally{await context.close();}
});
