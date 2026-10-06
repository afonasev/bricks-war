import {SnapshotAssembly} from '../src/network/snapshotAssembly';
import {it,expect,vi} from 'vitest';
import WebSocket from 'ws';
import {createNetworkServer,networkClientAddress} from '../server/http';
import {RoomService} from '../server/rooms';
import {PROTOCOL_VERSION,RULES_VERSION,type ClientSnapshot,type Credential} from '../src/network/protocol';
it('publication credits bound a slow peer, reject forged/duplicate ACKs and coalesce to latest state',async()=>{
  const runtime=createNetworkServer(new RoomService(()=>0));
  await new Promise<void>(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(runtime.server.address() as {port:number}).port}`;
  const credential=await runtime.service.create('Credits','Guest');
  const socket=new WebSocket(origin.replace('http:','ws:')+'/network/socket',{origin});
  const manifests:any[]=[];
  socket.on('message',raw=>{const data=JSON.parse(raw.toString());if(data.type==='snapshot-manifest')manifests.push(data);});
  const wait=()=>new Promise(resolve=>setTimeout(resolve,220));
  try {
    await new Promise<void>(resolve=>socket.once('open',resolve));
    expect(socket.extensions).toContain('permessage-deflate');
    socket.send(JSON.stringify({type:'hello',credential,protocol:PROTOCOL_VERSION,rulesVersion:RULES_VERSION,snapshotAcks:true}));
    await wait();expect(manifests).toHaveLength(4);expect(manifests[0].ackRequired).toBe(true);
    socket.send(JSON.stringify({type:'snapshot-ack',snapshotId:'foreign'}));await wait();expect(manifests).toHaveLength(4);
    const latest=runtime.service.authenticate(credential).room;latest.revision+=100;
    socket.send(JSON.stringify({type:'snapshot-ack',snapshotId:manifests[0].snapshotId}));await wait();
    expect(manifests).toHaveLength(5);expect(manifests[4].revision).toBe(latest.revision);
    socket.send(JSON.stringify({type:'snapshot-ack',snapshotId:manifests[0].snapshotId}));await wait();expect(manifests).toHaveLength(5);
    socket.send(JSON.stringify({type:'snapshot-ack',snapshotId:manifests[4].snapshotId}));await wait();expect(manifests).toHaveLength(9);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  }finally{socket.terminate();await runtime.close();}
});
it('HTTP origin, authenticated fragmented state, replacement and byte limits are enforced',async()=>{
  const runtime=createNetworkServer(new RoomService(()=>0));
  await new Promise<void>(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const address=runtime.server.address() as {port:number};const origin=`http://127.0.0.1:${address.port}`;
  const connections:WebSocket[]=[];
  try {
    const denied=await fetch(`${origin}/api/network/create`,{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify({roomName:'Wrong','name':'Wrong'})});
    expect(denied.status).toBe(400);expect(runtime.service.rooms.size).toBe(0);
    const created=await fetch(`${origin}/api/network/create`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({roomName:'Test','name':'Player'})});
    expect(created.headers.get('cache-control')).toBe('no-store');const {credential}=await created.json() as {credential:Credential};
    const first=new WebSocket(origin.replace('http:','ws:')+'/network/socket',{origin});connections.push(first);
    const receive=(socket:WebSocket)=>new Promise<ClientSnapshot>((resolve,reject)=>{
      const assembly=new SnapshotAssembly();
      socket.on('error',reject);socket.on('message',raw=>{
        expect(Buffer.byteLength(raw.toString())).toBeLessThanOrEqual(4096);const data=JSON.parse(raw.toString());
        if(data.type!=='snapshot-part'&&data.type!=='snapshot-manifest')return;
        const snapshot=assembly.accept(data);if(snapshot)resolve(snapshot);
      });
    });
    const snapshotPromise=receive(first);
    await new Promise<void>(resolve=>first.once('open',resolve));
    first.send(JSON.stringify({type:'hello',credential,protocol:PROTOCOL_VERSION,rulesVersion:RULES_VERSION}));
    const initial=await snapshotPromise;expect(initial.ownId).toBe(credential.participantId);expect(JSON.stringify(initial)).not.toContain(credential.token);
    first.send(JSON.stringify({type:'ack',revision:initial.revision,visible:true}));
    const second=new WebSocket(origin.replace('http:','ws:')+'/network/socket',{origin});connections.push(second);
    const replacementPromise=receive(second);
    await new Promise<void>(resolve=>second.once('open',resolve));second.send(JSON.stringify({type:'hello',credential,protocol:PROTOCOL_VERSION,rulesVersion:RULES_VERSION}));
    const replacement=await replacementPromise;expect(replacement.connectionEpoch).toBe(initial.connectionEpoch+1);
    await new Promise<void>(resolve=>first.readyState===WebSocket.CLOSED?resolve():first.once('close',()=>resolve()));
    expect(first.readyState).toBe(WebSocket.CLOSED);
    const malformed=new WebSocket(origin.replace('http:','ws:')+'/network/socket',{origin});connections.push(malformed);
    await new Promise<void>(resolve=>malformed.once('open',resolve));malformed.send(JSON.stringify({type:'pause'}));
    const rejection=await new Promise<string>(resolve=>malformed.once('message',raw=>resolve(raw.toString())));expect(JSON.parse(rejection).code).toBe('auth');
  }finally{for(const socket of connections)socket.terminate();await runtime.close();}
});

