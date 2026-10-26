import {test,expect,type Page} from '@playwright/test';
import {openLocalLobby} from '../helpers/localLobby';
const evidence=process.env.BRICKS_LOBBY_EVIDENCE ?? 'evidence/main-menu-play/runtime';
async function setup(page:Page,native=false,locale='ru'){
 await page.addInitScript(({native,locale})=>{
  localStorage.setItem('bricks-war:language:v1',locale);
  const pad={index:0,id:'Menu QA pad',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});Object.assign(window,{menuPad:pad,qaExit:0});
  if(native){const display={width:1440,height:960,fullscreen:false,auto:true,resolutions:[[1440,960]]};(window as any).bricksDesktop={updateState:async()=>({phase:'none'}),check:async()=>({phase:'none'}),setActivity:async()=>{},setSafeMenu:()=>{},healthy:async()=>{},display:async()=>display,setDisplay:async()=>display,confirmDisplay:async()=>display,exit:async()=>{(window as any).qaExit++},history:async()=>[]};}
 },{native,locale});await page.route('**/api/network/lobbies**',route=>route.fulfill({json:{rooms:[],next:null}}));await page.goto('/?muted=1');await expect(page.locator('[data-play-entry]')).toBeVisible();
}
async function pulse(page:Page,button:number){await page.evaluate(i=>{(window as any).menuPad.buttons[i].pressed=true},button);await page.waitForTimeout(100);await page.evaluate(i=>{(window as any).menuPad.buttons[i].pressed=false},button);await page.waitForTimeout(100);}
for(const [width,height,native] of [[1440,960,false],[1280,480,false],[390,844,false],[1440,960,true]] as const)test(`compact main menu Play routes and fixed destinations ${width} native${native}`,async({page})=>{
 await page.setViewportSize({width,height});await setup(page,native);
 const choices=page.locator('.mode-menu > button');await expect(choices).toHaveCount(native?4:3);
 await expect(choices.locator('strong')).toHaveText(native?['Играть','Сетевая игра','Настройки','Выход']:['Играть','Сетевая игра','Настройки']);
 await expect(page.locator('[data-destination="survival"],[data-destination="team-battle"]')).toHaveCount(0);
 const issue=await choices.evaluateAll(nodes=>nodes.some(e=>{const r=e.getBoundingClientRect();return r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1||e.scrollWidth>e.clientWidth+1}));expect(issue).toBe(false);
 await page.screenshot({path:`${evidence}/main-${width}-native${native}.png`,fullPage:true});
 await page.locator('[data-play-entry]').click();await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','battle');
 for(const mode of ['team-battle','survival','battle']){await page.locator('[data-cycle-mode]').click();await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode',mode);}
 await page.locator('[data-cycle-mode]').click();await page.locator('[data-lobby-back]').click();await page.locator('[data-play-entry]').click();await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','team-battle');
 await page.locator('[data-lobby-back]').click();await page.locator('[data-destination="settings"]').click();await expect(page.locator('#settings-back')).toBeVisible();await page.locator('#settings-back').click();
 await page.locator('[data-network-entry]').click();await expect(page.locator('.network-screen')).toBeVisible();
 if(native){await page.reload();await page.locator('#desktop-exit').click();await expect.poll(()=>page.evaluate(()=>(window as any).qaExit)).toBe(1);}
});
test('gamepad Play entry does not carry held A into the lobby',async({page})=>{await setup(page);await pulse(page,0);await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','battle');await expect(page.locator('.is-editing')).toHaveCount(0);});
for(const locale of ['en','fr','de','es','zh-Hans','ja'])test(`Play entry is localized and modes remain reachable ${locale}`,async({page})=>{await setup(page,false,locale);await expect(page.locator('.mode-menu button')).toHaveCount(3);expect(await page.locator('[data-play-entry] strong').innerText()).not.toBe('Играть');await openLocalLobby(page,'survival');});
