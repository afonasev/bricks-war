import {test,expect,type Page,type Locator} from '@playwright/test';
const out=process.env.BRICKS_LOBBY_EVIDENCE??'evidence/refine-owned-lobby-controls/F3/runtime';
const sage='rgb(237, 242, 223)', hover='rgb(243, 246, 235)';
async function boot(page:Page){
 await page.addInitScript(()=>{
  localStorage.setItem('bricks-war:language:v1','ru');
  localStorage.setItem('bricks-war:gamepad-profiles:v2',JSON.stringify(['Алиса','Катя','Миша','Оля','Тимур'].map((name,i)=>({id:'focus-'+i,device:'keyboard',name,uses:10-i}))));
  const pad={index:4,id:'Xbox focus QA',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0};
  const guest={...pad,index:5,id:'Xbox guest QA',buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false}))};
  Object.defineProperty(navigator,'getGamepads',{value:()=>[null,null,null,null,pad,guest]});Object.assign(window,{focusPad:pad,focusGuest:guest});
 });await page.goto('/?muted=1');await expect(page.locator('[data-play-entry]')).toBeVisible();
}
async function pulse(page:Page,button:number,guest=false){await page.evaluate(({button,guest})=>{(window as any)[guest?'focusGuest':'focusPad'].buttons[button].pressed=true},{button,guest});await page.waitForTimeout(110);await page.evaluate(({button,guest})=>{(window as any)[guest?'focusGuest':'focusPad'].buttons[button].pressed=false},{button,guest});await page.waitForTimeout(110);}
async function focus(_page:Page,control:Locator,fill=sage){
 const position=()=>control.evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}});
 const before=await position();await control.press('Shift');await expect(control).toBeFocused();
 if(await control.evaluate(e=>e.matches('[data-remove]'))){await expect(control).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(control).toHaveCSS('box-shadow','none');await expect(control).toHaveCSS('text-decoration-line','underline');}
 else if(await control.evaluate(e=>e.matches('[data-edit],[data-bot]'))){
  const card=control.locator('xpath=ancestor-or-self::*[contains(@class,"lobby-card")][1]');
  await expect(card).toHaveCSS('background-image',/linear-gradient/);
  expect(await card.evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe(sage);
  await expect(card).toHaveCSS('box-shadow',/rgb\(52, 76, 45\).*3px.*inset/);
  if(await control.getAttribute('data-bot')!==null){await expect(control).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(control).toHaveCSS('box-shadow','none');}
 }else{await expect(control).toHaveCSS('background-color',fill);await expect(control).toHaveCSS('background-image','none');await expect(control).toHaveCSS('box-shadow',/inset/);}
 expect(await position()).toEqual(before);
 const clipped=await control.evaluate(e=>{const r=e.getBoundingClientRect();return e.scrollWidth>e.clientWidth+1||r.left<0||r.right>innerWidth+1});expect(clipped).toBe(false);
}
async function shot(page:Page,name:string){await page.screenshot({path:`${out}/${name}.png`,fullPage:true});}
for(const [width,height] of [[1440,960],[1280,480],[390,844]] as const)test(`sage focus stays visible without geometry changes ${width}`,async({page})=>{
 await page.setViewportSize({width,height});await boot(page);
 for(const selector of ['[data-network-entry]','[data-destination="settings"]']){await page.keyboard.press('ArrowDown');await expect(page.locator(selector)).toBeFocused();await expect(page.locator(selector)).toHaveCSS('background-color',sage);}
 await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await expect(page.locator('[data-play-entry]')).toBeFocused();await expect(page.locator('[data-play-entry]')).toHaveCSS('background-color',sage);await shot(page,`main-keyboard-${width}`);
 await page.mouse.move(0,0);await page.locator('[data-play-entry]').hover();await expect(page.locator('[data-play-entry]')).toHaveCSS('background-color',hover);await shot(page,`main-mouse-${width}`);
 await page.locator('[data-play-entry]').click();
 const mode=page.locator('[data-cycle-mode]');const art=await mode.evaluate(e=>getComputedStyle(e).backgroundImage);const before=await mode.boundingBox();await mode.press('Shift');await expect(mode).toHaveCSS('background-image',art);expect(art).toContain('url(');expect(await mode.boundingBox()).toEqual(before);await expect(mode.locator('span')).toHaveCSS('background-color',sage);await shot(page,`mode-keyboard-${width}`);
 for(const id of ['match-duration','attack-mode','battle-difficulty'])await focus(page,page.locator('#'+id));
 await focus(page,page.locator('.lobby-help'),'rgb(228, 236, 212)');await expect(page.locator('.lobby-help')).toHaveCSS('border-radius','50%');
 await focus(page,page.locator('[data-edit="0"]'));await shot(page,`card-keyboard-${width}`);
 await focus(page,page.locator('[data-remove="0"]'));await expect(page.locator('[data-remove="0"]')).toHaveCSS('border-radius','50%');
 await focus(page,page.locator('[data-bot]').first());await shot(page,`bot-keyboard-${width}`);
 await focus(page,page.locator('[data-join]').first());await expect(page.locator('[data-join]').first().locator('..')).not.toHaveCSS('box-shadow',/rgb\(52, 76, 45\).*3px/);await shot(page,`join-keyboard-${width}`);
 await focus(page,page.locator('[data-lobby-back]'));
 await page.locator('[data-bot]').first().click();for(const level of await page.locator('[data-level]').all())await focus(page,level);const activeLevel=page.locator('[data-level][data-default-choice="true"]');await expect(activeLevel).toHaveCSS('background-color','rgb(255, 253, 240)');await expect(activeLevel).toHaveCSS('box-shadow','none');expect(await activeLevel.evaluate(e=>getComputedStyle(e,'::after').content)).toBe('none');await shot(page,`bot-editor-${width}`);
 await page.locator('[data-level="medium"]').click();await focus(page,page.locator('#start-match'));await shot(page,`start-keyboard-${width}`);
 await page.locator('[data-edit="0"]').click();await expect(page.locator('.lobby-theme-list')).toBeVisible();
 const selected=page.locator('.lobby-theme-list [data-default-choice="true"]');const selectedStyle=await selected.getAttribute('data-style');
 const other=page.locator('.lobby-theme-list button').nth(1);await focus(page,other);await expect(selected).toHaveAttribute('data-style',selectedStyle!);await expect(selected).toHaveAttribute('data-default-choice','true');await expect(page.locator('.lobby-theme-list [aria-pressed]')).toHaveCount(0);await expect(selected).toHaveCSS('background-color','rgb(255, 253, 240)');await expect(selected).toHaveCSS('box-shadow','none');expect(await selected.evaluate(e=>getComputedStyle(e,'::after').content)).toBe('none');await shot(page,`theme-list-${width}`);
 await page.keyboard.press('Escape');if(width===390)await page.locator('[data-remove="0"]').click();await page.locator('[data-join]').first().click();await expect(page.locator('[data-wheel-center]')).toBeVisible();await focus(page,page.locator('[data-cancel]'));await focus(page,page.locator('[data-wheel-up]'));await focus(page,page.locator('[data-wheel-down]'));await focus(page,page.locator('[data-wheel-center]'));await shot(page,`name-wheel-${width}`);
 await page.keyboard.press('ArrowUp');await expect(page.locator('[data-wheel-center]')).toContainText('Создать новое');await page.keyboard.press('Enter');await focus(page,page.locator('[data-typing-name]'));await page.locator('[data-typing-name]').fill('Фокус');await focus(page,page.locator('[data-typed-done]'));await focus(page,page.locator('[data-typing-back]'));await focus(page,page.locator('[data-typing-name]'));await shot(page,`typing-${width}`);
});
test('pad index four uses the same focus on main, globals, bot actions and theme editor',async({page})=>{
 await boot(page);await pulse(page,13);await expect(page.locator('.main-menu-screen .is-ui-selected')).toHaveCSS('background-color',sage);await shot(page,'main-pad');await pulse(page,12);await pulse(page,0);await expect(page.locator('.unified-lobby')).toHaveAttribute('data-menu-owner','gamepad-4');
 await pulse(page,15);await expect(page.locator('#match-duration')).toHaveClass(/pad-4-target/);await expect(page.locator('#match-duration')).toHaveCSS('background-color',sage);await shot(page,'parameter-pad');
 await pulse(page,2);await expect(page.locator('.pad-selected')).toHaveCSS('background-color',sage);await expect(page.locator('[class*="pad-4-target"]')).toHaveCount(0);await shot(page,'bot-editor-pad');await pulse(page,0);
 await page.evaluate(()=>{(window as any).focusPad.buttons[3].pressed=true});await page.waitForTimeout(850);await page.evaluate(()=>{(window as any).focusPad.buttons[3].pressed=false});await expect(page.locator('.lobby-theme-wheel')).toBeVisible();await expect(page.locator('[data-wheel-center].pad-selected')).toHaveCSS('background-color',sage);await expect(page.locator('[class*="pad-4-target"]')).toHaveCount(0);await shot(page,'theme-wheel-pad');
 await pulse(page,3,true);await expect(page.locator('.lobby-name-wheel .pad-selected')).toHaveCSS('background-color',sage);await shot(page,'name-wheel-pad');await pulse(page,12,true);await pulse(page,0,true);await expect(page.locator('.lobby-name-keys .pad-selected')).toHaveCSS('background-color',sage);await shot(page,'virtual-keys-pad');
});

