import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {ShellUpdate} from '../../electron/shell-update.mjs';
import {TransferGate} from '../../electron/update-coordinator.mjs';
const keys=generateKeyPairSync('ed25519');
const bytes=Buffer.from('trusted slow installer');
async function fixture(t,fetcher){
 const root=await mkdtemp(join(tmpdir(),'bricks-duration-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file={name:'Bricks-War-2.0.0-win-x64.exe',platform:'win32',arch:'x64',minimumOS:'10.0.0',protectedRollbackAbi:1,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const manifest={schema:1,game:'bricks-war',component:'shell',channel:'stable',version:'2.0.0',updaterAbi:2,contentAbi:3,contentSequence:1,files:[file]};
 const payload=JSON.stringify(manifest),envelope={payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')};
 const shell=new ShellUpdate({root,platform:'win32',arch:'x64',version:'1.0.0',publicKey:keys.publicKey,fetcher,gate:new TransferGate()});shell.selected={manifest:{...manifest,file},envelope,release:{tag_name:'v2.0.0'}};return shell;
}
test('payload preparation completes after more than 120 real seconds and records exact trusted bytes',{timeout:140000},async t=>{
 let timer; t.after(()=>clearTimeout(timer));const started=performance.now();
 const shell=await fixture(t,async()=>new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,1));timer=setTimeout(()=>{controller.enqueue(bytes.subarray(1));controller.close();},125000);},cancel(){clearTimeout(timer);}})));
 await shell.prepare();assert.ok(performance.now()-started>=125000);assert.deepEqual(await readFile(shell.ready.file),bytes);assert.equal(JSON.parse(await readFile(join(shell.root,'ready.json'))).version,'2.0.0');
});
test('explicit cancellation still aborts a stalled payload reader and never creates ready',async t=>{
 let entered,wasCancelled=false;const reading=new Promise(resolve=>entered=resolve);
 const shell=await fixture(t,async()=>new Response(new ReadableStream({pull(){entered();},cancel(){wasCancelled=true;}},{highWaterMark:0})));
 const preparation=shell.prepare();await reading;shell.controller.abort();await assert.rejects(preparation,{name:'AbortError'});assert.equal(wasCancelled,true);await assert.rejects(readFile(join(shell.root,'ready.json')),{code:'ENOENT'});
});
test('payload duration removal retains metadata deadline and corrupt/oversized rejection',async t=>{
 const calls=[];t.mock.method(AbortSignal,'timeout',ms=>{calls.push(ms);return new AbortController().signal;});
 const shell=await fixture(t,async()=>new Response(bytes));await shell.bytes('v2.0.0','shell-manifest.json',100);assert.deepEqual(calls,[30000]);calls.length=0;await shell.prepare();assert.deepEqual(calls,[]);
 for(const bad of [Buffer.alloc(bytes.length,120),Buffer.alloc(bytes.length+1)]){
  const corrupt=await fixture(t,async()=>new Response(bad));await assert.rejects(corrupt.prepare(),/Shell hash mismatch|Oversized shell package/);await assert.rejects(readFile(join(corrupt.root,'ready.json')),{code:'ENOENT'});
 }
});
