import {openNetworkProfile} from './menuHelpers';
import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const output=process.env.BRICKS_NETWORK_WORKSHOP_EVIDENCE_DIR??'evidence/align-network-workshop-menus/runtime';
const sizes=[[1440,960],[1280,480],[390,844],[844,390],[360,800]] as const;
async function enter(page:Page){await page.goto('/?muted=1');await page.locator('[data-network-entry]').click();}
async function geometry(page:Page){
 const issues=await page.evaluate(()=>{
  const painted=(e:HTMLElement)=>{const r=e.getBoundingClientRect();let left=r.left,right=r.right,top=r.top,bottom=r.bottom;for(let p=e.parentElement;p;p=p.parentElement){const c=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(c.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/auto|scroll|hidden|clip/.test(c.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}return {left,right,top,bottom};};
  const visible=(e:HTMLElement)=>{const r=painted(e);return r.right>r.left&&r.bottom>r.top&&getComputedStyle(e).visibility!=='hidden';};
  const scope=document.querySelector('[data-network-preferences]')??document.querySelector('.network-workshop')!;
  const errors:string[]=[];
  const text=[...scope.querySelectorAll<HTMLElement>(':is(h1,h2,h3,strong,button,textarea,label,summary,.menu-select-value)')].filter(visible);
  for(const e of text)if(e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2)errors.push(`clipped:${e.textContent}`);
  const controls=[...scope.querySelectorAll<HTMLElement>(':is(button,input,textarea,h1,h2,h3,summary,.network-roster li,.network-lobby,.menu-select)')].filter(visible);
  for(let i=0;i<controls.length;i++){const a=controls[i]!,r=painted(a);if(r.left< -1||r.right>innerWidth+1)errors.push(`outside:${a.textContent}`);for(const b of controls.slice(i+1)){if(a.contains(b)||b.contains(a))continue;const q=painted(b);if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)errors.push(`overlap:${a.textContent}/${b.textContent}`);}}
  return errors;
 });expect(issues).toEqual([]);
}
async function shots(page:Page,state:string){await mkdir(output,{recursive:true});for(const [width,height] of sizes){await page.setViewportSize({width,height});await geometry(page);await page.screenshot({path:`${output}/${state}-${width}x${height}.png`});}}
test('workshop room list has readable room states, pagination, empty and unavailable recovery',async({page})=>{
 let phase:'list'|'empty'|'unavailable'='list';let offset='';
 const rooms=[
  {id:'a',name:'Вечерняя битва',mode:'battle',count:4,capacity:8,protected:false,phase:'waiting'},
  {id:'b',name:'Команда друзей из Екатеринбурга',mode:'team-battle',count:3,capacity:8,protected:true,phase:'waiting'},
  {id:'c',name:'До последнего блока',mode:'survival',count:6,capacity:8,protected:false,phase:'playing'},
  {id:'d',name:'Комната заполнена',mode:'battle',count:8,capacity:8,protected:false,phase:'waiting'},
 ];
 await page.route('**/api/network/lobbies?*',route=>{offset=new URL(route.request().url()).searchParams.get('offset')!;return route.fulfill({status:phase==='unavailable'?503:200,json:phase==='unavailable'?{error:'Unavailable'}:{rooms:phase==='empty'?[]:rooms,next:offset==='0'?50:null}});});
 await page.addInitScript(()=>localStorage.setItem('bricks-war:language:v1','ru'));await enter(page);await expect(page.locator('.network-lobby')).toHaveCount(4);
 await expect(page.locator('.network-lobby').nth(2).getByRole('button')).toBeDisabled();await expect(page.locator('.network-lobby').nth(3).getByRole('button')).toBeDisabled();
 const join=page.locator('.network-lobby').first().getByRole('button');await join.focus();const node=await join.elementHandle();await page.locator('[data-net-action="retry"]').click();expect(await node!.evaluate(e=>e.isConnected)).toBe(true);
 await shots(page,'rooms');
 await page.locator('[data-net-action="page:50"]').click();await expect.poll(()=>offset).toBe('50');await page.locator('[data-net-action="page:0"]').click();
 await page.locator('.network-lobby').nth(1).getByRole('button').click();await expect(page.locator('#network-form input[type="password"]')).toBeVisible();await shots(page,'join');
 await page.locator('.screen-back').click();await page.locator('[data-net-action="create"]').click();await shots(page,'create');
 await page.locator('.screen-back').click();phase='empty';await page.locator('[data-net-action="retry"]').click();await expect(page.locator('.network-empty')).toBeVisible();await shots(page,'empty');
 phase='unavailable';await page.locator('[data-net-action="retry"]').click();await expect(page.locator('#network-status')).toContainText('Сервис недоступен');await shots(page,'unavailable');phase='list';await page.locator('[data-net-action="retry"]').click();await expect(page.locator('.network-lobby')).toHaveCount(4);
});
test('own-card readiness, profile editing, host and guest permissions use real service',async({browser,baseURL})=>{
 const contexts=await Promise.all([browser.newContext({baseURL,locale:'ru-RU'}),browser.newContext({baseURL,locale:'ru-RU'})]);
 const [host,guest]=await Promise.all(contexts.map(c=>c.newPage())) as [Page,Page];const errors:string[]=[];for(const p of [host,guest])p.on('pageerror',e=>errors.push(e.message));
 const room='Вечерняя битва '+Date.now();
 try{
  await enter(host);await host.locator('[data-net-action="create"]').click();await host.locator('[name="roomName"]').fill(room);await host.locator('[name="name"]').fill('Евгений');
  await host.getByRole('combobox',{name:'Режим',exact:true}).click();await host.getByRole('option',{name:'Битва',exact:true}).click();await host.locator('#network-form button[type="submit"]').click();
  await enter(guest);await guest.locator('.network-lobby').filter({hasText:room}).getByRole('button').click();await guest.locator('[name="name"]').fill('Александра');await guest.locator('#network-form button[type="submit"]').click();await expect(host.locator('.network-roster li')).toHaveCount(2);
  for(let i=0;i<1;i++)await host.locator('[data-net-action="ai-add"]').click();await expect(host.locator('.network-roster li')).toHaveCount(3);
  for(const p of [host,guest]){await expect(p.locator('[data-own="true"] [data-net-action="ready"]')).toHaveCount(1);await expect(p.locator('.network-lobby-footer [data-net-action="ready"]')).toHaveCount(0);await expect(p.locator('[data-own="false"] .network-personal-panel')).toHaveCount(0);}
  await expect(guest.locator('[data-net-action="start"],.network-ai-editor')).toHaveCount(0);await expect(guest.locator('#network-rules select').first()).toBeDisabled();
  expect(await host.locator('#network-profile').evaluate(e=>e.getClientRects().length)).toBe(0);expect(await host.locator('[data-network-ai]').first().evaluate(e=>e.getClientRects().length)).toBe(0);await host.locator('[data-net-action="ready"]').click();await expect(host.locator('[data-net-action="ready"]')).toHaveAttribute('aria-pressed','true');await expect(host.locator('[data-net-action="start"]')).toBeDisabled();await shots(host,'lobby-host');await shots(guest,'lobby-guest');for(const [width,height] of [[1440,960],[390,844]]){await host.setViewportSize({width:width!,height:height!});await host.locator('[data-own="true"]').scrollIntoViewIfNeeded();await geometry(host);await host.screenshot({path:`${output}/own-card-${width}.png`});await host.locator('.network-lobby-footer').scrollIntoViewIfNeeded();await geometry(host);await host.screenshot({path:`${output}/lobby-footer-${width}.png`});}
  await host.locator('.network-personal-panel summary').click();await host.locator('#network-profile [name="name"]').fill('Евгений Екатеринбург');await host.locator('#network-profile button[type="submit"]').click();await expect(guest.locator('.network-seat-copy strong').first()).toHaveText('Евгений Екатеринбург');
  await openNetworkProfile(host);await shots(host,'profile');await host.locator('.network-personal-panel').scrollIntoViewIfNeeded();await host.screenshot({path:`${output}/profile-editor-phone.png`});
  await host.locator('.network-personal-panel summary').click();
  // Native keyboard navigation opens the card editor, then gamepad uses the same focus targets.
  await host.locator('.network-personal-panel summary').focus();await host.keyboard.press('Enter');await expect(host.locator('.network-personal-panel')).toHaveAttribute('open','');
  await host.keyboard.press('Tab');await expect(host.locator('#network-profile textarea')).toBeFocused();
  await host.locator('.network-personal-panel summary').click();if(await host.locator('[data-net-action="ready"]').getAttribute('aria-pressed')==='true'){await host.locator('[data-net-action="ready"]').click();}await expect(host.locator('[data-net-action="ready"]')).toHaveAttribute('aria-pressed','false');
  // Virtual standard controller drives the production MenuFocusController; no session mutation.
  await host.evaluate(()=>{const buttons=Array.from({length:16},()=>({pressed:false,value:0,touched:false}));Object.assign(window,{networkMenuButtons:buttons});Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[{id:'QA Standard Controller',mapping:'standard',index:0,connected:true,axes:[0,0],buttons,timestamp:performance.now()}]});});
  await host.setViewportSize({width:1440,height:960});await host.locator('[data-net-action="ready"]').hover();await expect(host.locator('[data-net-action="ready"]')).toBeFocused();
  await host.evaluate(()=>{const w=window as unknown as {networkMenuButtons:{pressed:boolean;value:number}[]};w.networkMenuButtons[0]!.pressed=true;w.networkMenuButtons[0]!.value=1;});
  await expect(host.locator('[data-net-action="ready"]')).toHaveAttribute('aria-pressed','true');
  await expect(host.locator('#app')).toHaveAttribute('data-input-mode','gamepad');
  await host.evaluate(()=>{const w=window as unknown as {networkMenuButtons:{pressed:boolean;value:number}[]};w.networkMenuButtons[0]!.pressed=false;w.networkMenuButtons[0]!.value=0;});
  await expect(host.locator('.network-screen')).toHaveAttribute('data-network-view','lobby');await host.screenshot({path:`${output}/controller-focus.png`});
  await host.locator('.screen-back').click();await host.locator('[data-net-action="preferences"]').click();await shots(host,'network-settings');await host.locator('[data-network-prefs-back]').click();
  expect(errors).toEqual([]);await writeFile(`${output}/console-errors.json`,JSON.stringify(errors));
 }finally{for(const c of contexts)await c.close();}
});

for(const locale of ['de','zh-Hans'] as const)test(`translated workshop menus ${locale}`,async({page})=>{
 await page.addInitScript(l=>localStorage.setItem('bricks-war:language:v1',l),locale);await enter(page);
 await page.locator('[data-net-action="create"]').click();await page.locator('[name="roomName"]').fill(`Locale ${locale}`);await page.locator('[name="name"]').fill(`Player ${locale}`);await shots(page,`${locale}-create`);
 await page.locator('#network-form button[type="submit"]').click();await expect(page.locator('.network-personal-panel summary')).toBeVisible();
 await page.locator('.network-personal-panel summary').click();await shots(page,`${locale}-lobby-profile`);
 expect(await page.locator('.network-screen').innerText()).not.toMatch(/[А-Яа-яЁё]/);
 await page.locator('[data-net-action="leave"]').click();
});
