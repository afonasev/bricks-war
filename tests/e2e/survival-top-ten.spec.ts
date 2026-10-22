import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const viewports = [[1920,1080],[1280,480],[800,620],[390,844],[360,640],[320,568],[844,390]] as const;
const evidence = process.env.BRICKS_RECORD_SCREENSHOTS ?? 'evidence/compact-survival-records/time-feedback/screenshots';

async function expectTenFit(page: Page, results = false) {
  if (results) {
    await expect(page.getByRole('heading', { name: 'Итоги', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Этот матч', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Рекорды', exact: true })).toBeVisible();
    await expect(page.locator('.results-panel')).not.toContainText('До 3');
    const surfaces = await page.locator('.survival-results-columns > section').evaluateAll(elements => elements.map(el => ({ background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopWidth, rect: el.getBoundingClientRect().toJSON() })));
    expect(surfaces).toHaveLength(2);
    expect(surfaces[0]!.background).not.toBe(surfaces[1]!.background);
    expect(surfaces.every(surface => parseFloat(surface.border) > 0)).toBe(true);
    const [a,b] = surfaces.map(surface => surface.rect);
    expect(Math.min(a!.right,b!.right) <= Math.max(a!.left,b!.left) || Math.min(a!.bottom,b!.bottom) <= Math.max(a!.top,b!.top)).toBe(true);
  }
  if (results) expect(await page.locator('.results-panel').evaluate(el => ['::before', '::after'].map(pseudo => getComputedStyle(el, pseudo).content))).toEqual(['none', 'none']);
  const selector = results ? '.survival-record-list' : '.survival-records ol';
  await expect(page.locator(`${selector} > li:visible`)).toHaveCount(10);
  await expect(page.locator('.desktop-record-pages')).toHaveCount(0);
  await expect(page.locator(`${selector} .record-duration:visible`)).toHaveCount(10);
  await expect(page.locator(`${selector} .record-date:visible`)).toHaveCount(10);
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
      const duration = row.querySelector<HTMLElement>('.record-duration')!;
      const score = row.querySelector<HTMLElement>('.record-metrics time')!;
      if(parseFloat(getComputedStyle(duration).fontSize) >= parseFloat(getComputedStyle(score).fontSize)) errors.push(['time-not-secondary',i]);
      const date = row.querySelector<HTMLElement>('.record-date')!;
      if(parseFloat(getComputedStyle(date).fontSize) >= parseFloat(getComputedStyle(score).fontSize)) errors.push(['date-not-secondary',i]);
      const parts = [...row.querySelectorAll<HTMLElement>('b,.result-place,strong,time,.record-duration,.record-date')];
      parts.forEach(part => {
        const range=document.createRange();range.selectNodeContents(part);const t=range.getBoundingClientRect();
        if(t.left<r.left-1 || t.right>r.right+1 || t.top<r.top-1 || t.bottom>r.bottom+1 || part.scrollWidth>part.clientWidth+1) errors.push(['text-clipped',i,part.textContent]);
      });
      for(let j=0;j<parts.length;j++) for(let k=j+1;k<parts.length;k++) {
        const x=parts[j]!.getBoundingClientRect(),y=parts[k]!.getBoundingClientRect();
        if(Math.min(x.right,y.right)>Math.max(x.left,y.left)+1 && Math.min(x.bottom,y.bottom)>Math.max(x.top,y.top)+1) errors.push(['text-overlap',i]);
      }
    });
    if(results) for (const row of scope.querySelectorAll<HTMLElement>('.survival-match-results li')) {
      const r = row.getBoundingClientRect();
      if(r.top<0 || r.bottom>innerHeight || r.left<0 || r.right>innerWidth) errors.push(['match-offscreen',row.textContent]);
      if(Math.min(r.right,a.right)>Math.max(r.left,a.left)+1 && Math.min(r.bottom,a.bottom)>Math.max(r.top,a.top)+1) errors.push(['match-action-overlap',row.textContent]);
      for (const part of row.querySelectorAll<HTMLElement>('strong,small,time,.result-place')) {
        const range=document.createRange();range.selectNodeContents(part);const t=range.getBoundingClientRect();
        if(t.left<r.left-1 || t.right>r.right+1 || t.top<r.top-1 || t.bottom>r.bottom+1 || part.scrollWidth>part.clientWidth+1) errors.push(['match-text-clipped',part.textContent]);
      }
    }
    if(a.top<0 || a.bottom>innerHeight || a.left<0 || a.right>innerWidth) errors.push(['actions-offscreen',a.toJSON()]);
    return errors;
  }, {selector,results});
  expect(issues).toEqual([]);
}

