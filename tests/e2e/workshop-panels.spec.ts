import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const out = 'evidence/toy-workshop-arena/player-panels-f10';
for (const viewport of [{width:1440,height:960},{width:390,height:844}]) {
  test(`wooden player panels at ${viewport.width}`, async ({page}) => {
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
    const spriteState = await page.evaluate(() => {
      const qa=(window as any).__boardEffectsQA;
      const sprites=()=>qa.scene.children.list.filter((o:any)=>o.texture?.key?.startsWith('workshop-tiles-'));
      const count=sprites().length;
      for(let i=0;i<10;i++)qa.scene.renderState();
      return {count,after:sprites().length,visible:sprites().filter((o:any)=>o.visible).length};
    });
    expect(spriteState.visible).toBeGreaterThan(50);
    expect(spriteState.after).toBe(spriteState.count);
    await expect(page.locator('.wood-panel-shell')).toHaveCount(viewport.width>700?4:2);
    const cards = await page.locator('.hud-card').evaluateAll(nodes => nodes.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
    for (const c of cards) { expect(c.x).toBeGreaterThanOrEqual(-1);expect(c.y).toBeGreaterThanOrEqual(-1);expect(c.right).toBeLessThanOrEqual(viewport.width+1);expect(c.bottom).toBeLessThanOrEqual(viewport.height+1); }
    for (let a=0;a<cards.length;a++) for(let b=a+1;b<cards.length;b++) {
      const x=cards[a]!,y=cards[b]!;
      expect(Math.min(x.right,y.right)-Math.max(x.x,y.x)>1 && Math.min(x.bottom,y.bottom)-Math.max(x.y,y.y)>1).toBe(false);
    }
    await mkdir(out,{recursive:true});
    await page.screenshot({path:`${out}/arena-${viewport.width}.png`});
    if (viewport.width > 700) {
      await page.evaluate(() => {
        const qa = (window as any).__boardEffectsQA;
        const state = qa.engine.state;
        state.options.matchVariant = 'teams';
        state.participants.forEach((p:any,i:number)=>{
          p.config.teamId = i < 2 ? 'team-1' : 'team-2';
          if(i===0) p.board.grid[2][0]='Z';
          if(i===3) p.board.alive=false;
          p.board.staticRenderRevision++;
        });
        qa.scene.runtime.onState(state); qa.scene.renderState();
      });
      await page.screenshot({path:`${out}/teams-danger-out.png`});
      await expect(page.locator('.hud-card.is-out')).toHaveCount(1);
    }
    expect(errors).toEqual([]);
  });
}

