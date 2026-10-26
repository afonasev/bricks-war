import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPairSync,sign} from 'node:crypto';
import {ContentStore,digest} from '../../electron/content.mjs';
import {GithubUpdates} from '../../electron/github-updates.mjs';
import {TransferGate,UpdateCoordinator} from '../../electron/update-coordinator.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'bricks-app-update-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const keys=generateKeyPairSync('ed25519'),old=Buffer.from('working game'),next=Buffer.from('game with rating');
 const signed=(sequence,bytes,extra={})=>{const payload=JSON.stringify({schema:1,game:'bricks-war',component:'content',channel:'stable',sequence,gameVersion:`${sequence}.0.0`,minShellVersion:2,files:[{path:'index.html',size:bytes.length,sha256:digest(bytes)}],...extra});return {payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')};};
 const bundled=join(root,'bundle');await mkdir(bundled);await writeFile(join(bundled,'index.html'),old);await writeFile(join(bundled,'manifest.json'),JSON.stringify(signed(1,old)));
 const latest=signed(2,next,{minShellVersion:3,minShellRelease:'1.5.0'}),events=[];
 const options={root:join(root,'content'),bundled,publicKey:keys.publicKey,shellVersion:2,shellRelease:'1.0.0',download:async()=>{events.push('content');return next;}};
 const store=await new ContentStore(options).open(),gate=new TransferGate();
 let shellReady=null;
 const shellCandidate={component:'shell',manifest:{gameVersion:'1.5.0'},compatibility:{abi:3,version:'1.5.0',bundledSequence:1},prepare:async(_progress,_phase,options)=>{events.push('shell');assert.equal(options.deferReady,true);return {version:'1.5.0'};},commit:async plan=>{events.push('commit');shellReady=plan;},cancel:()=>events.push('cancel-shell'),discard:async()=>{shellReady=null;}};
 const release={id:2,tag_name:'content-2',assets:[{name:'manifest.json'},{name:digest(next),size:next.length,digest:`sha256:${digest(next)}`}]};
 const source=new GithubUpdates({store,gate,shell:{discover:async()=>shellCandidate},publicKey:keys.publicKey,cachePath:join(root,'cache.json'),fetcher:async url=>url.includes('api.github.com')?Response.json([release]):Response.json(latest)});
 const coordinator=new UpdateCoordinator({store,gate,discover:()=>source.discover(),readyShell:()=>shellReady});
 return {store,options,source,coordinator,events,shellCandidate,shellReady:()=>shellReady};
}

test('one consent prepares shell and dependent game before readiness, then new-shell startup activates the game',async t=>{
 const f=await fixture(t);await f.coordinator.check();
 assert.deepEqual(f.events,[]);assert.equal(f.coordinator.snapshot().requiresShell,true);assert.equal(f.coordinator.snapshot().currentVersion,'1.0.0');
 await f.coordinator.download();assert.deepEqual(f.events,['shell','content','commit']);assert.equal(f.coordinator.phase,'ready');assert.equal(f.store.ready,null);
 assert.equal(f.coordinator.snapshot().version,'2.0.0');assert.equal(f.coordinator.snapshot().currentVersion,'1.0.0');
 const old=await new ContentStore(f.options).open();assert.equal(await old.activate(),false);assert.equal(old.manifest.gameVersion,'1.0.0');
 const upgraded=await new ContentStore({...f.options,shellVersion:3,shellRelease:'2.0.0'}).open();await upgraded.activate();assert.equal(upgraded.manifest.gameVersion,'2.0.0');await upgraded.healthy();
});

test('failed dependent content never leaves a ready shell or changes the working game',async t=>{
 const f=await fixture(t);f.store.download=async()=>{throw Error('network');};await f.coordinator.check();await f.coordinator.download();
 assert.equal(f.coordinator.phase,'download-error');assert.equal(f.shellReady(),null);assert.equal(f.store.state.pending,null);assert.equal(f.store.manifest.gameVersion,'1.0.0');assert.deepEqual(f.events,['shell']);
});

test('cancelling the combined target discards staged dependent content and shell readiness',async t=>{
 const f=await fixture(t);await f.coordinator.check();await f.coordinator.download();assert.equal(f.store.state.pending,'release-2');
 await f.coordinator.cancel();assert.equal(f.shellReady(),null);assert.equal(f.store.state.pending,null);assert.equal(f.coordinator.phase,'available');assert.equal(f.store.manifest.gameVersion,'1.0.0');
});

test('unavailable required shell stays visible and cannot be downloaded or called up to date',async t=>{
 const f=await fixture(t);f.source.shell.discover=async()=>null;await f.coordinator.check();
 assert.equal(f.coordinator.snapshot().phase,'shell-required');assert.equal(f.coordinator.snapshot().available,true);await f.coordinator.download();assert.deepEqual(f.events,[]);
 await f.coordinator.cancel();assert.equal(f.coordinator.phase,'shell-required');
});


test('a cancelled complete target is offered after restart while failed-trial replay stays blocked',async t=>{
 const f=await fixture(t);await f.coordinator.check();await f.coordinator.download();await f.coordinator.cancel();
 const restarted=await new ContentStore(f.options).open();f.source.store=restarted;
 assert.equal((await f.source.discover()).requiresShell,true);assert.equal(restarted.manifest.gameVersion,'1.0.0');
 await restarted.prepare((await f.source.discover()).envelope,()=>{},{abi:3,version:'2.0.0'});
 const upgradedOptions={...f.options,shellVersion:3,shellRelease:'2.0.0'};
 const trial=await new ContentStore(upgradedOptions).open();await trial.activate();
 const failed=await new ContentStore(upgradedOptions).open();assert.equal(failed.manifest.gameVersion,'1.0.0');
 f.source.store=failed;f.source.shell.discover=async()=>null;assert.equal(await f.source.discover(),null);
 const recovery=new UpdateCoordinator({store:failed,gate:new TransferGate(),discover:()=>f.source.discover()});await recovery.check();assert.equal(recovery.snapshot().phase,'install-error');
});


test('a complete installer containing the target game needs no older content overlay',async t=>{
 const f=await fixture(t);f.shellCandidate.manifest.gameVersion='2.0.0';f.shellCandidate.compatibility.version='2.0.0';
 const selected=await f.source.discover();assert.equal(selected,f.shellCandidate);
});

test('an out-of-order older shell bundle cannot suppress newer content by sequence',async t=>{
 const f=await fixture(t);f.shellCandidate.compatibility.bundledSequence=3;
 const selected=await f.source.discover();assert.equal(selected.component,'shell-required');assert.equal(selected.manifest.gameVersion,'2.0.0');
});


test('a newer shell cannot downgrade capabilities needed by the installed game',async t=>{
 const f=await fixture(t);f.source.store.manifest={...f.store.manifest,gameVersion:'3.0.0',minShellVersion:4};
 f.shellCandidate.compatibility.abi=3;assert.equal(await f.source.discover(),null);
});
