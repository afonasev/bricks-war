import { expect, test, type Page } from '@playwright/test';

export async function expectDesktopFit(page: Page): Promise<void> {
  const issues = await page.evaluate(() => {
    const visible = (el: Element) => !el.closest('[hidden]') && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
    const overlay = [...document.querySelectorAll('.profile-choice, .results-panel, .pause-panel, .menu-select.is-open .menu-select-options')].find(visible);
    const scope = overlay ?? document.querySelector('main')!;
    const nodes = [...scope.querySelectorAll<HTMLElement>('button,input,textarea,h1,h2,h3,label,li,.release-footer-action,.release-guidance-footer small,.hud-header,.hud-identity')].filter(visible);
    const rects = nodes.map(el => ({ el, r: el.getBoundingClientRect(), name: el.getAttribute('aria-label') || el.textContent?.trim().slice(0,80) }));
    const offscreen = rects.filter(({r}) => r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1).map(({name}) => name);
    const controls = rects.filter(({el}) => el.matches('button,input,textarea') && !el.matches('[type="range"]'));
    const overlap = controls.flatMap((a,i) => controls.slice(i+1).filter(b => !a.el.contains(b.el) && !b.el.contains(a.el) && Math.min(a.r.right,b.r.right)>Math.max(a.r.left,b.r.left)+1 && Math.min(a.r.bottom,b.r.bottom)>Math.max(a.r.top,b.r.top)+1).map(b => [a.name,b.name]));
    const overflow = [...scope.querySelectorAll<HTMLElement>('.setup-scroll,.mode-setup-content,.release-panel,.debug-lab-content,.debug-group,.debug-field,.controls-reference,.keyboard-reference,.settings-list,.mode-settings,.participant-card'),scope as HTMLElement].filter(visible).filter(el => el.scrollHeight>el.clientHeight+1 || el.scrollWidth>el.clientWidth+1).map(el => [el.className,el.clientHeight,el.scrollHeight,el.clientWidth,el.scrollWidth]);
    const nameContainment = [...scope.querySelectorAll<HTMLElement>('[data-player-name]')].filter(visible).flatMap(el => {
      const field = el.getBoundingClientRect();
      return [el.closest('header'), el.closest('.participant-card')].flatMap(parent => {
        if (!parent) return [];
        const bounds = parent.getBoundingClientRect();
        return field.left < bounds.left - 1 || field.top < bounds.top - 1 || field.right > bounds.right + 1 || field.bottom > bounds.bottom + 1 ? [el.getAttribute('aria-label')] : [];
      });
    });
    return {offscreen,overlap,overflow,nameContainment,documentOverflow: document.documentElement.scrollHeight>innerHeight+1 || document.documentElement.scrollWidth>innerWidth+1};
  });
  expect(issues).toEqual({offscreen:[],overlap:[],overflow:[],nameContainment:[],documentOverflow:false});
}