for(const [width,height] of viewports) {
  test(`Survival top ten fits without scrolling ${width}x${height}`, async({page}) => {
    await page.setViewportSize({width,height});
    await page.addInitScript(() => localStorage.setItem('bricks-war:solo-records:v1',JSON.stringify(Array.from({length:10},(_,i)=>({id:`r${i}`,name:i%2 ? `WWWWWWWWWWWWWWWWW${i}` : `Александр Велики${i}`,elapsedMs:600000,lineScore:123456-i,finishedAt:1780000000000,placedPieces:1000})))));
    await page.goto('/?muted=1');
    await page.getByRole('button',{name:/^Выживание/}).click();
    await mkdir(evidence,{recursive:true});
    await page.screenshot({path:`${evidence}/setup-${width}x${height}.png`});
    await expectTenFit(page);
    await expect(page.locator('.survival-records .record-duration')).toHaveText(Array(10).fill('◷ 10:00'));
  });
}

for(const [width,height] of [[1920,1080],[390,844],[1600,900],[1280,720]] as const) {
  test(`Survival results top ten and current attempts fit ${width}x${height}`, async({page}) => {
    test.setTimeout(60000);
    await page.setViewportSize({width,height});
    await page.addInitScript(() => localStorage.setItem('bricks-war:solo-records:v1',JSON.stringify(Array.from({length:10},(_,i)=>({id:`r${i}`,name:i%2 ? `WWWWWWWWWWWWWWWWW${i}` : `Александр Велики${i}`,elapsedMs:600000,lineScore:123456-i,finishedAt:1780000000000,placedPieces:1000})))));
    if (width === 1600) await page.addInitScript(() => {
      const pads = [0,1].map(index => ({ index, id: `Very Long Wireless Controller Vendor Product Name ${index}`, connected: true, mapping: 'standard', axes: [0,0], buttons: Array.from({length:16}, () => ({ pressed:false, touched:false, value:0 })), timestamp:0 }));
      Object.defineProperty(navigator, 'getGamepads', { configurable:true, value: () => pads });
      Object.assign(window, { recordsTestPads:pads });
    });
    await page.goto('/?muted=1&playtest-fast=20&playtest-score=123456');
    await page.getByRole('button',{name:/^Выживание/}).click();
    if (width === 1600) {
      for (const i of [0,1]) {
        await page.getByRole('combobox',{name:`Участник ${i+1}`,exact:true}).click();
        await page.getByRole('option',{name:`Геймпад ${i+1}`,exact:true}).click();
      }
      await page.locator('[data-add-human="2"]').click();
      await page.locator('[data-add-human="3"]').click();
    }
    if (width === 1280) await page.locator('[data-remove-slot="1"]').click();
    await page.locator('#start-match').click();
    if (width === 1600) await page.evaluate(() => {
      for (const pad of (window as any).recordsTestPads) pad.buttons[13] = { pressed:true, touched:true, value:1 };
    });
    await expect(page.locator('.hud-card').first()).toBeVisible();
    // Natural accelerated playtest: retain real game-over and result handling.
    await page.keyboard.down('s');await page.keyboard.down('ArrowDown');
    await expect(page.locator('.results-panel')).toBeVisible({timeout:36000});
    await expect(page.locator('#play-again')).toBeEnabled({timeout:10000});
    await expect(page.locator('.survival-record-list .is-current-record')).not.toHaveCount(0);
    await expect(page.locator('.survival-match-results li')).not.toHaveCount(0);
    if (width === 1280 || width === 390) {
      await expect(page.locator('.survival-match-results li')).toHaveCount(1);
      await expect(page.locator('.survival-match-results .result-place')).toHaveCount(0);
      await expect(page.locator('.survival-match-results')).not.toContainText('♛');
      await expect(page.locator('.survival-record-list .result-place')).toHaveCount(10);
    }
    if (width === 1600) {
      await expect(page.locator('.survival-match-results li')).toHaveCount(4);
      await expect(page.locator('.survival-match-results')).toContainText('Геймпад 1');
      await expect(page.locator('.survival-match-results')).toContainText('Геймпад 2');
      await expect(page.locator('.survival-match-results')).toContainText('Клавиатура WASD');
      await expect(page.locator('.survival-match-results')).toContainText('Клавиатура стрелки');
      await expect(page.locator('.survival-match-results')).not.toContainText('Клавиатура 1');
      await expect(page.locator('.survival-match-results .result-place')).toHaveCount(4);
      const fonts = await page.locator('.survival-match-results .result-controller').evaluateAll(elements => elements.map(el => {
        const style = getComputedStyle(el); return [style.fontSize,style.fontFamily,style.fontWeight,style.textTransform].join('|');
      }));
      expect(new Set(fonts).size).toBe(1);
      await expect(page.locator('.results-panel')).not.toContainText('Very Long');
      await page.evaluate(() => { for (const pad of (window as any).recordsTestPads) pad.buttons[13] = { pressed:false, touched:false, value:0 }; });
    }
    for(const [w,h] of (width!==390 ? [[1920,1080],[1280,480],[800,620]] : [[390,844],[360,640],[320,568],[844,390]])) {
      await page.setViewportSize({width:w!,height:h!});
      await expect.poll(()=>page.locator('#app').getAttribute('data-layout')).toBe(w!<=760 || (w!<=900 && h!<=600) ? 'mobile' : 'desktop');

      await expectTenFit(page,true);
      const actions = await page.locator('.results-actions > button').evaluateAll(buttons => buttons.map(button => {
        const r=button.getBoundingClientRect(), style=getComputedStyle(button);
        return { width:r.width, height:r.height, cssWidth:parseFloat(style.width), max:document.querySelector('#app')!.getAttribute('data-layout')==='mobile' ? 240 : 190 };
      }));
      expect(actions).toHaveLength(2);
      expect(Math.abs(actions[0]!.width-actions[1]!.width)).toBeLessThan(1);
      expect(Math.abs(actions[0]!.height-actions[1]!.height)).toBeLessThan(1);
      expect(actions.every(action=>action.cssWidth<=action.max)).toBe(true);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.screenshot({path:`${evidence}/${width===1600 ? 'gamepad-' : width===1280 ? 'solo-' : ''}results-${w}x${h}.png`});

    }
  });
}

