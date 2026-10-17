import { expect, test } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const out=process.env.BRICKS_WORKSHOP_CAPTURE_DIR ?? 'evidence/toy-workshop-arena/material-study';

for (const viewport of [{width:1440,height:960},{width:1280,height:800},{width:1280,height:720}]) test(`real desktop solo material study at ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);
  const label=viewport.width===1440?'1440':`${viewport.width}-${viewport.height}`;
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?muted=1&playtest-board-events=1');
  await page.getByRole('button',{name:/^Выживание/}).click();
  const remove=page.getByRole('button',{name:'Удалить Игрок 2'});
  if(await remove.count())await remove.click();
  await page.getByRole('combobox',{name:'Стиль участника 1',exact:true}).click();
  await page.getByRole('option',{name:'Классика',exact:true}).click();
  await page.locator('#start-match').click();
  await expect(page.locator('.match-loading')).toHaveCount(0);
  await expect(page.locator('#countdown')).toBeHidden({timeout:6000});
  await expect(page.locator('#arena-event-notice')).toBeHidden({timeout:6000});
  await page.evaluate(()=>{
    const qa=(window as any).__boardEffectsQA; qa.scene.scene.pause();
    const p=qa.engine.state.participants[0];
    p.resolvedTileStyle='classic';
    const kinds=['Z','L','O','S','I','T'];
    p.board.grid.forEach((row:any[])=>row.fill(null));
    // A representative stepped pile; only the localhost QA state is arranged.
    const heights=[8,8,7,5,4,4,3,5,6,7];
    const h=p.board.grid.length;
    for(let x=0;x<10;x++)for(let y=h-heights[x]!;y<h;y++)p.board.grid[y][x]=kinds[(x+y*3+Math.floor(y/2))%kinds.length];
    if(p.board.active){p.board.active.y=7;}
    p.board.staticRenderRevision++;
    qa.scene.runtime.onState(qa.engine.state);qa.scene.renderState();
  });
  await expect(page.locator('.hud-card')).toHaveCount(1);
  const spriteState = await page.evaluate(() => {
    const qa = (window as any).__boardEffectsQA;
    const sprites = () => qa.scene.children.list.filter((o:any) => o.texture?.key === 'workshop-tiles-f5');
    const before = sprites().length;
    for (let i=0;i<20;i++) qa.scene.renderState();
    const visible = sprites().filter((o:any)=>o.visible);
    return {before, after:sprites().length, visible:visible.length,
      ghosts:visible.filter((o:any)=>o.alpha===.28).length};
  });
  expect(spriteState.visible).toBeGreaterThan(50);
  expect(spriteState.ghosts).toBeGreaterThan(0);
  expect(spriteState.after).toBe(spriteState.before);

  const card=await page.locator('.hud-card').boundingBox();expect(card).not.toBeNull();
  const bounds=await page.locator('.hud-card').evaluate(el=>{
    const rect=(s:string)=>{const r=el.querySelector(s)!.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
    return {name:rect('.hud-identity'),stats:rect('.hud-stats'),shield:rect('.shield-inventory'),next:rect('.hud-next-piece')};
  });
  expect(bounds.name.bottom).toBeLessThanOrEqual(bounds.stats.y+1);
  const rects=Object.values(bounds);
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    const a=rects[i]!,b=rects[j]!;
    expect(Math.min(a.right,b.right)>Math.max(a.x,b.x) && Math.min(a.bottom,b.bottom)>Math.max(a.y,b.y)).toBe(false);
  }
  expect(bounds.shield.bottom).toBeLessThanOrEqual(bounds.stats.y);
  expect(bounds.next.bottom).toBeLessThanOrEqual(bounds.stats.y);
  expect(bounds.shield.right).toBeLessThanOrEqual(bounds.next.x);
  expect(bounds.stats.bottom).toBeLessThan(card!.y+80);
  expect(bounds.next.bottom).toBeLessThan(card!.y+80);
  expect(errors).toEqual([]);
  await mkdir(out,{recursive:true});
  await page.screenshot({path:`${out}/runtime-${label}.png`});
  await writeFile(`${out}/geometry-${label}.json`,JSON.stringify({viewport,card,bounds,errors},null,2));
  if(viewport.width!==1440)return;
  // Comparison uses the unmodified full runtime capture. CSS crops the source
  // concept's first field and the runtime's centered field at the same scale.
  const actual=(await readFile(`${out}/runtime-${label}.png`)).toString('base64');
  const concept=(await readFile('evidence/toy-workshop-arena/concepts/workshop.png')).toString('base64');
  const crop={x:card!.x-25,y:card!.y-22,w:card!.width+50,h:card!.height+48};
  const scale=790/crop.h;
  const html=`<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#f6eddc;color:#4b321d;font:18px Arial}main{display:flex;gap:48px;justify-content:center;padding:28px}h2{font-size:24px;margin:0 0 8px}p{margin:0 0 18px;color:#765e43;font-size:15px}.crop{position:relative;overflow:hidden;border-radius:8px}.crop img{position:absolute;max-width:none}.concept{width:380px;height:790px}.concept img{width:1536px;height:1024px;left:-22px;top:-80px}.runtime{width:${crop.w*scale}px;height:790px}.runtime img{width:${1440*scale}px;height:${960*scale}px;left:${-crop.x*scale}px;top:${-crop.y*scale}px}footer{padding:0 38px 22px;font-size:14px}
    </style><main><section><h2>Утверждённый макет</h2><p>Первое поле · изображение-концепт</p><div class="crop concept"><img src="data:image/png;base64,${concept}"></div></section><section><h2>Настоящая игра</h2><p>Phaser runtime · desktop solo · без ретуши</p><div class="crop runtime"><img src="data:image/png;base64,${actual}"></div></section></main><footer>Сравниваем материал корпуса, поля и плиток. Раскладка фигур в runtime — локальная QA-фикстура. Визуальная приёмка открыта.</footer>`;
  await writeFile(`${out}/comparison.html`,html.replace(`data:image/png;base64,${actual}`,'runtime-1440.png').replace(`data:image/png;base64,${concept}`,'../concepts/workshop.png'));
  const review=await page.context().newPage();
  await review.setViewportSize({width:1000,height:960});await review.setContent(html);
  await review.locator('img').evaluateAll(async imgs=>{await Promise.all(imgs.map(img=>(img as HTMLImageElement).decode()));});
  await review.screenshot({path:`${out}/comparison.png`,fullPage:true});
  await review.close();
});
