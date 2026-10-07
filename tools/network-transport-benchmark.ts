/** Bounded loopback-only data-delivery diagnostic, not a browser/device acceptance gate. */
import {mkdir,writeFile} from 'node:fs/promises';
import WebSocket from 'ws';
import {request} from 'node:http';
import {SnapshotAssembly} from '../src/network/snapshotAssembly';
import {PROTOCOL_VERSION,RULES_VERSION,MAX_SNAPSHOT_BYTES,type ClientSnapshot,type Credential} from '../src/network/protocol';
import {defaultRoomRules} from '../src/network/rules';
import {delayRelayProcess} from '../tests/network-browser/delayRelayProcess';
const origin=process.argv[2]??'http://127.0.0.1:4190';
if(new URL(origin).hostname!=='127.0.0.1'||new URL(origin).protocol!=='http:')throw new Error('Benchmark accepts loopback HTTP only');
const output=process.argv[3];if(!output)throw new Error('Evidence directory required');await mkdir(output,{recursive:true});
const p95=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
const wait=async(predicate:()=>boolean,limit=5000)=>{const started=performance.now();while(!predicate()){if(performance.now()-started>limit)throw new Error('Diagnostic observation deadline');await new Promise(r=>setTimeout(r,5));}};
const post=(path:string,body:unknown)=>new Promise<any>((resolve,reject)=>{
  const data=JSON.stringify(body);
  const req=request(`${origin}/api/network/${path}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},response=>{
    let raw='';response.setEncoding('utf8');response.on('data',chunk=>raw+=chunk);response.on('end',()=>{try{const result=JSON.parse(raw);if(response.statusCode!==200)reject(new Error(result.error));else resolve(result);}catch(error){reject(error);}});
  });req.on('error',reject);req.end(data);
});
for(const count of [2,7,8]){
  const sockets:WebSocket[]=[],snapshots:(ClientSnapshot|null)[]=Array(count).fill(null);
  const arrivals:{x:number;spawn:number;at:number}[]=[];const forwarded=new Map<number,number>();
  const samples:unknown[]=[],durations:number[]=[],errors:string[]=[];let ownId='';
  const relay=await delayRelayProcess(origin,(id,input,at)=>{if(id===ownId)forwarded.set(input.sequence,performance.timeOrigin+at);},()=>{});
  let heartbeat:ReturnType<typeof setInterval>|undefined;
  try{
    const first=(await post('create',{roomName:`Transport ${count} ${Date.now()}`,name:'Host',rules:defaultRoomRules('survival')})).credential as Credential;
    const credentials=[first];ownId=first.participantId;await relay.observe(ownId);
    for(let i=1;i<count;i++)credentials.push((await post('join',{roomId:first.roomId,name:`Peer ${i}`})).credential);
    for(let index=0;index<count;index++){
      const socket=new WebSocket(relay.url,{origin});sockets.push(socket);const assembly=new SnapshotAssembly();let publication='';let readied=false;
      socket.on('error',error=>errors.push(error.message));
      socket.on('message',raw=>{
        const data=JSON.parse(raw.toString());if(data.type==='error'){errors.push(data.message);return;}
        if(data.type==='snapshot-manifest')publication=data.snapshotId;
        if(data.type!=='snapshot-manifest'&&data.type!=='snapshot-part')return;
        const snapshot=assembly.accept(data);if(!snapshot)return;snapshots[index]=snapshot;
        socket.send(JSON.stringify({type:'snapshot-ack',snapshotId:publication}));
        const own=snapshot.seats.find(s=>s.id===snapshot.ownId)!;
        if(!own.connected)socket.send(JSON.stringify({type:'ack',revision:snapshot.revision,visible:true}));
        else if(!snapshot.state&&!readied){readied=true;socket.send(JSON.stringify({type:'ready',ready:true}));}
        if(index===count-1){const board=snapshot.state?.participants.find(p=>p.config.id===ownId)?.board;const last=arrivals.at(-1);if(board?.active&&(!last||last.x!==board.active.x||last.spawn!==board.spawnSerial))arrivals.push({x:board.active.x,spawn:board.spawnSerial,at:performance.timeOrigin+performance.now()});}
      });
      await new Promise<void>(resolve=>socket.once('open',resolve));
      socket.send(JSON.stringify({type:'hello',credential:credentials[index],protocol:PROTOCOL_VERSION,rulesVersion:RULES_VERSION,snapshotAcks:true}));
    }
    heartbeat=setInterval(()=>{for(const socket of sockets)if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'heartbeat',visible:true}));},2000);
    await wait(()=>snapshots[0]?.seats.every(s=>s.connected&&s.ready)===true);sockets[0]!.send(JSON.stringify({type:'start'}));
    await wait(()=>snapshots.every(s=>s?.state?.phase==='playing'&&s.state.participants.every(p=>p.board.preparationRemainingMs===0)),15000);
    for(let sample=0;sample<24;sample++){
      const snapshot=snapshots[0]!,board=snapshot.state!.participants.find(p=>p.config.id===ownId)!.board;
      const x=board.active!.x+(sample%2?1:-1),spawn=board.spawnSerial,sequence=sample*2+1,targetTick=snapshot.tick+12;
      const common={type:'input',matchId:snapshot.matchId,connectionEpoch:snapshot.connectionEpoch,inputEpoch:snapshot.inputEpoch,spawnSerial:spawn,rotate:false};
      sockets[0]!.send(JSON.stringify({...common,sequence,targetTick,held:{left:sample%2===0,right:sample%2===1,down:false},actions:[sample%2?'move-right':'move-left']}));
      sockets[0]!.send(JSON.stringify({...common,sequence:sequence+1,targetTick:targetTick+1,held:{left:false,right:false,down:false},actions:[]}));
      await wait(()=>forwarded.has(sequence),2000);
      const began=forwarded.get(sequence)!;
      await wait(()=>arrivals.some(a=>a.x===x&&a.spawn===spawn&&a.at>=began),2000);
      const arrived=arrivals.find(a=>a.x===x&&a.spawn===spawn&&a.at>=began)!;durations.push(arrived.at-began);samples.push({sequence,epoch:snapshot.inputEpoch,spawnSerial:spawn,targetTick,forwardedAt:began,assembledAt:arrived.at});
      await wait(()=>snapshots[0]!.inputAck>=sequence+1,2000);await new Promise(r=>setTimeout(r,90));
    }
  }catch(error){errors.push(String(error));}
  finally{
    if(heartbeat)clearInterval(heartbeat);
    const metrics=await relay.metrics();
    const result={count,origin,samples:samples.length,deliveryP95Ms:p95(durations),maxMs:durations.length?Math.max(...durations):null,errors,method:'Production-entry bundled server; separate relay worker and Node WS clients; no Chrome, Vite proxy, per-cycle diagnostic hooks or renderer. Start at relay upstream forwarding, end at receiver full assembly. Not application/device/VPS acceptance.',movements:samples,compression:metrics.negotiations,maxMessageBytes:metrics.maxMessageBytes,maxQueuedBytes:metrics.maxQueuedBytes,overflowCount:metrics.overflowCount,relayErrors:metrics.errors};
    await writeFile(`${output}/transport-${count}.json`,JSON.stringify(result,null,2));
    console.log(JSON.stringify({count,samples:result.samples,p95:result.deliveryP95Ms,errors}));
    for(const socket of sockets)socket.terminate();await relay.close();
    if(result.samples!==24||errors.length||metrics.errors.length||metrics.overflowCount||metrics.maxMessageBytes>4096||metrics.maxQueuedBytes>MAX_SNAPSHOT_BYTES*2)process.exitCode=1;
  }
}