test('four editable Survival names stay inside their cards through resizing', async ({ page }) => {
  await page.addInitScript(() => {
    const pads = [0,1].map(index => ({ index, id: `Pad ${index}`, connected: true, mapping: 'standard', axes: [0,0], buttons: Array.from({length:16},()=>({pressed:false,touched:false,value:0})),timestamp:0 }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
    Object.assign(window, { nameFitPads: pads });
    localStorage.setItem('bricks-war:slot-selections:v1', JSON.stringify(['human-1','human-2','gamepad-0','gamepad-1']));
    localStorage.setItem('bricks-war:player-names:v1', JSON.stringify(Array(4).fill('Александр Великий')));
  });
  await page.goto('/?muted=1');
  await page.getByRole('button',{name:/^Выживание/}).click();
  await page.evaluate(() => { (window as any).nameFitPads.forEach((pad: any) => { pad.buttons[3].pressed = true; }); });
  await expect(page.locator('[data-player-name]')).toHaveCount(4);
  await page.evaluate(() => { (window as any).nameFitPads.forEach((pad: any) => { pad.buttons[3].pressed = false; }); });
  for (const name of ['Александр Великий','WWWWWWWWWWWWWWWWWW']) {
    for (const field of await page.locator('[data-player-name]').all()) await field.fill(name);
    await page.locator('[data-player-name]').last().press('Tab');
    for (const [width,height] of [[1920,1080],[800,620],[1280,480]]) {
      await page.setViewportSize({width:width!,height:height!});
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expectDesktopFit(page);
      const clipping = await page.locator('[data-player-name]').evaluateAll(fields => fields.filter(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).map(el => el.getAttribute('aria-label')));
      expect(clipping).toEqual([]);
    }
  }
});

for (const [width,height] of ([[1920,1080],[2560,1440],[1440,960],[1366,768],[1280,720],[1024,600],[800,620],[1280,480]] as const)) {
  test(`all desktop screens fit ${width}x${height}`, async ({page}) => {
    await page.setViewportSize({width,height});
    await page.addInitScript(() => {
      localStorage.setItem('bricks-war:player-names:v1',JSON.stringify(Array(4).fill('Александр Великий')));
      localStorage.setItem('bricks-war:solo-records:v1',JSON.stringify(Array.from({length:10},(_,i)=>({id:`r${i}`,name:'Александр Великий',elapsedMs:600000,lineScore:10000-i,finishedAt:1780000000000,placedPieces:1000}))));
    });
    await page.goto('/?muted=1');
    await expect(page.locator('.main-menu-screen')).toBeVisible();
    await expectDesktopFit(page);
    for (const mode of ['Выживание','Битва','Командный бой']) {
      await page.getByRole('button',{name:new RegExp(`^${mode}`)}).click();
      await expectDesktopFit(page);
      await page.getByRole('combobox',{name:'Стиль участника 1',exact:true}).click();
      await expectDesktopFit(page);
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'← Главное меню',exact:true}).click();
    }
    await page.getByRole('button',{name:/^Настройки/}).click(); await expectDesktopFit(page);
    await page.getByRole('button',{name:/^Управление/}).click(); await expectDesktopFit(page);
    await page.getByRole('button',{name:'← Настройки',exact:true}).click();
    await page.getByRole('button',{name:/^Лаборатория дизайна/}).click();
    const field = page.getByLabel('Предельное падение',{exact:true}); await field.fill('210');
    await expectDesktopFit(page);
    while (await page.getByRole('button',{name:'Следующий раздел →',exact:true}).isEnabled()) {
      await page.getByRole('button',{name:'Следующий раздел →',exact:true}).click(); await expectDesktopFit(page);
    }
    while (await page.getByRole('button',{name:'← Предыдущий раздел',exact:true}).isEnabled()) await page.getByRole('button',{name:'← Предыдущий раздел',exact:true}).click();
    await expect(field).toHaveValue('210');
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await expect(page.locator('.debug-lab-actions output')).toContainText('Сохран');
    await page.getByRole('button',{name:'Сбросить значения',exact:true}).click();
    await expect(field).toHaveValue('200');
  });
}

test('desktop select pages keep every option reachable with keyboard and pointer',async({page})=>{
  await page.setViewportSize({width:1280,height:480}); await page.goto('/?muted=1');
  await page.getByRole('button',{name:/^Битва/}).click();
  const trigger=page.getByRole('combobox',{name:'Стиль участника 1',exact:true}); await trigger.click();
  const list=page.getByRole('listbox',{name:'Стиль участника 1',exact:true});
  await list.getByRole('button',{name:'Следующие →',exact:true}).click(); await expectDesktopFit(page);
  await list.getByRole('option',{name:'Морские кристаллы',exact:true}).click();
  await expect(page.locator('[data-tile-style="0"]')).toHaveValue('sea-crystals');
  await trigger.click(); await trigger.press('ArrowUp'); await trigger.press('Enter');
  await expect(page.locator('[data-tile-style="0"]')).not.toHaveValue('sea-crystals');
  await expectDesktopFit(page);
});

