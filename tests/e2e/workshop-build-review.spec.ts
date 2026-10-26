import { openLocalLobby } from '../helpers/localLobby';
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out=process.env.BRICKS_PANEL_CAPTURE_DIR ?? 'evidence/toy-workshop-arena/playable-f11';
for(const scenario of [
  {id:'players-1',count:1,mode:'Выживание',width:1440,height:960},
  {id:'players-2',count:2,mode:'Битва',width:1440,height:960},
  {id:'players-3',count:3,mode:'Битва',width:1440,height:960},
  {id:'players-4',count:4,mode:'Битва',width:1440,height:960},
  {id:'mobile',count:2,mode:'Битва',width:390,height:844},
  {id:'teams',count:4,mode:'Командный бой',width:1440,height:960},
]) test(`playable review ${scenario.id}`,async({page})=>{
  await page.setViewportSize(scenario);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?muted=1&playtest-board-events=1');
  await openLocalLobby(page,scenario.mode);
  while(scenario.width>700 && await page.locator('[data-remove-slot]').count()>scenario.count)await page.locator('[data-remove-slot]').last().click();
  while(scenario.width>700 && await page.locator('[data-remove-slot]').count()<scenario.count)await page.getByRole('button',{name:'Добавить ИИ',exact:true}).first().click();
  await page.locator('#start-match').click();
  await expect(page.locator('.match-loading')).toHaveCount(0);
  await expect(page.locator('#countdown')).toBeHidden({timeout:6000});
  await expect(page.locator('#arena-event-notice')).toBeHidden({timeout:6000});
  const state=await page.evaluate(()=>{
    const qa=(window as any).__boardEffectsQA;qa.scene.scene.pause();
    qa.engine.state.participants.forEach((p:any)=>{
      p.resolvedTileStyle='classic';p.board.active=null;p.board.grid.forEach((r:any[])=>r.fill(null));
      const kinds=['Z','L','O','S','I','J','T'],heights=[8,8,7,5,4,4,3,5,6,7],h=p.board.grid.length;
      for(let x=0;x<10;x++)for(let y=h-heights[x]!;y<h;y++)p.board.grid[y][x]=kinds[(x+y*3+Math.floor(y/2))%7];
      for(let x=0;x<7;x++)p.board.grid[7][x+1]=kinds[x];
      p.board.staticRenderRevision++;
    });
    qa.scene.runtime.onState(qa.engine.state);qa.scene.renderState();
    return {count:qa.engine.state.participants.length,variant:qa.engine.state.options.matchVariant};
  });
  expect(state.count).toBe(scenario.count);
  if(scenario.id==='teams')expect(state.variant).toBe('teams');
  const rects=await page.locator('.wood-panel-shell,.wood-panel-foot').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
  for(const r of rects){expect(r.x).toBeGreaterThanOrEqual(-1);expect(r.right).toBeLessThanOrEqual(scenario.width+1);expect(r.y).toBeGreaterThanOrEqual(-1);expect(r.bottom).toBeLessThanOrEqual(scenario.height+1);}
  const shells=await page.locator('.wood-panel-foot').evaluateAll(nodes=>nodes.filter(n=>getComputedStyle(n).display!=='none').map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
  for(let a=0;a<shells.length;a++)for(let b=a+1;b<shells.length;b++){const x=shells[a]!,y=shells[b]!;expect(Math.min(x.right,y.right)>Math.max(x.x,y.x)&&Math.min(x.bottom,y.bottom)>Math.max(x.y,y.y)).toBe(false);}
  expect(errors).toEqual([]);await mkdir(out,{recursive:true});
  await page.screenshot({path:`${out}/${scenario.id}.png`});
  await writeFile(`${out}/${scenario.id}.json`,JSON.stringify({state,rects,errors},null,2));
});
