import {test,expect,type Page} from '@playwright/test';
const out=process.env.BRICKS_LOBBY_EVIDENCE!;
async function boot(page:Page,locale='en',pad=false){
 await page.addInitScript(({locale,pad})=>{
  localStorage.setItem('bricks-war:language:v1',locale);
  if(pad){const device={index:0,id:'Xbox guide QA',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[device]});Object.assign(window,{guidePad:device});}
 },{locale,pad});await page.goto('/?muted=1');await expect(page.locator('[data-play-entry]')).toBeVisible();
}
async function pulse(page:Page,button:number){await page.evaluate(i=>{(window as any).guidePad.buttons[i].pressed=true},button);await page.waitForTimeout(100);await page.evaluate(i=>{(window as any).guidePad.buttons[i].pressed=false},button);await page.waitForTimeout(100);}
async function layout(page:Page){
 const result=await page.locator('.lobby-rules-dialog').evaluate(dialog=>{
  const d=dialog.getBoundingClientRect();
  const controls=[...dialog.querySelectorAll<HTMLElement>(':scope > header button,:scope > .lobby-rules-tabs button,:scope > footer button')].filter(e=>e.getBoundingClientRect().width>0);
  const clipped=[...dialog.querySelectorAll<HTMLElement>('h3,li p,button,.lobby-mode-note')].filter(e=>e.getBoundingClientRect().width>0&&(e.scrollWidth>e.clientWidth+1||e.getBoundingClientRect().left<d.left-1||e.getBoundingClientRect().right>d.right+1)).map(e=>e.textContent);
  const offscreen=controls.filter(e=>{const r=e.getBoundingClientRect();return r.top<0||r.bottom>innerHeight+1||r.left<0||r.right>innerWidth+1}).map(e=>e.textContent);
  const overlaps=controls.flatMap((a,i)=>controls.slice(i+1).filter(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.min(x.right,y.right)>Math.max(x.left,y.left)+1&&Math.min(x.bottom,y.bottom)>Math.max(x.top,y.top)+1}).map(b=>[a.textContent,b.textContent]));
  const artOverlap=[...dialog.querySelectorAll<HTMLElement>('.lobby-mode-brief li')].some(e=>{const a=e.querySelector('svg')!.getBoundingClientRect(),b=e.querySelector('div')!.getBoundingClientRect();return a.right>b.left+1});
  return {clipped,offscreen,overlaps,artOverlap,dialogOffscreen:d.top<0||d.bottom>innerHeight+1};
 });expect(result).toEqual({clipped:[],offscreen:[],overlaps:[],artOverlap:false,dialogOffscreen:false});
}
for(const [width,height] of [[1440,960],[1280,480],[320,740],[390,844],[844,390]] as const)test(`three mode guides fit and preserve rules ${width}x${height}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height});await boot(page);await page.locator('[data-play-entry]').click();
 for(const [index,mode] of ['battle','team-battle','survival'].entries()){
  if(index)await page.locator('[data-cycle-mode]').click();
  const roster=await page.locator('[data-lobby-slot]').allTextContents();
  await page.locator('[data-open-rules]').click();const guide=page.locator('.lobby-mode-guide');await expect(guide).toHaveAttribute('data-guide-mode',mode!);await expect(guide.locator('.lobby-mode-brief li')).toHaveCount(3);await expect(guide.locator('.lobby-mode-brief svg')).toHaveCount(3);await layout(page);
  await page.screenshot({path:`${out}/${mode}-${width}.png`});
  await page.locator('[data-mode-details]').click();await expect(page.locator('.lobby-mode-details')).toBeVisible();await expect(page.locator('.lobby-mode-brief')).toBeHidden();await expect(page.locator('[data-mode-details]')).toHaveAttribute('aria-expanded','true');
  if(mode==='survival')await expect(page.locator('.lobby-mode-details')).toContainText('4:45');
  await layout(page);await page.locator('[data-mode-details]').click();await expect(page.locator('.lobby-mode-brief')).toBeVisible();
  await page.locator('[data-rules-tab="basics"]').click();await expect(page.locator('.lobby-rule-content svg')).toBeVisible();await page.locator('[data-rules-tab="mode"]').click();await expect(page.locator('.lobby-mode-brief')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('[data-open-rules]')).toBeFocused();expect(await page.locator('[data-lobby-slot]').allTextContents()).toEqual(roster);
 }
 // Timed score resolution for both conflict modes follows the current setting.
 await page.locator('[data-cycle-mode]').click();
 for(let i=0;i<2;i++){
  if(i)await page.locator('[data-cycle-mode]').click();await page.locator('#match-duration').click();await page.locator('[data-open-rules]').click();await expect(page.locator('.lobby-mode-guide')).toHaveAttribute('data-guide-timed','true');await expect(page.locator('.lobby-mode-brief li').last()).toContainText('time runs out');await layout(page);await page.screenshot({path:`${out}/timed-${i}-${width}.png`});await page.keyboard.press('Escape');
 }
 expect(errors).toEqual([]);
});
for(const locale of ['ru','fr','de','es','zh-Hans','ja'])test(`localized mode guides remain readable ${locale}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await boot(page,locale);await page.locator('[data-play-entry]').click();
 for(let i=0;i<3;i++){
  if(i)await page.locator('[data-cycle-mode]').click();await page.locator('[data-open-rules]').click();await expect(page.locator('.lobby-mode-brief li')).toHaveCount(3);await layout(page);await page.keyboard.press('Escape');
 }
});
test('owner controller and keyboard operate details, basics and return',async({page})=>{
 await boot(page,'en',true);await pulse(page,0);for(let i=0;i<4;i++)await pulse(page,15);await pulse(page,0);await expect(page.locator('.lobby-mode-brief')).toBeVisible();
 // Traverse spatially from header close to the tabs, footer and details action.
 await pulse(page,13);await pulse(page,13);await pulse(page,14);await expect(page.locator('[data-mode-details]')).toBeFocused();await pulse(page,0);await expect(page.locator('.lobby-mode-details')).toBeVisible();await pulse(page,0);await expect(page.locator('.lobby-mode-brief')).toBeVisible();
 await page.screenshot({path:`${out}/controller-details-focus.png`});await pulse(page,1);await expect(page.getByRole('dialog')).toHaveCount(0);
 // Pointer-owned entry keeps keyboard activation and focus trapped in the dialog.
 await page.reload();await page.locator('[data-play-entry]').click();await page.locator('[data-open-rules]').click();await page.keyboard.press('Tab');await expect(page.locator('[data-rules-tab="mode"]')).toBeFocused();await page.keyboard.press('Tab');await page.keyboard.press('Enter');await expect(page.locator('.lobby-rule-content')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
