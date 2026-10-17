import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const out=process.env.BRICKS_WORKSHOP_CAPTURE_DIR ?? `evidence/toy-workshop-arena/material-study-${process.env.BRICKS_THEME_STAGE ? 'f6' : 'f5'}`;
test('sprite clear removes tiles while preserving score and duration',async({page})=>{
  await page.goto('/?muted=1&playtest-clear=normal-2&playtest-board-events=1');
  await page.getByRole('button',{name:/^Выживание/}).click();
  const remove=page.getByRole('button',{name:'Удалить Игрок 2'});
  if(await remove.count())await remove.click();
  await page.getByRole('combobox',{name:'Стиль участника 1',exact:true}).click();
  await page.getByRole('option',{name:'Классика',exact:true}).click();
  await page.locator('#start-match').click();
  // Pause the scene in the same frame the real engine reaches highlight, so
  // screenshot latency cannot skip the 180 ms phase. Simulation duration unchanged.
  await page.waitForFunction(()=>{
    const qa=(window as any).__boardEffectsQA;
    if(qa?.engine.state.clearPresentations[0]?.phase!=='highlight')return false;
    qa.scene.scene.pause();return true;
  });
  const counts:number[]=[];
  for(const [label,progress] of [['start',0],['middle',.5],['end',.99]] as const){
    const state=await page.evaluate((p)=>{
      const qa=(window as any).__boardEffectsQA;
      const event=qa.engine.state.clearPresentations[0];
      event.remainingMs=event.durationMs*(1-p);
      qa.scene.renderState();
      return {score:qa.engine.state.participants[0].score,phase:event.phase,rows:event.removedRows.length,duration:event.durationMs};
    },progress);
    expect(state).toEqual({score:0,phase:'highlight',rows:2,duration:180});
    counts.push(await page.evaluate(()=> (window as any).__boardEffectsQA.scene.children.list.filter((o:any)=>o.texture?.key==='workshop-tiles-f5' && o.visible).length));
    await mkdir(out,{recursive:true});
    await page.screenshot({path:`${out}/clear-${label}.png`});
  }
  expect(counts[0]).toBeGreaterThan(counts[2]!);
});
