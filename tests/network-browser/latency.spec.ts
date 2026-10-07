import {test,expect,type Page,type Browser} from '@playwright/test';
import {delayRelayProcess} from './delayRelayProcess';
import {mkdir,writeFile} from 'node:fs/promises';
const percentile=(values:number[],q:number)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1]!;
async function writeLatencyEvidence(filename:string,data:unknown){const directory=process.env.BRICKS_NETWORK_LATENCY_EVIDENCE_DIR;const repeat=test.info().repeatEachIndex;const name=repeat?filename.replace(/\.json$/,`-repeat-${repeat}.json`):filename;const destination=directory?`${directory}/${name}`:`/tmp/${name}`;if(directory)await mkdir(directory,{recursive:true});await writeFile(destination,JSON.stringify(data,null,2));}
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:/^Сетевая игра/}).click();}
for(const variant of [2,7,8,'battle-2','mixed','battle-7','battle-8','teams-mixed'] as const){const mixed=variant==='mixed'||variant==='teams-mixed';const count=mixed?2:typeof variant==='number'?variant:variant==='battle-2'?2:variant==='battle-7'?7:8;test(`${variant} contexts RTT 150±50ms prediction and confirmed other-board latency`,async({browser,baseURL})=>{
  const isolatedDevices=process.env.BRICKS_NETWORK_ISOLATED_DEVICES==='1';
  const devices:Browser[]=isolatedDevices?await Promise.all(Array.from({length:count},()=>browser.browserType().launch({channel:'chrome',args:['--mute-audio']}))):[];
  const contexts=await Promise.all(Array.from({length:count},(_,index)=>(devices[index]??browser).newContext({baseURL,viewport:{width:800,height:900}})));
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  let ownId='';
  const presses:{sequence:number;at:number;input:unknown}[]=[];
  const snapshots:unknown[]=[];
  const observedRtt:number[]=[];const sentInputs=new Map<number,number>();
  let lastAck=0;
  const relay=await delayRelayProcess(baseURL!, (id,input,at)=>{
    if(id!==ownId)return;
    sentInputs.set(input.sequence,at);
    if(input.held.left||input.held.right)presses.push({sequence:input.sequence,at,input});
  },(id,s,at)=>{
    if(id!==ownId)return;
    snapshots.push({at,ack:s.inputAck,epoch:s.inputEpoch,phase:s.state?.phase,board:s.state?.participants.find(p=>p.config.id===ownId)?.board});if(snapshots.length>32)snapshots.shift();
    if(s.inputAck<=lastAck)return;
    const sent=sentInputs.get(s.inputAck);if(sent!==undefined)observedRtt.push(at-sent);lastAck=s.inputAck;
  });
  // Only the test transport endpoint changes; native sockets retain browser rendering and service authority.
  for(const context of contexts)await context.addInitScript(({url,trace})=>{
    const Native=window.WebSocket;
    window.WebSocket=class extends Native {
      constructor(target:string|URL,protocols?:string|string[]){const resolved=new URL(target,location.href);const originalOrigin=location.origin.replace(/^http/,'ws');super(resolved.origin===originalOrigin&&resolved.pathname==='/network/socket'?url:target,protocols);}
    };
    const transport:unknown[]=[];(window as any).__transportTrace=transport;const recordTransport=(row:unknown)=>{if(trace&&transport.length<20000)transport.push(row);};
    const listen=window.WebSocket.prototype.addEventListener;
    const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(target:string|URL,protocols?:string|string[]){super(target,protocols);listen.call(this,'message',(event:Event)=>{const data=JSON.parse((event as MessageEvent).data);recordTransport({stage:'receive',at:performance.timeOrigin+performance.now(),type:data.type,snapshotId:data.snapshotId,part:data.part,total:data.total,ack:data.inputAck,rttMs:data.type==='pong'?performance.now()-data.nonce:undefined,ownId:data.ownId,connectionEpoch:data.connectionEpoch,inputEpoch:data.inputEpoch});});}};
    const samples:number[]=[];Object.defineProperty(window,'__networkLocalLatency',{value:samples});
    const remoteFrames:{id:string;x:string;serial:string;at:number}[]=[];
    Object.defineProperty(window,'__networkRemoteFrames',{value:remoteFrames});
    let lastInputSequence=0;
    Object.defineProperty(window,'__networkLastInputSequence',{get:()=>lastInputSequence});
    const send=Native.prototype.send;
    window.WebSocket.prototype.send=function(data){
      if(typeof data==='string'){const message=JSON.parse(data);if(message.type==='input'){lastInputSequence=message.sequence;recordTransport({stage:'send',at:performance.timeOrigin+performance.now(),...message});}}
      return send.call(this,data);
    };
    // Timestamp confirmed DOM presentation inside the receiving browser. Runner RPC,
    // assertion and trace processing time is not remote-board latency.
    new MutationObserver(()=>{
      for(const field of document.querySelectorAll<HTMLElement>('.network-field-heading[data-field]')){
        const id=field.dataset.field!,x=field.dataset.activeX!,serial=field.dataset.spawnSerial!;
        const last=[...remoteFrames].reverse().find(frame=>frame.id===id);
        if(x!==undefined&&serial!==undefined&&(!last||last.x!==x||last.serial!==serial))
          remoteFrames.push({id,x,serial,at:performance.timeOrigin+performance.now()});
      }
      if(remoteFrames.length>256)remoteFrames.splice(0,remoteFrames.length-256);
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-active-x','data-spawn-serial']});
    const keys:unknown[]=[];Object.defineProperty(window,'__networkKeyTrace',{value:keys});
    document.addEventListener('keydown',event=>{
      if(event.code!=='KeyA'&&event.code!=='KeyD')return;
      const arena=document.querySelector<HTMLElement>('.network-arena');if(!arena)return;
      const started=performance.now(),x=Number(arena.dataset.presentedX)+(event.code==='KeyA'?-1:1);
      keys.push({at:started,x,code:event.code,target:(event.target as HTMLElement).tagName,hidden:document.hidden,...arena.dataset,spawnSerial:arena.dataset.presentedSpawn,status:document.querySelector('#network-status')?.textContent});
      const measure=()=>{if(Number(arena.dataset.presentedX)===x){samples.push(performance.now()-started);return;}if(performance.now()-started<1000)requestAnimationFrame(measure);};
      requestAnimationFrame(measure);
    },true);
  },{url:relay.url,trace:process.env.BRICKS_NETWORK_TRACE==='1'});
  const host=pages[0]!,other=pages[count-1]!;const room=`Latency ${count} ${Date.now()}`;
  const local:number[]=[],remote:number[]=[];const movements:unknown[]=[];
  try{
    await enter(host);await host.getByRole('button',{name:'Создать лобби',exact:true}).click();
    if(variant==='battle-2'||variant==='battle-7'||variant==='battle-8'||variant==='teams-mixed'){await host.getByRole('combobox',{name:'Режим',exact:true}).click();await host.getByRole('option',{name:variant==='teams-mixed'?'Командный бой':'Битва',exact:true}).click();}
    await host.getByLabel('Название лобби').fill(room);await host.getByLabel('Ваше имя',{exact:true}).fill('Latency host');await host.getByRole('button',{name:'Создать',exact:true}).click();
    await expect(host.getByRole('heading',{name:room})).toBeVisible();
    for(let i=1;i<count;i++){const page=pages[i]!;await enter(page);await page.locator('.network-lobby').filter({hasText:room}).getByRole('button',{name:'Войти'}).click();await page.getByLabel('Ваше имя',{exact:true}).fill(`Latency human ${i}`);await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page.getByRole('heading',{name:room})).toBeVisible();}
    for(const page of pages){await expect(page.locator('.network-seat-state').filter({hasText:'Возвращается'})).toHaveCount(0);const control=page.getByRole('combobox',{name:'Управление на этом устройстве'});if(await page.locator('#network-controls').inputValue()!=='keyboard'){await control.click();await page.getByRole('option',{name:'WASD',exact:true}).click();}await expect(page.locator('#network-controls')).toHaveValue('keyboard');await expect(control).toContainText('WASD');}
    if(variant==='teams-mixed'){await other.getByRole('combobox',{name:'Команда',exact:true}).click();await other.getByRole('option',{name:'Команда 2',exact:true}).click();await expect(other.locator('#network-team select')).toHaveValue('team-2');}
    if(mixed)for(let i=0;i<6;i++){await host.getByRole('button',{name:'Добавить ИИ',exact:true}).click();await expect(host.locator('.network-roster li[data-kind=ai]')).toHaveCount(i+1);const editor=host.locator('.network-ai-editor').last();await editor.locator('summary').click();await editor.getByRole('combobox',{name:'Сложность ИИ'}).click();await host.getByRole('option',{name:'Эксперт',exact:true}).click();await editor.getByRole('button',{name:'Сохранить ИИ',exact:true}).click();await expect(host.locator('.network-seat-copy small').filter({hasText:'ИИ · Эксперт'})).toHaveCount(i+1);}
    for(const page of pages)await page.getByRole('button',{name:'Готов',exact:true}).click();
    await expect(host.getByRole('button',{name:'Начать',exact:true})).toBeEnabled();await host.getByRole('button',{name:'Начать',exact:true}).click();
    await expect(host.locator('.network-arena')).toHaveAttribute('data-phase','playing',{timeout:15000});
    await expect(host.locator('.network-arena')).toHaveAttribute('data-preparation','0',{timeout:15000});
    if(process.env.BRICKS_NETWORK_TRACE==='1')for(const page of [host,other])await page.evaluate(async()=>{
      const audit:unknown[]=[];(window as any).__predictionTrace=audit;
      const record=(row:unknown)=>{if(audit.length<20000)audit.push(row);};
      const {PlayScene}=await new Function('return import("/src/rendering/PlayScene.ts")')();
      const render=PlayScene.prototype.renderState;PlayScene.prototype.renderState=function(...args:any[]){const at=performance.now();const session=this.runtime.engine;if(!session.__tracedConfirm){session.__tracedConfirm=true;const confirm=session.confirm;session.confirm=function(snapshot:any){const at=performance.now();const result=confirm.call(this,snapshot);record({kind:'confirm',at:performance.timeOrigin+at,ms:performance.now()-at,id:snapshot.ownId,connectionEpoch:snapshot.connectionEpoch,inputEpoch:snapshot.inputEpoch,matchId:snapshot.matchId,tick:snapshot.tick,ack:snapshot.inputAck,inputResult:snapshot.inputResult,lead:this.leadTicks,predictedTick:this.prediction.tick});return result;};}const result=render.apply(this,args);record({kind:'render',at:performance.timeOrigin+at,ms:performance.now()-at,participants:this.runtime.engine.state.participants.map((p:any)=>({id:p.config.id,x:p.board.active?.x,spawnSerial:p.board.spawnSerial}))});if(!this.__traced){this.__traced=true;this.game.events.on('postrender',()=>record({kind:'postrender',at:performance.timeOrigin+performance.now(),participants:this.runtime.engine.state.participants.map((p:any)=>({id:p.config.id,x:p.board.active?.x,spawnSerial:p.board.spawnSerial}))}));}return result;};
      const {OwnPrediction}=await new Function('return import("/src/network/ownPrediction.ts")')();
      const {MatchEngine}=await new Function('return import("/src/simulation/match.ts")')();
      const restore=MatchEngine.restorePrediction;MatchEngine.restorePrediction=function(...args:any[]){const at=performance.now();const result=restore.apply(this,args);record({kind:'restore',ms:performance.now()-at});return result;};
      const advance=OwnPrediction.prototype.advanceTo;OwnPrediction.prototype.advanceTo=function(...args:any[]){const at=performance.now(),before=this.tick;const result=advance.apply(this,args);record({kind:'replay',ms:performance.now()-at,ticks:this.tick-before});return result;};
    });
    ownId=(await host.locator('.network-arena').getAttribute('data-own-id'))!;
    await relay.observe(ownId);
    for(let sample=0;sample<24;sample++){
      const pressCount=presses.length;
      const direction=sample%2?'KeyD':'KeyA';
      let baseline:{x:number;spawnSerial:string}|undefined;
      try {
        // Run readiness and presentation observation inside the browser. Polling
        // eight contexts through the runner adds load to the byte relay's clock.
        const probe=await host.evaluate(async code=>{
          const audit=window as unknown as {__networkLastInputSequence:number;__networkKeyTrace:{x:number;spawnSerial:string}[]};
          const arena=document.querySelector<HTMLElement>('.network-arena')!;
          const wait=async(predicate:()=>boolean,limit:number)=>{
            const started=performance.now();
            while(!predicate()){
              if(performance.now()-started>=limit)throw new Error('Local probe deadline exceeded');
              await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
            }
          };
          await wait(()=>Number(arena.dataset.inputAck)>=audit.__networkLastInputSequence&&arena.dataset.phase==='playing'&&document.querySelector('#network-status')?.textContent==='Подключено',1000);
          // Separate runner keydown/keyup RPCs can turn a tap into a held repeat.
          for(const type of ['keydown','keyup'])document.body.dispatchEvent(new KeyboardEvent(type,{code,key:code,bubbles:true}));
          const baseline=audit.__networkKeyTrace.at(-1)!;
          await wait(()=>arena.dataset.presentedX===String(baseline.x),1000);
          return {baseline,x:arena.dataset.presentedX,serial:arena.dataset.presentedSpawn};
        },direction);
        baseline=probe.baseline;
        expect(probe.x).toBe(String(baseline.x));
        expect(probe.serial).toBe(baseline.spawnSerial);
        // Wait for the actual transition at the receiving browser, preserving the
        // existing 2-second observation deadline and same-spawn assertions.
        await expect.poll(()=>presses.length,{intervals:[5],timeout:1000}).toBe(pressCount+1);
        // Correlate the piece actually controlled, including a speculative next spawn.
        expect((presses[pressCount]!.input as {spawnSerial:number}).spawnSerial).toBe(Number(baseline.spawnSerial));
        const forwarded=performance.timeOrigin+presses[pressCount]!.at;
        const result=await other.evaluate(async({id,x,serial,forwarded})=>{
          const audit=window as unknown as {__networkRemoteFrames:{id:string;x:string;serial:string;at:number}[]};
          const started=performance.now();
          while(performance.now()-started<2000){
            const field=document.querySelector<HTMLElement>(`[data-field="${id}"]`);
            const frame=audit.__networkRemoteFrames.find(f=>f.id===id&&f.x===String(x)&&f.serial===serial&&f.at>=forwarded);
            if(field?.dataset.activeX===String(x)&&frame)return {x:field.dataset.activeX,serial:field.dataset.spawnSerial,at:frame.at};
            await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
          }
          throw new Error('Confirmed other-board probe deadline exceeded');
        },{id:ownId,x:baseline.x,serial:baseline.spawnSerial,forwarded});
        expect(result.x).toBe(String(baseline.x));
        expect(result.serial).toBe(baseline.spawnSerial);
        expect(presses.length).toBe(pressCount+1);
        remote.push(result.at-forwarded);movements.push({sample,input:presses[pressCount]!.input,forwarded,domAt:result.at,x:baseline.x,spawnSerial:baseline.spawnSerial});
      } catch(error) {
        const failure={count,sample,baseline,host:await host.evaluate(()=>({...((document.querySelector('.network-arena') as HTMLElement)?.dataset)})),keys:await host.evaluate(()=> (window as unknown as {__networkKeyTrace:unknown[]}).__networkKeyTrace),presses,snapshots,relay:await relay.metrics()};
        await writeLatencyEvidence(`bricks-network-latency-failure-${variant}.json`,failure);throw error;
      }
      await new Promise(resolve=>setTimeout(resolve,90));
    }
    local.push(...await host.evaluate(()=> (window as unknown as {__networkLocalLatency:number[]}).__networkLocalLatency));expect(local).toHaveLength(24);
    const relayMetrics=await relay.metrics();
    const metrics={contexts:count,browserProcesses:isolatedDevices?count:1,isolatedDevices,injectedOneWayMs:[50,100],samples:local.length,movements,localMoveMs:{p95:percentile(local,.95),max:Math.max(...local)},confirmedOtherBoardMs:{p95:percentile(remote,.95),max:Math.max(...remote)},serverArrivalToOwnAckMs:{p50:percentile(observedRtt,.5),p95:percentile(observedRtt,.95)},method:'transparent endpoint-compressed byte relay; confirmed-other duration starts when input is forwarded upstream, before service commit, ends at receiver DOM mutation (excludes runner/assertion RPC)',relay:{maxMessageBytes:relayMetrics.maxMessageBytes,maxQueuedBytes:relayMetrics.maxQueuedBytes,oneWayDeliveryP95Ms:percentile(relayMetrics.oneWayDeliveryMs,.95)},gate:{localP95LimitMs:50,confirmedOtherP95LimitMs:250}};
    await writeLatencyEvidence(`bricks-network-latency-${variant}.json`,metrics);
    expect(metrics.localMoveMs.p95).toBeLessThanOrEqual(50);expect(metrics.confirmedOtherBoardMs.p95).toBeLessThanOrEqual(250);
  }finally{if(process.env.BRICKS_NETWORK_TRACE==='1')await writeLatencyEvidence(`client-trace-${variant}.json`,await Promise.all([host,other].map(page=>page.evaluate(()=>({trace:(window as any).__predictionTrace,transport:(window as any).__transportTrace,remote:(window as any).__networkRemoteFrames,keys:(window as any).__networkKeyTrace})).catch(()=>null))));if(process.env.BRICKS_NETWORK_LATENCY_EVIDENCE_DIR)await writeLatencyEvidence(`relay-${variant}.json`,await relay.metrics());for(const context of contexts)await context.close();for(const device of devices)await device.close();await relay.close();}

});

}
