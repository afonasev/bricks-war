import test from 'node:test';
import assert from 'node:assert/strict';
import { TransferGate,UpdateCoordinator,ShellActivation } from '../../electron/update-coordinator.mjs';
import { localizedNotes,compareVersions } from '../../electron/github-updates.mjs';
const tick = () => new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const gate = new TransferGate(); let requests = 0, discovery = 0, resolveDownload;
  const store = {manifest:{gameVersion:'1.0.0'},ready:null, cancel(){resolveDownload?.();},
    async prepare(envelope,progress) { requests++; await new Promise(resolve=>resolveDownload=resolve); progress(100); this.ready={gameVersion:'2.0.0'}; }};
  const coordinator = new UpdateCoordinator({store,gate,discover:async()=>{discovery++;return {component:'content',manifest:{gameVersion:'2.0.0'},envelope:{}};},history:async()=>[]});
  return {gate,store,coordinator,counts:()=>({requests,discovery}),finish:()=>resolveDownload()};
}
test('one discovery per process, zero package bytes before consent and frozen target on retry/history',async()=>{
  const f=fixture();await Promise.all([f.coordinator.check(),f.coordinator.check()]);
  assert.deepEqual(f.counts(),{discovery:1,requests:0}); assert.equal(f.coordinator.phase,'available');
  await f.coordinator.getHistory();const downloading=f.coordinator.download();f.coordinator.download();
  assert.deepEqual(f.counts(),{discovery:1,requests:1});f.finish();await downloading;
  assert.equal(f.coordinator.phase,'ready');await f.coordinator.check();assert.equal(f.counts().discovery,1);
});
test('failed discovery does not retry and cannot download',async()=>{
  let calls=0;const gate=new TransferGate();const coordinator=new UpdateCoordinator({store:{manifest:{gameVersion:'1.0.0'}},gate,discover:async()=>{calls++;throw Error('offline');}});
  await coordinator.check();await coordinator.check();await coordinator.download();assert.equal(calls,1);assert.equal(coordinator.phase,'check-error');
});
test('match barrier waits for real transfer abort, pauses requests, resumes same operation',async()=>{
  const gate=new TransferGate();let started=0,drained=false;
  const transfer=gate.run(signal=>new Promise((resolve,reject)=>{started++;if(started===2){resolve('same asset');return;}signal.addEventListener('abort',()=>{setImmediate(()=>{drained=true;reject(signal.reason);});});}));
  await tick();await gate.setAllowed(false);assert.equal(drained,true);assert.equal(gate.active.size,0);await tick();assert.equal(started,1);
  await gate.setAllowed(true);assert.equal(await transfer,'same asset');assert.equal(started,2);
});
test('cancel while match-paused releases the waiting operation without resuming traffic',async()=>{
  const gate=new TransferGate();await gate.setAllowed(false);const cancel=new AbortController();let calls=0;
  const transfer=gate.run(()=>{calls++;},cancel.signal);cancel.abort();await assert.rejects(transfer);assert.equal(calls,0);assert.equal(gate.waiters.length,0);
});
test('prepared shell remains ready despite failed discovery and history never runs during match',async()=>{
  const coordinator=new UpdateCoordinator({store:{manifest:{gameVersion:'1.0.0'}},gate:new TransferGate(),readyShell:()=>({version:'2.0.0'}),discover:async()=>{throw Error('offline');},history:async()=>{throw Error('must not request');}});
  await coordinator.check();assert.equal(coordinator.snapshot().phase,'ready');assert.equal(coordinator.snapshot().version,'2.0.0');await coordinator.setActivity(false);await assert.rejects(coordinator.getHistory(),/match/);
});
test('stable version comparison is numeric and notes respect matching language markers',()=>{
  assert.equal(compareVersions('1.10.0','1.9.9'),1);assert.throws(()=>compareVersions('1.0.0-rc','1.0.0'));
  const body='## Русский\n### Новое\n- Русский текст\n\n## English\n### Added\n- English text\n';
  assert.deepEqual(localizedNotes(body),{text:'### Новое\n- Русский текст',fallback:false});
  assert.deepEqual(localizedNotes(body,'en'),{text:'### Added\n- English text',fallback:false});
  assert.equal(localizedNotes('Legacy English').fallback,true);
});

test('ordinary quit starts no helper; repeated explicit activation shares the pending handshake',async()=>{
 let calls=0,finish;const activation=new ShellActivation({launchHelper:()=>{calls++;return new Promise(resolve=>finish=resolve);}});
 assert.equal(activation.pending,false);assert.equal(calls,0);const a=activation.start(),b=activation.start();assert.equal(a,b);await tick();assert.equal(calls,1);assert.equal(activation.pending,true);assert.equal(activation.acknowledged,false);finish();await a;assert.equal(activation.pending,false);assert.equal(activation.acknowledged,true);
});
test('helper preparation failure releases quit guard and does not strand a rejected promise',async()=>{
 let failures=0;const activation=new ShellActivation({launchHelper:async()=>{throw Error('helper');}},()=>failures++);await assert.rejects(activation.start());assert.equal(activation.pending,false);assert.equal(activation.promise,null);assert.equal(failures,1);
});
