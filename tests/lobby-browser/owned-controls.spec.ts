import {test,expect,type Page} from '@playwright/test';
const evidence=process.env.BRICKS_LOBBY_EVIDENCE??'evidence/refine-owned-lobby-controls/runtime';
async function boot(page:Page){
 await page.addInitScript(()=>{
  localStorage.setItem('bricks-war:language:v1','ru');
  localStorage.setItem('bricks-war:gamepad-profiles:v2',JSON.stringify(['Алиса','Катя','Миша','Оля','Тимур'].map((name,i)=>({id:'qa-'+i,device:'keyboard',name,uses:10-i}))));
  const pads=[0,1,2].map(index=>({index,id:index===1?'Sony DualSense':index===2?'Nintendo Switch':'Xbox QA 0',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0}));
  Object.defineProperty(navigator,'getGamepads',{value:()=>pads});Object.assign(window,{ownedPads:pads});
 });
 await page.goto('/?muted=1');await expect(page.locator('[data-play-entry]')).toBeVisible();
}
async function button(page:Page,index:number,button:number,down:boolean){await page.evaluate(({index,button,down})=>{(window as any).ownedPads[index].buttons[button].pressed=down},{index,button,down});}
async function pulse(page:Page,index:number,code:number){await button(page,index,code,true);await page.waitForTimeout(110);await button(page,index,code,false);await page.waitForTimeout(110);}
async function holdY(page:Page,index:number){await button(page,index,3,true);await page.waitForTimeout(850);await button(page,index,3,false);await page.waitForTimeout(110);}
async function layout(page:Page,scroll=false){
 const issues=await page.locator('.unified-lobby').evaluate((root,scroll)=>{
  const visible=(e:Element)=>{const r=e.getBoundingClientRect();return !!r.width&&!!r.height&&!e.closest('[hidden]')};
  const controls=[...root.querySelectorAll<HTMLElement>('button,input')].filter(visible);
  const overlaps=controls.flatMap((a,i)=>controls.slice(i+1).filter(b=>{if(a.contains(b)||b.contains(a))return false;const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.min(x.right,y.right)>Math.max(x.left,y.left)+1&&Math.min(x.bottom,y.bottom)>Math.max(x.top,y.top)+1}).map(b=>[a.textContent,b.textContent]));
  const clipped=controls.filter(e=>{const r=e.getBoundingClientRect();const card=e.closest('.lobby-card')?.getBoundingClientRect();return e.scrollWidth>e.clientWidth+1||r.left<0||r.right>innerWidth+1||!scroll&&(r.top<0||r.bottom>innerHeight+1)||card&&(r.bottom>card.bottom+1||r.top<card.top-1)}).map(e=>e.textContent);
  return {overlaps,clipped,wide:document.documentElement.scrollWidth>innerWidth+1};
 },scroll);
 expect(issues).toEqual({overlaps:[],clipped:[],wide:false});
}
test('keyboard retains setting focus, editor focus, immediate typing and direct choices',async({page})=>{
 await boot(page);await page.keyboard.press('Enter');
 await page.keyboard.press('ArrowRight');await expect(page.locator('#match-duration')).toBeFocused();
 await page.keyboard.press('Enter');await page.keyboard.press('Enter');await expect(page.locator('#match-duration')).toHaveAttribute('data-value','3');await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','battle');await expect(page.locator('#match-duration')).toBeFocused();
 await page.keyboard.press('w');const draft=page.locator('[data-lobby-slot="1"]');await expect(draft.locator('[data-wheel-center]')).toHaveText('Гость');await expect(draft.locator('[data-wheel-center]')).toBeFocused();
 await page.keyboard.press('ArrowUp');await expect(draft.locator('[data-wheel-center]')).toContainText('Создать новое');await page.keyboard.press('Enter');
 const input=draft.locator('[data-typing-name]');await expect(input).toBeFocused();await input.fill('Анна');await page.keyboard.press('Enter');await expect(draft.locator('.lobby-theme-list')).toBeVisible();await expect(draft.locator('[data-style="random"]')).toBeFocused();
 await draft.locator('[data-style="forest-mosaic"]').click();await expect(page.locator('[data-edit="1"] h2')).toHaveText('Анна');await expect(page.locator('[data-edit="1"]')).toBeFocused();
 await expect(page.locator('.lobby-card-hint')).toHaveCount(0);await expect(page.locator('.lobby-confirm-hint')).toBeHidden();await expect(page.locator('[data-bot] .lobby-key')).toBeHidden();await expect(page.locator('[data-join] .lobby-key')).toBeVisible();
 await page.locator('[data-bot]').click();await page.locator('[data-level="expert"]').click();await expect(page.locator('#start-match')).toBeEnabled();await layout(page);await page.screenshot({path:evidence+'/mouse-ready.png'});
 await page.locator('#start-match').click();await expect(page.locator('.hud-card')).toHaveCount(3);await expect(page.locator('.hud-identity strong')).toContainText(['Игрок 1','Анна','ИИ · ЭКСПЕРТ']);
});
test('entry pad alone controls globals; Y skips people, swaps bots, hold edits and guests stay local',async({page})=>{
 await boot(page);await pulse(page,0,0);await expect(page.locator('.unified-lobby')).toHaveAttribute('data-menu-owner','gamepad-0');
 await pulse(page,0,2);await expect(page.locator('[data-level]')).toHaveCount(4);await pulse(page,0,0);await expect(page.locator('[data-edit="1"] h2')).toContainText('Бот');
 await pulse(page,1,3);await expect(page.locator('[data-lobby-slot="2"] [data-wheel-center]')).toHaveText('Гость');await page.screenshot({path:evidence+'/pad-name.png'});await pulse(page,1,0);await expect(page.locator('.lobby-theme-wheel')).toBeVisible();await layout(page);await page.screenshot({path:evidence+'/pad-theme.png'});await pulse(page,1,13);await pulse(page,1,0);await expect(page.locator('[data-edit="2"] h2')).toHaveText('Игрок 2');
 const mode=await page.locator('.unified-lobby').getAttribute('data-mode');for(const code of [15,13,0,1,2,9])await pulse(page,1,code);await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode',mode!);await expect(page.locator('.is-editing')).toHaveCount(0);await expect(page.locator('.hud-card')).toHaveCount(0);
 await page.locator('[data-cycle-mode]').click({force:true});await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode',mode!); // pointer cannot steal shared navigation
 await pulse(page,1,3);await expect(page.locator('[data-edit="3"] h2')).toHaveText('Игрок 2');await pulse(page,1,3);await expect(page.locator('[data-edit="1"] h2')).toHaveText('Игрок 2');await expect(page.locator('[data-edit="3"] h2')).toContainText('Бот');await expect(page.locator('[data-edit="3"] .lobby-style-label')).toHaveText('Случайный');
 await holdY(page,1);await expect(page.locator('[data-lobby-slot="1"].is-editing')).toBeVisible();await expect(page.locator('[data-lobby-slot="1"] .lobby-theme-wheel')).toBeVisible();await pulse(page,2,1);await expect(page.locator('.is-editing')).toHaveCount(1);await pulse(page,1,1);await expect(page.locator('.is-editing')).toHaveCount(0);
 await holdY(page,0);await expect(page.locator('[data-lobby-slot="0"].is-editing')).toBeVisible();await pulse(page,1,1);await expect(page.locator('[data-lobby-slot="0"].is-editing')).toBeVisible();await pulse(page,0,1);
 await expect(page.locator('[data-bot] .input-ai')).toBeVisible();await expect(page.locator('[data-lobby-back] .input-back')).toBeVisible();await layout(page);await page.screenshot({path:evidence+'/pad-ready.png'});
 // A fresh connection at the owner's index cannot inherit global authority.
 await page.evaluate(()=>{(window as any).ownedPads[0].connected=false});await page.waitForTimeout(120);await page.evaluate(()=>{const p=(window as any).ownedPads[0];p.connected=true;p.id='Replacement pad'});await page.waitForTimeout(120);await pulse(page,0,0);await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode',mode!);await expect(page.locator('.is-editing')).toHaveCount(0);
});
for(const [width,height]of [[1440,960],[1280,720],[1280,480],[390,844]])test(`names, themes and bot zone remain readable ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width:width!,height:height!});await boot(page);await page.locator('[data-play-entry]').click();await page.locator('[data-edit="0"]').click();await expect(page.locator('[data-style]')).toHaveCount(7);await layout(page,width!<761);await page.screenshot({path:`${evidence}/themes-${width}x${height}.png`,fullPage:true});await page.keyboard.press('Escape');
 if(width!>760){await page.keyboard.press('w');await layout(page);await page.screenshot({path:`${evidence}/names-${width}x${height}.png`});await page.keyboard.press('Escape');}
 await page.locator('[data-bot] .lobby-plus').click();await expect(page.locator('[data-level]')).toHaveCount(4);await layout(page,width!<761);await page.locator('[data-level="medium"]').click();await expect(page.locator('[data-edit="1"]')).toBeVisible();
});

test('parallel pad typing preserves cancellation, uniqueness, family hints and match consumers',async({page})=>{
 await boot(page);await page.locator('[data-play-entry]').click();
 await pulse(page,0,3);await pulse(page,1,3);
 for(const index of [0,1]){await pulse(page,index,12);await pulse(page,index,0);}
 await expect(page.locator('.is-typing')).toHaveCount(2);
 const first=page.locator('[data-lobby-slot="1"]'),second=page.locator('[data-lobby-slot="2"]');
 await expect(first.locator('[data-typing-back] .input-back')).toHaveText('B');await expect(second.locator('[data-typing-back] .input-back')).toHaveText('○');
 await pulse(page,0,0);await pulse(page,1,0);await expect(first.locator('[data-typing-name]')).toHaveValue('Й');await expect(second.locator('[data-typing-name]')).toHaveValue('Й');
 await pulse(page,0,3);await expect(first.locator('.lobby-theme-wheel')).toBeVisible();await pulse(page,1,3);await expect(second).toHaveClass(/is-typing/);await expect(second.locator('[data-typed-done]')).toBeDisabled();
 await pulse(page,1,15);await pulse(page,1,0);await expect(second.locator('[data-typing-name]')).toHaveValue('ЙЦ');await pulse(page,1,3);await expect(second.locator('.lobby-theme-wheel')).toBeVisible();
 await pulse(page,0,0);await pulse(page,1,0);await expect(first.locator('h2')).toHaveText('Й');await expect(second.locator('h2')).toHaveText('ЙЦ');
 await expect(page.locator('.lobby-confirm-hint')).toBeHidden();await page.locator('#start-match').click();await expect(page.locator('.hud-card')).toHaveCount(3);await expect(page.locator('.hud-identity strong')).toHaveText(['Игрок 1','Й','ЙЦ']);
});
test('entry pad Start admits the roster and keyboard cannot change globals while a guest edits',async({page})=>{
 await boot(page);await pulse(page,0,0);await page.keyboard.press('w');await expect(page.locator('[data-lobby-slot="1"] [data-wheel-center]')).toHaveText('Гость');
 await page.keyboard.press('Enter');await page.locator('[data-lobby-slot="1"] [data-style="classic"]').click();
 await page.locator('#match-duration').press('Enter');await expect(page.locator('#match-duration')).toHaveAttribute('data-value','until-victory');await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode','battle');await expect(page.locator('.is-editing')).toHaveCount(0);
 await holdY(page,0);await expect(page.locator('.lobby-theme-wheel')).toBeVisible();await pulse(page,0,13);await pulse(page,0,0);
 await pulse(page,0,9);await expect(page.locator('.hud-card')).toHaveCount(2);await expect(page.locator('.hud-identity strong')).toHaveText(['Игрок 1','Игрок 2']);
});
test('held X through the rules overlay cannot remove a card or add a bot on return',async({page})=>{
 await boot(page);await pulse(page,0,0);await pulse(page,0,2);await pulse(page,0,0);await expect(page.locator('[data-edit]')).toHaveCount(2);
 for(let i=0;i<4;i++)await pulse(page,0,15);await pulse(page,0,0);await expect(page.getByRole('dialog')).toBeVisible();
 await button(page,0,2,true);await page.waitForTimeout(150);await pulse(page,0,1);await expect(page.getByRole('dialog')).toHaveCount(0);await page.waitForTimeout(900);await expect(page.locator('[data-edit]')).toHaveCount(2);await expect(page.locator('.is-editing')).toHaveCount(0);await button(page,0,2,false);
});
