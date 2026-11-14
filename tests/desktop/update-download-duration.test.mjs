import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {bytes,fixture} from './update-download-fixture.mjs';

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
