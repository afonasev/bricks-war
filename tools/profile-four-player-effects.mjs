import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const origin = process.env.BRICKS_PROFILE_ORIGIN ?? 'http://127.0.0.1:4187';
const output = process.argv[2] ?? 'evidence/optimize-four-player-effects/baseline.json';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
try {
 const page = await browser.newPage({ viewport: {width:1920,height:1080}, deviceScaleFactor:1 });
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 await page.goto(`${origin}/?muted=1&playtest-board-events=1`);
 await page.getByRole('button',{name:/^Битва(?: |$)/}).click();
 while(await page.locator('select[data-slot]').count()<4) await page.locator('[data-add-ai]').first().click();
 await page.locator('#start-match').click();
 await page.waitForFunction(()=>window.__boardEffectsQA?.engine.state.phase==='playing');
 const result = await page.evaluate(async()=>{
  const scene=window.__boardEffectsQA.scene;
  if(!scene)throw new Error('Scene not found');
  const s=window.__boardEffectsQA.engine.state;
  scene.game.loop.stop();
  const {pieceDefinition}=await import('/src/simulation/tetrominoes.ts');
  s.participants.forEach(p=>{p.resolvedTileStyle='classic';p.board.nextPiece=pieceDefinition('T');p.board.active={definition:pieceDefinition('T'),rotation:0,x:3,y:3};p.board.grid.forEach((r,y)=>r.fill(y>=10?'T':null));p.board.staticRenderRevision++});
  s.elapsedMs=5000;scene.activePieceInterpolation.reset(s.participants);scene.runtime.onState(s);
  const stats=(samples)=>{samples.sort((a,b)=>a-b);return {samples:samples.length,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p50Ms:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1)}};
  const cases={};
  for(const name of ['idle','shield','fire','combined']){
   s.shieldPresentations=name==='shield'||name==='combined'?s.participants.map((p,i)=>({serial:i+1,participantId:p.config.id,remainingMs:600,durationMs:1100,absorbedRows:1,remainingRows:0,deferredImpacts:[]})):[];
   s.anomalyBurnEvents=name==='fire'||name==='combined'?s.participants.map((p,i)=>({serial:i+1,participantId:p.config.id,rows:Array.from({length:4},()=>Array(10).fill('T')),pulseMs:500})):[];
   const samples=[],coldSamples=[],rendererSamples=[],fire=[],staticDraw=[];
   const wrap=(key,samples)=>{const fn=scene[key];scene[key]=function(...args){const t=performance.now();const r=fn.apply(this,args);samples.push(performance.now()-t);return r};return ()=>scene[key]=fn};
   const restoreFire=wrap('drawFireBand',fire),restoreStatic=wrap('drawStaticBoardCard',staticDraw);
   for(let i=0;i<250;i++){
    s.anomalyBurnEvents.forEach(e=>e.pulseMs=1000*(1-(i%25)/24));
    s.shieldPresentations.forEach(e=>e.remainingMs=1100-(i%60)*16);
    scene.time.now+=16.667;
    const t=performance.now();scene.renderState();const elapsed=performance.now()-t;
    const rt=performance.now();scene.game.renderer.preRender();scene.game.scene.render(scene.game.renderer);scene.game.renderer.postRender();
    if(i>=25){samples.push(elapsed);rendererSamples.push(performance.now()-rt)}else coldSamples.push(elapsed);
   }
   restoreFire();restoreStatic();
   cases[name]={renderPreparation:stats(samples),firstCyclePreparation:stats(coldSamples),rendererSubmission:stats(rendererSamples),fireFrameTextures:scene.fireFrames?.size ?? 0,fireCalls:fire.length,fireTotalMs:fire.reduce((a,b)=>a+b,0),staticDrawCalls:staticDraw.length};
  }
  const fireTextureCount=Object.keys(scene.textures.list).filter(k=>k.startsWith('fire-band-')).length;
  if(scene.fireFrames && fireTextureCount!==scene.fireFrames.size) throw new Error('Unowned fire texture leak');
  return {fireTextureCount,cases,participants:s.participants.length,renderer:scene.game.renderer.type,userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},contract:'Synchronous render preparation, same 250 frames per case, 25 warmup. Renderer submission measured separately; excludes GPU/compositor completion, simulation, HUD, audio; no FPS claim.'};
 });
 if(result.participants!==4||errors.length)throw new Error(JSON.stringify({result,errors}));
 await page.locator('#game-canvas canvas').screenshot({path:output.replace('.json','.png')});
 await mkdir(output.slice(0,output.lastIndexOf('/')),{recursive:true});
 await writeFile(output,JSON.stringify({...result,errors,baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()},null,2));
 console.log(JSON.stringify(result.cases,null,2));
 const cleanup=await page.evaluate(()=>{const scene=window.__boardEffectsQA.scene;scene.game.scene.stop('play');return Object.keys(scene.textures.list).filter(k=>k.startsWith('fire-band-'))});
 if(cleanup.length)throw new Error('Fire textures retained after scene shutdown: '+cleanup);
}finally{await browser.close()}
