import { openPreferencesCategory } from '../helpers/preferences';
import {test,expect} from '@playwright/test';
const notes='Latest changes\n'+Array.from({length:45},(_,i)=>`- Improvement ${i+1}: readable controls and clear player boards.`).join('\n');
for(const [width,height]of [[1440,960],[1280,480],[390,844],[844,390]]as const)test(`shared sections ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width,height});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(notes=>{localStorage.setItem('bricks-war:language:v1','en');const pad={index:0,id:'Xbox QA',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});(window as any).shellPad=pad;const display={width:1440,height:960,fullscreen:false,auto:true,resolutions:[[1280,720],[1440,960]]};(window as any).bricksDesktop={updateState:async()=>({phase:'idle'}),check:async()=>({phase:'idle'}),setActivity:async()=>{},setSafeMenu:()=>{},healthy:async()=>{},display:async()=>display,history:async()=>[{version:'1.13.2',date:'2026-10-31',text:notes,fallback:false,installed:true}]};},notes);
 await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();
 const check=async(screen:string)=>{
  const main=page.locator(`main[data-screen="${screen}"]`);await expect(main).toHaveClass(/section-shell/);
  await expect(main.locator('.section-heading .section-brand')).toBeVisible();await expect(main.locator('.section-heading h1')).not.toBeEmpty();await expect(main.locator('.section-heading button')).toHaveCount(0);await expect(main.locator('.section-navigation .section-back .input-back')).toHaveText('B');
  const geometry=await main.evaluate(e=>{const b=(s:string)=>e.querySelector(s)!.getBoundingClientRect();const header=b('.section-heading'),content=b('.section-content'),nav=b('.section-navigation'),back=b('.section-back'),main=e.getBoundingClientRect();return {backLeft:back.left,backBottom:back.bottom,mainLeft:main.left,mainBottom:main.bottom,inside:back.left>=0&&back.right<=innerWidth+1&&back.bottom<=innerHeight+1,disjoint:header.bottom<=content.top+1&&content.bottom<=nav.top+1,background:getComputedStyle(document.querySelector('#app')!).backgroundImage};});
  expect(geometry.inside).toBe(true);expect(height-geometry.backBottom).toBeLessThanOrEqual(24);expect(geometry.disjoint).toBe(true);expect(geometry.background).toContain('maple');
  await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/${screen}-${width}.png`});return geometry;
 };
 const first=await check('settings');
 for(const [launcher,screen]of [['#open-controls','controls'],['#open-rules','rules'],['#open-settings-lab','laboratory'],['#open-release-history','history']]as const){
  await openPreferencesCategory(page,launcher==='#open-controls'?'controls':'more');await page.locator(launcher).click();const geometry=await check(screen);expect(Math.abs(geometry.backLeft-first.backLeft)).toBeLessThanOrEqual(1);expect(Math.abs(geometry.backBottom-first.backBottom)).toBeLessThanOrEqual(1);
  if(screen==='rules'){await page.evaluate(()=>{(window as any).shellPad.buttons[15].pressed=true;});await expect(page.locator('#rules-progress')).toHaveText('2 / 8');await page.evaluate(()=>{(window as any).shellPad.buttons[15].pressed=false;});await page.waitForTimeout(90);}
  if(screen==='history'){await expect(page.locator('[data-history-scroll]')).toContainText('Improvement 45');await page.evaluate(()=>{(window as any).shellPad.axes[3]=.8;});await expect.poll(()=>page.locator('[data-history-scroll]').evaluate(e=>e.scrollTop)).toBeGreaterThan(30);await page.evaluate(()=>{(window as any).shellPad.axes[3]=0;});}
  await page.evaluate(()=>{(window as any).shellPad.buttons[1].pressed=true;});await expect(page.locator('main[data-screen="settings"]')).toBeVisible();await page.evaluate(()=>{(window as any).shellPad.buttons[1].pressed=false;});await page.waitForTimeout(90);
 }
 await page.locator('#settings-back').click();await page.locator('[data-play-entry]').click();await expect(page.locator('.lobby-heading span')).toHaveCount(0);await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/lobby-${width}.png`});expect(errors).toEqual([]);
});

test('history keeps origin focus and ignores a late native response after Back',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('bricks-war:language:v1','en');Object.defineProperty(navigator,'getGamepads',{value:()=>[]});let count=0;
  const state={available:true,applying:false,error:false,phase:'ready',version:'1.13.3',currentVersion:'1.13.2'};const display={width:1440,height:960,fullscreen:false,resolutions:[[1440,960]]};
  (window as any).bricksDesktop={updateState:async()=>state,check:async()=>state,setActivity:async()=>state,setSafeMenu:()=>{},healthy:async()=>{},display:async()=>display,history:()=>{count++;if(count===1)return new Promise(resolve=>{(window as any).resolveHistory=resolve;});if(count===2)return Promise.reject(Error('fixture unavailable'));return Promise.resolve([]);}};
 });
 await page.goto('/?muted=1');const launch=page.locator('.desktop-release-history');await expect(launch).toBeVisible();await launch.click();await expect(page.locator('main[data-screen="history"]')).toBeVisible();await page.locator('[data-history-back]').click();await expect(page.locator('.main-menu-screen')).toBeVisible();await expect(launch).toBeFocused();
 await page.evaluate(()=>{(window as any).resolveHistory([{version:'late',text:'stale response'}]);});await page.waitForTimeout(100);await expect(page.locator('[data-screen="history"]')).toHaveCount(0);
 await page.locator('[data-destination="settings"]').click();await page.locator('#open-release-history').click();await expect(page.locator('[data-screen="history"] [role="status"]')).not.toBeEmpty();await page.locator('[data-history-back]').click();await expect(page.locator('#open-release-history')).toBeFocused();
 await page.locator('#open-release-history').click();await expect(page.locator('[data-history-scroll] article')).toHaveCount(0);await expect(page.locator('[data-screen="history"] [role="status"]')).not.toBeEmpty();
 for(const [width,height]of [[390,844],[1440,960],[844,390]]as const){await page.setViewportSize({width,height});const back=await page.locator('[data-history-back]').boundingBox();expect(back!.y+back!.height).toBeLessThanOrEqual(height);expect(height-back!.y-back!.height).toBeLessThanOrEqual(24);}
});

for(const width of [1440,390])test(`public Laboratory shell component ${width}`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:960});await page.goto('/?muted=1');await expect(page.locator('[data-play-entry]')).toBeVisible();
 await page.evaluate(async()=>{
  const {configureSectionShell}=await import('/src/ui/sectionShell.ts' as string);
  const root=document.querySelector('#app')!;root.innerHTML='<main class="release-screen premium-surface settings-screen" data-screen="laboratory"><header><button id="close-debug-lab">Back</button><h1>Laboratory</h1></header><section class="release-panel laboratory-unavailable"><h2>Local development only</h2><p>These tools are available in the local development build.</p></section><footer>Old hints</footer></main>';
  root.querySelector('#close-debug-lab')!.addEventListener('click',()=>{(window as any).labBackClicked=true;});configureSectionShell(root,'laboratory');configureSectionShell(root,'laboratory');
 });
 await expect(page.locator('.section-heading')).toHaveCount(1);await expect(page.locator('.section-navigation')).toHaveCount(1);await expect(page.locator('.section-content .laboratory-unavailable')).toBeVisible();await expect(page.locator('main footer')).toHaveCount(0);await page.locator('#close-debug-lab').click();expect(await page.evaluate(()=>(window as any).labBackClicked)).toBe(true);
});
