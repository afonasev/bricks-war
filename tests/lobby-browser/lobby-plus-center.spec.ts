import {test,expect} from '@playwright/test';
import {openLocalLobby} from '../helpers/localLobby';
for(const [width,height] of [[1440,960],[1280,480]])test(`empty-slot plus centered ${width}`,async({page})=>{
 await page.setViewportSize({width:width!,height:height!});await page.addInitScript(()=>localStorage.setItem('bricks-war:language:v1','en'));await page.goto('/?muted=1');await openLocalLobby(page,'survival');
 for(const mode of ['survival','battle','team-battle']){
  await expect(page.locator('.unified-lobby')).toHaveAttribute('data-mode',mode);
  const card=page.locator('.lobby-card.is-empty').first();const plus=card.locator('.lobby-plus');await expect(plus).toBeVisible();
  const box=await plus.evaluate(e=>{const c=e.closest('.lobby-card')!.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);const r=range.getBoundingClientRect();return {offset:Math.abs((r.left+r.right-c.left-c.right)/2),inside:r.top>=c.top&&r.bottom<=c.bottom};});expect(box.offset).toBeLessThanOrEqual(1);expect(box.inside).toBe(true);
  const join=card.locator('[data-join]');await expect(join).toBeVisible();const a=await plus.boundingBox(),b=await join.boundingBox();expect(a!.y+a!.height).toBeLessThanOrEqual(b!.y);
  await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/${mode}-${width}.png`});if(mode!=='team-battle')await page.locator('[data-cycle-mode]').click();
 }
});
