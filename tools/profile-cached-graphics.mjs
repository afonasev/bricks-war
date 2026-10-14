import {chromium} from '@playwright/test';import {writeFile,mkdir} from 'node:fs/promises';

const output=process.env.BRICKS_GEOMETRY_PROFILE_OUTPUT??'evidence/cache-static-graphics-geometry';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio']});
try{
 const p=await browser.newPage({viewport:{width:1600,height:950},deviceScaleFactor:2});await p.goto('http://127.0.0.1:4187/?muted=1&playtest-performance=1');await p.bringToFront();await p.getByRole('button',{name:/^Битва(?: |$)/}).click();while(await p.locator('select[data-slot]').count()<4)await p.locator('[data-add-ai]').first().click();await p.locator('#start-match').click();await p.waitForFunction(()=>window.__boardEffectsQA?.engine.state.phase==='playing');
 const data=await p.evaluate(async()=>{
  const {scene,engine}=window.__boardEffectsQA;scene.game.loop.stop();const s=engine.state;s.shieldPresentations=[];s.anomalyBurnEvents=[];s.clearPresentations=[];s.attackQueues={};s.attackLaunchEvents=[];s.anomalyCueEvents=[];
  const {pieceDefinition}=await import('/src/simulation/tetrominoes.ts');
  s.participants.forEach(p=>{p.board.grid.forEach((r,y)=>r.fill(y>=10?'T':null));p.board.active={definition:pieceDefinition('T'),rotation:0,x:3,y:3};p.board.staticRenderRevision++});scene.activePieceInterpolation.reset(s.participants);
  const mixed=['marmalade','construction-bricks','sea-crystals','stone-fortress'];
  const {cacheGraphicsGeometry}=await import('/src/rendering/graphicsGeometryCache.ts');const cases=[];const legacy={graphics:scene.staticGraphics,cache:{destroy(){}}};const handles=()=>scene.staticCards?Array.from(scene.staticCards.values()):[legacy];const enable=cached=>{for(const c of handles()){c.cache.destroy();if(cached)c.cache=cacheGraphicsGeometry(c.graphics)}};
  const render=()=>{scene.game.renderer.preRender();scene.game.scene.render(scene.game.renderer);scene.game.renderer.postRender()};
  for(const style of ['mixed','classic','construction-bricks','pixel-adventure','stone-fortress','marmalade','forest-mosaic','sea-crystals']){
   s.participants.forEach((p,i)=>{p.resolvedTileStyle=style==='mixed'?mixed[i]:style;p.board.staticRenderRevision++});scene.renderState();
   for(const cached of [false,true]){
    enable(cached);
    const samples=[];let coldMs=0;
    for(let i=0;i<25;i++){const t=performance.now();render();const ms=performance.now()-t;if(i===0)coldMs=ms;if(i>=5)samples.push(ms)}samples.sort((a,b)=>a-b);
    cases.push({png:scene.game.canvas.toDataURL(),style,cached,tiles:480,coldMs,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p50Ms:samples[10],p95Ms:samples[19],cacheBytes:cached?handles().reduce((s,c)=>s+c.cache.byteLength,0):0,hits:cached?handles().reduce((s,c)=>s+c.cache.hits,0):0,misses:cached?handles().reduce((s,c)=>s+c.cache.misses,0):0});
   }
  }
  window.__comparison={scene,enable,render};
  return {scope:'Controlled 4 boards ×120 tiles; same viewport and DPR. Only render submission CPU, no simulation or GPU completion; hiding static layer is diagnostic, not a proposed visual change.',cases};
 });for(const c of data.cases){await writeFile(output+`/${c.style}-${c.cached?'cached':'native'}.png`,Buffer.from(c.png.split(',')[1],'base64'));delete c.png;}await writeFile(output+'/dense.json',JSON.stringify(data,null,2));console.log(data.cases);
 for(const cached of [false,true]){await p.evaluate(cached=>{const c=window.__comparison;c.enable(cached);c.render();c.render()},cached);await p.locator('#game-canvas canvas').screenshot({path:output+`/wide-${cached?'cached':'native'}.png`})}
}finally{await browser.close()}