for (const [width,height] of [[1440,960],[390,844]] as const) {
  test(`Survival setup caps repeated names and fills ten eligible places ${width}x${height}`, async ({page}) => {
    await page.setViewportSize({width,height});
    await page.addInitScript(() => localStorage.setItem('bricks-war:solo-records:v1', JSON.stringify(Array.from({length:14},(_,i)=>({id:`r${i}`, name:i<6 ? ['Вася',' ВАСЯ ','вася'][i%3] : `Игрок ${i}`, lineScore:1000-i, elapsedMs:1000, finishedAt:1780000000000})))));
    await page.goto('/?muted=1');
    await page.getByRole('button',{name:/^Выживание/}).click();
    const names = await page.locator('.survival-records .record-identity strong').allTextContents();
    expect(names).toHaveLength(10);
    expect(names.filter(name => name.trim().toLowerCase()==='вася')).toHaveLength(3);
    expect(names).toContain('Игрок 12');
    await expectTenFit(page);
  });
}

test('Battle results keep compact actions and consistent keyboard subtitles', async ({page}) => {
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:960});
  await page.goto('/?muted=1&playtest-fast=20');
  await page.getByRole('button',{name:/^Битва/}).click();
  await page.getByRole('combobox',{name:'Длительность матча',exact:true}).click();
  await page.getByRole('option',{name:'2 мин',exact:true}).click();
  await page.locator('#start-match').click();
  await expect(page.locator('.results-panel')).toBeVisible({timeout:36000});
  await expect(page.locator('#play-again')).toBeEnabled({timeout:10000});
  await expect(page.locator('.results-panel')).toContainText('Клавиатура WASD');
  await expect(page.locator('.results-panel')).toContainText('Клавиатура стрелки');
  await expect(page.locator('.results-list .result-place').first()).toBeVisible();
  for (const [width,height] of [[1440,960],[390,844]]) {
    await page.setViewportSize({width:width!,height:height!});
    await expect.poll(()=>page.locator('#app').getAttribute('data-layout')).toBe(width!<=760 ? 'mobile' : 'desktop');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const actions = await page.locator('.results-actions > button').evaluateAll(buttons => buttons.map(button => {
      const r=button.getBoundingClientRect();return {width:r.width,height:r.height,bottom:r.bottom,right:r.right};
    }));
    expect(actions).toHaveLength(2);
    expect(Math.abs(actions[0]!.width-actions[1]!.width)).toBeLessThan(1);
    expect(Math.abs(actions[0]!.height-actions[1]!.height)).toBeLessThan(1);
    expect(actions.every(action=>action.width<=240 && action.bottom<=height! && action.right<=width!), JSON.stringify({width,height,actions})).toBe(true);
    await page.screenshot({path:`${evidence}/battle-results-${width}x${height}.png`});
  }
});
