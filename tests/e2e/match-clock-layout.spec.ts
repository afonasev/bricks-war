import { openLocalLobby } from '../helpers/localLobby';
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
const evidence = process.env.BRICKS_CLOCK_SCREENSHOTS;
for (const players of [1, 2, 3, 4]) {
  test(`docks the wooden clock at the top-right with ${players} players through resize`, async ({page}) => {
    await page.goto('/?muted=1');
    await openLocalLobby(page,players===1?'survival':'battle');
    while (await page.locator('[data-remove-slot]').count() > players) await page.locator('[data-remove-slot]').last().click();
    while (await page.locator('[data-remove-slot]').count() < players) await page.getByRole('button',{name:'Добавить ИИ',exact:true}).first().click();
    await page.locator('#start-match').click();
    await expect(page.locator('.hud-card')).toHaveCount(players);
    await expect(page.locator('.match-loading')).toHaveCount(0);
    await expect(page.locator('#countdown')).toBeHidden({timeout:6000});
    await expect(page.locator('#arena-event-notice')).toBeHidden({timeout:6000});
    const phaseColors = await page.locator('#round-timer').evaluate(timer=>{
      const value=timer.querySelector('#match-clock')!;
      const normal=getComputedStyle(value).color;
      timer.classList.add('is-final'); const final=getComputedStyle(value).color;
      timer.classList.remove('is-final'); return {normal,final};
    });
    expect(phaseColors.final).not.toBe(phaseColors.normal);
    for (const viewport of [{width:3840,height:2160},{width:1440,height:960},{width:1440,height:963},{width:900,height:720},{width:800,height:1000},{width:1280,height:480}]) {
      await page.setViewportSize(viewport);
      await expect.poll(async () => {
        const timer=await page.locator('#match-clock').boundingBox();
        if (!timer) return 999;
        const cards=await page.locator('.hud-card').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));
        if (cards.some(c=>c.left<0 || c.right>viewport.width || c.top<0 || c.bottom>viewport.height)) return 999;
        const center=(Math.min(...cards.map(c=>c.left))+Math.max(...cards.map(c=>c.right)))/2;
        return Math.abs(timer.y)+Math.abs(viewport.width-timer.x-timer.width)+Math.abs(center-viewport.width/2);
      }).toBeLessThan(2);
      const clock=await page.locator('#match-clock').boundingBox();
      const cards=await page.locator('.hud-card').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}}));
      // HUD refreshes replace nodes; query and measure connected feet in one browser task.
      const feet=await page.evaluate(()=>[...document.querySelectorAll('.wood-panel-foot')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}}));
      expect(cards.every(c=>c.top>=0 && c.bottom<=viewport.height && c.left>=0 && c.right<=viewport.width)).toBe(true);
      expect(Math.abs(Math.min(...feet.map(c=>c.left))-(viewport.width-Math.max(...feet.map(c=>c.right))))).toBeLessThan(1);
      for (const a of cards) {
        expect(a.left<clock!.x+clock!.width && clock!.x<a.right && a.top<clock!.y+clock!.height && clock!.y<a.bottom).toBe(false);
        for (const b of cards) {
          if (a !== b && Math.abs(a.top-b.top)<1 && b.left>a.left) expect(b.left-a.right).toBeGreaterThanOrEqual(48);
          if (a !== b && Math.abs(a.left-b.left)<1 && b.top>a.top) expect(b.top-a.bottom).toBeGreaterThanOrEqual(48);
        }
      }
      for(let i=1;i<feet.length;i++) if(Math.abs(feet[i]!.top-feet[i-1]!.top)<1)
        expect(feet[i]!.left-feet[i-1]!.right).toBeCloseTo(32,0);
      await expect(page.locator('.arena-backdrop')).toHaveAttribute('aria-hidden','true');
      const decorated = Math.min(...cards.map(c=>c.left))-8 >= Math.max(180,viewport.width*.12);
      expect(await page.locator('.arena-backdrop').evaluate(e=>getComputedStyle(e).display!=='none')).toBe(decorated);
      const foliage=page.locator('.arena-foliage');
      if(decorated) await expect(foliage).toBeVisible(); else await expect(foliage).toBeHidden();
      if(decorated){
        const leaf=await foliage.boundingBox();
        expect(leaf!.x).toBe(0); expect(leaf!.y).toBe(0);
        expect(leaf!.x+leaf!.width).toBeLessThan(Math.min(...cards.map(c=>c.left))-8);
        expect(leaf!.y+leaf!.height).toBeLessThanOrEqual(viewport.height);
      }

      const clipped = await page.locator('.hud-card').evaluateAll(nodes=>nodes.flatMap(card=>{
        const bounds=card.getBoundingClientRect();
        return [...card.querySelectorAll('.hud-identity strong,.hud-stats b,.hud-stats span')].filter(label=>{
          const range=document.createRange();range.selectNodeContents(label);const r=range.getBoundingClientRect();
          return r.left<bounds.left-1 || r.right>bounds.right+1 || r.top<bounds.top-1;
        }).map(label=>label.textContent);
      }));
      expect(clipped).toEqual([]);

      expect(await page.locator('#match-clock').evaluate(e=>getComputedStyle(e).borderTopWidth)).toBe('0px');
      expect(await page.locator('#match-clock').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(33);
      await expect(page.locator('#round-timer')).toHaveText(/^\d{2}:\d{2}$/);
      if(evidence && viewport.height !== 963){fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:`${evidence}/desktop-${players}-${viewport.width}x${viewport.height}.png`});}
    }
  });
}
test('preserves phone clock and touch pause',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/?muted=1');
  await openLocalLobby(page,'survival');
  await page.locator('#start-match').click();
  await expect(page.locator('.match-loading')).toHaveCount(0);
    await expect(page.locator('#countdown')).toBeHidden({timeout:6000});
    await expect(page.locator('#arena-event-notice')).toBeHidden({timeout:6000});
  await expect(page.locator('#mobile-match-timer')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.locator('#round-timer')).toHaveCount(0);
  if(evidence)await page.screenshot({path:`${evidence}/phone-390x844.png`});
  await page.locator('#manual-pause').click();
  await expect(page.locator('#pause-overlay')).toBeVisible();
});
