import { expect, test } from '@playwright/test';

for (const viewport of [{width:1440,height:960},{width:1280,height:480},{width:800,height:620},{width:390,height:844}]) {
  test(`Start is prominent and centered in supported mode setups ${viewport.width}x${viewport.height}`, async ({page}) => {
    await page.setViewportSize(viewport);
    const mobile = viewport.width < 700;
    for (const mode of mobile ? ['Выживание','Битва'] : ['Выживание','Битва','Командный бой']) {
      await page.goto('/?muted=1');
      await page.getByRole('button',{name:new RegExp(`^${mode}`)}).click();
      const start = page.locator('#start-match');
      await expect(start).toBeVisible();
      const geometry = await start.evaluate(el => {
        const r = el.getBoundingClientRect();
        const scale = document.querySelector('.desktop-menu-stage')?.getBoundingClientRect().width;
        const footer = el.closest('footer')!;
        const back = footer.querySelector('.input-back')?.parentElement?.getBoundingClientRect();
        const roster = footer.querySelector('.input-roster')?.parentElement?.getBoundingClientRect();
        return {center:(r.left+r.right)/2,width:r.width,height:r.height,scale:scale ? scale/1120 : 1,
          leftOfStart:!back || back.right <= r.left,rightOfStart:!roster || roster.left >= r.right,
          clipped:el.scrollWidth > el.clientWidth+1 || el.scrollHeight > el.clientHeight+1,
          inside:r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight};
      });
      expect(Math.abs(geometry.center-viewport.width/2)).toBeLessThanOrEqual(1);
      expect(geometry.width).toBeGreaterThanOrEqual((mobile ? 300 : 250)*geometry.scale);
      expect(geometry.height).toBeGreaterThanOrEqual((mobile ? 60 : 56)*geometry.scale);
      expect(geometry).toMatchObject({leftOfStart:true,rightOfStart:true,clipped:false,inside:true});
      if (mode === 'Битва' && viewport.width !== 800) await page.screenshot({path:`evidence/center-start-button/setup-${viewport.width}x${viewport.height}.png`});
    }
  });
}
