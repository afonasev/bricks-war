/** Local-only diagnostic runner; never used by the production service entrypoint. */
import {writeFileSync} from 'node:fs';
import {WebSocket} from 'ws';
import {RoomService} from '../server/rooms';
import {SnapshotPublisher} from '../server/publication';
import {createNetworkServer} from '../server/http';
const path=process.env.BRICKS_NETWORK_STAGE_TRACE;
if(!path)throw new Error('BRICKS_NETWORK_STAGE_TRACE is required');
const trace:unknown[]=[];
const record=(row:Record<string,unknown>)=>{if(trace.length<100000)trace.push({at:performance.timeOrigin+performance.now(),...row});};
const identities=new WeakMap<WebSocket,string>();
const send=WebSocket.prototype.send;
WebSocket.prototype.send=function(this:WebSocket,data:Parameters<WebSocket['send']>[0],optionsOrCallback?:Parameters<WebSocket['send']>[1]|((err?:Error)=>void),callback?:(err?:Error)=>void){
  let last: {snapshotId:string}|null=null;
  if(typeof data==='string'){
    const frame=JSON.parse(data);
    if(frame.type==='snapshot-manifest')identities.set(this,frame.ownId);
    if(frame.type==='snapshot-part'&&frame.part===frame.total-1)last={snapshotId:frame.snapshotId};
  }
  const originalCallback=typeof optionsOrCallback==='function'?optionsOrCallback:callback;
  const completed=(error?:Error)=>{if(last)record({stage:'send-complete',id:identities.get(this),snapshotId:last.snapshotId,error:error?.message});originalCallback?.(error);};
  return send.call(this,data,typeof optionsOrCallback==='function'?{}:(optionsOrCallback??{}),completed);
};
const service=new RoomService();
const command=service.command.bind(service);
service.command=(room,seat,epoch,input)=>{
  if(input.type==='input')record({stage:'ingress',roomId:room.id,id:seat.id,...input});
  command(room,seat,epoch,input);
  if(input.type==='input'){
    const queue=seat.queue;
    if(!Object.hasOwn(queue,'shift'))queue.shift=function(){const value=Array.prototype.shift.call(this);if(value)record({stage:'execution',roomId:room.id,matchId:room.matchId,id:seat.id,tick:room.tick+1,...value});return value;};
  }
};
const manifest=SnapshotPublisher.prototype.manifest;
SnapshotPublisher.prototype.manifest=function(publication,seat,ackRequired){
  record({stage:'publication',snapshotId:publication.snapshotId,roomId:publication.roomId,matchId:publication.matchId,id:seat.id,connectionEpoch:seat.connectionEpoch,inputEpoch:seat.inputEpoch,sequence:seat.ack,inputResult:seat.inputResult,bytes:publication.wireBytes,tick:service.rooms.get(publication.roomId)?.tick,revision:publication.revision,inputs:service.rooms.get(publication.roomId)?.seats.map(s=>({id:s.id,connectionEpoch:s.connectionEpoch,inputEpoch:s.inputEpoch,sequence:s.ack}))});
  return manifest.call(this,publication,seat,ackRequired);
};
const runtime=createNetworkServer(service,(process.env.BRICKS_NETWORK_ORIGINS??'').split(','),metrics=>record({stage:'cycle',...metrics}));
runtime.server.listen(Number(process.env.BRICKS_NETWORK_PORT??4190),'127.0.0.1');
const save=()=>writeFileSync(path,JSON.stringify({method:'same-host absolute performance clocks; execution timestamp at queue consumption before the fixed simulation step; publication before ws compression/send',trace},null,2));
// Serialize only after the measured run: synchronous periodic JSON writes distort server scheduling.
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;save();void runtime.close().then(()=>process.exit());};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
