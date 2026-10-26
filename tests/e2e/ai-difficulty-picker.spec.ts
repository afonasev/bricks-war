import { openLocalLobby } from '../helpers/localLobby';
import { expect, test, type Page } from '@playwright/test';
async function install(page: Page, slots = ['human-1','off','off','off'], id = 'Xbox Wireless Controller') {
 await page.addInitScript(({slots,id}) => {
  localStorage.setItem('bricks-war:slot-selections:v1',JSON.stringify(slots));
  const pad = {id,index:0,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,touched:false,value:0})),timestamp:0};
  Object.defineProperty(navigator,'getGamepads',{value:()=>[pad],configurable:true});
  Object.assign(window,{pickerPad:pad});
 },{slots,id});
 await page.goto('/?muted=1');
}
async function down(page: Page, button: number, pressed: boolean) {
 await page.evaluate(({button,pressed})=>{(window as any).pickerPad.buttons[button].pressed=pressed;},{button,pressed});
 await page.waitForTimeout(100);
}
async function press(page: Page, button: number) { await down(page,button,true);await down(page,button,false); }
const dialog = (page: Page) => page.locator('[data-ai-choice]');
for (const mode of ['Битва','Командный бой']) {
 test(`X selects AI difficulty, remembers it and isolates modal in ${mode}`,async({page})=>{
  await install(page);
  await openLocalLobby(page, mode);
  await down(page,2,true);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('.is-ui-selected')).toHaveText('Средняя');
  await page.waitForTimeout(250);
  await expect(page.locator('[data-ai-choice]')).toHaveCount(1);
  await down(page,2,false);
  await press(page,9); await press(page,3);
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('[data-slot-card].empty')).toHaveCount(3);
  await expect(page.locator('[data-slot="0"]')).toHaveValue('human-1');
  await press(page,13);
  await expect(dialog(page).locator('.is-ui-selected')).toHaveText('Сложная');
  await down(page,0,true);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('[data-slot="1"]')).toHaveValue('ai-hard');
  await page.waitForTimeout(250);
  await expect(page.locator('[data-slot-card].empty')).toHaveCount(2);
  await down(page,0,false);
  await press(page,2);
  await expect(dialog(page).locator('.is-ui-selected')).toHaveText('Сложная');
  await press(page,1);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('[data-slot-card].empty')).toHaveCount(2);
  await press(page,2); await press(page,12); await press(page,12); await press(page,0);
  await expect(page.locator('[data-slot="2"]')).toHaveValue('ai-easy');
  await press(page,2); await press(page,13); await press(page,13); await press(page,13); await press(page,0);
  await expect(page.locator('[data-slot="3"]')).toHaveValue('ai-expert');
  await press(page,2); await expect(dialog(page)).toHaveCount(0);
  await press(page,9);
  await expect(page.locator('.arena-screen')).toBeVisible();
 });
}
test('Start respects invalid roster and X stays inactive in Survival and main menu',async({page})=>{
 await install(page,['off','off','off','off']);
 await press(page,2); await expect(dialog(page)).toHaveCount(0);
 await openLocalLobby(page,'battle');
 await press(page,9); await expect(page.locator('[data-screen="battle"]')).toBeVisible();
 await page.getByRole('button',{name:'← Главное меню',exact:true}).click();
 await openLocalLobby(page,'survival');
 await press(page,2); await expect(dialog(page)).toHaveCount(0);
});
test('another modal blocks X and Start',async({page})=>{
 await install(page);
 await openLocalLobby(page,'battle');
 await page.getByLabel('Имя игрока 1').click();
 await expect(page.locator('[data-profile-choice]')).toBeVisible();
 await press(page,2); await press(page,9);
 await expect(dialog(page)).toHaveCount(0);
 await expect(page.locator('[data-profile-choice]')).toBeVisible();
});
for (const size of [{width:1440,height:960},{width:1280,height:480},{width:800,height:620},{width:390,height:844}]) {
 test(`AI picker and hints fit ${size.width}x${size.height}`,async({page})=>{
  await page.setViewportSize(size); await install(page);
  await openLocalLobby(page,'battle');
  await expect(page.locator('.footer-start kbd')).toHaveText('Start');
  await expect(page.locator('#start-match > span')).toHaveText('Начать матч');
  if(size.width>=700){
   await expect(page.locator('.release-footer-before-start')).toContainText('Выбрать');
   await expect(page.locator('.release-footer-before-start')).toContainText('Назад');
  }
  const footer = await page.locator('.release-footer-inner').evaluate(el => {
    const rects = [...el.querySelectorAll<HTMLElement>('.release-footer-action, .footer-start')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);
    return {inside:rects.every(r=>r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight),overlap:rects.some((a,i)=>rects.some((b,j)=>i!==j&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top))};
  });
  expect(footer).toEqual({inside:true,overlap:false});
  await page.screenshot({path:`evidence/gamepad-ai-difficulty-picker/setup-${size.width}x${size.height}.png`});
  await press(page,2);
  if(size.width<700){await expect(dialog(page)).toHaveCount(0);await expect(page.getByRole('combobox', {name:'Сложность ИИ',exact:true})).toBeVisible();return;}
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('.ai-choice-guidance')).toHaveCount(0);
  await expect(dialog(page)).not.toContainText('Выбрать');
  const audit = await dialog(page).evaluate(el=>{
   const r=el.getBoundingClientRect();
   const controls=[...el.querySelectorAll<HTMLElement>('button')].map(b=>({r:b.getBoundingClientRect(),clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1}));
   return {centerX:Math.abs((r.left+r.right)/2-innerWidth/2),centerY:Math.abs((r.top+r.bottom)/2-innerHeight/2),inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,clipped:controls.some(c=>c.clip),overlap:controls.some((a,i)=>controls.some((b,j)=>i!==j&&a.r.left<b.r.right&&a.r.right>b.r.left&&a.r.top<b.r.bottom&&a.r.bottom>b.r.top))};
  });
  expect(audit).toMatchObject({inside:true,clipped:false,overlap:false});
  expect(audit.centerX).toBeLessThanOrEqual(1);expect(audit.centerY).toBeLessThanOrEqual(1);
  await page.screenshot({path:`evidence/gamepad-ai-difficulty-picker/picker-${size.width}x${size.height}.png`});
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i < 6 ? 'Tab' : 'Shift+Tab');
    await expect(dialog(page).locator(':focus')).toHaveCount(1);
  }
 });
}
test('PlayStation face labels do not replace Start label',async({page})=>{
 await install(page,undefined,'DualSense Wireless Controller');
 await openLocalLobby(page,'battle');
 await expect(page.locator('.input-ai')).toHaveText('□');
 await expect(page.locator('.footer-start kbd')).toHaveText('Start');
 await press(page,2);await expect(dialog(page)).toBeVisible();
});

test('default medium confirms once and Y works again after closing',async({page})=>{
 await install(page);
 await openLocalLobby(page,'battle');
 await press(page,2); await press(page,0);
 await expect(page.locator('[data-slot="1"]')).toHaveValue('ai-medium');
 await press(page,3);
 await expect(page.locator('[data-slot="2"]')).toHaveValue('gamepad-0');
});
