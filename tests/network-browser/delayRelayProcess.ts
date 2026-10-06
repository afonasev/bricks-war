import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {ClientSnapshot} from '../../src/network/protocol';
import type {delayRelay} from './delayRelay';
type Metrics=ReturnType<Awaited<ReturnType<typeof delayRelay>>['metrics']>;
/** Keep injected transport timers independent of Playwright's eight-page RPC work. */
export async function delayRelayProcess(origin:string,onInput:(id:string,data:any,at:number)=>void,onSnapshot:(id:string,snapshot:ClientSnapshot,at:number)=>void){
  const child=fork(fileURLToPath(new URL('./delayRelayProcessWorker.ts',import.meta.url)),[],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
  let errors='',serial=0;
  child.stderr?.on('data',data=>{errors+=String(data);});
  const requests=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  child.on('message',(message:any)=>{
    if(message.type==='input')onInput(message.id,message.input,message.at-performance.timeOrigin);
    if(message.type==='snapshot')onSnapshot(message.id,message.snapshot,message.at-performance.timeOrigin);
    if(message.request!==undefined){const request=requests.get(message.request);requests.delete(message.request);if(message.error)request?.reject(new Error(message.error));else request?.resolve(message.value);}
  });
  const fail=(error:Error)=>{for(const request of requests.values())request.reject(error);requests.clear();};
  child.on('error',fail);child.on('exit',code=>fail(new Error(`Relay process exited ${code}: ${errors}`)));
  const request=(type:string,data:Record<string,unknown>={})=>new Promise<any>((resolve,reject)=>{
    const request=++serial;requests.set(request,{resolve,reject});child.send({type,request,...data},error=>{if(error){requests.delete(request);reject(error);}});
  });
  try {
    const url:string=await request('start',{origin});
    return {url,pid:child.pid,
      observe:(id:string)=>request('observe',{id}) as Promise<void>,
      metrics:()=>request('metrics') as Promise<Metrics>,
      close:async()=>{try{await request('close');}finally{child.disconnect();child.kill('SIGTERM');}}
    };
  }catch(error){child.kill('SIGTERM');throw error;}
}
