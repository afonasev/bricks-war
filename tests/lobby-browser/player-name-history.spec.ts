import { test, expect, type Page } from '@playwright/test';
const evidence = process.env.BRICKS_LOBBY_EVIDENCE!;
async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('bricks-war:language:v1', 'ru');
    const pads = [0,1].map(index => ({index,id:'Xbox QA '+index,mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0}));
    Object.defineProperty(navigator,'getGamepads',{value:()=>pads});
    Object.assign(window,{namePads:pads});
  });
  await page.goto('/?muted=1');
  await page.locator('[data-play-entry]').click();
}
async function pulse(page:Page, code:number, index=0) {
  await page.evaluate(({index,code}) => { (window as any).namePads[index].buttons[code].pressed=true; },{index,code});
  await page.waitForTimeout(100);
  await page.evaluate(({index,code}) => { (window as any).namePads[index].buttons[code].pressed=false; },{index,code});
  await page.waitForTimeout(100);
}
async function storedNames(page:Page) {
  return page.evaluate(()=>JSON.parse(localStorage.getItem('bricks-war:gamepad-profiles:v2')??'[]').map((p:any)=>p.name));
}
for (const [width,height] of [[1440,960],[1280,480],[390,844]]) test(`controller case switching and Y persist immediately; other controller cannot apply ${width}`, async({page})=>{
  await page.setViewportSize({width:width!,height:height!});
  await boot(page); await pulse(page,3); await pulse(page,12); await pulse(page,0);
  const card=page.locator('[data-lobby-slot="1"]');
  await expect(card.locator('[data-typing-name]')).toHaveValue('');
  await pulse(page,0); // Й
  for(let i=0;i<3;i++) await pulse(page,13);
  // Reach the case key with the same controller that owns the draft.
  for(let i=0;i<8;i++) {
    if(await card.locator('[data-keyboard-case]').evaluate(e=>e.classList.contains('pad-selected'))) break;
    await pulse(page,15);
  }
  await expect(card.locator('[data-keyboard-case]')).toHaveClass(/pad-selected/);
  await pulse(page,0);
  await expect(card.locator('[data-letter="й"]')).toBeVisible();
  const geometry = await card.evaluate(root => {
    const elements = [...root.querySelectorAll<HTMLElement>('button,input')].filter(e=>e.getClientRects().length);
    const bounds = root.getBoundingClientRect();
    return {
      clipped: elements.filter(e=>{const r=e.getBoundingClientRect();return e.scrollWidth>e.clientWidth+1||r.left<bounds.left||r.right>bounds.right||r.bottom>bounds.bottom||r.top<bounds.top;}).map(e=>e.textContent),
      overlaps: elements.flatMap((a,i)=>elements.slice(i+1).filter(b=>{const r=a.getBoundingClientRect(),q=b.getBoundingClientRect();return Math.min(r.right,q.right)>Math.max(r.left,q.left)+1&&Math.min(r.bottom,q.bottom)>Math.max(r.top,q.top)+1;}).map(b=>[a.textContent,b.textContent]))
    };
  });
  expect(geometry).toEqual({clipped:[],overlaps:[]});
  await page.screenshot({path:`${evidence}/controller-lowercase-${width}.png`,fullPage:true});
  // Return to the first letter using controller navigation.
  for(let i=0;i<3;i++) await pulse(page,12);
  for(let i=0;i<12;i++) await pulse(page,14);
  await pulse(page,0);
  await expect(card.locator('[data-typing-name]')).toHaveValue('Йй');
  await pulse(page,3,1); // a different controller joins; it cannot save this draft
  await expect(card.locator('[data-typing-name]')).toBeVisible();
  await pulse(page,3);
  await expect(card.locator('.lobby-theme-wheel')).toBeVisible();
  expect(await storedNames(page)).toContain('Йй'); // no style confirmation required
  await page.reload(); await page.locator('[data-play-entry]').click();
  await pulse(page,3); await pulse(page,13);
  await expect(page.locator('[data-lobby-slot="1"] [data-wheel-center]')).toHaveText('Йй');
});
for(const [width,height] of [[1440,960],[390,844]]) test(`mouse name confirmation survives cancelled style and reload ${width}`,async({page})=>{
  await page.setViewportSize({width:width!,height:height!}); await boot(page);
  // On phones the first human is replaced only after removing its card.
  if(width!<761) await page.locator('[data-remove="0"]').click();
  await page.locator('[data-join]').first().click();
  const card=page.locator('.is-editing');
  await card.locator('[data-wheel-up]').click(); await card.locator('[data-wheel-center]').click();
  await card.locator('[data-typing-name]').fill('Анна');
  await page.screenshot({path:`${evidence}/mouse-name-${width}.png`,fullPage:true});
  await card.locator('[data-typed-done]').click();
  expect(await storedNames(page)).toContain('Анна');
  await card.locator('[data-cancel]').click();
  await page.reload(); await page.locator('[data-play-entry]').click();
  expect(await storedNames(page)).toContain('Анна');
  // A second confirmed name must retain the first one.
  if(width!<761) await page.locator('[data-remove="0"]').click();
  await page.locator('[data-join]').first().click();
  await page.locator('.is-editing [data-wheel-up]').click();
  await page.locator('.is-editing [data-wheel-center]').click();
  await page.locator('[data-typing-name]').fill('Борис');
  await page.locator('[data-typed-done]').click();
  expect(await storedNames(page)).toEqual(expect.arrayContaining(['Анна','Борис']));
});

test('actual match start updates recency; selecting a saved name does not; rendered list puts recent player first',async({page})=>{
  await page.addInitScript(()=>{
    if(!localStorage.getItem('name-history-seeded')) {
      localStorage.setItem('bricks-war:gamepad-profiles:v2',JSON.stringify([
        {id:'a',device:'keyboard',name:'Частый',uses:100,lastUsed:200},
        {id:'b',device:'keyboard',name:'Давний',uses:1,lastUsed:100},
      ])); localStorage.setItem('name-history-seeded','1');
    }
  });
  await boot(page); await page.locator('[data-join]').first().click();
  const card=page.locator('.is-editing');
  await card.locator('[data-wheel-down]').click();
  await expect(card.locator('[data-wheel-center]')).toHaveText('Частый');
  await card.locator('[data-wheel-down]').click();
  await expect(card.locator('[data-wheel-center]')).toHaveText('Давний');
  await card.locator('[data-wheel-center]').click();
  await card.locator('[data-wheel-center]').click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bricks-war:gamepad-profiles:v2')!).find((p:any)=>p.name==='Давний').lastUsed)).toBe(100);
  await page.locator('#start-match').click();
  await expect(page.locator('.hud-card')).toHaveCount(2);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bricks-war:gamepad-profiles:v2')!).find((p:any)=>p.name==='Давний').lastUsed)).toBeGreaterThan(200);
  await page.reload(); await page.locator('[data-play-entry]').click();
  // Fresh lobby begins with its default roster; history order survives reload.
  await page.locator('[data-join]').first().click();
  await page.locator('.is-editing [data-wheel-down]').click();
  await expect(page.locator('.is-editing [data-wheel-center]')).toHaveText('Давний');
});