for(const width of [1440,390])test(`pointer hover uses the sage family without moving controls ${width}`,async({page})=>{
 await page.setViewportSize({width,height:960});await boot(page);await page.locator('[data-play-entry]').click();
 for(const selector of ['#match-duration','.lobby-help','[data-edit="0"]','[data-remove="0"]','[data-bot]','[data-join]','[data-lobby-back]']){
  const control=page.locator(selector).first();await control.scrollIntoViewIfNeeded();const before=await control.boundingBox();await control.hover();
  if(await control.evaluate(e=>e.matches('[data-remove]'))){await expect(control).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(control).toHaveCSS('box-shadow','none');}
  else if(await control.evaluate(e=>e.matches('[data-edit],[data-bot]'))){
   const card=control.locator('xpath=ancestor-or-self::*[contains(@class,"lobby-card")][1]');await expect(card).toHaveCSS('background-image',/linear-gradient/);expect(await card.evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe(hover);await expect(card).toHaveCSS('box-shadow',/2px.*inset/);
   if(await control.getAttribute('data-bot')!==null)await expect(control).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  }else{await expect(control).toHaveCSS('background-color',hover);await expect(control).toHaveCSS('background-image','none');}
  expect(await control.boundingBox()).toEqual(before);
 }
 await page.locator('[data-bot]').first().hover();await shot(page,`bot-mouse-${width}`);
 await page.locator('[data-bot]').first().click();await page.locator('[data-level]').first().hover();await expect(page.locator('[data-level]').first()).toHaveCSS('background-color',hover);await shot(page,`bot-editor-mouse-${width}`);
});

test('survival rating and rules actions share the navigation style',async({page})=>{
 await boot(page);await page.locator('[data-play-entry]').click();await page.locator('[data-cycle-mode]').click();await page.locator('[data-cycle-mode]').click();
 await focus(page,page.locator('[data-open-rating]'));await shot(page,'rating-focus');await page.locator('[data-open-rules]').click();
 const close=page.locator('.lobby-overlay button').first();await focus(page,close);await shot(page,'rules-focus');await page.keyboard.press('Escape');await expect(page.locator('.lobby-overlay')).toBeHidden();
});

test('pad primary card actions frame the whole original-colour card and Join stays separate',async({page})=>{
 await boot(page);await pulse(page,0);await pulse(page,13);
 const occupied=page.locator('[data-edit="0"]');await expect(occupied).toHaveClass(/pad-4-target/);await expect(occupied).toHaveCSS('background-image',/linear-gradient/);await expect(occupied).toHaveCSS('box-shadow',/rgb\(52, 76, 45\).*3px.*inset/);
 await shot(page,'occupied-card-pad');await pulse(page,15);
 const bot=page.locator('[data-bot].pad-4-target');await expect(bot).toBeVisible();const slot=await bot.getAttribute('data-bot');const card=page.locator(`[data-lobby-slot="${slot}"]`);await expect(bot).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(bot).toHaveCSS('box-shadow','none');await expect(card).toHaveCSS('box-shadow',/rgb\(52, 76, 45\).*3px.*inset/);await shot(page,'whole-card-pad');
 await pulse(page,13);await expect(card.locator('[data-join]')).toHaveClass(/pad-4-target/);await expect(card.locator('[data-join]')).toHaveCSS('background-color',sage);await expect(card).not.toHaveCSS('box-shadow',/rgb\(52, 76, 45\).*3px/);await shot(page,'join-separate-pad');
});

test('only navigation focus exists; default difficulty starts focused and A commits the target',async({page})=>{
 await boot(page);await pulse(page,0);await pulse(page,2);
 await expect(page.locator('[data-level].pad-selected')).toHaveAttribute('data-level','medium');await expect(page.locator('[data-level][aria-pressed]')).toHaveCount(0);
 await pulse(page,13);await pulse(page,13);await pulse(page,13);
 const current=page.locator('[data-level][data-default-choice="true"]');const focused=page.locator('[data-level].pad-selected');await expect(focused).toHaveCount(1);await expect(focused).toHaveAttribute('data-level','expert');await expect(focused).toHaveCSS('background-color',sage);await expect(current).toHaveAttribute('data-level','medium');await expect(current).toHaveCSS('background-color','rgb(255, 253, 240)');await expect(current).toHaveCSS('box-shadow','none');expect(await current.evaluate(e=>getComputedStyle(e,'::after').content)).toBe('none');await shot(page,'bot-difficulty-pad');await pulse(page,0);await expect(page.locator('.is-editing')).toHaveCount(0);await expect(page.locator('[data-edit="1"] h2')).toContainText('эксперт');
});
