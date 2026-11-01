import {test,expect,type Page} from '@playwright/test';
const oldRecords=JSON.stringify([{id:'old',name:'Legacy',lineScore:9999,elapsedMs:300000,finishedAt:1700000000000}]);
const recordsKey='bricks-war:solo-records:v1';
async function setup(page:Page,pad=false){
 await page.addInitScript(({oldRecords,recordsKey,pad})=>{
  localStorage.setItem('bricks-war:language:v1','en');
  if(!sessionStorage.getItem('reset-fixture-seeded')){localStorage.setItem(recordsKey,oldRecords);localStorage.setItem('bricks-war:survival-profile:v1',JSON.stringify({name:'Saved name',controller:'human-1',tileStyle:'classic'}));sessionStorage.setItem('reset-fixture-seeded','1');}
  if(pad){const controller={index:0,id:'Xbox QA',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[controller]});(window as any).resetPad=controller;}
 },{oldRecords,recordsKey,pad});
 await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();
}
for(const [width,height]of [[1440,960],[1280,480],[390,844],[844,390]]as const)test(`local records confirm cancel persist ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width,height});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await setup(page);
 const profile=await page.evaluate(()=>localStorage.getItem('bricks-war:survival-profile:v1'));
 await page.locator('#reset-local-records').click();
 await expect(page.locator('[data-record-reset-confirm]')).toBeVisible();
 await expect(page.locator('[data-record-reset-cancel]')).toBeFocused();
 const geometry=await page.locator('[data-record-reset-confirm]').evaluate(e=>{
  const items=[...e.querySelectorAll<HTMLElement>('h2,p,button')];const rects=items.map(x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};});
  return {inside:rects.every(r=>r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1),readable:items.every(x=>x.scrollWidth<=x.clientWidth+1),disjoint:rects.every((a,i)=>rects.every((b,j)=>i===j||a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1))};
 });
 expect(geometry).toEqual({inside:true,readable:true,disjoint:true});
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/reset-confirm-${width}x${height}.png`});
 await page.locator('[data-record-reset-cancel]').click();
 expect(await page.evaluate(key=>localStorage.getItem(key),recordsKey)).toBe(oldRecords);
 await page.locator('#reset-local-records').click();await page.keyboard.press('Escape');
 await expect(page.locator('[data-record-reset-confirm]')).toBeHidden();await expect(page.locator('main[data-screen="settings"]')).toBeVisible();
 await page.locator('#reset-local-records').click();await page.locator('[data-record-reset-accept]').click();
 await expect(page.locator('[data-record-reset-status]')).toHaveText('Local records cleared.');
 expect(await page.evaluate(key=>localStorage.getItem(key),recordsKey)).toBe('[]');
 expect(await page.evaluate(()=>localStorage.getItem('bricks-war:survival-profile:v1'))).toBe(profile);
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/reset-done-${width}x${height}.png`});
 await page.reload();expect(await page.evaluate(key=>localStorage.getItem(key),recordsKey)).toBe('[]');
 expect(errors).toEqual([]);
});
test('controller can cancel with B and select confirm with direction and A',async({page})=>{
 await setup(page,true);
 const press=async(button:number)=>{await page.evaluate(b=>{(window as any).resetPad.buttons[b]={pressed:true,value:1};},button);await page.waitForTimeout(110);await page.evaluate(b=>{(window as any).resetPad.buttons[b]={pressed:false,value:0};},button);await page.waitForTimeout(110);};
 await page.locator('#reset-local-records').click();await press(1);await expect(page.locator('[data-record-reset-confirm]')).toBeHidden();
 expect(await page.evaluate(key=>localStorage.getItem(key),recordsKey)).toBe(oldRecords);
 await page.locator('#reset-local-records').click();await press(15);
 await expect(page.locator('[data-record-reset-accept]')).toBeFocused();
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/reset-controller.png`});
 await press(0);await expect(page.locator('[data-record-reset-status]')).toHaveText('Local records cleared.');
});
test('blocked local storage reports failure and preserves the record',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='bricks-war:solo-records:v1')throw new DOMException('Read only','QuotaExceededError');return original.call(this,key,value);};});
 await page.locator('#reset-local-records').click();await page.locator('[data-record-reset-accept]').click();
 await expect(page.locator('[data-record-reset-status]')).toHaveText('Could not clear records on this device.');
 expect(await page.evaluate(key=>localStorage.getItem(key),recordsKey)).toBe(oldRecords);
});
