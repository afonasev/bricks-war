import { test,expect,type Page } from '@playwright/test';
const evidence=process.env.BRICKS_LOBBY_EVIDENCE ?? 'evidence/gamepad-grid-keyboard/runtime';
async function pulse(page:Page,button:number){await page.evaluate(i=>{(window as any).gridPad.buttons[i].pressed=true},button);await page.waitForTimeout(80);await page.evaluate(i=>{(window as any).gridPad.buttons[i].pressed=false},button);await page.waitForTimeout(80);}
for(const width of [1440,390])test(`shared menu uses geometric grid and keyboard Y B X ${width}`,async({page})=>{
 await page.setViewportSize({width,height:width===1440?960:844});
 await page.addInitScript(()=>{localStorage.setItem('bricks-war:language:v1','ru');const pad={index:0,id:'QA pad',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});Object.assign(window,{gridPad:pad,qaJoin:0,qaAi:0});});
 await page.route('**/qa-menu-focus-harness',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/ui/menuFocus.css"><style>#app main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:20px}#app main>*{height:48px;min-width:0}</style><div id="app" data-input-mode="gamepad"><main><input id="name" value="Аня" maxlength="18" data-ui-focus><button id="right" data-ui-focus>Справа</button><button id="below" data-ui-focus>Снизу</button><button id="diagonal" data-ui-focus>Справа снизу</button></main></div><script type="module">import {MenuFocusController} from '/src/ui/menuNavigation.ts';const focus=new MenuFocusController(document.querySelector('#app'),{onBack:()=>{},onGamepadRoster:()=>window.qaJoin++,onGamepadAddAi:()=>window.qaAi++});focus.activate('main-menu');</script></html>`}));
 await page.goto('/qa-menu-focus-harness');await expect(page.locator('#name')).toHaveClass(/is-ui-selected/);
 await pulse(page,15);await expect(page.locator('#right')).toHaveClass(/is-ui-selected/);
 await pulse(page,13);await expect(page.locator('#diagonal')).toHaveClass(/is-ui-selected/);
 await pulse(page,14);await expect(page.locator('#below')).toHaveClass(/is-ui-selected/);
 await pulse(page,12);await expect(page.locator('#name')).toHaveClass(/is-ui-selected/);
 await pulse(page,14);await expect(page.locator('#name')).toHaveClass(/is-ui-selected/);
 await pulse(page,0);const keyboard=page.locator('[data-virtual-keyboard]');await expect(keyboard).toBeVisible();
 await expect(keyboard.locator('.name-keyboard-row').first()).toHaveText('ЙЦУКЕНГШЩЗХЪ');
 const first=keyboard.getByRole('button',{name:'Й',exact:true});await expect(first).toHaveClass(/is-ui-selected/);
 await expect(first).toHaveCSS('background-color','rgb(139, 212, 246)');await expect(first).toHaveCSS('outline-style','none');
 await pulse(page,15);await pulse(page,15);await pulse(page,15);await expect(keyboard.getByRole('button',{name:'К',exact:true})).toHaveClass(/is-ui-selected/);
 await pulse(page,13);await expect(keyboard.locator('.name-keyboard-row').nth(1).locator('.is-ui-selected')).toHaveCount(1);
 await pulse(page,12);await expect(keyboard.getByRole('button',{name:'К',exact:true})).toHaveClass(/is-ui-selected/);
 await pulse(page,2);await expect(page.locator('#name')).toHaveValue('Аня');await expect(keyboard).toBeVisible();
 await keyboard.getByRole('button',{name:'А',exact:true}).click();await pulse(page,3);
 await expect(keyboard).toHaveCount(0);await expect(page.locator('#name')).toHaveValue('АняА');
 expect(await page.evaluate(()=>[(window as any).qaJoin,(window as any).qaAi])).toEqual([0,0]);
 await pulse(page,0);await keyboard.getByRole('button',{name:'Б',exact:true}).click();
 await page.screenshot({path:`${evidence}/shared-keyboard-${width}.png`,fullPage:true});
 await pulse(page,1);await expect(keyboard).toHaveCount(0);await expect(page.locator('#name')).toHaveValue('АняА');
});
