import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {bytes,fixture} from './update-download-fixture.mjs';

test('payload preparation completes after more than 120 real seconds and records exact trusted bytes',{timeout:140000},async t=>{
 let timer; t.after(()=>clearTimeout(timer));const started=performance.now();
 const shell=await fixture(t,async()=>new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,1));timer=setTimeout(()=>{controller.enqueue(bytes.subarray(1));controller.close();},125000);},cancel(){clearTimeout(timer);}})));
 await shell.prepare();assert.ok(performance.now()-started>=125000);assert.deepEqual(await readFile(shell.ready.file),bytes);assert.equal(JSON.parse(await readFile(join(shell.root,'ready.json'))).version,'2.0.0');
});
