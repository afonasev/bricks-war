import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

for (const viewport of [{width:1440,height:960},{width:390,height:844}]) {
  test(`shared anomaly arrival completes without a notice at ${viewport.width}px`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto('/?muted=1&playtest-anomaly-arrival=1');
    await page.getByRole('button',{name:/^Битва/}).click();
    await page.evaluate(()=>{
      const samples:{clock:string|null;phase:string|null;remaining:number}[]=[];
      (window as any).arrivalSamples=samples;
      new MutationObserver(()=>{const stage=document.querySelector('#game-stage');
        const phase=stage?.getAttribute('data-arrival-phase');
        if(phase==='clearing'||phase==='burning')samples.push({clock:document.querySelector('#match-clock, #mobile-match-timer')?.textContent??null,phase,remaining:Number(stage!.getAttribute('data-arrival-remaining-ms'))});
      }).observe(document.querySelector('#app')!,{subtree:true,attributes:true});
    });
    await page.locator('#start-match').click();
    const stage=page.locator('#game-stage');
    await expect(page.locator('[data-event-kind="level-up"]')).toHaveCount(0);
    await expect(stage).toHaveAttribute('data-arrival-serial','1',{timeout:10000});
    await expect(stage).toHaveAttribute('data-arrival-phase','');
    const samples=await page.evaluate(()=>(window as any).arrivalSamples as {clock:string;phase:string;remaining:number}[]);
    expect([...new Set(samples.map(sample=>sample.phase))]).toEqual(['clearing','burning']);
    const burnSamples=samples.filter(sample=>sample.phase==='burning');
    expect(burnSamples.length).toBeGreaterThan(2);
    expect(new Set(samples.map(sample=>sample.clock)).size).toBe(1);
    expect(Math.max(...burnSamples.map(sample=>sample.remaining))).toBeGreaterThan(900);
    expect(Math.min(...burnSamples.map(sample=>sample.remaining))).toBeLessThan(100);
    const cards=page.locator('.hud-card');
    expect(await page.locator('.hud-card.has-active-anomaly').count()).toBe(await cards.count());
    await expect(page.locator('[data-event-kind="level-up"]')).toHaveCount(0);
  });
}

test('records one actual runtime alarm at shared spawn and retains mute-independent event identity', async ({page},testInfo) => {
  await page.addInitScript(() => {
    const capture={tones:[] as {frequency:number;at:number}[],chunks:[] as Blob[],recorder:null as MediaRecorder|null};
    (window as unknown as {alarmCapture:typeof capture}).alarmCapture=capture;
    const originalConnect=AudioNode.prototype.connect;
    const streams=new WeakMap<BaseAudioContext,MediaStreamAudioDestinationNode>();
    AudioNode.prototype.connect=function(this: AudioNode,...args: unknown[]) {
      const result=Reflect.apply(originalConnect,this,args);
      if(args[0]===this.context.destination && this.context instanceof AudioContext) {
        let destination=streams.get(this.context);
        if(!destination) {
          destination=this.context.createMediaStreamDestination();streams.set(this.context,destination);
          capture.recorder=new MediaRecorder(destination.stream,{mimeType:'audio/webm;codecs=opus'});
          capture.recorder.ondataavailable=e=>capture.chunks.push(e.data);capture.recorder.start();
        }
        Reflect.apply(originalConnect,this,[destination]);
      }
      return result;
    } as typeof AudioNode.prototype.connect;
    const create=AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator=function(this: AudioContext) {
      const oscillator=create.call(this);const set=oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
      let frequency=0;
      oscillator.frequency.setValueAtTime=(value,time)=>{frequency=value;return set(value,time);};
      const start=oscillator.start.bind(oscillator);
      oscillator.start=(at=0)=>{if(frequency===620||frequency===310)capture.tones.push({frequency,at});start(at);};
      return oscillator;
    };
  });
  await page.goto('/?playtest-anomaly-arrival=1');
  await page.getByRole('button',{name:/^Настройки/}).click();
  await page.locator('#music-volume').press('Home');
  await expect(page.locator('#music-volume')).toHaveValue('0');
  await page.locator('#settings-back').click();
  await page.getByRole('button',{name:/^Битва/}).click();await page.locator('#start-match').click();
  await expect(page.locator('#game-stage')).toHaveAttribute('data-arrival-serial','1',{timeout:10000});
  await page.waitForTimeout(1100);
  const recording=await page.evaluate(async()=>{
    const capture=(window as any).alarmCapture;
    const recorder=capture.recorder as MediaRecorder;
    await new Promise<void>(done=>{recorder.onstop=()=>done();recorder.stop();});
    const bytes=new Uint8Array(await new Blob(capture.chunks).arrayBuffer());
    return {tones:capture.tones,bytes:Array.from(bytes)};
  });
  expect(recording.tones.filter((t:any)=>t.frequency===620)).toHaveLength(3);
  expect(recording.tones.filter((t:any)=>t.frequency===310)).toHaveLength(3);
  const path=testInfo.outputPath('runtime-alarm.webm');await writeFile(path,Buffer.from(recording.bytes));
  await testInfo.attach('actual runtime alarm',{path,contentType:'audio/webm'});
  if(process.env.BRICKS_ANOMALY_AUDIO_EVIDENCE) {
    const folder=resolve(process.env.BRICKS_ANOMALY_AUDIO_EVIDENCE);await mkdir(folder,{recursive:true});
    await writeFile(resolve(folder,'runtime-alarm.webm'),Buffer.from(recording.bytes));
    await writeFile(resolve(folder,'runtime-alarm.json'),JSON.stringify({seed:4217,tones:recording.tones,source:'actual GameAudio WebAudio output',viewport:await page.viewportSize()},null,2));
  }
});
