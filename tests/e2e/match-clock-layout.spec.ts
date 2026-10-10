import { expect, test } from '@playwright/test';
import fs from 'node:fs';
const evidence = process.env.BRICKS_CLOCK_SCREENSHOTS;
for (const players of [1, 4]) {
  test(`centers the clock in actual free space with ${players} players through resize`, async ({page}) => {
    await page.goto('/?muted=1');
    await page.getByRole('button',{name:players === 1 ? /^Выживание/ : /^Битва/}).click();
    if (players === 1 && await page.getByRole('button',{name:'Удалить Игрок 2'}).count()) await page.getByRole('button',{name:'Удалить Игрок 2'}).click();
    if (players === 4) while (await page.getByRole('button',{name:'Добавить ИИ',exact:true}).count()) await page.getByRole('button',{name:'Добавить ИИ',exact:true}).first().click();
    await page.getByRole('button',{name:'Начать',exact:true}).click();
    await expect(page.locator('.hud-card')).toHaveCount(players);
    await expect(page.locator('.match-loading')).toHaveCount(0);
    await expect(page.locator('#countdown')).toBeHidden({timeout:6000});
    await expect(page.locator('#arena-event-notice')).toBeHidden({timeout:6000});
    for (const viewport of [{width:1440,height:960},{width:1440,height:963},{width:900,height:720},{width:800,height:1000},{width:1280,height:480}]) {
      await page.setViewportSize(viewport);
      await expect.poll(async () => {
        const boxes=await page.locator('.hud-card').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}}));
        const timer=await page.locator('#match-clock').boundingBox();
        if (!timer) return 999;
        return Math.abs(timer.y+timer.height/2 - Math.min(...boxes.map(b=>b.top))/2);
      }).toBeLessThan(2);
      const clock=await page.locator('#match-clock').boundingBox();
      const cards=await page.locator('.hud-card').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}}));
      expect(clock!.y).toBeGreaterThanOrEqual(0);
      expect(clock!.y+clock!.height).toBeLessThan(Math.min(...cards.map(b=>b.top)));
      expect(Math.abs(clock!.x+clock!.width/2-viewport.width/2)).toBeLessThan(1);
      expect(cards.every(c=>c.bottom<=viewport.height)).toBe(true);
      for (const a of cards) for (const b of cards) {
        if (a !== b && Math.abs(a.top-b.top)<1 && b.left>a.left) expect(b.left-a.right).toBeGreaterThanOrEqual(16);
        if (a !== b && Math.abs(a.left-b.left)<1 && b.top>a.top) expect(b.top-a.bottom).toBeGreaterThanOrEqual(16);
      }
      await expect(page.locator('.arena-backdrop')).toHaveAttribute('aria-hidden','true');
      expect(await page.locator('#match-clock').evaluate(e=>getComputedStyle(e).borderBottomWidth)).toBe('5px');
      expect(await page.locator('#match-clock').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThan(24);
      await expect(page.locator('#round-timer')).toHaveText(/^\d{2}:\d{2}$/);
      if(evidence && viewport.height !== 963){fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:`${evidence}/desktop-${players}-${viewport.width}x${viewport.height}.png`});}
    }
  });
}
test('preserves phone clock and touch pause',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/?muted=1');
  await page.getByRole('button',{name:/^Выживание/}).click();
  await page.getByRole('button',{name:'Начать',exact:true}).click();
  await expect(page.locator('.match-loading')).toHaveCount(0);
    await expect(page.locator('#countdown')).toBeHidden({timeout:6000});
    await expect(page.locator('#arena-event-notice')).toBeHidden({timeout:6000});
  await expect(page.locator('#mobile-match-timer')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.locator('#round-timer')).toHaveCount(0);
  if(evidence)await page.screenshot({path:`${evidence}/phone-390x844.png`});
  await page.locator('#manual-pause').click();
  await expect(page.locator('#pause-overlay')).toBeVisible();
});
