// Local real match, without accelerated simulation. No device FPS acceptance.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const origin=process.env.BRICKS_PROFILE_ORIGIN??'http://127.0.0.1:4187';
const output='evidence/optimize-four-player-effects/live-expert.json';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/?muted=1&playtest-performance=1`);
 await page.getByRole('button',{name:/^Битва(?: |$)/}).click();
 while(await page.locator('select[data-slot]').count()<4)await page.locator('[data-add-ai]').first().click();
 for(let i=0;i<4;i++)await page.locator(`select[data-slot="${i}"]`).selectOption('ai-expert',{force:true});
 await page.locator('#start-match').click();
 await page.waitForFunction(()=>window.__boardEffectsQA?.engine.state.phase==='playing');
 const result=await page.evaluate(async()=>{
  const {scene,engine}=window.__boardEffectsQA;
  const series={simulation:[],actionsIncludingAi:[],hudAndAudio:[],renderPreparation:[],frameIntervals:[]};
  const restore=[];
  const wrap=(obj,key,name)=>{const fn=obj[key];obj[key]=function(...args){const t=performance.now();const r=fn.apply(this,args);series[name].push(performance.now()-t);return r};restore.push(()=>obj[key]=fn)};
  wrap(engine,'step','simulation');wrap(scene,'collectActions','actionsIncludingAi');wrap(scene.runtime,'onState','hudAndAudio');wrap(scene,'renderState','renderPreparation');
  let last=performance.now();const frame=()=>{const now=performance.now();series.frameIntervals.push(now-last);last=now};scene.game.events.on('postrender',frame);
  await new Promise(r=>setTimeout(r,20000));restore.forEach(r=>r());scene.game.events.off('postrender',frame);
  const stats=xs=>{xs.sort((a,b)=>a-b);return {count:xs.length,meanMs:xs.reduce((a,b)=>a+b,0)/xs.length,p95Ms:xs[Math.floor(xs.length*.95)],maxMs:xs.at(-1),over16ms:xs.filter(x=>x>16.667).length,over33ms:xs.filter(x=>x>33.333).length}};
  return {measurement:'20s live four expert bots; no fast-forward; headless Chrome on this Mac, not gaming PC',participants:engine.state.participants.map(p=>({controller:p.config.controller,difficulty:p.config.difficulty,placedPieces:p.placedPieces})),phase:engine.state.phase,elapsedMs:engine.state.elapsedMs,renderer:scene.game.renderer.type,stats:Object.fromEntries(Object.entries(series).map(([k,v])=>[k,stats(v)]))};
 });
 if(errors.length||result.participants.some(p=>p.controller!=='ai'||p.difficulty!=='expert'))throw new Error(JSON.stringify({errors,result}));
 await mkdir('evidence/optimize-four-player-effects',{recursive:true});await writeFile(output,JSON.stringify({...result,errors},null,2));console.log(JSON.stringify(result.stats,null,2));
}finally{await browser.close()}
