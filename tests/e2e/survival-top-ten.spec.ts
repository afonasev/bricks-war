import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const viewports = [[1920,1080],[1280,480],[800,620],[390,844],[360,640],[320,568],[844,390]] as const;
const evidence = 'evidence/compact-survival-records/screenshots';

async function expectTenFit(page: Page, results = false) {
  const selector = results ? '.survival-record-list' : '.survival-records ol';
  await expect(page.locator(`${selector} > li:visible`)).toHaveCount(10);
  await expect(page.locator('.desktop-record-pages')).toHaveCount(0);
  const issues = await page.evaluate(({selector,results}) => {
    const list = document.querySelector<HTMLElement>(selector)!;
    const scope = document.querySelector<HTMLElement>(results ? '.results-panel' : '.mode-setup-screen')!;
    const action = scope.querySelector<HTMLElement>(results ? '.results-actions' : '.release-guidance-footer')!;
    const a = action.getBoundingClientRect();
    const errors: unknown[] = [];
    for (const el of [scope,list,...scope.querySelectorAll<HTMLElement>('.setup-scroll,.mobile-survival-records')]) {
      if(el.scrollHeight > el.clientHeight+1 || el.scrollWidth > el.clientWidth+1 || el.scrollTop !== 0) errors.push(['scroll',el.className,el.clientHeight,el.scrollHeight]);
    }
    const rows = [...list.children] as HTMLElement[];
    rows.forEach((row,i) => {
      const r=row.getBoundingClientRect();
      if(r.top<0 || r.bottom>innerHeight || r.left<0 || r.right>innerWidth) errors.push(['offscreen',i,r.toJSON()]);
      if(Math.min(r.right,a.right)>Math.max(r.left,a.left)+1 && Math.min(r.bottom,a.bottom)>Math.max(r.top,a.top)+1) errors.push(['action-overlap',i]);
      if(i && r.top<rows[i-1]!.getBoundingClientRect().bottom-1) errors.push(['row-overlap',i]);
      const parts = [...row.querySelectorAll<HTMLElement>('b,.result-place,strong,time')];
      parts.forEach(part => {
        const range=document.createRange();range.selectNodeContents(part);const t=range.getBoundingClientRect();
        if(t.left<r.left-1 || t.right>r.right+1 || t.top<r.top-1 || t.bottom>r.bottom+1 || part.scrollWidth>part.clientWidth+1) errors.push(['text-clipped',i,part.textContent]);
      });
      for(let j=0;j<parts.length;j++) for(let k=j+1;k<parts.length;k++) {
        const x=parts[j]!.getBoundingClientRect(),y=parts[k]!.getBoundingClientRect();
        if(Math.min(x.right,y.right)>Math.max(x.left,y.left)+1 && Math.min(x.bottom,y.bottom)>Math.max(x.top,y.top)+1) errors.push(['text-overlap',i]);
      }
    });
    if(a.top<0 || a.bottom>innerHeight || a.left<0 || a.right>innerWidth) errors.push(['actions-offscreen',a.toJSON()]);
    return errors;
  }, {selector,results});
  expect(issues).toEqual([]);
}

for(const [width,height] of viewports) {
  test(`Survival top ten fits without scrolling ${width}x${height}`, async({page}) => {
    await page.setViewportSize({width,height});
    await page.addInitScript(() => localStorage.setItem('bricks-war:solo-records:v1',JSON.stringify(Array.from({length:10},(_,i)=>({id:`r${i}`,name:i%2 ? 'WWWWWWWWWWWWWWWWWW' : 'Александр Великий',elapsedMs:600000,lineScore:123456-i,finishedAt:1780000000000,placedPieces:1000})))));
    await page.goto('/?muted=1');
    await page.getByRole('button',{name:/^Выживание/}).click();
    await mkdir(evidence,{recursive:true});
    await page.screenshot({path:`${evidence}/setup-${width}x${height}.png`});
    await expectTenFit(page);
  });
}

for(const [width,height] of [[1920,1080],[390,844]] as const) {
  test(`Survival results top ten and current attempts fit ${width}x${height}`, async({page}) => {
    test.setTimeout(60000);
    await page.setViewportSize({width,height});
    await page.addInitScript(() => localStorage.setItem('bricks-war:solo-records:v1',JSON.stringify(Array.from({length:10},(_,i)=>({id:`r${i}`,name:i%2 ? 'WWWWWWWWWWWWWWWWWW' : 'Александр Великий',elapsedMs:600000,lineScore:123456-i,finishedAt:1780000000000,placedPieces:1000})))));
    await page.goto('/?muted=1&playtest-fast=20&playtest-score=123456');
    await page.getByRole('button',{name:/^Выживание/}).click();
    await page.getByRole('button',{name:/^Начать/}).click();
    await expect(page.locator('.hud-card').first()).toBeVisible();
    // Natural accelerated playtest: retain real game-over and result handling.
    await page.keyboard.down('s');await page.keyboard.down('ArrowDown');
    await expect(page.locator('.results-panel')).toBeVisible({timeout:36000});
    await expect(page.locator('#play-again')).toBeEnabled({timeout:10000});
    await expect(page.locator('.survival-record-list .is-current-record')).not.toHaveCount(0);
    await expect(page.locator('.survival-match-results li')).not.toHaveCount(0);
    for(const [w,h] of (width===1920 ? [[1920,1080],[1280,480],[800,620]] : [[390,844],[360,640],[320,568],[844,390]])) {
      await page.setViewportSize({width:w!,height:h!});
      await expect.poll(()=>page.locator('#app').getAttribute('data-layout')).toBe(w!<=760 || (w!<=900 && h!<=600) ? 'mobile' : 'desktop');
      await page.screenshot({path:`${evidence}/results-${w}x${h}.png`});
      await expectTenFit(page,true);
    }
  });
}
