import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {openLocalLobby} from '../helpers/localLobby';
const out='evidence/replace-countdown-with-ready/runtime';
for(const item of [
  {locale:'ru',width:1440,height:960}, {locale:'en',width:1440,height:960},
  {locale:'ru',width:390,height:844}, {locale:'en',width:320,height:568},
  {locale:'en',width:844,height:390},
])test(`ready title timing and layout ${item.locale} ${item.width}x${item.height}`,async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,locale:item.locale,viewport:{width:item.width,height:item.height}});
 const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('/?muted=1');await openLocalLobby(page,'survival');
  await page.evaluate(()=>{
   const samples={shown:0,hidden:0,label:''};(window as any).__readySamples=samples;
   new MutationObserver(()=>{const e=document.querySelector<HTMLElement>('#countdown');if(!e)return;
    if(!e.hidden&&!document.querySelector('.match-loading')){if(!samples.shown){samples.shown=performance.now();samples.label=e.textContent??'';}}
    else if(samples.shown&&!samples.hidden)samples.hidden=performance.now();
   }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
  });
  await page.locator('#start-match').click();await expect(page.locator('.match-loading')).toHaveCount(0);
  const title=page.locator('#countdown');await expect(title).toBeVisible();await expect(title).toHaveText(item.locale==='ru'?'Готовы?':'Ready?');
  await page.waitForTimeout(260);
  const layout=await title.evaluate(el=>{
   const parts=[...el.querySelectorAll<HTMLElement>('.ready-label,.ready-blocks')];const rects=parts.map(e=>e.getBoundingClientRect());
   return {inside:rects.every(r=>r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight),
    overlaps:rects.some((r,i)=>rects.slice(i+1).some(q=>Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)),
    text:el.textContent,animation:getComputedStyle(el.querySelector('.ready-title')!).animationName};
  });
  expect(layout.inside).toBe(true);expect(layout.overlaps).toBe(false);
  await mkdir(out,{recursive:true});await page.screenshot({path:`${out}/${item.locale}-${item.width}x${item.height}.png`});
  await expect(title).toBeHidden();const samples=await page.evaluate(()=>(window as any).__readySamples);
  expect(samples.label).toBe(item.locale==='ru'?'Готовы?':'Ready?');
  expect(samples.hidden-samples.shown).toBeGreaterThanOrEqual(950);expect(samples.hidden-samples.shown).toBeLessThan(1_300);
  expect(errors).toEqual([]);await writeFile(`${out}/${item.locale}-${item.width}x${item.height}.json`,JSON.stringify({layout,samples,errors},null,2));
 }finally{await context.close();}
});

test('ready title is static with reduced motion and controller pause freezes the second',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,locale:'en',viewport:{width:1280,height:720},reducedMotion:'reduce'});
 await context.addInitScript(()=>{const pad={index:0,id:'Ready QA Pad',connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,touched:false,value:0})),timestamp:0};(window as any).__readyPad=pad;Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});});
 const page=await context.newPage();
 try{
  await page.goto('/?muted=1');await openLocalLobby(page,'survival');await page.locator('#start-match').click();
  await expect(page.locator('.match-loading')).toHaveCount(0);await expect(page.locator('#countdown')).toBeVisible();
  expect(await page.locator('.ready-title').evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
  await mkdir(out,{recursive:true});await page.screenshot({path:`${out}/en-controller-reduced-motion.png`});
  await page.evaluate(()=>{(window as any).__readyPad.buttons[9].pressed=true;});
  await expect(page.locator('#pause-overlay')).toBeVisible();await page.waitForTimeout(1_200);
  await page.evaluate(()=>{(window as any).__readyPad.buttons[9].pressed=false;});await page.waitForTimeout(60);
  await page.locator('#continue-match').click();await expect(page.locator('#countdown')).toBeVisible();
  await expect(page.locator('#countdown')).toBeHidden();
 }finally{await context.close();}
});
