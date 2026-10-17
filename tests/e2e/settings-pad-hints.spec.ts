import {test,expect} from '@playwright/test';
for(const [id,back,reset] of [['Xbox Controller','B','Y'],['Sony DualSense','○','△'],['Nintendo Switch Pro','A','X'],['Unknown Pad','Право','Верх']]) {
 test(`settings footer hints persist with pointer input: ${id}`,async({page})=>{
  await page.addInitScript(id=>{const pad={index:0,id,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>pad.connected?[pad]:[],configurable:true});(window as any).hintPad=pad;},id);
  await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();
  const backHint=page.locator('.settings-screen footer .input-back'),resetHint=page.locator('footer .input-reset');
  await expect(backHint).toHaveText(back!);await expect(backHint).toBeVisible();await expect(resetHint).toHaveText(reset!);await expect(resetHint).toBeVisible();
  await expect(page.locator('button .input-badge')).toHaveCount(1);await expect(page.locator('footer [data-reset-preferences] .input-reset')).toHaveCount(1);await expect(page.locator('[data-reset-preferences]')).toHaveCount(1);await expect(page.locator('.settings-utility [data-reset-preferences]')).toHaveCount(0);await expect(page.locator('footer .input-confirm')).toHaveText(id==='Sony DualSense'?'✕':id==='Nintendo Switch Pro'?'B':id==='Unknown Pad'?'Низ':'A');await expect(page.locator('.context-pad-hint')).toHaveCount(0);
  await page.locator('#master-volume').fill('25');await page.locator('footer [data-reset-preferences]').click();await expect(page.locator('#master-volume')).toHaveValue('100');
  await page.locator('#master-volume').click();await expect(backHint).toBeVisible();await expect(resetHint).toBeVisible();
  for(const viewport of [{width:1440,height:960},{width:1280,height:480},{width:390,height:844}]) {
   await page.setViewportSize(viewport);
   const issues=await page.locator('#settings-back,[data-reset-preferences]').evaluateAll(buttons=>buttons.flatMap(button=>{const b=button.getBoundingClientRect();return [...button.children].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left<b.left||r.right>b.right||r.top<b.top||r.bottom>b.bottom)}).map(el=>el.className)}));expect(issues).toEqual([]);expect(await page.locator('footer .input-badge').evaluateAll(elements=>elements.filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.textContent))).toEqual([]);const footer=await page.locator('.settings-screen footer').evaluate(el=>({bottom:el.getBoundingClientRect().bottom,top:el.getBoundingClientRect().top,utilityBottom:el.previousElementSibling!.getBoundingClientRect().bottom,height:innerHeight}));expect(Math.abs(footer.bottom-footer.height)).toBeLessThanOrEqual(1);expect(footer.top).toBeGreaterThanOrEqual(footer.utilityBottom-1);
   if(id==='Xbox Controller')await page.screenshot({path:`evidence/settings-footer-reset-action/settings-${viewport.width}.png`});
  }
  await page.setViewportSize({width:1440,height:960});await page.locator('#open-controls').click();await expect(page.locator('.controls-screen footer .input-back')).toHaveText(back!);await expect(page.locator('footer .input-reset')).toHaveCount(0);await expect(page.locator('button .input-badge')).toHaveCount(0);await page.locator('#controls-back').click();
  await page.locator('#settings-back').click();await page.locator('[data-destination="battle"]').click();
  await expect(page.locator('footer .input-back')).toHaveText(back!);await expect(page.locator('footer .input-roster')).toHaveText(reset!);await expect(page.locator('footer .input-reset')).toHaveCount(0);
  if(id==='Xbox Controller'){
   const centers=await page.locator('#start-match kbd').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const text=range.getBoundingClientRect(),badge=el.getBoundingClientRect();return {x:Math.abs((text.left+text.right-badge.left-badge.right)/2),y:Math.abs((text.top+text.bottom-badge.top-badge.bottom)/2)};});expect(centers.x).toBeLessThanOrEqual(1);expect(centers.y).toBeLessThanOrEqual(2);
   await page.screenshot({path:'evidence/settings-footer-reset-action/battle-gamepad.png'});
  }
  await page.locator('#mode-back').click();await page.locator('[data-destination="settings"]').click();
  await page.evaluate(()=>{(window as any).hintPad.connected=false});await expect(backHint).toBeHidden();await expect(resetHint).toBeHidden();await expect(page.locator('footer [data-reset-preferences]')).toBeVisible();await page.locator('#master-volume').fill('25');await page.locator('footer [data-reset-preferences]').click();await expect(page.locator('#master-volume')).toHaveValue('100');
 });
}

test('pause and network preference footers show B and Y before controller input',async({page})=>{
 await page.addInitScript(()=>{const pad={index:0,id:'Xbox Controller',connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad],configurable:true});(window as any).hintPad=pad;});
 await page.goto('/?muted=1');await page.locator('[data-destination="survival"]').click();await page.locator('#start-match').click();await expect(page.locator('.match-loading')).toHaveCount(0);await page.keyboard.press('Escape');await page.locator('#pause-settings').click();
 await expect(page.locator('#pause-settings-panel footer .input-confirm')).toHaveText('A');await expect(page.locator('#pause-settings-panel footer [data-reset-preferences]')).toHaveCount(1);await expect(page.locator('#pause-settings-panel footer .input-back')).toHaveText('B');await expect(page.locator('#pause-settings-panel footer .input-back')).toBeVisible();await expect(page.locator('footer .input-reset')).toBeVisible();
 await page.locator('#master-volume').fill('25');await page.evaluate(()=>{(window as any).hintPad.buttons[3].pressed=true});await expect(page.locator('#master-volume')).toHaveValue('100');await page.evaluate(()=>{(window as any).hintPad.buttons[3].pressed=false});await page.locator('#pause-settings-back').click();await expect(page.locator('#pause-overlay')).toBeVisible();
 await page.route('**/api/network/lobbies**',route=>route.fulfill({json:{rooms:[],next:null}}));await page.goto('/?muted=1');await page.locator('[data-network-entry]').click();await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await expect(page.locator('[data-network-preferences] footer .input-confirm')).toHaveText('A');await expect(page.locator('[data-network-preferences] footer [data-reset-preferences]')).toHaveCount(1);await expect(page.locator('[data-network-preferences] footer .input-back')).toHaveText('B');await expect(page.locator('[data-network-preferences] footer .input-back')).toBeVisible();await expect(page.locator('footer .input-reset')).toBeVisible();
});

test('auxiliary and network menus use footer-only Back hints without reset',async({page})=>{
 await page.addInitScript(()=>{const pad={index:0,id:'Sony DualSense',connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad],configurable:true});});
 await page.route('**/api/network/lobbies**',route=>route.fulfill({json:{rooms:[],next:null}}));
 await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();
 const check=async()=>{await expect(page.locator('footer .input-back')).toHaveText('○');await expect(page.locator('footer .input-back')).toBeVisible();await expect(page.locator('.input-reset')).toHaveCount(0);await expect(page.locator('button .input-badge')).toHaveCount(0);};
 await page.locator('#open-rules').click();await check();await page.locator('#rules-back').click();
 await page.locator('#open-settings-lab').click();await check();await page.locator('#close-debug-lab').click();
 await page.locator('#settings-back').click();await page.locator('[data-network-entry]').click();await check();await page.getByRole('button',{name:'Создать лобби',exact:true}).click();await check();
});
