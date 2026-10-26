import {openLocalLobby} from '../helpers/localLobby';
import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';

for(const [width,height] of [[1440,960],[1280,480],[800,620],[390,844],[390,667],[844,390]]) {
 test(`menu footers reach viewport edge ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width:width!,height:height!});
  await page.route('**/api/network/lobbies**',route=>route.fulfill({json:{rooms:[],next:null}}));
  await page.goto('/?muted=1'); await page.locator('main').waitFor();
  const audit:unknown[]=[];
  async function check(name:string){
   const geometry=await page.evaluate(()=>{
    const main=document.querySelector('main')!;const footer=main.querySelector('footer')!;
    const r=footer.getBoundingClientRect();
    const body=document.documentElement;
    return {screen:main.getAttribute('data-screen')||main.className,layout:document.querySelector('#app')?.getAttribute('data-layout'),bottom:r.bottom,top:r.top,height:innerHeight,documentOverflow:body.scrollHeight>innerHeight+1,
     covered:[...main.querySelectorAll<HTMLElement>('button,input')].filter(e=>!e.closest('footer')&&!e.closest('[hidden]')&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').filter(e=>{const b=e.getBoundingClientRect();let top=b.top,bottom=b.bottom;for(let parent=e.parentElement;parent&&parent!==main;parent=parent.parentElement){if(/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)){const clip=parent.getBoundingClientRect();top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}}return bottom>top&&bottom>r.top+1&&top<r.bottom-1}).map(e=>e.id||e.textContent?.trim().slice(0,50))};
   });
   audit.push({name,...geometry});
   if(!process.env.FOOTER_AUDIT){expect(Math.abs(geometry.bottom-height!),name).toBeLessThanOrEqual(1);expect(geometry.documentOverflow,name).toBe(false);expect(geometry.covered,name).toEqual([]);}
  }
  await check('main');
  for(const mode of ['Выживание','Битва','Командный бой']){
   await openLocalLobby(page,mode);await check(mode);await page.locator('[data-lobby-back]').click();
  }
  await page.getByRole('button',{name:/^Настройки/}).click();await check('settings');
  await page.locator('.settings-list').evaluate(el=>{el.scrollTop=el.scrollHeight});await check('settings scrolled');
  if(width===1440||width===390&&height===844)await page.screenshot({path:`evidence/menu-footer-edges/settings-${width}x${height}${process.env.FOOTER_AUDIT?'-before':''}.png`});
  if(await page.locator('#app').getAttribute('data-layout')==='desktop'){await page.getByRole('button',{name:/Подробнее об управлении/}).click();await check('controls');await page.getByRole('button',{name:'← Настройки',exact:true}).click();}
  await page.getByRole('button',{name:/^Правила/}).click();await check('rules');await page.getByRole('button',{name:'← Настройки',exact:true}).click();
  await page.getByRole('button',{name:/^Лаборатория дизайна/}).click();await check('lab');
  const labBounds=await page.locator('.debug-lab-content').evaluate(el=>({top:el.getBoundingClientRect().top,headerBottom:el.previousElementSibling!.getBoundingClientRect().bottom,height:el.clientHeight}));
  expect(labBounds.top).toBeGreaterThanOrEqual(labBounds.headerBottom-1);expect(labBounds.height).toBeGreaterThan(40);
  if(await page.locator('#app').getAttribute('data-layout')==='mobile'){const lastField=page.locator('.debug-lab-content textarea').last();await lastField.scrollIntoViewIfNeeded();await expect(lastField).toBeInViewport();await check('lab scrolled');}
  await page.locator('#close-debug-lab').click();await page.locator('#settings-back').click();
  await page.getByRole('button',{name:/^Сетевая игра/}).click();await check('network list');
  await page.getByRole('button',{name:'Создать лобби',exact:true}).click();await check('network create');
  writeFileSync(`evidence/menu-footer-edges/geometry-${width}x${height}${process.env.FOOTER_AUDIT?'-before':''}.json`,JSON.stringify(audit,null,2));
 });
}

test('desktop bridge settings footer follows window resizing', async ({page}) => {
 await page.addInitScript(() => {
  const state={available:false,applying:false,error:false,phase:'idle'};
  (window as any).bricksDesktop={updateState:async()=>state,check:async()=>state,setSafeMenu:()=>{},healthy:async()=>{},setActivity:async()=>state,display:async()=>({width:1440,height:960,fullscreen:false,resolutions:[[1280,720],[1440,960]]})};
 });
 await page.goto('/?muted=1');
 await page.getByRole('button',{name:/^Настройки/}).click();
 await expect(page.locator('#desktop-resolution')).toHaveCount(1);
 for(const viewport of [{width:1440,height:960},{width:1280,height:480},{width:1024,height:768}]) {
  await page.setViewportSize(viewport);
  await expect.poll(()=>page.locator('.settings-screen footer').evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-innerHeight))).toBeLessThanOrEqual(1);
  await page.locator('.settings-list').evaluate(el=>{el.scrollTop=el.scrollHeight});
  await expect(page.locator('#open-controls')).toBeInViewport();
 }
 await page.screenshot({path:'evidence/menu-footer-edges/desktop-bridge-settings.png'});
});
