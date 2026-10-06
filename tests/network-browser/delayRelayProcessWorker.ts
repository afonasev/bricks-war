import {delayRelay} from './delayRelay';
let relay:Awaited<ReturnType<typeof delayRelay>>|undefined;
let ownId='';
process.on('message',async(message:any)=>{
  try{
    let value:unknown;
    if(message.type==='start'){
      relay=await delayRelay(message.origin,
        (id,input,at)=>process.send?.({type:'input',id,input,at:performance.timeOrigin+at}),
        (id,snapshot,at)=>process.send?.({type:'snapshot',id,snapshot,at:performance.timeOrigin+at}),
        {compression:true,observeSnapshot:id=>id===ownId});
      value=relay.url;
    }else if(message.type==='observe')ownId=message.id;
    else if(message.type==='metrics')value=relay!.metrics();
    else if(message.type==='close')await relay?.close();
    else throw new Error('Unknown relay process request');
    process.send?.({request:message.request,value});
  }catch(error){process.send?.({request:message.request,error:String(error)});}
});
process.on('disconnect',()=>{void relay?.close().finally(()=>process.exit());});
