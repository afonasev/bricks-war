import {it,expect} from 'vitest';
import WebSocket,{WebSocketServer} from 'ws';
import {delayRelay} from './network-browser/delayRelay';
it('latency harness preserves FIFO UTF-8 frames and original origin under independent delayed directions',async()=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise<void>(r=>server.once('listening',r));
  let origin='';const received:number[]=[];server.on('connection',(socket,request)=>{origin=request.headers.origin!;socket.on('message',(raw,binary)=>{received.push(JSON.parse(raw.toString()).index);socket.send(raw,{binary});});});
  const upstream=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const relay=await delayRelay(upstream,()=>{},()=>{});const socket=new WebSocket(relay.url,{origin:'http://127.0.0.1:4188'});
  try{
    const echoed:string[]=[];const done=new Promise<void>(resolve=>socket.on('message',(raw,binary)=>{expect(binary).toBe(false);echoed.push(raw.toString());if(echoed.length===40)resolve();}));
    await new Promise<void>(r=>socket.once('open',r));const frames=Array.from({length:40},(_,index)=>JSON.stringify({type:'probe',index,name:'Проверка',data:'a'.repeat(2500)}));
    frames.forEach(frame=>socket.send(frame));await done;expect(echoed).toEqual(frames);expect(received).toEqual(Array.from({length:40},(_,i)=>i));expect(origin).toBe('http://127.0.0.1:4188');
    expect(relay.metrics().maxMessageBytes).toBeLessThanOrEqual(4096);expect(relay.metrics().maxQueuedBytes).toBeLessThan(512*1024);
  }finally{socket.terminate();await relay.close();for(const client of server.clients)client.terminate();await new Promise<void>(r=>server.close(()=>r()));}
});

it('transparent relay preserves negotiated compression, masked bytes and fragmented UTF-8 FIFO with measured delay',async()=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0,perMessageDeflate:{serverNoContextTakeover:true,clientNoContextTakeover:true,threshold:0}});
  await new Promise<void>(r=>server.once('listening',r));
  const upstream=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const inbound:Buffer[]=[],outbound:Buffer[]=[],clientSent:Buffer[]=[],clientReceived:Buffer[]=[];
  let serverExtensions='';
  server.on('connection',peer=>{
    serverExtensions=peer.extensions;
    const tcp=(peer as any)._socket;
    tcp.prependListener('data',(chunk:Buffer)=>inbound.push(Buffer.from(chunk)));
    const write=tcp.write.bind(tcp);tcp.write=(chunk:any,...args:any[])=>{if(Buffer.isBuffer(chunk))outbound.push(Buffer.from(chunk));return write(chunk,...args);};
    peer.on('message',(raw,binary)=>peer.send(raw,{binary}));
  });
  const relay=await delayRelay(upstream,()=>{},()=>{},{compression:true});
  const socket=new WebSocket(relay.url,{origin:'http://127.0.0.1:4188',perMessageDeflate:{clientNoContextTakeover:true,serverNoContextTakeover:true,threshold:0}});
  try {
    await new Promise<void>(r=>socket.once('open',r));
    const tcp=(socket as any)._socket;tcp.on('data',(chunk:Buffer)=>clientReceived.push(Buffer.from(chunk)));
    const write=tcp.write.bind(tcp);tcp.write=(chunk:any,...args:any[])=>{if(Buffer.isBuffer(chunk))clientSent.push(Buffer.from(chunk));return write(chunk,...args);};
    const frames=Array.from({length:18},(_,index)=>JSON.stringify({type:'probe',index,name:'Проверка',data:'аб'.repeat(900)}));
    const echoed:string[]=[];const done=new Promise<void>(resolve=>socket.on('message',raw=>{echoed.push(raw.toString());if(echoed.length===frames.length)resolve();}));
    for(const [index,frame] of frames.entries()){
      if(index===0){socket.send(frame.slice(0,120),{fin:false});socket.send(frame.slice(120),{fin:true});}
      else socket.send(frame);
    }
    await done;await new Promise(r=>setTimeout(r,10));
    expect(echoed).toEqual(frames);expect(socket.extensions).toBe(serverExtensions);expect(socket.extensions).toContain('permessage-deflate');
    expect(Buffer.concat(inbound)).toEqual(Buffer.concat(clientSent));expect(Buffer.concat(clientReceived)).toEqual(Buffer.concat(outbound));
    const metrics=relay.metrics();expect(metrics.negotiations).toHaveLength(1);
    expect(metrics.negotiations[0]!.responseExtensions).toContain('server_no_context_takeover');expect(metrics.negotiations[0]!.responseExtensions).toContain('client_no_context_takeover');
    expect(metrics.compressedFrames).toBe(36);expect(metrics.injectedOneWayMs.every(n=>n>=50&&n<=100)).toBe(true);
    expect(Math.min(...metrics.oneWayDeliveryMs)).toBeGreaterThanOrEqual(49);expect(Math.max(...metrics.schedulerOvershootMs)).toBeLessThan(50);
    expect(metrics.maxQueuedBytes).toBeLessThan(512*1024);expect(metrics.overflowCount).toBe(0);
    expect(Buffer.concat(inbound).length).toBeLessThan(frames.join('').length/4);
  }finally{socket.terminate();await relay.close();for(const peer of server.clients)peer.terminate();await new Promise<void>(r=>server.close(()=>r()));}
});

it('transparent relay closes explicitly when scheduled wire bytes exceed its bound',async()=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise<void>(r=>server.once('listening',r));
  const relay=await delayRelay(`http://127.0.0.1:${(server.address() as {port:number}).port}`,()=>{},()=>{},{oneWayMs:[500,500],queueLimitBytes:8192});
  const socket=new WebSocket(relay.url,{perMessageDeflate:false});
  try{
    await new Promise<void>(r=>socket.once('open',r));const closed=new Promise<void>(r=>socket.once('close',()=>r()));
    for(let i=0;i<8;i++)socket.send(JSON.stringify({type:'probe',index:i,data:'a'.repeat(2500)}));
    await closed;expect(relay.metrics().overflowCount).toBeGreaterThan(0);expect(socket.readyState).toBe(WebSocket.CLOSED);
  }finally{socket.terminate();await relay.close();for(const peer of server.clients)peer.terminate();await new Promise<void>(r=>server.close(()=>r()));}
});
