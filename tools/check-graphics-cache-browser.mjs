import {chromium} from '@playwright/test';import{writeFile}from'node:fs/promises';
const output='evidence/cache-static-graphics-geometry';const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4187/?muted=1&playtest-performance=1');await page.getByRole('button',{name:/^Битва(?: |$)/}).click();await page.locator('#start-match').click();await page.waitForFunction(()=>window.__boardEffectsQA?.engine.state.phase==='playing');
 const before=await page.evaluate(()=>{const {scene}=window.__boardEffectsQA;return {cards:scene.staticCards.size,bytes:Array.from(scene.staticCards.values()).reduce((s,c)=>s+c.cache.byteLength,0),errors:scene.game.renderer.gl.getError()}});
 await page.setViewportSize({width:430,height:932});await page.waitForTimeout(300);
 await page.keyboard.press('Escape');await page.waitForTimeout(100);await page.screenshot({path:output+'/phone-pause.png'});await page.keyboard.press('Escape');await page.waitForTimeout(300);await page.screenshot({path:output+'/phone.png'});
 const recovery=await page.evaluate(async()=>{
  const {scene}=window.__boardEffectsQA,canvas=scene.game.canvas,gl=scene.game.renderer.gl,ext=gl.getExtension('WEBGL_lose_context');
  if(!ext)return {status:'NotRun',reason:'WEBGL_lose_context unavailable'};
  await new Promise(resolve=>{canvas.addEventListener('webglcontextrestored',()=>setTimeout(resolve,300),{once:true});ext.loseContext();setTimeout(()=>ext.restoreContext(),150)});
  return {status:'passed',glError:scene.game.renderer.gl.getError(),bytes:Array.from(scene.staticCards.values()).reduce((s,c)=>s+c.cache.byteLength,0)};
 });await page.screenshot({path:output+'/phone-restored.png'});
 const cleanup=await page.evaluate(()=>{const {scene}=window.__boardEffectsQA;const caches=Array.from(scene.staticCards.values()).map(c=>c.cache),buffers=caches.flatMap(c=>c.bufferHandles);if(buffers.length!==scene.staticCards.size)throw new Error('Geometry ownership inventory mismatch');scene.game.scene.stop('play');return {ownedGeometryBuffersBefore:buffers.length,cacheBytes:caches.reduce((s,c)=>s+c.byteLength,0),cards:scene.staticCards.size,retainedGeometryBuffers:buffers.filter(b=>b.webGLBuffer&&scene.game.renderer.glBufferWrappers.includes(b)).length}});
 if(before.errors||errors.length||recovery.glError||cleanup.cacheBytes||cleanup.cards||cleanup.retainedGeometryBuffers)throw new Error(JSON.stringify({before,errors,recovery,cleanup}));
 await writeFile(output+'/browser-cache-lifecycle.json',JSON.stringify({before,recovery,cleanup,errors},null,2));console.log({before,recovery,cleanup});
}finally{await browser.close()}
