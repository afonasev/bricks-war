import {openNetworkProfile} from './menuHelpers';
import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {catalogs} from '../../src/i18n/catalogs';
import {localizedNetworkMessage,networkText,networkUiText} from '../../src/network/presentationCopy';
const locales=['ru','en','fr','de','es','ja','zh-Hans'] as const;
const shots=process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-network-journey/screenshots';
async function boot(context:BrowserContext,locale:string){
 await context.addInitScript(value=>localStorage.setItem('bricks-war:language:v1',value),locale);
 const page=await context.newPage();await page.goto('/?muted=1');await page.locator('[data-network-entry]').click();return page;
}
async function readable(page:Page){
 await expect.poll(()=>page.evaluate(()=>{
  const modal=document.querySelector('[data-network-preferences]');
  const painted=(e:HTMLElement)=>{const r=e.getBoundingClientRect();let left=r.left,right=r.right,top=r.top,bottom=r.bottom;if(modal){for(let p=e.parentElement;p;p=p.parentElement){const c=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(c.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/auto|scroll|hidden|clip/.test(c.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}}return {left,right,top,bottom};};
  const visible=(e:HTMLElement)=>{const r=painted(e);return (!modal||modal.contains(e))&&r.right>r.left&&r.bottom>r.top&&getComputedStyle(e).visibility!=='hidden';};
  const nodes=[...document.querySelectorAll<HTMLElement>('[data-network-preferences] button,[data-network-preferences] label,[data-network-preferences] h2,[data-network-preferences] .menu-select-value,.network-screen button,.network-screen label,.network-screen strong,.network-screen h1,.network-screen h2,.network-screen .menu-select-value,.network-pause-panel button,.network-field-heading b,.network-field-heading strong')].filter(visible);
  const issues=nodes.flatMap(e=>{const r=e.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(e);const t=range.getBoundingClientRect();return e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2||r.left< -1||r.right>innerWidth+1||t.left<r.left-2||t.right>r.right+2?[`${e.tagName}:${e.textContent}`]:[];});
  const controls=[...document.querySelectorAll<HTMLElement>('[data-network-preferences] button,[data-network-preferences] input,[data-network-preferences] h2,.network-screen button,.network-screen input,.network-screen textarea,.network-screen h1,.network-screen h2,.network-screen .network-roster li,.network-pause-panel button,.network-field-heading .hud-identity,.network-field-heading .hud-stats')].filter(visible);
  for(let i=0;i<controls.length;i++){const a=controls[i]!,r=painted(a);for(const b of controls.slice(i+1)){if(a.contains(b)||b.contains(a))continue;const q=painted(b);if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)issues.push(`overlap:${a.textContent}/${b.textContent}`);}}
  return issues;
 }),{timeout:5000}).toEqual([]);
}
async function shotSizes(page:Page,locale:string,state:string){
 await mkdir(shots,{recursive:true});
 for(const [width,height] of [[1440,960],[1280,480],[390,844]] as const){await page.setViewportSize({width,height});if(state==='network-preferences'){const audit=await page.locator('[data-network-preferences] input,[data-network-preferences] button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect(),p=e.closest('.pause-preferences-scroll'),c=p?.getBoundingClientRect();return {tag:e.tagName,text:e.textContent,rect:{x:r.x,y:r.y,width:r.width,height:r.height},scrollClip:c?{top:c.top,bottom:c.bottom,overflow:getComputedStyle(p!).overflowY}:null};}));await writeFile(`${shots}/${locale}-${state}-${width}x${height}-geometry.json`,JSON.stringify(audit,null,2));}await page.screenshot({path:`${shots}/${locale}-${state}-${width}x${height}.png`,fullPage:!['arena','pause','network-preferences'].includes(state)});await readable(page);if(locale!=='ru'){const text=await page.locator('.network-screen,.network-arena').innerText();expect(text).not.toMatch(/[А-Яа-яЁё]/);const labels=await page.locator('[aria-label]').evaluateAll(es=>es.filter(e=>e.getClientRects().length>0).map(e=>e.getAttribute('aria-label')).join(' '));expect(labels).not.toMatch(/[А-Яа-яЁё]/);}await page.screenshot({path:`${shots}/${locale}-${state}-${width}x${height}.png`,fullPage:!['arena','pause','network-preferences'].includes(state)});}
}
for(const locale of locales)test(`real network language lifecycle ${locale}`,async({browser,baseURL})=>{
 const hostContext=await browser.newContext({baseURL,locale:'ru-RU',viewport:{width:1440,height:960}});
 const guestContext=await browser.newContext({baseURL,locale:'ru-RU',viewport:{width:390,height:844}});
 const errors:string[]=[];let guest:Page;const guestLocale=locales[(locales.indexOf(locale)+1)%locales.length]!;
 try{
  const host=await boot(hostContext,locale);guest=await boot(guestContext,guestLocale);
  for(const p of [host,guest])p.on('pageerror',e=>errors.push(e.message));
  const room=`Locale ${locale} ${Date.now()}`,name=`Name <中> ${locale}`;
  await host.locator('[data-net-action="create"]').click();
  await host.locator('[name="roomName"]').fill(room);await host.locator('[name="name"]').fill(name);await host.locator('[name="password"]').fill('local-test');
  await shotSizes(host,locale,'create');await host.setViewportSize({width:1440,height:960});
  await host.locator('#network-form button[type="submit"]').click();await openNetworkProfile(host);await expect(host.locator('#network-profile')).toBeVisible();
  await guest.locator('.network-lobby').filter({hasText:room}).locator('[data-net-action^="join:"]').click();
  await guest.locator('[name="name"]').fill(`Guest 中 ${locale}`);await guest.locator('[name="password"]').fill('wrong');await guest.locator('#network-form button[type="submit"]').click();
  await expect(guest.locator('#network-status')).not.toBeEmpty();
  await expect(guest.locator('#network-status')).toHaveText(localizedNetworkMessage('Неверный пароль.',guestLocale));
  await guest.screenshot({path:`${shots}/${guestLocale}-wrong-password-phone.png`,fullPage:true});
  await guest.locator('[name="password"]').fill('local-test');await guest.locator('#network-form button[type="submit"]').click();await openNetworkProfile(guest);await expect(guest.locator('#network-profile')).toBeVisible();
  await expect(host.locator('.network-seat-copy strong').first()).toHaveText(name);
  await host.locator('[data-net-action="ai-add"]').click();await expect(host.locator('[data-kind="ai"]')).toHaveCount(1);
  await host.locator('.network-ai-editor summary').click();await shotSizes(host,locale,'lobby-ai');
  await host.locator('[data-net-action^="ai-remove:"]').click();await expect(host.locator('[data-kind="ai"]')).toHaveCount(0);
  for(const p of [host,guest]){
   // Use existing select value and its genuine change event; no internal session mutation.
   await openNetworkProfile(p);await p.locator('#network-controls + .menu-select [role="combobox"]').click();await p.getByRole('option',{name:'WASD',exact:true}).click();
   await p.locator('[data-net-action="ready"]').click();
  }
  await host.setViewportSize({width:1440,height:960});await expect(host.locator('[data-net-action="start"]')).toBeEnabled();await host.locator('[data-net-action="start"]').click();
  for(const p of [host,guest])await expect(p.locator('.network-arena')).toHaveAttribute('data-phase','playing',{timeout:15000});
  await shotSizes(host,locale,'arena');await host.setViewportSize({width:1440,height:960});
  await guest.close();await expect(host.locator('.network-arena')).toHaveAttribute('data-phase','paused',{timeout:15000});
  await expect(host.locator('.network-absences article')).toHaveCount(1);await host.screenshot({path:`${shots}/${locale}-guest-disconnected.png`,fullPage:true});
  guest=await guestContext.newPage();guest.on('pageerror',e=>errors.push(e.message));await guest.goto('/?muted=1');await guest.locator('[data-network-entry]').click();await guest.locator('[data-net-action="return"]').click();
  await expect(guest.locator('.network-arena')).toHaveAttribute('data-phase','playing',{timeout:15000});
  const credential=await guest.evaluate(()=>JSON.parse(localStorage.getItem('bricks-network-seat-v1')!));
  const response=await guest.request.post(`${baseURL}/api/network/current`,{headers:{Origin:baseURL!},data:{credential}});expect(response.ok()).toBe(true);const snapshot=await response.json();expect(snapshot.seats.every((s:{connected:boolean;absence:unknown})=>s.connected&&!s.absence)).toBe(true);
  await guest.locator('[data-net-action="pause"]:visible').click();await expect(host.locator('#network-pause')).toBeVisible();
  await expect(guest.locator('#network-pause')).toHaveAccessibleName(networkUiText('paused',guestLocale));
  await guest.locator('[data-net-action="preferences"]').click();
  for(const [width,height] of [[1440,960],[1280,480],[390,844]]){await guest.setViewportSize({width:width!,height:height!});await expect(guest.getByRole('dialog')).toHaveCount(1);await expect(guest.getByRole('dialog')).toHaveAccessibleName(catalogs[guestLocale].settings);for(let i=0;i<6;i++){await guest.keyboard.press('Tab');expect(await guest.locator('[data-network-preferences]').evaluate(e=>e.contains(document.activeElement))).toBe(true);}await readable(guest);await guest.screenshot({path:`${shots}/${locale}-paused-settings-${width}.png`});}
  await guest.locator('[data-network-prefs-back]').click();await expect(guest.locator('#network-pause')).toHaveAttribute('aria-modal','true');await expect(guest.locator('#network-pause')).not.toHaveAttribute('aria-hidden','true');
  await shotSizes(guest,guestLocale,'pause');await guest.setViewportSize({width:390,height:844});
  await guest.locator('[data-net-action="list"]').click();await expect(guest.locator('[data-net-action="return"]')).toBeVisible();await guest.locator('[data-net-action="return"]').click();
  await expect(guest.locator('#network-pause')).toBeVisible();await host.locator('[data-net-action="resume"]').click();
  await expect(host.locator('.network-arena')).toHaveAttribute('data-phase','playing');
  for(let pass=0;pass<36;pass++){
   await Promise.all([host,guest].map(async p=>{if(await p.locator('.network-arena[data-alive="true"]').count()){await p.keyboard.up('s');await p.keyboard.down('s');}}));
   if(await host.locator('[data-network-view="results"]').count())break;
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  for(const p of [host,guest]){await expect(p.locator('[data-network-view="results"]')).toBeVisible({timeout:45000});await expect(p.locator('.network-roster li')).toHaveCount(2);}
  await shotSizes(host,locale,'results');await host.locator('[data-net-action="lobby"]').click();await openNetworkProfile(host);await expect(host.locator('#network-profile')).toBeVisible();
  expect(await host.locator('#network-profile [name="name"]').inputValue()).toBe(name);
  await expect(host.locator('html')).toHaveAttribute('lang',locale);await expect(guest.locator('html')).toHaveAttribute('lang',guestLocale);expect(errors).toEqual([]);
 }finally{await hostContext.close();await guestContext.close();}
});

for(const locale of locales)test(`network replacement and service failure copy ${locale}`,async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,locale:'ru-RU',viewport:{width:390,height:844}});
 try{
  const first=await boot(context,locale);await first.locator('[data-net-action="create"]').click();
  await first.locator('[name="roomName"]').fill(`Replacement ${locale} ${Date.now()}`);await first.locator('[name="name"]').fill('Original <中>');
  await first.locator('#network-form button[type="submit"]').click();await openNetworkProfile(first);await expect(first.locator('#network-profile')).toBeVisible();
  const second=await context.newPage();await second.goto('/?muted=1');await second.locator('[data-network-entry]').click();await second.locator('[data-net-action="return"]').click();
  await openNetworkProfile(second);await expect(second.locator('#network-profile')).toBeVisible();await expect(first.locator('[data-network-view="ended"]')).toBeVisible();
  const ended=await first.locator('.network-content').innerText();if(locale!=='ru')expect(ended).not.toMatch(/[А-Яа-яЁё]/);
  expect(await second.evaluate(()=>Boolean(localStorage.getItem('bricks-network-seat-v1')))).toBe(true);
  await first.screenshot({path:`${shots}/${locale}-replacement-phone.png`,fullPage:true});
  await second.locator('[data-net-action="leave"]').click();
  await second.route('**/api/network/lobbies**',route=>route.abort('failed'));
  await second.locator('[data-net-action="retry"]').click();
  const failure=second.locator('#network-status');await expect(failure).not.toBeEmpty();
  await expect(failure).toHaveText(networkText('serviceUnavailable',locale));
  if(locale!=='ru')expect(await failure.innerText()).not.toMatch(/[А-Яа-яЁё]/);
  await readable(second);await second.screenshot({path:`${shots}/${locale}-service-unavailable-phone.png`,fullPage:true});
 }finally{await context.close();}
});

async function pickValue(page:Page,selector:string,value:string){
 const select=page.locator(selector);const label=(await select.locator(`option[value="${value}"]`).textContent())!;
 await page.locator(`${selector} + .menu-select [role="combobox"]`).click();await page.getByRole('option',{name:label,exact:true}).click();
 await expect(select).toHaveValue(value);
}
for(const locale of locales)test(`network Battle and team rule forms ${locale}`,async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,locale:'ru-RU',viewport:{width:1440,height:960}});
 try{
  const page=await boot(context,locale);await page.locator('[data-net-action="create"]').click();
  await page.locator('[name="roomName"]').fill(`Rules ${locale} ${Date.now()}`);await page.locator('[name="name"]').fill('Rules QA <中>');
  await pickValue(page,'#network-create-rules [name="mode"]','battle');await pickValue(page,'#network-create-rules [name="battleTimeMode"]','timed');
  await pickValue(page,'#network-create-rules [name="durationMinutes"]','7');
  await shotSizes(page,locale,'battle-rules-create');
  await page.locator('#network-form button[type="submit"]').click();await openNetworkProfile(page);await expect(page.locator('#network-profile')).toBeVisible();
  await expect(page.locator('#network-rules [name="durationMinutes"]')).toHaveValue('7');
  await pickValue(page,'#network-rules [name="mode"]','team-battle');await expect(page.locator('#network-team')).toBeVisible();
  await page.locator('[data-net-action="ai-add"]').click();await expect(page.locator('[data-kind="ai"]')).toHaveCount(1);await page.locator('.network-ai-editor summary').click();
  await shotSizes(page,locale,'team-rules-lobby');await expect(page.locator('[data-net-action="start"]')).toBeDisabled();
 }finally{await context.close();}
});

