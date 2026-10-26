import { test, expect } from '@playwright/test';
const out = process.env.BRICKS_LOBBY_EVIDENCE ?? 'evidence/workshop-menu-family/runtime';
for (const [width,height,native,locale] of [[1440,960,false,'ru'],[1280,480,false,'ru'],[390,844,false,'ru'],[844,390,false,'ru'],[1440,960,true,'ru'],[1280,480,true,'de'],[390,844,false,'ja']] as const) {
 test(`workshop main and settings ${width} ${height} native${native} ${locale}`,async({page})=>{
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width,height});
  await page.addInitScript(({native,locale})=>{
   localStorage.setItem('bricks-war:language:v1',locale);
   const pad={index:0,id:'Xbox Controller',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0};
   Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});Object.assign(window,{workshopPad:pad});
   if(native){const display={width:1440,height:960,fullscreen:false,auto:true,resolutions:[[1280,720],[1440,960]]};(window as any).bricksDesktop={updateState:async()=>({phase:'none'}),check:async()=>({phase:'none'}),setActivity:async()=>{},setSafeMenu:()=>{},healthy:async()=>{},display:async()=>display,setDisplay:async()=>display,confirmDisplay:async()=>display,exit:async()=>{},history:async()=>[]};}
  },{native,locale});
  await page.goto('/?muted=1');
  const main=page.locator('.workshop-menu.main-menu-screen');await expect(main).toBeVisible();
  await expect(main.locator('.mode-menu > button')).toHaveCount(native?4:3);await expect(main.locator('.mode-icon svg')).toHaveCount(native?4:3);
  expect(await main.evaluate(e=>{const app=e.closest('#app')!;return getComputedStyle(app.getAttribute('data-layout')==='desktop'?app:e).backgroundImage;})).toContain('maple.webp');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-play-entry]')).toHaveCSS('background-color','rgb(139, 212, 246)');
  await expect(page.locator('[data-play-entry]')).toHaveCSS('outline-style','none');
  if(await page.locator('#app').getAttribute('data-layout')==='desktop') await expect.poll(()=>page.locator('.menu-workshop-art').evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth>0)).toBe(true);
  await page.screenshot({path:`${out}/main-${width}-${height}-${locale}-native${native}.png`});
  const before=await page.locator('[data-play-entry]').boundingBox();await page.mouse.move(0,0);await page.locator('[data-play-entry]').hover();
  await expect(page.locator('#app')).toHaveAttribute('data-input-mode','pointer');
  await expect(page.locator('[data-play-entry]')).toHaveCSS('background-color','rgb(245, 234, 210)');await expect(page.locator('[data-play-entry]')).toHaveCSS('outline-style','none');expect(await page.locator('[data-play-entry]').boundingBox()).toEqual(before);
  await page.locator('[data-destination="settings"]').click();
  const settings=page.locator('.workshop-menu.settings-screen');await expect(settings).toBeVisible();expect(await settings.evaluate(e=>{const app=e.closest('#app')!;return getComputedStyle(app.getAttribute('data-layout')==='desktop'?app:e).backgroundImage;})).toContain('maple.webp');
  await expect(page.locator('#master-volume,#music-volume,#effects-volume')).toHaveCount(3);await expect(page.locator('#calm-effects')).toHaveCount(1);await expect(page.locator('#desktop-resolution')).toHaveCount(native?1:0);
  await page.keyboard.press('Tab');const slider=page.locator('#master-volume');await slider.focus();await expect(slider.locator('..')).toHaveCSS('background-color','rgb(139, 212, 246)');
  const value=Number(await slider.inputValue());await page.keyboard.press('ArrowLeft');await expect(slider).toHaveValue(String(Math.max(0,value-1)));
  await page.screenshot({path:`${out}/settings-${width}-${height}-${locale}-native${native}.png`,fullPage:true});
  const issues=await settings.locator('button:visible,input:visible,.settings-action strong,.volume-control > span').evaluateAll(els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(e.scrollWidth>e.clientWidth+1||r.left< -1||r.right>innerWidth+1)}).map(e=>e.id||e.textContent));expect(issues).toEqual([]);
  const overlap=await settings.evaluate(el=>{const list=el.querySelector('.settings-list')!.getBoundingClientRect(),header=el.querySelector('.release-heading')!.getBoundingClientRect(),footer=el.querySelector('footer')!.getBoundingClientRect(),utility=el.querySelector('.settings-utility')!.getBoundingClientRect();return {header:list.top<header.bottom-1,footer:utility.bottom>footer.top+1}});expect(overlap).toEqual({header:false,footer:false});
  await page.locator('#settings-back').click();await expect(main).toBeVisible();expect(errors).toEqual([]);
 });
}

for (const [id,back,reset,confirm] of [['Xbox Controller','B','Y','A'],['Sony DualSense','○','△','✕'],['Nintendo Switch Pro','A','X','B'],['Unknown Pad','Право','Верх','Низ']] as const) {
 test(`settings family hints, reset and focus ${id}`,async({page})=>{
  await page.addInitScript(id=>{localStorage.setItem('bricks-war:language:v1','ru');const pad={index:0,id,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>pad.connected?[pad]:[]});Object.assign(window,{familyPad:pad});},id);
  await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();
  const backHint=page.locator('.settings-screen footer .input-back'),resetHint=page.locator('.settings-utility .input-reset');
  await expect(backHint).toHaveText(back);await expect(backHint).toBeVisible();await expect(resetHint).toHaveText(reset);await expect(resetHint).toBeVisible();await expect(page.locator('footer .input-confirm')).toHaveText(confirm);
  await expect(page.locator('[data-reset-preferences]')).toHaveCount(1);await page.locator('#master-volume').fill('25');await page.locator('.settings-utility [data-reset-preferences]').click();await expect(page.locator('#master-volume')).toHaveValue('100');
  await page.keyboard.press('Tab');await page.locator('#calm-effects').focus();await expect(page.locator('#calm-effects').locator('..')).toHaveCSS('background-color','rgb(139, 212, 246)');await page.keyboard.press('Space');await expect(page.locator('#calm-effects')).toBeChecked();
  await page.locator('#open-controls').click();await expect(page.locator('.controls-screen footer .input-back')).toHaveText(back);await page.locator('#controls-back').click();
  await page.evaluate(()=>{(window as any).familyPad.connected=false});await expect(backHint).toBeVisible();await expect(backHint).toHaveText('B');await expect(resetHint).toBeVisible();await expect(resetHint).toHaveText('Y');await expect(page.locator('[data-reset-preferences]')).toBeVisible();await page.locator('#master-volume').fill('25');await page.locator('.settings-utility [data-reset-preferences]').click();await expect(page.locator('#master-volume')).toHaveValue('100');
 });
}
