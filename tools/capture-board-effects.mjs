// Real game frames + game WebAudio output. No audition or synthesized replacement track.
import {chromium} from '@playwright/test';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const origin=process.env.BRICKS_CAPTURE_ORIGIN??'http://127.0.0.1:4187';
const output=path.resolve(process.env.BRICKS_CAPTURE_OUTPUT??'evidence/systematize-board-event-effects/gameplay');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try{
 for(const name of (process.env.BRICKS_CAPTURE_CASES??'queue,defense,anomaly,simultaneous,phone,phone-anomaly').split(',')){
  const viewport=name.startsWith('phone')?{width:390,height:844}:{width:1280,height:800};
  const context=await browser.newContext({viewport,serviceWorkers:'block'});
  await context.addInitScript(()=>{
   const Original=window.AudioContext;
   window.AudioContext=class extends Original{constructor(...args){super(...args);const capture=this.createMediaStreamDestination();window.__audioCapture=capture;
    const original=AudioNode.prototype.connect;
    if(!window.__captureConnect){window.__captureConnect=true;AudioNode.prototype.connect=function(target,...rest){const result=original.call(this,target,...rest);if(target===this.context.destination&&window.__audioCapture?.context===this.context)original.call(this,window.__audioCapture);return result;};}
   }};
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/?playtest-board-events=1`);
  await page.getByRole('button',{name:/^Битва(?: |$)/}).click();
  if((name==='queue'||name==='simultaneous')&&await page.locator('#add-slot').count())await page.locator('#add-slot').click();
  await page.locator('#start-match').click();
  await page.waitForFunction(()=>window.__boardEffectsQA?.engine.state.phase==='playing'&&window.__boardEffectsQA.audio.boardEventBuffers.size===7);
  await page.waitForTimeout(1300);
  await page.evaluate(()=>{const q=window.__boardEffectsQA;q.audio.setMusicVolume(0);q.audio.setEffectsVolume(1);});
  const frames=path.join(output,`${name}-frames`);await mkdir(frames,{recursive:true});
  const cdp=await context.newCDPSession(page);let count=0;const images=[],pending=[];
  cdp.on('Page.screencastFrame',e=>{const i=count++;images.push({file:`frame-${String(i).padStart(5,'0')}.jpg`,time:e.metadata.timestamp});pending.push(writeFile(path.join(frames,images.at(-1).file),Buffer.from(e.data,'base64')));void cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId});});
  const start=await page.evaluate(()=>{window.__audioChunks=[];const r=window.__audioRecorder=new MediaRecorder(window.__audioCapture.stream,{mimeType:'audio/webm;codecs=opus'});r.ondataavailable=e=>window.__audioChunks.push(e.data);r.start();return Date.now()/1000;});
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:viewport.width,maxHeight:viewport.height,everyNthFrame:1});
  const trace=[];const begin=Date.now();let action=0;const duration=name==='queue'?19000:name==='defense'?12500:8000;
  while(Date.now()-begin<duration){const elapsed=Date.now()-begin;
   const checkpoint=await page.evaluate(({name,elapsed,action})=>{
    const q=window.__boardEffectsQA,e=q.engine,p=e.state.participants,recipient=p[0];
    let next=action;
    if(action===0){for(const player of p){player.board.grid.forEach(r=>r.fill(null));player.board.staticRenderRevision++;}for(let y=19;y<22;y++)for(let x=0;x<8;x++)recipient.board.grid[y][x]=['J','L','O'][(x+y)%3];recipient.board.staticRenderRevision++;
     if(name==='queue'){e.options.conflictTargeting='hunt-leader';recipient.score=2000;q.prepareClearPlaytest(p[1].board,'normal',3);}
     else if(name==='defense'){q.prepareClearPlaytest(recipient.board,'normal',1);}
     else if(name==='deadline'){e.options.battleTimeMode='timed';e.state.options.battleTimeMode='timed';e.state.durationMs=60000;e.state.elapsedMs=58000;e.state.remainingMs=2000;e.state.nextPressureAtMs=60001;e.state.finalPushActive=true;recipient.score=500;recipient.shieldCount=1;e.enqueueBoardAttack(recipient.config.id,3,'conflict',p[1].config.id);e.enqueueBoardAttack(recipient.config.id,1,'pressure');}
     else if(name==='phone'){p[1].config.label='Екатерина Санкт-Петербург';e.enqueueBoardAttack(recipient.config.id,3,'conflict',p[1].config.id);e.enqueueBoardAttack(recipient.config.id,1,'pressure');}
     else if(name==='simultaneous'){e.options.conflictTargeting='hunt-leader';recipient.score=2000;q.prepareClearPlaytest(p[1].board,'normal',3);q.prepareClearPlaytest(p[2].board,'normal',3);e.state.nextPressureAtMs=e.state.elapsedMs+600;}
     else q.prepareClearPlaytest(recipient.board,'fire',2);
     next=1;
    }
    if(name==='queue'&&action===1&&elapsed>1200){const sender=p[2]??p[1];q.prepareClearPlaytest(sender.board,'normal',2);next=2;}
    if(name==='queue'&&action===2&&elapsed>2500){e.state.nextPressureAtMs=e.state.elapsedMs+1;recipient.shieldCount=1;recipient.shieldReady=true;next=3;}
    if(name==='defense'&&action===1&&elapsed>1300){q.prepareClearPlaytest(recipient.board,'normal',1);next=2;}
    if(name==='defense'&&action===2&&elapsed>4000){e.enqueueBoardAttack(recipient.config.id,2,'conflict',p[1].config.id);e.enqueueBoardAttack(recipient.config.id,1,'pressure');q.prepareClearPlaytest(recipient.board,'normal',1);next=3;}
    if(name==='defense'&&action===3&&elapsed>8300){q.prepareClearPlaytest(recipient.board,'normal',1);next=4;}
    return {next,elapsed:e.state.elapsedMs,phase:e.state.phase,remainingMs:e.state.remainingMs,queues:structuredClone(e.state.attackQueues),shield:recipient.shieldCount,grayRows:recipient.board.grid.filter(row=>row.some(c=>c==='garbage')).length,burn:e.state.anomalyBurnSerial,cue:e.state.anomalySuccessSerial};
   },{name,elapsed,action});action=checkpoint.next;trace.push({wallMs:elapsed,...checkpoint});
   if(elapsed>700&&elapsed<1100||elapsed>4700&&elapsed<5100){await page.screenshot({path:path.join(output,`${name}-${elapsed>4000?'later':'during'}.png`)});}
   await page.waitForTimeout(100);
  }
  await cdp.send('Page.stopScreencast');await Promise.all(pending);
  if(name==='deadline'){
   const ended=trace.find(t=>t.phase==='results'),last=trace.at(-1);
   if(!ended||ended.wallMs<1800||ended.wallMs>2400||last.remainingMs!==0||last.shield!==1||last.grayRows!==0||Object.keys(last.queues).length)
    throw new Error('Timed deadline capture must end after two seconds with its unfinished attacks canceled');
  }
  const audio=await page.evaluate(async()=>{const r=window.__audioRecorder;await new Promise(resolve=>{r.onstop=resolve;r.stop();});const b=await new Blob(window.__audioChunks,{type:'audio/webm'}).arrayBuffer();return Array.from(new Uint8Array(b));});
  const audioPath=path.join(frames,'audio.webm');await writeFile(audioPath,Buffer.from(audio));
  // Use browser timestamps, preserving recorded timing instead of assuming a constant frame rate.
  const valid=images.filter(f=>f.time>=start);const list=[];
  for(let i=0;i<valid.length;i++){list.push(`file '${valid[i].file}'`);if(i+1<valid.length)list.push(`duration ${Math.max(.001,valid[i+1].time-valid[i].time)}`);}
  await writeFile(path.join(frames,'frames.txt'),list.join('\n'));
  const offset=Math.max(0,(valid[0]?.time??start)-start);
  const result=spawnSync('/opt/homebrew/bin/ffmpeg',['-y','-f','concat','-safe','0','-i',path.join(frames,'frames.txt'),'-ss',String(offset),'-i',audioPath,'-c:v','libx264','-crf','19','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-shortest',path.join(output,`${name}.mp4`)],{encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr.slice(-2000));
  await writeFile(path.join(output,`${name}-trace.json`),JSON.stringify({origin,viewport,start,offset,frameCount:valid.length,errors,trace},null,2));
  await page.screenshot({path:path.join(output,`${name}-after.png`)});await context.close();await rm(frames,{recursive:true});console.log(`${name}: ${valid.length} actual frames; ${errors.length} page errors`);
 }
}finally{await browser.close();}
