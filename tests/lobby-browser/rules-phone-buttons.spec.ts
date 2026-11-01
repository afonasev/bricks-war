import {test,expect} from '@playwright/test';
for(const [width,height] of [[390,844],[360,640],[320,568],[844,390]])test(`phone slide targets ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width:width!,height:height!});await page.addInitScript(()=>localStorage.setItem('bricks-war:language:v1','en'));
 await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();await page.locator('#open-rules').click();
 const buttons=page.locator('[data-rule-topic]');await expect(buttons).toHaveCount(8);
 const boxes=await buttons.evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};}));
 for(const r of boxes){expect(r.w).toBeGreaterThanOrEqual(48);expect(r.h).toBeGreaterThanOrEqual(48);expect(r.x).toBeGreaterThanOrEqual(0);expect(r.right).toBeLessThanOrEqual(width!);expect(r.bottom).toBeLessThanOrEqual(height!);}
 for(let i=0;i<8;i++){await buttons.nth(i).click();await expect(page.locator('#rules-progress')).toHaveText(`${i+1} / 8`);}
 await buttons.nth(0).click();await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/phone-${width}.png`});
});