test('network preferences switch language without reconnecting or leaking keyboard input',async({browser,baseURL})=>{
 const contexts=await Promise.all([0,1].map(()=>browser.newContext({baseURL,locale:'en-US',viewport:{width:1440,height:960}})));
 try{
  const host=await boot(contexts[0]!,'en'),guest=await boot(contexts[1]!,'en');const inputs:{held:{right:boolean}}[]=[];let sockets=0;
  guest.on('websocket',socket=>{sockets++;socket.on('framesent',f=>{try{const v=JSON.parse(String(f.payload));if(v.type==='input')inputs.push(v);}catch{}});});
  const room=`Language switch ${Date.now()}`;await host.locator('[data-net-action="create"]').click();await host.locator('[name="roomName"]').fill(room);await host.locator('[name="name"]').fill('Language host');await host.locator('#network-form button[type="submit"]').click();await openNetworkProfile(host);await expect(host.locator('#network-profile')).toBeVisible();
  await guest.locator('.network-lobby').filter({hasText:room}).locator('[data-net-action^="join:"]').click();await guest.locator('[name="name"]').fill('Language guest');await guest.locator('#network-form button[type="submit"]').click();
  for(const p of [host,guest]){await openNetworkProfile(p);await expect(p.locator('#network-profile')).toBeVisible();await pickValue(p,'#network-controls','keyboard');await p.locator('[data-net-action="ready"]').click();}
  await host.locator('[data-net-action="start"]').click();await expect(guest.locator('.network-arena')).toHaveAttribute('data-phase','playing');await expect(guest.locator('.network-arena')).toHaveAttribute('data-preparation','0',{timeout:15000});
  const credential=await guest.evaluate(()=>localStorage.getItem('bricks-network-seat-v1'));const matchId=await guest.locator('.network-arena').getAttribute('data-match-id');
  await guest.locator('[data-net-action="pause"]:visible').click();await expect(host.locator('#network-pause')).toBeVisible();await guest.locator('[data-net-action="preferences"]').click();
  await expect(guest.locator('[data-network-preferences]')).toBeVisible();await expect(guest.getByRole('dialog')).toHaveCount(1);await expect(guest.getByRole('dialog')).toHaveAccessibleName(/.+/);for(let i=0;i<8;i++){await guest.keyboard.press('Tab');expect(await guest.locator('[data-network-preferences]').evaluate(e=>e.contains(document.activeElement))).toBe(true);}await pickValue(guest,'[data-network-preferences] [data-language]','ja');
  await host.locator('[data-net-action="resume"]').click();await expect(guest.locator('.network-arena')).toHaveAttribute('data-phase','playing');
  await shotSizes(guest,'ja','network-preferences');await guest.setViewportSize({width:1440,height:960});
  inputs.length=0;await guest.keyboard.down('d');await new Promise(resolve=>setTimeout(resolve,500));await guest.keyboard.up('d');expect(inputs.some(i=>i.held.right)).toBe(false);
  expect(await guest.locator('[data-network-preferences]').evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await guest.locator('[data-network-prefs-back]').click();await expect(guest.locator('[data-network-preferences]')).toHaveCount(0);
  await guest.screenshot({path:`${shots}/language-switch-ja-arena.png`,fullPage:true});
  await expect(guest.locator('[data-net-action="pause"]:visible')).toHaveAttribute('aria-label',networkUiText('pause','ja'));
  await expect(guest.locator('#network-hud')).not.toContainText('points');
  expect(await guest.evaluate(()=>localStorage.getItem('bricks-network-seat-v1'))).toBe(credential);expect(await guest.locator('.network-arena').getAttribute('data-match-id')).toBe(matchId);expect(sockets).toBe(1);
  const before=Number(await guest.locator('.network-arena').getAttribute('data-confirmed-x'));await guest.keyboard.down('d');await expect.poll(async()=>Number(await guest.locator('.network-arena').getAttribute('data-confirmed-x'))).toBeGreaterThan(before);await guest.keyboard.up('d');
  await guest.locator('[data-net-action="pause"]:visible').click();await expect(guest.locator('#network-pause h2')).toHaveText(networkUiText('paused','ja'));
  await guest.locator('[data-net-action="list"]').click();await guest.locator('[data-net-action="preferences"]').click();await pickValue(guest,'[data-network-preferences] [data-language]','de');await guest.locator('[data-network-prefs-back]').click();
  await expect(guest.locator('.network-screen h1')).toHaveText(networkText('online','de'));await expect(host.locator('html')).toHaveAttribute('lang','en');await expect(guest.locator('html')).toHaveAttribute('lang','de');
 }finally{for(const c of contexts)await c.close();}
});
