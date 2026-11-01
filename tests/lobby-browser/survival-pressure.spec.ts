import {test,expect} from '@playwright/test';
import {openLocalLobby} from '../helpers/localLobby';
for(const [width,height]of [[1440,960],[390,844]]as const)test(`real Survival keeps one-second pressure and pauses every warning ${width}`,async({page})=>{
 await page.setViewportSize({width,height});
 await page.addInitScript(()=>localStorage.setItem('bricks-war:language:v1','en'));
 await page.goto('/?muted=1&playtest-board-events=1');
 await openLocalLobby(page,'survival');await page.locator('#start-match').click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__boardEffectsQA?.engine.state.phase),{timeout:10000}).toBe('playing');
 await page.evaluate(()=>{
  const e=(window as any).__boardEffectsQA.engine;
  e.state.elapsedMs=404999;e.state.nextPressureAtMs=405000;e.state.finalPushActive=true;
  for(const p of e.state.participants){p.shieldCount=0;p.shieldReady=false;}
 });
 await expect.poll(()=>page.locator('.hud-card').first().getAttribute('data-gray-rows'),{timeout:10000}).toBe('4');
 const state=await page.evaluate(()=>{
  const e=(window as any).__boardEffectsQA.engine;const p=e.state.participants[0];const q=e.state.attackQueues[p.config.id];
  return {pressure:e.state.nextPressureAtMs-e.state.elapsedMs,warnings:q.filter((a:any)=>a.phase==='warning').length,rows:p.board.grid.filter((r:any[])=>r.every(c=>c==='garbage')).length};
 });
 expect(state.rows).toBeGreaterThanOrEqual(4);expect(state.warnings).toBe(3);expect(state.pressure).toBeLessThanOrEqual(1000);
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/pressure-${width}.png`});
 if(width===390)await page.locator('#manual-pause').click();else await page.keyboard.press('Escape');
 const frozen=await page.evaluate(()=>{const e=(window as any).__boardEffectsQA.engine;return JSON.stringify({time:e.state.elapsedMs,queues:e.state.attackQueues});});
 await page.waitForTimeout(700);
 expect(await page.evaluate(()=>{const e=(window as any).__boardEffectsQA.engine;return JSON.stringify({time:e.state.elapsedMs,queues:e.state.attackQueues});})).toBe(frozen);
 await page.locator('#continue-match').click();
 await expect.poll(()=>page.locator('.hud-card').first().getAttribute('data-gray-rows')).toBe('5');
});
