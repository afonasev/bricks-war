import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

for (const viewport of [{width:1440,height:960},{width:1280,height:480},{width:390,height:844},{width:360,height:640},{width:844,height:390}]) {
  test(`short mode rules remain readable ${viewport.width}x${viewport.height}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await mkdir('evidence/add-visual-rules/rework-f1/mode-screenshots',{recursive:true});
    for (const mode of ['survival','battle']) {
      await page.goto('/');
      await page.locator(`[data-destination="${mode}"]`).click();
      const text = mode==='survival'
        ? page.locator('.survival-rules li').first().or(page.locator('.mobile-setup-card > p:not(.eyebrow)')).first()
        : page.locator('.mode-rules-battle li').last().or(page.locator('.mobile-mode-rule')).first();
      await expect(text).toContainText(/очки|очкам/);
      if(mode==='survival') await expect(text).toContainText('Атак нет');
      const fit=await text.evaluate(el=>{
        const r=el.getBoundingClientRect();
        return {clipped:el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+1,visible:r.left>=-1 && r.right<=innerWidth+1 && r.top>=-1 && r.bottom<=innerHeight+1};
      });
      expect(fit).toEqual({clipped:false,visible:true});
      await page.screenshot({path:`evidence/add-visual-rules/rework-f1/mode-screenshots/${viewport.width}x${viewport.height}-${mode}.png`});
    }
  });
}
