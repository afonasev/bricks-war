import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const out = 'evidence/toy-workshop-arena/review';
for (const viewport of [{width:1440,height:960},{width:390,height:844}]) {
  test(`toy workshop surfaces at ${viewport.width}`, async ({page}) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?muted=1&playtest-board-events=1');
    await page.getByRole('button', {name:/^Битва/}).click();
    if (viewport.width > 700) {
      const add = page.getByRole('button', {name:'Добавить ИИ',exact:true});
      while (await add.count()) await add.first().click();
    }
    await page.locator('#start-match').click();
    await expect(page.locator('.match-loading')).toHaveCount(0);
    await expect(page.locator('#countdown')).toBeHidden({timeout:6000});
    await expect(page.locator('#arena-event-notice')).toBeHidden({timeout:6000});
    // Existing localhost-only QA interface; freeze presentation, not persisted settings.
    await page.evaluate(() => {
      const qa = (window as any).__boardEffectsQA;
      qa.scene.scene.pause();
      const kinds = ['I','O','T','S','Z','J','L'];
      qa.engine.state.participants.forEach((p: any, n: number) => {
        p.resolvedTileStyle = ['classic','construction-bricks','forest-mosaic','marmalade'][n % 4];
        for (let y=14; y<p.board.grid.length; y++) for (let x=0; x<10; x++) {
          p.board.grid[y][x] = y > 18 || x < (y-12) % 5 || x > 7 ? kinds[(x+y+n)%7] : null;
        }
        p.board.staticRenderRevision++;
      });
      qa.scene.runtime.onState(qa.engine.state);
      qa.scene.renderState();
    });
    const cards = await page.locator('.hud-card').evaluateAll(nodes => nodes.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
    for (const c of cards) { expect(c.x).toBeGreaterThanOrEqual(-1);expect(c.y).toBeGreaterThanOrEqual(-1);expect(c.right).toBeLessThanOrEqual(viewport.width+1);expect(c.bottom).toBeLessThanOrEqual(viewport.height+1); }
    for (let a=0;a<cards.length;a++) for(let b=a+1;b<cards.length;b++) {
      const x=cards[a]!,y=cards[b]!;
      expect(Math.min(x.right,y.right)-Math.max(x.x,y.x)>1 && Math.min(x.bottom,y.bottom)-Math.max(x.y,y.y)>1).toBe(false);
    }
    await mkdir(out,{recursive:true});
    await page.screenshot({path:`${out}/arena-${viewport.width}.png`});
    expect(errors).toEqual([]);
  });
}

test('captures real normal clear at three progress points without mutating tile sizes or score',async({page})=>{
  await page.goto('/?muted=1&playtest-clear=normal-2&playtest-board-events=1');
  await page.getByRole('button',{name:/^Выживание/}).click();
  const remove=page.getByRole('button',{name:'Удалить Игрок 2'});
  if(await remove.count())await remove.click();
  await page.locator('#start-match').click();
  // Pause the scene in the same frame the real engine reaches highlight, so
  // screenshot latency cannot skip the 180 ms phase. Simulation duration unchanged.
  await page.waitForFunction(()=>{
    const qa=(window as any).__boardEffectsQA;
    if(qa?.engine.state.clearPresentations[0]?.phase!=='highlight')return false;
    qa.scene.scene.pause();return true;
  });
  for(const [label,progress] of [['start',0],['middle',.5],['end',.99]] as const){
    const state=await page.evaluate((p)=>{
      const qa=(window as any).__boardEffectsQA;
      const event=qa.engine.state.clearPresentations[0];
      event.remainingMs=event.durationMs*(1-p);
      qa.scene.renderState();
      return {score:qa.engine.state.participants[0].score,phase:event.phase,rows:event.removedRows.length,duration:event.durationMs};
    },progress);
    expect(state).toEqual({score:0,phase:'highlight',rows:2,duration:180});
    await mkdir(out,{recursive:true});
    await page.screenshot({path:`${out}/clear-${label}.png`});
  }
});


test('captures the unchanged cyan shield signal against workshop material', async ({page}) => {
  await page.goto('/?muted=1&playtest-shield-impact=1&playtest-shield-rows=1&playtest-shield-capture=200');
  await page.getByRole('button',{name:/^Выживание/}).click();
  const remove = page.getByRole('button',{name:'Удалить Игрок 2'});
  if (await remove.count()) await remove.click();
  await page.locator('#start-match').click();
  await expect(page.locator('.match-loading')).toHaveCount(0);
  await expect.poll(async()=>Number(await page.locator('.hud-card').first().getAttribute('data-shield-remaining-ms'))).toBeGreaterThan(0);
  await mkdir(out,{recursive:true});
  await page.screenshot({path:`${out}/shield.png`});
});
