import {createServer,connect,type Socket} from 'node:net';
import {inflateRawSync,constants} from 'node:zlib';
import {SnapshotAssembly} from '../../src/network/snapshotAssembly';
import type {ClientSnapshot} from '../../src/network/protocol';

/** Test-only transparent transport: endpoint upgrade and compressed/masked frames are never re-encoded. */
export async function delayRelay(origin:string,onInput:(id:string,data:any,at:number)=>void,onSnapshot:(id:string,snapshot:ClientSnapshot,at:number)=>void,
  options:{oneWayMs?:readonly[number,number];bytesPerSecond?:number;compression?:boolean;queueLimitBytes?:number;observeSnapshot?:(id:string)=>boolean}={}) {
  const endpoint=new URL(origin);if(endpoint.protocol!=='http:')throw new Error('Local relay requires HTTP upstream');
  const sockets=new Set<Socket>();const delays:number[]=[],injected:number[]=[],overshoot:number[]=[];
  const errors:string[]=[];const metadata:unknown[]=[];
  const negotiations:{requestExtensions:string;responseExtensions:string}[]=[];
  let maxMessageBytes=0,maxQueuedBytes=0,closing=false,compressedFrames=0,forwardedBytes=0,overflowCount=0;
  const limit=options.queueLimitBytes??512*1024;
  const server=createServer(browser=>{
    const upstream=connect(Number(endpoint.port||80),endpoint.hostname);sockets.add(browser);sockets.add(upstream);
    let id='';const assembly=new SnapshotAssembly();let requestExtensions='',responseExtensions='';
    const timers=new Set<ReturnType<typeof setTimeout>>();
    const stop=()=>{for(const timer of timers)clearTimeout(timer);timers.clear();browser.destroy();upstream.destroy();};
    browser.on('error',stop);upstream.on('error',stop);browser.on('close',()=>{sockets.delete(browser);stop();});upstream.on('close',()=>{sockets.delete(upstream);stop();});
    const pipe=(source:Socket,target:Socket,direction:'up'|'down')=>{
      let handshake=true,buffer:Buffer=Buffer.alloc(0),due=0,bytes=0,counter=0;
      let message:Buffer[]=[],messageBytes=0,messageOpcode=0,messageCompressed=false;
      const queue:{wire:Buffer;payload:Buffer;opcode:number;fin:boolean;compressed:boolean;at:number;due:number;injected:number}[]=[];
      let timer:ReturnType<typeof setTimeout>|null=null;
      const observe=(item:typeof queue[number],at:number)=>{
        if(item.opcode>=8)return;
        if(direction==='down'&&options.observeSnapshot&&!options.observeSnapshot(id))return;
        if(item.opcode!==0){messageOpcode=item.opcode;messageCompressed=item.compressed;message=[];messageBytes=0;}
        message.push(item.payload);messageBytes+=item.payload.length;if(messageBytes>4096)throw new Error('Observer message bound');
        if(!item.fin)return;
        let data=Buffer.concat(message);message=[];messageBytes=0;
        if(messageCompressed){compressedFrames++;data=inflateRawSync(Buffer.concat([data,Buffer.from([0,0,255,255])]),{finishFlush:constants.Z_SYNC_FLUSH,maxOutputLength:4096});}
        maxMessageBytes=Math.max(maxMessageBytes,data.length);
        if(messageOpcode!==1)return;
        const parsed=JSON.parse(data.toString());
        if(parsed.type==='input'||parsed.type==='snapshot-manifest'||parsed.type==='snapshot-ack'||parsed.type==='snapshot-part'&&parsed.part===parsed.total-1){metadata.push({id,direction,type:parsed.type,sequence:parsed.sequence,snapshotId:parsed.snapshotId,ack:parsed.inputAck,part:parsed.part,total:parsed.total,receivedAt:item.at,forwardedAt:at,scheduledFor:item.due,overshoot:Math.max(0,at-item.due)});if(metadata.length>256)metadata.shift();}
        if(direction==='up'){
          if(parsed.type==='hello')id=parsed.credential.participantId;
          if(parsed.type==='input')onInput(id,parsed,at);
        }else if(parsed.type==='snapshot-manifest'||parsed.type==='snapshot-part'){
          const snapshot=assembly.accept(parsed);if(snapshot)onSnapshot(id,snapshot,at);
        }
      };
      const sampleBound=()=>{
        maxQueuedBytes=Math.max(maxQueuedBytes,bytes+buffer.length+target.writableLength);
        if(bytes+buffer.length+target.writableLength>limit){overflowCount++;stop();return false;}return true;
      };
      const schedule=()=>{if(timer||!queue.length||closing||target.destroyed)return;timer=setTimeout(drain,Math.max(1,queue[0]!.due-performance.now()));timers.add(timer);};
      const drain=()=>{
        if(timer)timers.delete(timer);timer=null;
        if(closing||target.destroyed)return;
        try {
          while(queue[0]&&queue[0].due<=performance.now()){
            const item=queue.shift()!;bytes-=item.wire.length;const at=performance.now();
            delays.push(at-item.at);injected.push(item.injected);overshoot.push(Math.max(0,at-item.due));
            forwardedBytes+=item.wire.length;target.write(item.wire);observe(item,at);if(!sampleBound())return;
            if(target.writableNeedDrain){target.once('drain',schedule);return;}
          }
          schedule();
        }catch(error){errors.push(String(error));stop();}
      };
      source.on('data',chunk=>{
        if(closing||target.destroyed)return;
        try {
          buffer=Buffer.concat([buffer,Buffer.from(chunk)]);if(!sampleBound())return;
          if(handshake){
            const end=buffer.indexOf('\r\n\r\n');if(end<0)return;
            const headers=buffer.subarray(0,end+4);const extension=/^Sec-WebSocket-Extensions:\s*(.*)$/im.exec(headers.toString())?.[1]?.trim()??'';
            if(direction==='up')requestExtensions=extension;
            else {
              responseExtensions=extension;negotiations.push({requestExtensions,responseExtensions});
              // The passive decoder supports independent endpoint messages, as configured by the real service.
              if(extension&&(!extension.includes('server_no_context_takeover')||!extension.includes('client_no_context_takeover')))throw new Error('Observer requires endpoint no-context takeover');
              if(options.compression&&!extension.includes('permessage-deflate'))throw new Error('Endpoint compression was not negotiated');
            }
            // Browser addresses the relay; route HTTP authority to the original endpoint without touching Origin, extension offers or WS bytes.
            target.write(direction==='up'?Buffer.from(headers.toString().replace(/^Host:.*$/im,`Host: ${endpoint.host}`)):headers);buffer=buffer.subarray(end+4);handshake=false;
          }
          while(buffer.length>=2){
            const first=buffer[0]!,second=buffer[1]!;let length=second&127,header=2;
            if(length===126){if(buffer.length<4)break;length=buffer.readUInt16BE(2);header=4;}
            else if(length===127){if(buffer.length<10)break;const wide=buffer.readBigUInt64BE(2);if(wide>BigInt(limit))throw new Error('Frame bound');length=Number(wide);header=10;}
            const masked=!!(second&128);if(masked)header+=4;
            if(length+header>limit)throw new Error('Frame bound');if(buffer.length<header+length)break;
            const wire=Buffer.from(buffer.subarray(0,header+length));buffer=buffer.subarray(header+length);
            const payload=Buffer.from(wire.subarray(header));if(masked)for(let i=0;i<payload.length;i++)payload[i]=payload[i]!^wire[header-4+i%4]!;
            const at=performance.now(),[low,high]=options.oneWayMs??[50,100];const delay=low+(counter++%6)*(high-low)/5;
            due=Math.max(due,at+delay);if(direction==='down'&&options.bytesPerSecond)due+=wire.length/options.bytesPerSecond*1000;
            queue.push({wire,payload,opcode:first&15,fin:!!(first&128),compressed:!!(first&64),at,due,injected:delay});bytes+=wire.length;if(!sampleBound())return;
          }
          schedule();
        }catch(error){errors.push(String(error));stop();}
      });
    };
    pipe(browser,upstream,'up');pipe(upstream,browser,'down');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`ws://127.0.0.1:${(server.address() as {port:number}).port}/network/socket`,
    metrics:()=>({maxMessageBytes,maxQueuedBytes,oneWayDeliveryMs:delays,injectedOneWayMs:injected,schedulerOvershootMs:overshoot,negotiations,compressedFrames,forwardedBytes,overflowCount,transparent:true,errors,metadata}),
    close:async()=>{closing=true;for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
