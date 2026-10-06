import WebSocket from 'ws';
import {SnapshotAssembly} from '../src/network/snapshotAssembly';
import {PROTOCOL_VERSION,RULES_VERSION,type Credential} from '../src/network/protocol';
import type {Socket} from 'node:net';
const origin=process.argv[2]!;const sockets:WebSocket[]=[];
let readyCount=0,frameCount=0,maxMessageBytes=0,totalWireBytes=0;
const transportSockets:Socket[]=[];
process.on('disconnect',()=>process.exit(0));
process.on('error',()=>process.exit(1));
process.on('message',(message:{type:string;credentials?:Credential[]})=>{
  if(message.type==='stop'){for(const socket of sockets)socket.terminate();process.exit(0);}
  if(message.type!=='connect')return;
  for(const credential of message.credentials??[]){
    const socket=new WebSocket(origin.replace('http:','ws:')+'/network/socket',{origin});sockets.push(socket);
    socket.on('upgrade',response=>transportSockets.push(response.socket));
    const assembly=new SnapshotAssembly();let acknowledged=false;let inputEpoch=0,seq=0;let publicationId='';
    socket.on('error',error=>process.send?.({type:'error',message:error.message}));
    socket.on('open',()=>socket.send(JSON.stringify({type:'hello',credential,protocol:PROTOCOL_VERSION,rulesVersion:RULES_VERSION,snapshotAcks:true})));
    socket.on('message',raw=>{
      const bytes=Buffer.byteLength(raw.toString());maxMessageBytes=Math.max(maxMessageBytes,bytes);totalWireBytes+=bytes;
      const message=JSON.parse(raw.toString());if(message.type!=='snapshot-manifest'&&message.type!=='snapshot-part')return;
      if(message.type==='snapshot-manifest')publicationId=message.ackRequired?message.snapshotId:'';
      const snapshot=assembly.accept(message);if(!snapshot)return;frameCount++;
      if(publicationId)socket.send(JSON.stringify({type:'snapshot-ack',snapshotId:publicationId}));
      const own=snapshot.seats.find(s=>s.id===snapshot.ownId);
      if(!own?.connected)socket.send(JSON.stringify({type:'ack',revision:snapshot.revision,visible:true}));
      else if(!acknowledged){acknowledged=true;readyCount++;process.send?.({type:'ready',readyCount});}
      if(snapshot.inputEpoch!==inputEpoch){inputEpoch=snapshot.inputEpoch;seq=0;}
      if(snapshot.state?.phase==='playing'&&!snapshot.state.globalEventHold&&snapshot.tick%90<4)socket.send(JSON.stringify({type:'input',
        matchId:snapshot.matchId,connectionEpoch:snapshot.connectionEpoch,inputEpoch:snapshot.inputEpoch,sequence:++seq,
        held:{left:(snapshot.tick%180)<90,right:(snapshot.tick%180)>=90,down:false},rotate:false}));
    });
  }
});
setInterval(()=>{for(const socket of sockets)if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'heartbeat',visible:true}));
  process.send?.({type:'stats',frameCount,maxMessageBytes,totalWireBytes,transportBytes:transportSockets.reduce((sum,socket)=>sum+socket.bytesRead,0)});},1000);
