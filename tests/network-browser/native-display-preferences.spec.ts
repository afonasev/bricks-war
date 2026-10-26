import {test,expect,type Page} from '@playwright/test';
import {catalogs} from '../../src/i18n/catalogs';
import {mkdir,writeFile} from 'node:fs/promises';
const out=process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/verify-public-player-candidate/nested-native';
async function pulse(page:Page,button:number){await page.evaluate(i=>{(window as any).nestedPad.buttons[i].pressed=true;},button);await page.waitForTimeout(180);await page.evaluate(i=>{(window as any).nestedPad.buttons[i].pressed=false;},button);await page.waitForTimeout(180);}
for(const paused of [false,true])for(const [width,height] of [[1440,960],[1280,480],[390,844]] as const)test(`native network display ${paused?'pause':'list'} ${width}x${height}`,async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,locale:paused?'ja':'en',viewport:{width,height}});const guestContext=await browser.newContext({baseURL,locale:'en'});const page=await context.newPage();const guest=await guestContext.newPage();const tag=`${paused?'pause':'list'}-${width}`;
 await context.addInitScript(()=>{
  const display={width:1280,height:720,fullscreen:false,auto:true,resolutions:[[1280,720],[1440,900]]};const calls:boolean[]=[];
  const nestedPad={index:0,id:'Nested QA Pad',connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,touched:false,value:0})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[nestedPad]});Object.assign(window,{nestedPad,nestedConfirmations:calls});
  (window as any).bricksDesktop={display:async()=>display,setDisplay:async(v:any)=>({...display,...v}),confirmDisplay:async(yes:boolean)=>{calls.push(yes);return display;},updateState:async()=>({phase:'none'}),check:async()=>({phase:'none'}),setActivity:async()=>({phase:'none'}),setSafeMenu:()=>{},healthy:async()=>{},history:async()=>[],exit:async()=>{}};
 });
 try{
  await page.goto('/?muted=1');await page.locator('[data-network-entry]').click();
  if(paused){
   const room=`Nested ${width} ${Date.now()}`;await page.locator('[data-net-action="create"]').click();await page.locator('[name="roomName"]').fill(room);await page.locator('#network-form button[type="submit"]').click();await expect(page.locator('#network-profile')).toBeVisible();
   await guest.goto('/?muted=1');await guest.locator('[data-network-entry]').click();await guest.locator('.network-lobby').filter({hasText:room}).locator('[data-net-action^="join:"]').click();await guest.locator('#network-form button[type="submit"]').click();
   for(const p of [page,guest]){await expect(p.locator('#network-profile')).toBeVisible();await p.locator('[data-net-action="ready"]').click();}
   await page.locator('[data-net-action="start"]').click();await expect(page.locator('.network-arena')).toHaveAttribute('data-phase','playing',{timeout:15000});await expect(page.locator('.network-arena')).toHaveAttribute('data-preparation','0',{timeout:15000});await page.locator('[data-net-action="pause"]:visible').click();await expect(page.locator('#network-pause')).toBeVisible();
  }
  await page.locator('[data-net-action="preferences"]').click();const prefs=page.locator('[data-network-preferences]');await expect(prefs).toBeVisible();
  const open=async()=>{await prefs.locator('[data-pause-resolution] + .menu-select [data-menu-select-trigger]').click();await page.getByRole('option',{name:'1440 × 900',exact:true}).click();await expect(page.locator('[data-display-confirm]')).toBeVisible();};
  await open();const confirm=page.locator('[data-display-confirm]');await mkdir(out,{recursive:true});
  await writeFile(`${out}/${tag}-initial-focus.json`,JSON.stringify(await page.evaluate(()=>({active:document.activeElement?.outerHTML,dialogs:[...document.querySelectorAll('[role="dialog"]')].map(e=>({html:e.outerHTML.slice(0,300),inert:(e as HTMLElement).inert,hidden:e.getAttribute('aria-hidden')}))})),null,2));
  await page.screenshot({path:`${out}/${tag}-confirmation.png`});await expect(page.getByRole('dialog')).toHaveCount(1);await expect(confirm).toHaveAccessibleName(paused?catalogs.ja.keepDisplay:catalogs.en.keepDisplay);expect(await confirm.evaluate(e=>e.contains(document.activeElement))).toBe(true);
  for(let i=0;i<6;i++){await page.keyboard.press(i%2?'Shift+Tab':'Tab');expect(await confirm.evaluate(e=>e.contains(document.activeElement))).toBe(true);}
  await pulse(page,0);await expect(confirm).toHaveCount(0);expect(await page.evaluate(()=>(window as any).nestedConfirmations)).toEqual([true]);await expect(prefs).toBeVisible();await expect(prefs).toHaveAttribute('aria-modal','true');await expect(prefs).not.toHaveAttribute('aria-hidden','true');
  await open();await pulse(page,1);await expect(confirm).toHaveCount(0);expect(await page.evaluate(()=>(window as any).nestedConfirmations)).toEqual([true,false]);await expect(prefs).toBeVisible();expect(await prefs.evaluate(e=>e.contains(document.activeElement))).toBe(true);
  await open();await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);expect(await page.evaluate(()=>(window as any).nestedConfirmations)).toEqual([true,false,false]);await expect(prefs).toBeVisible();
  await page.locator('[data-network-prefs-back]').click();await expect(prefs).toHaveCount(0);if(paused){await expect(page.locator('#network-pause')).toBeVisible();await expect(page.locator('.network-arena')).toHaveAttribute('data-phase','paused');}else await expect(page.locator('[data-network-view="list"]')).toBeVisible();
 }finally{await context.close();await guestContext.close();}
});
