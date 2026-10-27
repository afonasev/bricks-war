import {test,expect,type Page} from '@playwright/test';
const out=process.env.BRICKS_LOBBY_EVIDENCE??'evidence/refine-owned-lobby-controls/F8/runtime';
async function boot(page:Page){await page.addInitScript(()=>{
 localStorage.setItem('bricks-war:language:v1','ru');
 localStorage.setItem('bricks-war:gamepad-profiles:v2',JSON.stringify(['Александра-Виктория','Катя','Миша','Оля','Тимур'].map((name,i)=>({id:'size-'+i,device:'keyboard',name,uses:10-i}))));
 const pads=[0,1].map(index=>({index,id:'Card size QA '+index,mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0}));
 Object.defineProperty(navigator,'getGamepads',{value:()=>pads});Object.assign(window,{sizePads:pads});
 });await page.goto('/?muted=1');await page.locator('[data-play-entry]').click();}
async function pulse(page:Page,button:number){await page.evaluate(i=>{(window as any).sizePads[1].buttons[i].pressed=true},button);await page.waitForTimeout(110);await page.evaluate(i=>{(window as any).sizePads[1].buttons[i].pressed=false},button);await page.waitForTimeout(110);}
async function rects(page:Page){return page.locator('.lobby-card').evaluateAll(cards=>cards.map(e=>{const r=e.getBoundingClientRect();return {slot:e.getAttribute('data-lobby-slot'),x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}}));}
async function contained(page:Page){
 const issues=await page.locator('.lobby-cards').evaluate(root=>{
  const cards=[...root.querySelectorAll<HTMLElement>('.lobby-card')];
  const clipped=cards.flatMap(card=>{const c=card.getBoundingClientRect();return [...card.querySelectorAll<HTMLElement>('button,input,h2,.lobby-card-mark,.lobby-style-label')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&(r.left<c.left-1||r.right>c.right+1||r.top<c.top-1||r.bottom>c.bottom+1||e.scrollWidth>e.clientWidth+1)}).map(e=>({slot:card.dataset.lobbySlot,text:e.textContent,rect:e.getBoundingClientRect().toJSON()}))});
  const controls=[...root.querySelectorAll<HTMLElement>('button,input')].filter(e=>e.getBoundingClientRect().width>0);
  const overlaps=controls.flatMap((a,i)=>controls.slice(i+1).filter(b=>{if(a.contains(b)||b.contains(a))return false;const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.min(x.right,y.right)>Math.max(x.left,y.left)+1&&Math.min(x.bottom,y.bottom)>Math.max(x.top,y.top)+1}).map(b=>[a.textContent,b.textContent]));
  return {clipped,overlaps,wide:document.documentElement.scrollWidth>innerWidth+1};
 });expect(issues).toEqual({clipped:[],overlaps:[],wide:false});
}
for(const [width,height] of [[1440,960],[1280,720],[1280,480],[390,844]] as const)test(`card size and position stay fixed through every editor ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width,height});await boot(page);const baseline=await rects(page);
 async function stable(){const now=await rects(page);expect(now.slice(0,baseline.length)).toEqual(baseline);expect(new Set(now.map(r=>r.width+':'+r.height)).size).toBe(1);await contained(page);}
 await stable();await page.locator('[data-bot]').first().click();await stable();await page.locator('[data-level="hard"]').click();await stable();
 await pulse(page,3);await expect(page.locator('.lobby-name-wheel')).toBeVisible();await stable();await page.screenshot({path:`${out}/mixed-name-${width}x${height}.png`,fullPage:true});
 await pulse(page,12);await pulse(page,0);await expect(page.locator('.lobby-name-keys')).toBeVisible();await stable();await page.screenshot({path:`${out}/mixed-typing-${width}x${height}.png`,fullPage:true});
 await pulse(page,1);await stable();await pulse(page,1);await stable();await page.locator('[data-edit="0"]').click();await expect(page.locator('.lobby-theme-list')).toBeVisible();await stable();await page.screenshot({path:`${out}/mixed-theme-${width}x${height}.png`,fullPage:true});
});
