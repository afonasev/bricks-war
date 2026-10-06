import {SnapshotAssembly} from '../src/network/snapshotAssembly';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, RULES_VERSION, type Credential } from '../src/network/protocol';
const origin='http://127.0.0.1:4188';
const roomName=process.argv[2]??'QA · Выживание';
const list=await fetch(`${origin}/api/network/lobbies`).then(r=>r.json());
const room=list.rooms.find((r:{name:string})=>r.name===roomName);
if(!room)throw new Error('Create QA room through UI first');
const names=['Виктория Владивосток','Михаил Нижний Новгород','Екатерина Санкт-Петербург','Константин Новосибирск','Анастасия Красноярск','Дмитрий Калининград','Елизавета Петропавловск'];
const sockets:WebSocket[]=[];
for(const name of names) {
  const response=await fetch(`${origin}/api/network/join`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({roomId:room.id,name})}).then(r=>r.json());
  const credential=response.credential as Credential;if(!credential)throw new Error(response.error);
  const socket=new WebSocket(`${origin.replace('http:','ws:')}/network/socket`,{origin});sockets.push(socket);
  const assembly=new SnapshotAssembly();
  socket.on('open',()=>socket.send(JSON.stringify({type:'hello',credential,protocol:PROTOCOL_VERSION,rulesVersion:RULES_VERSION})));
  socket.on('message',raw=>{
    const message=JSON.parse(raw.toString());
    if(message.type!=='snapshot-part'&&message.type!=='snapshot-manifest')return;
    const snapshot=assembly.accept(message);if(!snapshot)return;
    const own=snapshot.seats.find(s=>s.id===snapshot.ownId);
    if(!own?.connected)socket.send(JSON.stringify({type:'ack',revision:snapshot.revision,visible:true}));
    else if(!snapshot.state&&!own.ready)socket.send(JSON.stringify({type:'ready',ready:true}));
  });
}
const heartbeat=setInterval(()=>{for(const socket of sockets)if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'heartbeat',visible:true}));},2000);
console.log('Seven synthetic QA peers connected; no physical-device acceptance.');
const stop=()=>{clearInterval(heartbeat);for(const socket of sockets)socket.close();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
