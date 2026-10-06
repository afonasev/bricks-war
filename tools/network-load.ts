import {defaultRoomRules} from '../src/network/rules';
import type {NetworkMode} from '../src/network/protocol';
import {RoomService} from '../server/rooms';
import {createNetworkServer,type CycleMetrics} from '../server/http';
import {fork} from 'node:child_process';
import type {Credential} from '../src/network/protocol';
import {MAX_SNAPSHOT_BYTES} from '../src/network/protocol';
import {cpus,totalmem} from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
const service=new RoomService();const samples:CycleMetrics[]=[];const debtSamples:number[]=[];
const runtime=createNetworkServer(service,[],m=>{if(samples.length<7200)samples.push(m);debtSamples.push(Math.max(0,...[...service.rooms.values()].map(r=>r.accumulator)));});
await new Promise<void>(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
const port=(runtime.server.address() as {port:number}).port;const origin=`http://127.0.0.1:${port}`;
const mixed=process.env.BRICKS_LOAD_AI==='1';
const mode=(process.env.BRICKS_LOAD_MODE??'survival') as NetworkMode;
if(!['survival','battle','team-battle'].includes(mode))throw new Error('Invalid load mode');
const humanCount=mixed?2:8;
const credentials:Credential[]=[];
let readyCount=0;let frameCount=0;let maxMessageBytes=0;let totalWireBytes=0;let clientError:string|null=null;
let transportBytes=0;
let maxHeap=process.memoryUsage().heapUsed;
for(let r=0;r<10;r++){
  const first=await service.create(`Load ${r}`,'Host','',{rules:defaultRoomRules(mode),profile:{teamId:'team-1'}});credentials.push(first);
  for(let i=1;i<humanCount;i++)credentials.push(await service.join(first.roomId,`Player ${i}`,'',{teamId:i%2?'team-2':'team-1'}));
}
const driver=fork('tools/network-load-clients.ts',[origin],{execArgv:['--import','tsx'],stdio:['ignore','inherit','inherit','ipc']});
driver.on('message',(m:{type:string;readyCount:number;frameCount:number;maxMessageBytes:number;totalWireBytes:number;transportBytes:number;message:string})=>{
  if(m.type==='ready')readyCount=m.readyCount;
  if(m.type==='stats'){frameCount=m.frameCount;maxMessageBytes=m.maxMessageBytes;totalWireBytes=m.totalWireBytes;transportBytes=m.transportBytes;}
  if(m.type==='error')clientError=m.message;
});
driver.send({type:'connect',credentials});
while(readyCount<10*humanCount){if(clientError)throw new Error(clientError);await new Promise(resolve=>setTimeout(resolve,20));}
for(const room of service.rooms.values()){
  const host=room.seats[0]!;
  if(mixed)for(let i=0;i<6;i++){
    service.command(room,host,host.connectionEpoch,{type:'ai-add'});
    const bot=room.seats.at(-1)!;service.command(room,host,host.connectionEpoch,{type:'ai-update',participantId:bot.id,tileStyle:'random',difficulty:'expert'});
  }
  for(const seat of room.seats.filter(s=>s.kind==='human'))service.command(room,seat,seat.connectionEpoch,{type:'ready',ready:true});
  service.command(room,host,host.connectionEpoch,{type:'start'});
}
samples.length=0;
debtSamples.length=0;
const heartbeat=setInterval(()=>{maxHeap=Math.max(maxHeap,process.memoryUsage().heapUsed);},2000);
const started=performance.now();const baselineHeap=process.memoryUsage().heapUsed;
do{await new Promise(resolve=>setTimeout(resolve,Math.max(1,60_000-(performance.now()-started))));}while(performance.now()-started<60_000);const elapsedSeconds=(performance.now()-started)/1000;
clearInterval(heartbeat);const retained=service.rooms.size;const aiDecisions=[...service.rooms.values()].map(r=>r.aiActionCount);const finalSimulationDebtMs=Math.max(...[...service.rooms.values()].map(r=>r.accumulator));driver.send({type:'stop'});await runtime.close();
const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]!;
const debtQuarterP95=[0,1,2,3].map(quarter=>percentile(debtSamples.slice(Math.floor(debtSamples.length*quarter/4),Math.floor(debtSamples.length*(quarter+1)/4)),.95));
const durations=samples.map(s=>s.durationMs);const publication=samples.filter(s=>s.publicationMs>0).map(s=>s.publicationMs);
const maxBufferedBytes=Math.max(...samples.map(s=>s.maxBufferedBytes));
const report={mode,kind:`actual ${10*humanCount}-WebSocket wall-clock loopback workload; not production capacity`,mixed,humanCount,aiDecisions,simulationDebtMs:{peak:Math.max(...debtSamples),p95:percentile(debtSamples,.95),quarterP95:debtQuarterP95,final:finalSimulationDebtMs},node:process.version,platform:process.platform,arch:process.arch,
  hardware:{cpu:cpus()[0]?.model,cores:cpus().length,totalMemory:totalmem()},rooms:10,seatsPerRoom:8,elapsedSeconds,
  cycleSamples:samples.length,wholeCycleMs:{p50:percentile(durations,.5),p95:percentile(durations,.95),p99:percentile(durations,.99),max:Math.max(...durations)},
  publicationMs:{p99:percentile(publication,.99),max:Math.max(...publication)},schedulerLagMs:{p99:percentile(samples.map(s=>s.schedulerLagMs),.99),max:Math.max(...samples.map(s=>s.schedulerLagMs))},
  confirmedSnapshots:frameCount,snapshotsPerRecipientSecond:frameCount/(10*humanCount)/elapsedSeconds,maxMessageBytes,logicalBytes:totalWireBytes,logicalMegabytesPerSecond:totalWireBytes/elapsedSeconds/1e6,
  transportBytes,transportMegabytesPerSecond:transportBytes/elapsedSeconds/1e6,transportMeasurement:'underlying WebSocket TCP socket bytesRead including upgrade/framing; loopback without TLS',
  maxBufferedBytes,baselineHeap,maxHeap,retainedRooms:retained,
  gate:{wholeCycleP99LimitMs:16.7,bufferedBytesLimit:MAX_SNAPSHOT_BYTES*2,
    passed:percentile(durations,.99)<=16.7&&maxMessageBytes<=4096&&maxBufferedBytes<=MAX_SNAPSHOT_BYTES*2&&retained===10&&(!mixed||aiDecisions.every(n=>n>0))&&finalSimulationDebtMs<=16.7},revision:process.env.BRICKS_TEST_REVISION??'working tree'};
const path=process.env.BRICKS_NETWORK_LOAD_REPORT??new URL('../evidence/add-network-survival-lobbies/load-metrics.json',import.meta.url);
await mkdir(typeof path==='string'?dirname(path):new URL('.',path),{recursive:true});
await writeFile(path,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.gate.passed)process.exitCode=1;
