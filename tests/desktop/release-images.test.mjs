import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseImageUrl,releaseImageResponse,RELEASE_IMAGE_LIMIT} from '../../electron/release-images.mjs';
import {TransferGate} from '../../electron/update-coordinator.mjs';
const image='https://raw.githubusercontent.com/afonasev/bricks-war/'+'a'.repeat(40)+'/docs/release-notes/1.12.1/cards.png';
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0]);
test('only immutable official screenshot URLs reach the transport',async()=>{
 for(const url of [image.replace('afonasev','other'),image.replace('a'.repeat(40),'main'),image+'?token=x',
  image.replace('https:','http:'),image.replace('raw.githubusercontent.com','raw.githubusercontent.com.evil.test'),
  image.replace('/docs/release-notes/','/src/'),image.replace('cards.png','cards.svg'),
  image.replace('https://','https://user:secret@'),'file:///tmp/cards.png','javascript:alert(1)',image.replace('cards.png','a'.repeat(2100)+'.png')]){
  assert.equal(releaseImageUrl(url),null,url);
  assert.equal((await releaseImageResponse(url,()=>{throw Error('Untrusted URL fetched');})).status,403);
 }
 assert.equal(releaseImageUrl(image),image);
});
test('returns only bounded raster bytes, with no redirect/cookie or HTML handling',async()=>{
 let options;const good=await releaseImageResponse(image,async(_url,init)=>{options=init;return new Response(png,{headers:{'Content-Type':'image/png'}});});
 assert.equal(good.status,200);assert.deepEqual(new Uint8Array(await good.arrayBuffer()),png);
 assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
 assert.equal(good.headers.get('X-Content-Type-Options'),'nosniff');
 for(const [body,headers,status] of [
  ['<html>not an image</html>',{'Content-Type':'image/png'},415],
  [png,{'Content-Type':'text/html'},415],
  [png,{'Content-Type':'image/png','Content-Length':String(RELEASE_IMAGE_LIMIT+1)},415],
  [new Uint8Array(RELEASE_IMAGE_LIMIT+1),{'Content-Type':'image/png'},413]]){
  assert.equal((await releaseImageResponse(image,async()=>new Response(body,{headers}))).status,status);
 }
 assert.equal((await releaseImageResponse(image,async()=>new Response('missing',{status:404}))).status,502);
});
test('match entry drains image transfers and closed requests cannot resume after the match',async()=>{
 const gate=new TransferGate(), cancel=new AbortController();let started,aborted=false,calls=0;
 const ready=new Promise(resolve=>started=resolve);
 const request=gate.run(signal=>releaseImageResponse(image,async(_url,init)=>{
  calls++;started();
  return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(init.signal.reason);},{once:true}));
 },signal),cancel.signal);
 await ready;await gate.setAllowed(false);
 assert.equal(aborted,true);assert.equal(gate.active.size,0);assert.equal(calls,1);
 cancel.abort();await assert.rejects(request);await gate.setAllowed(true);assert.equal(calls,1);
});
