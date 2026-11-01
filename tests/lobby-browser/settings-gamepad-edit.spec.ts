import { test, expect, type Page } from '@playwright/test';
import { openLocalLobby } from '../helpers/localLobby';
async function pulse(page: Page, button: number) {
  await page.evaluate(i => { (window as any).editPad.buttons[i].pressed = true; }, button);
  await page.waitForTimeout(90);
  await page.evaluate(i => { (window as any).editPad.buttons[i].pressed = false; }, button);
  await page.waitForTimeout(90);
}
async function boot(page: Page, native: boolean) {
  await page.addInitScript(native => {
    localStorage.setItem('bricks-war:language:v1', 'en');
    const pad = { index: 0, id: 'Xbox QA', mapping: 'standard', connected: true, axes: [0,0,0,0], buttons: Array.from({length:16}, () => ({pressed:false,value:0})), timestamp:0 };
    Object.defineProperty(navigator,'getGamepads',{value:()=>pad.connected?[pad]:[]}); (window as any).editPad=pad;
    if(native){const display={width:1440,height:960,fullscreen:false,auto:true,resolutions:[[1280,720],[1440,960]]};(window as any).bricksDesktop={updateState:async()=>({phase:'idle'}),check:async()=>({phase:'idle'}),setActivity:async()=>{},setSafeMenu:()=>{},healthy:async()=>{},display:async()=>display,setDisplay:async()=>display,confirmDisplay:async()=>display,history:async()=>[]};}
  },native);
  await page.goto('/?muted=1');
}
for(const [width,height,native] of [[1440,960,false],[1280,480,true],[390,844,false]] as const) test(`settings navigation then edit ${width} native${native}`,async({page})=>{
  await page.setViewportSize({width,height});await boot(page,native);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('[data-destination="settings"]').click();
  const ranges=page.locator('.settings-screen input[type="range"]');
  const count=await ranges.count();expect(count).toBeGreaterThanOrEqual(5);
  for(let i=0;i<count;i++){
    const range=ranges.nth(i);const before=await range.inputValue();
    await range.focus();await range.press('Enter'); // Keyboard focuses the controller target without changing its value.
    await pulse(page,15);await expect(range).toHaveValue(before);
    await range.focus();await range.press('Enter');
    await pulse(page,0);await expect(range).toHaveAttribute('data-gamepad-editing','true');
    const direction=Number(before)>Number(await range.getAttribute('min')||0)?14:15;
    await pulse(page,direction);expect(await range.inputValue()).not.toBe(before);
    await pulse(page,1);await expect(range).toHaveValue(before);await expect(range).not.toHaveAttribute('data-gamepad-editing');
    await expect(page.locator('.settings-screen')).toBeVisible();
  }
  const music=page.locator('#music-volume');await music.focus();await music.press('Enter');await pulse(page,0);await pulse(page,14);
  const saved=await music.inputValue();await pulse(page,0);await expect(music).not.toHaveAttribute('data-gamepad-editing');
  await pulse(page,15);await expect(music).toHaveValue(saved);
  if(width>700){
    await page.locator('#master-volume').focus();await page.locator('#master-volume').press('Enter');await pulse(page,15);
    expect(await page.locator('.is-ui-selected').evaluate(e=>Boolean(e.closest('.settings-right-column')))).toBe(true);
    const selects=page.locator('.settings-screen select[data-menu-select-enhanced]');
    for(let i=0;i<await selects.count();i++){
      const select=selects.nth(i);const original=await select.inputValue();
      const trigger=select.locator('xpath=following-sibling::*[1]').locator('[data-menu-select-trigger]');
      await trigger.hover();await pulse(page,15);await expect(select).toHaveValue(original);await expect(trigger).toHaveAttribute('aria-expanded','false');
      await trigger.hover();await pulse(page,0);await expect(trigger).toHaveAttribute('aria-expanded','true');
      await pulse(page,1);await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(select).toHaveValue(original);
    }
    const check=page.locator('#calm-effects');const before=await check.isChecked();await check.hover();await pulse(page,15);expect(await check.isChecked()).toBe(before);
    await check.hover();await pulse(page,0);expect(await check.isChecked()).toBe(!before);
  }
  await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/navigation-${width}.png`});
  await music.focus();await music.press('Enter');await pulse(page,0);await expect(music).toHaveAttribute('data-gamepad-editing','true');
  await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/editing-${width}.png`});
  await pulse(page,0);await page.reload();await page.locator('[data-destination="settings"]').click();await expect(page.locator('#music-volume')).toHaveValue(saved);
  await expect(page.locator('[data-gamepad-editing]')).toHaveCount(0);expect(errors).toEqual([]);
});

test('paused preferences require A before changing a slider',async({page})=>{
  await boot(page,false);await openLocalLobby(page,'survival');await page.locator('#start-match').click();
  await expect(page.locator('canvas')).toBeVisible();await expect(page.locator('.match-loading')).toHaveCount(0);await expect(page.locator('#countdown')).toBeHidden();await page.keyboard.press('Escape');await page.locator('#pause-settings').click();
  const range=page.locator('#pause-settings-panel #music-volume');await expect(range).toBeVisible();const before=await range.inputValue();
  await range.focus();await range.press('Enter');await pulse(page,15);await expect(range).toHaveValue(before);
  await range.focus();await range.press('Enter');await pulse(page,0);await pulse(page,14);expect(await range.inputValue()).not.toBe(before);
  await pulse(page,1);await expect(range).toHaveValue(before);await expect(page.locator('#pause-settings-panel')).toBeVisible();
});

test('network preference marker and native select share explicit edit lifecycle',async({page})=>{
  await page.goto('/?muted=1');
  await page.evaluate(async()=>{
    // Isolated network-settings component: no multiplayer or connection claim.
    const {MenuFocusController}=await import('/src/ui/menuNavigation.ts' as string);
    const root=document.createElement('div');root.id='edit-fixture';root.innerHTML='<section data-network-preferences style="display:flex;gap:80px"><input type="range" min="0" max="100" value="50" data-ui-focus><select data-ui-focus><option>One</option><option>Two</option></select><input type="checkbox" data-ui-focus></section>';
    document.body.append(root);
    const pad={index:0,id:'Fixture',connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};
    const controller=new MenuFocusController(root,{onBack:()=>{(window as any).fixtureBack=((window as any).fixtureBack||0)+1;},readGamepads:()=>[pad]});controller.activate('network');
    Object.assign(window,{editPad:pad,fixtureController:controller});
  });
  const root=page.locator('#edit-fixture'),range=root.locator('input[type=range]'),select=root.locator('select'),checkbox=root.locator('input[type=checkbox]');
  await pulse(page,15);await expect(range).toHaveValue('50');await expect(select).toBeFocused();
  await pulse(page,15);await expect(select).toHaveValue('One');await expect(checkbox).toBeFocused();
  await pulse(page,14);await pulse(page,0);await expect(select).toHaveAttribute('data-gamepad-editing','true');
  await pulse(page,15);await expect(select).toHaveValue('Two');await pulse(page,1);await expect(select).toHaveValue('One');
  expect(await page.evaluate(()=>(window as any).fixtureBack||0)).toBe(0);
  await pulse(page,14);await pulse(page,0);await pulse(page,15);await expect(range).toHaveValue('51');
  await page.evaluate(()=>(window as any).fixtureController.suspend());await expect(range).not.toHaveAttribute('data-gamepad-editing');
  await page.evaluate(()=>{(window as any).fixtureController.destroy();document.querySelector('#edit-fixture')!.remove();});
});
