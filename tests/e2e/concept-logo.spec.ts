import { expect, test } from '@playwright/test';
const screenshots = process.env.BRICKS_MENU_SCREENSHOTS ?? 'evidence/reuse-concept-logo';
for (const viewport of [{ width:1440,height:960 },{ width:1280,height:480 },{ width:390,height:844 },{ width:844,height:390 }]) {
  for (const update of [false,true]) {
    test(`concept logo above menu controls ${viewport.width}x${viewport.height} update=${update}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      if(update) await page.addInitScript(() => {
        (window as any).bricksDesktop = {
          updateState: async()=>({available:true,applying:false,error:false,phase:'ready'}),
          check: async()=>({available:true,applying:false,error:false,phase:'ready'}),
          apply: async()=>true,setSafeMenu:()=>{},healthy:async()=>{},
          display:async()=>({width:1280,height:720,fullscreen:false}),exit:async()=>{},
        };
      });
      await page.goto('/?muted=1');
      const loading=page.locator('#startup-loading'); await expect(loading).toBeVisible();
      const startupLogo=loading.locator('h1 img');
      expect(await startupLogo.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
      if(!update) await page.screenshot({path:`${screenshots}/startup-${viewport.width}x${viewport.height}.png`});
      await expect(loading).toHaveCount(0);
      const heading=page.locator('.main-menu-brand h1'); await expect(heading).toHaveAccessibleName('BRICKS WAR');
      await expect(page.locator('.main-menu-screen .menu-kicker')).toHaveCount(0);
      await expect(page.locator('.main-menu-screen footer small')).toHaveCount(0);
      await expect(page.locator('.release-footer-credits')).toHaveText('© 2026 Evgeniy Afonasev · afonasev.tech');
      const logo=heading.locator('img'); await expect(logo).toBeVisible();
      expect(await logo.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
      if(update) await expect(page.locator('.client-update-button')).toBeVisible();
      const issues=await page.evaluate(()=>{
        const nodes=[...document.querySelectorAll<HTMLElement>('.main-menu-brand h1,.main-menu-screen .mode-menu button,.main-menu-brand .client-update-slot,.main-menu-screen .release-footer-credits,.main-menu-screen .release-build-info,.main-menu-screen .release-footer-actions')].filter(el=>!el.hidden&&el.getClientRects().length&&getComputedStyle(el).display!=='none');
        const issues:string[]=[]; const rects=nodes.map(el=>el.getBoundingClientRect());
        nodes.forEach((el,i)=>{const r=rects[i]!; if(r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1||el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)issues.push('clipped '+el.className+' '+JSON.stringify({sw:el.scrollWidth,cw:el.clientWidth,sh:el.scrollHeight,ch:el.clientHeight,box:[r.left,r.top,r.right,r.bottom],grid:getComputedStyle(el).gridTemplateColumns,pad:getComputedStyle(el).padding}));});
        rects.forEach((r,i)=>rects.slice(i+1).forEach(q=>{if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)issues.push('overlap');}));
        const h=document.querySelector('.main-menu-brand h1')!.getBoundingClientRect();
        const buttons=[...document.querySelectorAll<HTMLElement>('.mode-menu button')].filter(el=>el.getClientRects().length);
        if(buttons.some(el=>el.getBoundingClientRect().top<h.bottom-1))issues.push('logo below buttons');
        return issues;
      });
      await page.screenshot({path:`${screenshots}/menu-${viewport.width}x${viewport.height}${update?'-update':''}.png`});
      expect(issues).toEqual([]);
    });
  }
}