for (const [width,height] of [[1280,480],[800,620]] as const) {
  for (const mode of ['Выживание','Битва']) {
    test(`arena, pause settings and results fit ${mode} ${width}x${height}`, async({page})=>{
      test.setTimeout(60_000);
      await page.setViewportSize({width,height});
      await page.addInitScript(()=> { localStorage.setItem('bricks-war:player-names:v1', JSON.stringify(Array(4).fill('WWWWWWWWWWWWWWWWWW'))); localStorage.setItem('bricks-war:solo-records:v1',JSON.stringify(Array.from({length:10},(_,i)=>({id:`r${i}`,name:'Александр Великий',elapsedMs:100000,lineScore:10000-i})))); });
      await page.goto('/?muted=1&playtest-fast=20&playtest-score=123456');
      await page.getByRole('button',{name:new RegExp(`^${mode}`)}).click();
      if (mode==='Битва') {
        await page.getByRole('combobox',{name:'Длительность матча',exact:true}).click();
        await page.getByRole('option',{name:'2 мин',exact:true}).click();
        await page.locator('[data-add-ai="3"]').click();
      }
      await page.getByRole('button',{name:/^Начать/}).click();
      await expect(page.locator('.hud-card').first()).toBeVisible(); await expectDesktopFit(page);
      const hudFit = await page.locator('.hud-card').evaluateAll(cards => cards.flatMap(card => {
        const outer = card.getBoundingClientRect();
        const parts = [...card.querySelectorAll<HTMLElement>('.hud-identity strong, .hud-stats b, .hud-stats span, .shield-inventory, .hud-next-piece')];
        const boxes = parts.map(part => part.getBoundingClientRect());
        const clipped = parts.flatMap((part,index) => { const box = boxes[index]!; return part.scrollWidth > part.clientWidth + 1 || box.left < outer.left || box.right > outer.right || box.top < outer.top || box.bottom > outer.top + 52 ? [{ text: part.textContent, class: part.className, scroll: part.scrollWidth, width: part.clientWidth, top: box.top-outer.top, bottom: box.bottom-outer.top }] : []; });
        const overlap = boxes.flatMap((a,index) => boxes.slice(index+1).flatMap((b,other) => Math.min(a.right,b.right) > Math.max(a.left,b.left) + 1 && Math.min(a.bottom,b.bottom) > Math.max(a.top,b.top) + 1 ? [[parts[index]!.textContent, parts[index+other+1]!.textContent]] : []));
        return [...clipped,...overlap];
      }));
      expect(hudFit).toEqual([]);
      await page.getByRole('button',{name:'Поставить матч на паузу',exact:true}).click();
      await expectDesktopFit(page);
      await page.getByRole('button',{name:'Настройки',exact:true}).click(); await expectDesktopFit(page);
      await page.getByRole('button',{name:'← Назад к паузе',exact:true}).click();
      await page.getByRole('button',{name:'Продолжить Esc',exact:true}).click();
      if (mode==='Выживание') { await page.keyboard.down('s'); await page.keyboard.down('ArrowDown'); }
      await expect(page.locator('.results-panel')).toBeVisible({timeout:36_000}); await expectDesktopFit(page);
      if (mode==='Выживание') {
        const expectResultColumns = async () => {
          const layout = await page.locator('.survival-results-columns').evaluate(wrapper => {
            const match = wrapper.querySelector('.survival-current-results')!.getBoundingClientRect();
            const records = wrapper.querySelector('.survival-local-records')!.getBoundingClientRect();
            return { wide: innerWidth >= 1100, match: match.toJSON(), records: records.toJSON() };
          });
          if (layout.wide) {
            expect(layout.match.right).toBeLessThanOrEqual(layout.records.left);
            expect(Math.abs(layout.match.top-layout.records.top)).toBeLessThan(1);
          } else {
            expect(layout.match.bottom).toBeLessThanOrEqual(layout.records.top);
            expect(Math.abs(layout.match.left-layout.records.left)).toBeLessThan(1);
          }
          await expectDesktopFit(page);
        };
        for (const [resultWidth,resultHeight] of [[1920,1080],[1100,720],[1099,720],[800,620],[1280,480]]) {
          await page.setViewportSize({width:resultWidth!,height:resultHeight!});
          const expectedScale = Math.min((resultWidth!-32)/1120,(resultHeight!-32)/640);
          await expect.poll(async () => Number(await page.locator('#app').evaluate(root => getComputedStyle(root).getPropertyValue('--desktop-scale'))), { timeout: 5_000 }).toBeCloseTo(expectedScale, 4);
          await expectResultColumns();
        }
        const matchRows = await page.locator('.survival-match-results > li').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().toJSON()));
        expect(matchRows.length).toBeGreaterThan(1);
        matchRows.forEach((row,index)=>{
          expect(Math.abs(row.x-matchRows[0]!.x)).toBeLessThan(1);
          expect(Math.abs(row.width-matchRows[0]!.width)).toBeLessThan(1);
          if(index) expect(row.y).toBeGreaterThanOrEqual(matchRows[index-1]!.bottom);
        });
        const next=page.getByRole('button',{name:'Следующие →',exact:true});
        while(await next.isEnabled()) { await next.click(); await expectResultColumns(); }
        await expect(page.locator('.survival-record-list li:not([hidden])')).not.toHaveCount(0);
      }
    });
  }
}


