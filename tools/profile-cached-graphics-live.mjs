import {chromium} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const output='evidence/cache-static-graphics-geometry/live';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio'],ignoreDefaultArgs:['--disable-background-timer-throttling']});
const processSamples=[];let monitor;
try{
 const context=await browser.newContext({viewport:{width:1600,height:950},deviceScaleFactor:2,serviceWorkers:'block'});
 await context.addInitScript(seed=>{const native=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=(values)=>{native(values);if(values instanceof Uint32Array&&values.length===1)values[0]=seed;return values};},2258076429);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4187/?muted=1&playtest-performance=1');await page.bringToFront();
 await page.getByRole('button',{name:/^Битва(?: |$)/}).click();
 while(await page.locator('select[data-slot]').count()<4)await page.locator('[data-add-ai]').first().click();
 for(let i=0;i<4;i++)await page.locator(`select[data-slot="${i}"]`).selectOption('ai-expert',{force:true});
 await page.locator('#start-match').click();await page.waitForFunction(()=>window.__boardEffectsQA?.engine.state.phase==='playing');
 const cdp=await context.newCDPSession(page),system=await browser.newBrowserCDPSession();
 await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
 const gpuInfo=await system.send('SystemInfo.getInfo');
 await writeFile(output+'/gpu-info.json',JSON.stringify({gpu:gpuInfo.gpu,modelName:gpuInfo.modelName,modelVersion:gpuInfo.modelVersion},null,2));
 await page.evaluate(()=>{
  const {scene,engine}=window.__boardEffectsQA;
  const all=window.__perf={frames:[],restores:[],gpuTimer:'NotRun: EXT_disjoint_timer_query unavailable',memory:[]};
  const totals={};let last=performance.now();
  const wrap=(obj,key,name)=>{const fn=obj[key];obj[key]=function(...args){const t=performance.now();try{return fn.apply(this,args)}finally{totals[name]=(totals[name]??0)+performance.now()-t}};all.restores.push(()=>obj[key]=fn)};
  wrap(engine,'step','simulation');wrap(scene,'collectActions','aiAndInput');wrap(scene.runtime,'onState','hudAndAudio');wrap(scene,'renderState','renderPreparation');wrap(scene.game.scene,'render','rendererSubmission');wrap(scene.game.renderer,'postRender','rendererFlush');
  for(const method of ['drawStaticBoardCard','drawBoardCard','drawFireBand','drawClearPresentation'])wrap(scene,method,method);
  const gl=scene.game.renderer.gl,ext=gl?.getExtension('EXT_disjoint_timer_query');all.gpuTimer=ext?'available (not sampled to avoid altering rendering)':'NotRun: EXT_disjoint_timer_query unavailable';
  all.environment={userAgent:navigator.userAgent,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],canvas:[scene.game.canvas.width,scene.game.canvas.height],renderer:scene.game.renderer.type,visibility:document.visibilityState};
  const frame=()=>{const now=performance.now(),s=engine.state;all.frames.push({t:now,dt:now-last,elapsed:s.elapsedMs,phase:s.phase,alive:s.participants.filter(p=>p.board.alive).length,effects:s.anomalyBurnEvents.length+s.shieldPresentations.length+s.attackLaunchEvents.length+s.anomalyCueEvents.length+s.clearPresentations.length+Object.keys(s.attackQueues).length,...totals});last=now;for(const k of Object.keys(totals))totals[k]=0;};
  scene.game.events.on('postrender',frame);all.restores.push(()=>scene.game.events.off('postrender',frame));
  all.engine=engine;
 });
 const started=Date.now();let ticks=0;
 monitor=setInterval(async()=>{try{const data=await system.send('SystemInfo.getProcessInfo');const processes=data.processInfo.map(p=>{let rssKb=null;try{rssKb=Number(execFileSync('ps',['-p',String(p.id),'-o','rss='],{encoding:'utf8'}).trim())}catch{}return {...p,rssKb}});processSamples.push({wallMs:Date.now()-started,processes});}catch{}},1000);
 for(let chunk=0;chunk<3;chunk++){
  if(chunk===2)await cdp.send('Profiler.start');
  await page.waitForTimeout(30000);
  const checkpoint=await page.evaluate(()=>({elapsed:window.__boardEffectsQA.engine.state.elapsedMs,alive:window.__boardEffectsQA.engine.state.participants.filter(p=>p.board.alive).length,burns:window.__boardEffectsQA.engine.state.anomalyBurnSerial,attacks:window.__boardEffectsQA.engine.state.attackSerial,shields:window.__boardEffectsQA.engine.state.shieldPresentationSerial,frames:window.__perf.frames.length,phase:window.__boardEffectsQA.engine.state.phase}));
  console.log(JSON.stringify({wallSeconds:(Date.now()-started)/1000,...checkpoint}));
 }
 const {profile}=await cdp.send('Profiler.stop');await writeFile(output+'/active.cpuprofile',JSON.stringify(profile));
 clearInterval(monitor);monitor=null;
 const data=await page.evaluate(()=>{const p=window.__perf;p.restores.forEach(r=>r());return {environment:p.environment,gpuTimer:p.gpuTimer,frames:p.frames,final:structuredClone(p.engine.state)}});
 await page.locator('#game-canvas canvas').screenshot({path:output+'/active.png'});
 await writeFile(output+'/measurement.json',JSON.stringify({...data,errors,cache:await page.evaluate(()=>Array.from(window.__boardEffectsQA.scene.staticCards.values()).map(c=>({bytes:c.cache.byteLength,hits:c.cache.hits,misses:c.cache.misses}))),source:execFileSync('git',['rev-parse','HEAD'],{cwd:process.cwd(),encoding:'utf8'}).trim(),profileWindow:'last 30s; first 60s without sampling profiler',processSamples}));
 console.log('saved '+data.frames.length+' frames; '+errors.length+' page errors');
}finally{if(monitor)clearInterval(monitor);await browser.close()}