it('proxy identity requires explicit trust, a loopback peer and a valid single IP',()=>{
  const request=(peer:string,header:string|string[])=>({socket:{remoteAddress:peer},headers:{'x-bricks-client-ip':header}});
  expect(networkClientAddress(request('127.0.0.1','192.0.2.1'))).toBe('127.0.0.1');
  expect(networkClientAddress(request('192.0.2.2','192.0.2.1'),true)).toBe('192.0.2.2');
  expect(networkClientAddress(request('127.0.0.1','192.0.2.1'),true)).toBe('192.0.2.1');
  expect(networkClientAddress(request('::1','2001:db8::1'),true)).toBe('2001:db8::1');
  for(const malformed of ['spoof','192.0.2.1, 192.0.2.2',['192.0.2.1']])expect(networkClientAddress(request('127.0.0.1',malformed),true)).toBe('127.0.0.1');
});
for(const trusted of [false,true])it(`HTTP write limits use ${trusted?'distinct proxy clients':'direct peers despite spoofed headers'}`,async()=>{
  const runtime=createNetworkServer(new RoomService(()=>0),[],undefined,trusted);
  await new Promise<void>(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(runtime.server.address() as {port:number}).port}`;
  const create=(ip:string)=>fetch(`${origin}/api/network/create`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Bricks-Client-IP':ip},body:JSON.stringify({roomName:'Rate test',name:'Player'})});
  try {
    for(let i=1;i<=31;i++)expect((await create(`192.0.2.${i}`)).status).toBe(!trusted&&i===31?429:200);
    if(trusted){for(let i=0;i<29;i++)expect((await create('192.0.2.1')).status).toBe(200);expect((await create('192.0.2.1')).status).toBe(429);}
  }finally{await runtime.close();}
});


it('committed input publishes complete state before the next periodic deadline',async()=>{
  let now=0;const service=new RoomService(()=>now);const host=await service.create('Input priority','Host'),guest=await service.join(host.roomId,'Guest');
  const links=[host,guest].map(c=>service.connect(c,PROTOCOL_VERSION,RULES_VERSION));
  for(const link of links){service.command(link.room,link.seat,link.epoch,{type:'ack',revision:link.room.revision,visible:true});service.command(link.room,link.seat,link.epoch,{type:'ready',ready:true});}
  service.command(links[0]!.room,links[0]!.seat,links[0]!.epoch,{type:'start'});
  for(let i=0;i<260;i++){now+=1000/60;for(const seat of links[0]!.room.seats)seat.lastHealth=now;service.advance();}
  let publicationClock=0;const clock=vi.spyOn(performance,'now').mockImplementation(()=>publicationClock);const runtime=createNetworkServer(service);
  await new Promise<void>(r=>runtime.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(runtime.server.address() as {port:number}).port}`;
  const socket=new WebSocket(origin.replace('http:','ws:')+'/network/socket',{origin});const snapshots:ClientSnapshot[]=[];const assembly=new SnapshotAssembly();
  socket.on('message',raw=>{const data=JSON.parse(raw.toString());if(data.type==='snapshot-manifest'||data.type==='snapshot-part'){const snapshot=assembly.accept(data);if(snapshot){snapshots.push(snapshot);socket.send(JSON.stringify({type:'snapshot-ack',snapshotId:data.snapshotId}));if(!snapshot.seats.find(s=>s.id===snapshot.ownId)?.connected)socket.send(JSON.stringify({type:'ack',revision:snapshot.revision,visible:true}));}}});
  const wait=async(predicate:()=>boolean)=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,5));expect(predicate()).toBe(true);};
  try {
    await new Promise<void>(r=>socket.once('open',r));socket.send(JSON.stringify({type:'hello',credential:host,protocol:PROTOCOL_VERSION,rulesVersion:RULES_VERSION,snapshotAcks:true}));
    await wait(()=>!!snapshots.at(-1)?.seats.find(s=>s.id===host.participantId)?.connected);
    const initial=snapshots.at(-1)!;publicationClock=10;
    const original=service.command.bind(service);let received=false;service.command=(room,seat,epoch,command)=>{original(room,seat,epoch,command);if(command.type==='input')received=true;};
    socket.send(JSON.stringify({type:'input',matchId:initial.matchId,connectionEpoch:initial.connectionEpoch,inputEpoch:initial.inputEpoch,sequence:1,held:{left:false,right:true,down:false},rotate:false}));
    await wait(()=>received);expect(links[0]!.seat.ack).toBe(0);expect(snapshots.at(-1)!.inputAck).toBe(0);
    now+=1000/60;await wait(()=>snapshots.at(-1)!.inputAck===1);
    const confirmed=snapshots.at(-1)!;expect(publicationClock).toBeLessThan(50);expect(confirmed.state!.phase).toBe('playing');expect(confirmed.tick).toBeGreaterThan(initial.tick);
    const before=initial.state!.participants.find(p=>p.config.id===host.participantId)!.board.active!;const after=confirmed.state!.participants.find(p=>p.config.id===host.participantId)!.board.active!;expect(after.x).toBe(before.x+1);
  }finally{socket.terminate();await runtime.close();clock.mockRestore();}
});