test('desktop compositions keep proportions and records form one column through resizing', async ({page}) => {
  await page.setViewportSize({width:1920,height:1080});
  await page.addInitScript(() => localStorage.setItem('bricks-war:solo-records:v1',JSON.stringify(Array.from({length:10},(_,i)=>({id:`r${i}`,name:'Александр Великий',elapsedMs:600000,lineScore:10000-i,finishedAt:1780000000000,placedPieces:1000})))));
  await page.goto('/?muted=1');
  await page.getByRole('button',{name:/^Выживание/}).click();
  const composition = () => page.evaluate(() => {
    const stage = document.querySelector('.desktop-menu-stage')!.getBoundingClientRect();
    const scale = stage.width / 1120;
    return [...document.querySelectorAll('.release-heading,.survival-setup-grid > section,.survival-lobby,.release-guidance-footer,.survival-lobby .participant-card,.survival-lobby .menu-select-trigger')].map(el=>{const r=el.getBoundingClientRect(); return [r.width/scale,r.height/scale,(r.x-stage.x)/scale,(r.y-stage.y)/scale];});
  });
  const original = await composition();
  for(const [width,height] of ([[2560,1440],[1440,960],[1280,720],[1024,600],[800,620],[1280,480]] as const)) {
    await page.setViewportSize({width,height});
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expectDesktopFit(page);
    const stage = await page.locator('.desktop-menu-stage').boundingBox();
    expect(stage).not.toBeNull();
    const expectedScale = Math.min((width-32)/1120,(height-32)/640);
    expect(stage!.width).toBeCloseTo(1120*expectedScale,1);
    expect(stage!.height).toBeCloseTo(640*expectedScale,1);
    expect(stage!.x).toBeCloseTo((width-stage!.width)/2,1);
    expect(stage!.y).toBeCloseTo((height-stage!.height)/2,1);
    expect(Math.min(width-stage!.width,height-stage!.height)).toBeCloseTo(32,1);
    if(width>=1440 && height>=960) expect(stage!.width/1120).toBeGreaterThan(1);
    const resized = await composition();
    resized.forEach((box,i)=>box.forEach((value,j)=>expect(Math.abs(value-original[i]![j]!)).toBeLessThan(1)));
    const records = await page.locator('.survival-records li:not([hidden])').evaluateAll(items=>items.map(el=>el.getBoundingClientRect().toJSON()));
    expect(records).toHaveLength(4);
    records.forEach((r,i)=>{expect(Math.abs(r.x-records[0]!.x)).toBeLessThan(1); if(i) expect(r.y).toBeGreaterThanOrEqual(records[i-1]!.bottom);});
  }
  await page.getByRole('button',{name:'Следующие →',exact:true}).click();
  await expect(page.locator('.desktop-record-pages output')).toHaveText('2 / 3');
  await page.setViewportSize({width:2560,height:1440});
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('.desktop-record-pages output')).toHaveText('2 / 3');
});
