import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.env.BRICKS_PROFILE_ORIGIN??'http://127.0.0.1:4187'}/?muted=1&playtest-board-events=1`);
 await page.getByRole('button',{name:/^Битва(?: |$)/}).click();while(await page.locator('select[data-slot]').count()<4)await page.locator('[data-add-ai]').first().click();await page.locator('#start-match').click();
 await page.waitForFunction(()=>window.__boardEffectsQA?.engine.state.phase==='playing');
 const result=await page.evaluate(()=>{
  const {scene,engine}=window.__boardEffectsQA;scene.game.loop.stop();
  const exercise=()=>{for(const calm of [false,true]){document.body.classList.toggle('calm-effects',calm);for(let rows=1;rows<=4;rows++)for(let frame=0;frame<=24;frame++)for(const p of engine.state.participants)scene.drawFireBand(p.config.id,0,0,26,rows,frame/24)}};
  const keys=()=>Object.keys(scene.textures.list).filter(k=>k.startsWith('fire-band-'));
  exercise();const first=keys();exercise();const second=keys();
  if(scene.fireFrames.size!==104||first.length!==104||JSON.stringify(first)!==JSON.stringify(second))throw new Error('Cache must be exactly bounded, shared and reused');
  scene.game.scene.stop('play');const after=keys();if(after.length)throw new Error('Shutdown leaked fire textures');
  return {participants:4,animatedFrames:100,calmFrames:4,texturesAfterFirstPass:first.length,texturesAfterSecondPass:second.length,texturesAfterShutdown:after.length};
 });if(errors.length)throw new Error(errors.join('\n'));await writeFile('evidence/optimize-four-player-effects/cache-lifecycle.json',JSON.stringify({...result,errors},null,2));console.log(result);
}finally{await browser.close()}
