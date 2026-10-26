import { openLocalLobby } from '../helpers/localLobby';
import { expect, test } from '@playwright/test';

test('keeps the approved pause card grid spaced and reachable across viewports and locales', async ({ page }) => {
  // 21 layout states, each scrolling every existing control into view.
  test.setTimeout(120_000);
  await page.goto('/?muted=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await openLocalLobby(page,'battle');
  await page.locator('#start-match').click();
  await expect(page.locator('#countdown')).toBeHidden();
  await page.locator('#manual-pause').click();
  await page.locator('#pause-settings').click();
  const panel = page.locator('#pause-settings-panel');
  const report = [];
  for (const locale of ['Русский', 'Deutsch', '日本語']) {
    await panel.locator('.settings-language-section [data-menu-select-trigger]').click();
    await page.getByRole('option', { name: locale, exact: true }).click();
    for (const [width, height] of [[390,844],[360,640],[568,320],[667,375],[844,390],[1280,720],[1440,960]] as const) {
      await page.setViewportSize({ width, height });
      const metrics = await panel.evaluate((element) => {
        const rect = (e: Element) => e.getBoundingClientRect().toJSON();
        const cards = [...element.querySelectorAll('.pause-preferences-column > section')].map(rect);
        const sliderRows = [...element.querySelectorAll('.volume-control')].map(row => {
          const label = row.querySelector('span')!;
          const range = document.createRange(); range.selectNodeContents(label);
          const text = range.getBoundingClientRect(), box = label.getBoundingClientRect();
          const input = row.querySelector('input')!.getBoundingClientRect();
          return { fits: text.left >= box.left && text.right <= box.right,
            below: input.top >= text.bottom };
        });
        const labels = [...element.querySelectorAll('strong,small,h3,.settings-section-note,.menu-select-value')].filter(e => e.getBoundingClientRect().height > 0).map(e => {
          const range = document.createRange(); range.selectNodeContents(e);
          const text = range.getBoundingClientRect(), box = e.getBoundingClientRect();
          return {text:e.textContent, left:text.left,right:text.right,boxLeft:box.left,boxRight:box.right,fits:text.left >= box.left && text.right <= box.right};
        });
        const columns = [...element.querySelectorAll('.pause-preferences-column')].map(column => {
          const sections = [...column.children].map(e => e.getBoundingClientRect());
          return sections[1]!.top - sections[0]!.bottom;
        });
        return { panel:rect(element), heading:rect(element.querySelector(':scope > h2')!),
          body:rect(element.querySelector('.pause-preferences-scroll')!), back:rect(element.querySelector('#pause-settings-back')!),
          reset:rect(element.querySelector('[data-reset-preferences]')!), columns,cards,sliderRows,labels,labelsFit:labels.every(label=>label.fits),
          scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight };
      });
      report.push({locale,width,height,...metrics});
      await test.info().attach(`state-${locale}-${width}x${height}`,{body:JSON.stringify(report[report.length-1]),contentType:'application/json'});
      expect(metrics.panel.top).toBeGreaterThanOrEqual(0);
      expect(metrics.panel.bottom).toBeLessThanOrEqual(height);
      expect(metrics.panel.left).toBeGreaterThanOrEqual(0);
      expect(metrics.panel.right).toBeLessThanOrEqual(width);
      expect(metrics.scrollWidth).toBe(metrics.clientWidth);
      expect(metrics.scrollHeight).toBe(metrics.clientHeight);
      expect(metrics.heading.bottom).toBeLessThanOrEqual(metrics.body.top);
      expect(metrics.body.bottom).toBeLessThanOrEqual(metrics.back.top);
      expect(metrics.reset.bottom).toBeLessThanOrEqual(height);
      expect(metrics.columns.every(gap => gap >= 12)).toBe(true);
      expect(metrics.labelsFit).toBe(true);
      expect(metrics.sliderRows).toHaveLength(5);
      expect(metrics.sliderRows.every(row => row.fits && row.below)).toBe(true);
      for (const control of await panel.locator('.pause-preferences-scroll button,.pause-preferences-scroll input,.pause-preferences-scroll [data-menu-select-trigger]').all()) {
        if (!await control.isVisible()) continue;
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(metrics.body.top);
        expect(box!.y+box!.height).toBeLessThanOrEqual(metrics.body.bottom);
      }
    }
  }
  await test.info().attach('layout-matrix', {body:JSON.stringify(report,null,2),contentType:'application/json'});
  await panel.locator('#pause-settings-back').click();
  await page.locator('#continue-match').click();
  await expect(page.locator('#pause-overlay')).toBeHidden();
});

test('keeps shared network preference cards and controller footer inside the viewport', async ({ page }) => {
  // The same virtual device contract used by gamepad-roster.spec.ts.
  await page.addInitScript(() => {
    const pad = { index:0,id:'Layout QA Pad',connected:true,mapping:'standard',axes:[0,0],
      buttons:Array.from({length:16},()=>({pressed:false,touched:false,value:0})),timestamp:0 };
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});
  });
  await page.goto('/?muted=1');
  await page.getByRole('button', {name:/^Сетевая игра/}).click();
  await page.locator('[data-net-action="preferences"]').click();
  const panel=page.locator('[data-network-preferences]');
  await expect(panel.locator('.pause-preferences-column > section')).toHaveCount(4);
  await expect(panel.locator('.preferences-guidance-footer .release-footer-action')).toHaveCount(2);
  for (const [width,height] of [[390,844],[844,390],[1280,720]] as const) {
    await page.setViewportSize({width,height});
    const b=await panel.boundingBox();
    expect(b).not.toBeNull();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.y).toBeGreaterThanOrEqual(0);
    expect(b!.x+b!.width).toBeLessThanOrEqual(width);
    expect(b!.y+b!.height).toBeLessThanOrEqual(height);
    await expect(panel.locator('[data-reset-preferences]')).toBeVisible();
  }
  await test.info().attach('controller-network-settings',{body:await page.screenshot(),contentType:'image/png'});
  await panel.locator('[data-network-prefs-back]').click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('[data-net-action="preferences"]')).toBeVisible();
});
