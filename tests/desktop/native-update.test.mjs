import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {NativeUpdate,nativeContext,validateNativeRelease} from '../../electron/native-update.mjs';
import {TransferGate} from '../../electron/update-coordinator.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const id=(char,sequence=1,version='1.0.0')=>({digest:char.repeat(64),sequence,version});
const current={launcher:id('a'),client:id('b'),executable:'/native/root',profile:'/original/profile',rootPid:123};
const keys=generateKeyPairSync('ed25519');
const archive=Buffer.from('signed native fixture archive');
const manifest=()=>({schema:1,game:'bricks-war',component:'native-release',channel:'stable',rootAbi:1,version:'2.0.0',contentAbi:3,contentSequence:2,
 files:[{platform:process.platform,arch:process.arch,minimumOS:process.platform==='darwin'?'13.0.0':'10.0.0',name:'native.zip',sha256:hash(archive),size:archive.length,unpackedSize:100,targets:[{component:'launcher',...id('c',2,'2.0.0')},{component:'client',...id('d',2,'2.0.0')}]}]});
const envelope=value=>{const payload=JSON.stringify(value);return{payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')}};
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'bricks-native-update-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
function updater(root,{badTree=false,blocked=[],release=manifest()}={}){
 const calls=[];const signed=envelope(release);
 const selected={tag_name:'v2.0.0',assets:[{name:'native-manifest.json'},{name:'native.zip',size:archive.length,digest:`sha256:${hash(archive)}`}]};
 const native=new NativeUpdate({root,context:current,version:'1.0.0',publicKey:keys.publicKey,gate:new TransferGate(),fetcher:async url=>{calls.push(url);return new Response(url.endsWith('/native-manifest.json')?JSON.stringify(signed):archive);},args:['-muted'],status:async()=>({failed:blocked,recoveryRequired:false}),
 extract:async(_platform,_archive,path)=>{await mkdir(join(path,'launcher'));await mkdir(join(path,'client'));},
 verifyTree:async component=>({identity:id(badTree?'f':component==='launcher'?'c':'d',2,'2.0.0'),unpackedSize:40})});
 return{native,calls,selected};
}
test('native context requires actual installed identities, original root and matching client version',()=>{
 assert.equal(nativeContext({},'1.0.0','/profile'),null);
 const env={BRICKS_BOOTSTRAP_HEALTH_ROOT:'/original/health',BRICKS_BOOTSTRAP_INSTALLED:'1',BRICKS_BOOTSTRAP_EXECUTABLE:'/root/native',BRICKS_BOOTSTRAP_LAUNCHER_ID:JSON.stringify(current.launcher),BRICKS_BOOTSTRAP_CLIENT_ID:JSON.stringify(current.client),BRICKS_BOOTSTRAP_ROOT_PID:'12'};
 assert.ok(Object.isFrozen(nativeContext(env,'1.0.0','/profile')));assert.equal(nativeContext(env,'1.0.0','/profile','e'.repeat(64)).healthNonce,'e'.repeat(64),'captured nonce survives environment scrubbing without being re-exported');assert.throws(()=>nativeContext(env,'2.0.0','/profile'),/Invalid installed/);assert.throws(()=>nativeContext({...env,BRICKS_BOOTSTRAP_ROOT_PID:'0'},'1.0.0','/profile'),/original native root/);
});
test('signed native release rejects substitution, downgrade, duplicate roles, wrong OS and ABI',()=>{
 const original=manifest();assert.equal(validateNativeRelease(envelope(original),keys.publicKey,process.platform,process.arch,current,'99.0.0').changed.length,2);
 const mutations=[m=>m.game='other',m=>m.rootAbi=2,m=>m.files[0].targets[1].component='launcher',m=>m.files[0].targets[0]={component:'launcher',...id('f')},m=>m.files[0].minimumOS='100.0.0',m=>m.files[0].name='../native.zip'];
 for(const mutate of mutations){const value=manifest();mutate(value);assert.throws(()=>validateNativeRelease(envelope(value),keys.publicKey,process.platform,process.arch,current,'99.0.0'));}
 const changed=envelope(original);changed.payload=changed.payload.replace('2.0.0','3.0.0');assert.throws(()=>validateNativeRelease(changed,keys.publicKey,process.platform,process.arch,current),/signature/);
});
test('discovery consumes no archive bytes and frozen consent prepares both native identities',async()=>fixture(async root=>{
 const {native,calls,selected}=updater(root);await native.open();const target=await native.discover([selected]);assert.equal(target.component,'shell');assert.equal(calls.length,1);assert.ok(calls[0].endsWith('/native-manifest.json'));
 const plan=await target.prepare(()=>{},()=>{});assert.equal(calls.length,2);assert.deepEqual(plan.sources.map(source=>source.component),['launcher','client']);assert.equal(plan.profile,current.profile);assert.deepEqual(plan.args,['-muted']);assert.ok(native.ready);
 await native.open();assert.ok(native.ready,'verified previously consented package has priority without rediscovery');assert.equal(calls.length,2);
 const altered=JSON.parse(await readFile(join(root,'ready.json')));altered.sources[0].digest='f'.repeat(64);await writeFile(join(root,'ready.json'),JSON.stringify(altered));await native.open();assert.equal(native.ready,null,'cached readiness cannot select a different signed identity');
}));
test('deferred combined preparation publishes no ready receipt until the full plan commits',async()=>fixture(async root=>{
 const {native,selected}=updater(root);await native.open();const target=await native.discover([selected]);const plan=await target.prepare(()=>{},()=>{},{deferReady:true});assert.equal(native.ready,null);await assert.rejects(readFile(join(root,'ready.json')),/ENOENT/);await target.commit(plan);assert.ok(native.ready);await assert.rejects(()=>target.commit({...plan}),/target changed/);
}));
test('independent tree verification failure does not publish ready and cleans only owned failed stage',async()=>fixture(async root=>{
 const {native,selected}=updater(root,{badTree:true});await native.open();const target=await native.discover([selected]);await assert.rejects(()=>target.prepare(()=>{},()=>{}),/identity mismatch/);assert.equal(native.ready,null);assert.deepEqual(await readdir(root),[]);
}));
test('failed digest is not offered again; per-user recovery acknowledgement binds one transaction',async()=>fixture(async root=>{
 const {native,selected}=updater(root,{blocked:['d'.repeat(64)]});await native.open();assert.equal(await native.discover([selected]),null);
 native.status=async()=>({failed:[],recoveryRequired:true,nonce:'e'.repeat(64)});await native.open();assert.equal(native.recoveryRequired,true);await native.acknowledgeRecovery();await native.open();assert.equal(native.recoveryRequired,false);
 native.status=async()=>({failed:[],recoveryRequired:true,nonce:'f'.repeat(64)});await native.open();assert.equal(native.recoveryRequired,true,'a later failed transaction is not silently acknowledged');
}));

test('candidate reaches game health through its own pending transaction; foreign and aborted decisions still recover',async()=>fixture(async root=>{
 const {native}=updater(root);const nonce='1'.repeat(64);native.context={...current,healthNonce:hash(`${nonce}:client`)};
 native.status=async()=>({failed:[],phase:'pending',recoveryRequired:true,nonce});await native.open();assert.equal(native.recoveryRequired,false);
 native.status=async()=>({failed:[],phase:'pending',recoveryRequired:true,nonce:'2'.repeat(64)});await native.open();assert.equal(native.recoveryRequired,true);
 native.status=async()=>({failed:[],phase:'aborted',recoveryRequired:true,nonce});await native.open();assert.equal(native.recoveryRequired,true);
}));
