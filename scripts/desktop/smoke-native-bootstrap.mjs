/** Native root → signed versioned core → signed tiny native client; never installs a game. */
import {mkdtemp,mkdir,writeFile,readFile,copyFile,chmod,symlink,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {generateKeyPairSync,sign,createHash,randomBytes} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const base=process.env.BRICKS_QA_HOME||join(homedir(),'.local/state/bricks-war/qa');await mkdir(base,{recursive:true});
const output=await mkdtemp(join(base,'native-route-'));await mkdir(join(output,'health'));
const key=generateKeyPairSync('ed25519');
const keyPath=join(output,'fixture-key.pem');await writeFile(keyPath,key.publicKey.export({type:'spki',format:'pem'}));
const target=process.env.CARGO_TARGET_DIR||join(output,'target');
const report={status:'RUNNING',output,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source:{},scenarios:[]};
const env={...process.env,BRICKS_BOOTSTRAP_PROFILE:join(output,"profile"),CARGO_TARGET_DIR:target,BRICKS_BOOTSTRAP_TEST_KEY:keyPath,BRICKS_BOOTSTRAP_HEALTH_ROOT:join(output,'health')};
const selected = new Set(process.argv.slice(2));
report.selection = selected.size ? [...selected] : 'all';
let sequence=0;
async function command(file,args,{success=true,extra={},timeout=120000}={}){
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(file,args,{env:{...env,...extra},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error(`Timed out: ${file} ${args}`));},timeout);
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);
  child.on('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr});});
 });
 const id=String(++sequence).padStart(3,'0');await writeFile(join(output,`${id}.json`),JSON.stringify({file,args,extra,...result},null,2));
 if(success)assert.equal(result.code,0,`${file} ${args}\n${result.stderr}`);else assert.notEqual(result.code,0,'expected rejection');
 return result;
}
let binary,client;
async function tree(name,component,seq,{entry,bytes,args=[],mutate}={}){
 const path=join(output,name);await mkdir(path);
 entry ||= component==='launcher'?'core':'client';bytes ||= await readFile(component==='launcher'?binary:client);
 await writeFile(join(path,entry),bytes);await chmod(join(path,entry),0o755);
 const manifest={schema:1,game:'bricks-war',component,channel:'stable',platform:process.platform,arch:process.arch,version:`1.0.${seq}`,sequence:seq,root_abi:1,entry,args,files:[{path:entry,size:bytes.length,sha256:digest(bytes),executable:true}]};
 mutate?.(manifest);const payload=JSON.stringify(manifest);await writeFile(join(path,'bootstrap-manifest.json'),JSON.stringify({payload,signature:sign(null,Buffer.from(payload),key.privateKey).toString('base64')}));
 return {path,manifest,digest:digest(payload)};
}
const root=name=>join(output,`install-${name}`);
const cli=(op,install,component,...args)=>command(binary,[op,install,component,...args]);
const state=async(install,component)=>JSON.parse(await readFile(join(install,component,'state.json'),'utf8'));
const activate=async(install,component,extra={})=>command(binary,['activate',install,component,'--','-muted'],{extra});
async function seed(install,component,t){await cli('stage',install,component,t.path);await activate(install,component);}
async function scenario(name,fn){if(selected.size && !selected.has(name))return;await fn();report.scenarios.push({name,pass:true});console.log(`PASS ${name}`);}
try{
 for(const file of ['native/bootstrap/src/main.rs','native/bootstrap/src/engine.rs','native/bootstrap/src/tree.rs','native/bootstrap/src/platform.rs','native/bootstrap/Cargo.toml','native/bootstrap/Cargo.lock','native/bootstrap/src/installed.rs','native/bootstrap/src/worker.rs','native/bootstrap/src/ipc.rs','native/bootstrap/src/boundary.rs','native/bootstrap/src/windows.rs'])report.source[file]=digest(await readFile(file));
 await command('cargo',['build','--locked','--manifest-path','native/bootstrap/Cargo.toml','--features','fixture'],{timeout:180000});
 const built=join(target,'debug',process.platform==='win32'?'bricks-bootstrap.exe':'bricks-bootstrap');
 binary=join(output,process.platform==='win32'?'fixture-root.exe':'fixture-root');await copyFile(built,binary);await chmod(binary,0o755);
 assert.notEqual(process.platform,'win32','This fixture compiler currently requires clang/POSIX; Windows remains NotRun');
 client=join(output,'tiny-client');
 const source=join(output,'tiny-client.c');
 await writeFile(source,`
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc,char**argv){
 const char* mode=getenv("BRICKS_FIXTURE_BEHAVIOR");
 const char* receipt=getenv("BRICKS_BOOTSTRAP_RECEIPT");
 const char* nonce=getenv("BRICKS_BOOTSTRAP_NONCE");
 const char* hash=getenv("BRICKS_BOOTSTRAP_DIGEST");
 if(!receipt||!nonce||!hash)return 20;
 const char* failed=getenv("BRICKS_FIXTURE_FAIL_DIGEST");if(failed && strcmp(hash,failed))mode=NULL;
 if(mode && !strcmp(mode,"exit"))return 19;
 if(mode && !strcmp(mode,"quit"))return 0;
 const char* witness=getenv("BRICKS_FIXTURE_WITNESS");
 if(witness){FILE*f=fopen(witness,"a");if(!f)return 21;fprintf(f,"%d %s %s",getpid(),nonce,hash);for(int i=1;i<argc;i++)fprintf(f," %s",argv[i]);fputs("\\n",f);fclose(f);}
 if(mode && !strcmp(mode,"timeout")){sleep(95);return 22;}
 char temp[4096];snprintf(temp,sizeof(temp),"%s.tmp-%d",receipt,getpid());
 FILE*f=fopen(temp,"w");if(!f)return 23;
 fprintf(f,"{\\"nonce\\":\\"%s\\",\\"digest\\":\\"%s\\",\\"pid\\":%d}",mode&&!strcmp(mode,"stale")?"${'0'.repeat(64)}":nonce,hash,getpid());fflush(f);fsync(fileno(f));fclose(f);if(rename(temp,receipt))return 24;
 usleep(600000);return 0;
}
`);
 await command('clang',['-Os',source,'-o',client]);
 report.binary={path:binary,sha256:digest(await readFile(binary))};
 const a=await tree('client-a','client',1),b=await tree('client-b','client',2),c=await tree('client-c','client',3);
 const coreA=await tree('core-a','launcher',1,{args:['core']}),coreB=await tree('core-b','launcher',2,{args:['core']});
 await scenario('independent-native-root-core-client-and-muted-args',async()=>{
  const install=root('journey');await seed(install,'client',a);
  await cli('stage',install,'launcher',coreA.path);const witness=join(output,'nested-witness.txt');
  await activate(install,'launcher',{BRICKS_FIXTURE_WITNESS:witness});
  assert.match(await readFile(witness,'utf8'),/ -muted\n$/);assert.equal((await state(install,'launcher')).active.digest,coreA.digest);
 });
 await scenario('client-update-retains-old-tree-and-offline-launch',async()=>{
  const install=root('journey');await cli('stage',install,'client',b.path);await activate(install,'client');
  const s=await state(install,'client');assert.equal(s.active.digest,b.digest);assert.equal(s.previous.digest,a.digest);assert.equal(await readFile(join(install,'client','slots',a.digest,'client')).then(digest),a.manifest.files[0].sha256);
  await cli('run',install,'launcher','--','-muted');
 });
 await scenario('bootstrap-core-self-update-keeps-stable-root',async()=>{
  const before=digest(await readFile(binary));await cli('stage',root('journey'),'launcher',coreB.path);await activate(root('journey'),'launcher');
  const s=await state(root('journey'),'launcher');assert.equal(s.active.digest,coreB.digest);assert.equal(s.previous.digest,coreA.digest);assert.equal(digest(await readFile(binary)),before);
 });
 await scenario('corrupt-active-client-selects-verified-retained-tree',async()=>{
  const install=root('journey');await writeFile(join(install,'client','slots',b.digest,'client'),'corrupt');await cli('run',install,'launcher','--','-muted');const s=await state(install,'client');assert.equal(s.active.digest,a.digest);assert.ok(s.failed.includes(b.digest));
 });
 await scenario('signature-component-platform-sequence-and-traversal-rejected',async()=>{
  const install=root('reject');await seed(install,'client',a);
  for(const [name,mutate] of [['platform',m=>m.platform='other'],['component',m=>m.component='launcher'],['traversal',m=>m.files[0].path='../client'],['alias',m=>m.files.push({...m.files[0],path:'CLIENT'})],['sequence',m=>m.sequence=1]]){
   const t=await tree(`bad-${name}`,'client',2,{mutate});await command(binary,['stage',install,'client',t.path],{success:false});
  }
  const unsigned=await tree('bad-signature','client',2);const envelope=JSON.parse(await readFile(join(unsigned.path,'bootstrap-manifest.json')));envelope.signature=randomBytes(64).toString('base64');await writeFile(join(unsigned.path,'bootstrap-manifest.json'),JSON.stringify(envelope));
  await command(binary,['stage',install,'client',unsigned.path],{success:false});assert.equal((await state(install,'client')).active.digest,a.digest);
 });
 await scenario('changed-bytes-and-unsigned-files-rejected-before-prepare',async()=>{
  const t=await tree('bad-bytes','client',2);await writeFile(join(t.path,'client'),'bad');await command(binary,['stage',root('reject'),'client',t.path],{success:false});
  const extra=await tree('bad-extra','client',2);await writeFile(join(extra.path,'extra'),'unsigned');await command(binary,['stage',root('reject'),'client',extra.path],{success:false});
 });
 await scenario('recovery-after-staging-and-prepared-durable-boundaries',async()=>{
  for(const fault of ['staged','prepared']){
   const install=root(fault);await seed(install,'client',a);
   const r=await command(binary,['stage',install,'client',b.path],{success:false,extra:{BRICKS_BOOTSTRAP_FAULT:fault}});assert.equal(r.code,86);
   await cli('recover',install,'client');assert.equal((await state(install,'client')).active.digest,a.digest);await cli('run',install,'client','--','-muted');
  }
 });
 await scenario('recovery-after-pre-spawn-journal-binds-failed-digest',async()=>{
  const install=root('pending');await seed(install,'client',a);await cli('stage',install,'client',b.path);
  const r=await command(binary,['activate',install,'client'],{success:false,extra:{BRICKS_BOOTSTRAP_FAULT:'pending'}});assert.equal(r.code,86);
  const pending=await state(install,'client');assert.equal(pending.pending.target.digest,b.digest);assert.equal(pending.pending.nonce.length,64);
  await cli('recover',install,'client');const s=await state(install,'client');assert.equal(s.active.digest,a.digest);assert.ok(s.failed.includes(b.digest));
  await command(binary,['stage',install,'client',b.path],{success:false});await cli('run',install,'client','--','-muted');
 });
 await scenario('stale-nonce-health-cannot-commit',async()=>{
  const install=root('stale');await seed(install,'client',a);await cli('stage',install,'client',b.path);
  // Both candidate and fallback receive stale receipts; transaction must still
  // be rolled back before the fallback reports its own independent error.
  await command(binary,['activate',install,'client'],{success:false,extra:{BRICKS_FIXTURE_BEHAVIOR:'stale',BRICKS_FIXTURE_FAIL_DIGEST:b.digest}});
  const s=await state(install,'client');assert.equal(s.active.digest,a.digest);assert.ok(s.failed.includes(b.digest));await cli('run',install,'client','--','-muted');
 });
 await scenario('early-exit-never-commits-or-consumes-working-tree',async()=>{
  const install=root('exit');await seed(install,'client',a);await cli('stage',install,'client',b.path);await command(binary,['activate',install,'client'],{success:false,extra:{BRICKS_FIXTURE_BEHAVIOR:'exit',BRICKS_FIXTURE_FAIL_DIGEST:b.digest}});
  const s=await state(install,'client');assert.equal(s.active.digest,a.digest);assert.equal(s.pending,null);assert.ok(s.failed.includes(b.digest));
 });
 await scenario('post-health-uncommitted-restart-rolls-back',async()=>{
  const install=root('healthy');await seed(install,'client',a);await cli('stage',install,'client',b.path);
  const r=await command(binary,['activate',install,'client'],{success:false,extra:{BRICKS_BOOTSTRAP_FAULT:'healthy'}});assert.equal(r.code,86);
  await new Promise(r=>setTimeout(r,800));await cli('recover',install,'client');assert.equal((await state(install,'client')).active.digest,a.digest);
 });
 await scenario('post-commit-restart-preserves-new-working-identity',async()=>{
  const install=root('committed');await seed(install,'client',a);await cli('stage',install,'client',c.path);
  const r=await command(binary,['activate',install,'client'],{success:false,extra:{BRICKS_BOOTSTRAP_FAULT:'committed'}});assert.equal(r.code,86);
  await new Promise(r=>setTimeout(r,800));await cli('recover',install,'client');assert.equal((await state(install,'client')).active.digest,c.digest);await cli('run',install,'client','--','-muted');
 });
 await scenario('live-orphan-refuses-recovery-until-original-process-exits',async()=>{
  const install=root('spawned');await seed(install,'client',a);await cli('stage',install,'client',b.path);
  const r=await command(binary,['activate',install,'client'],{success:false,extra:{BRICKS_BOOTSTRAP_FAULT:'spawned'}});assert.equal(r.code,86);
  const refused=await command(binary,['recover',install,'client'],{success:false});assert.match(refused.stderr,/still running|live processes/);
  await new Promise(r=>setTimeout(r,800));await cli('recover',install,'client');assert.equal((await state(install,'client')).active.digest,a.digest);
 });
 await scenario('signed-contained-symlink-preserved-escaping-link-rejected',async()=>{
  const install=root('links');
  for(const [name,link,ok] of [['contained','client',true],['escape','../outside',false]]){
   const t=await tree(`links-${name}`,'client',1);await symlink(link,join(t.path,'alias'));await writeFile(join(output,'outside'),'external');
   t.manifest.files.push({path:'alias',link});const payload=JSON.stringify(t.manifest);
   await writeFile(join(t.path,'bootstrap-manifest.json'),JSON.stringify({payload,signature:sign(null,Buffer.from(payload),key.privateKey).toString('base64')}));
   await command(binary,['stage',install,'client',t.path],{success:ok});
   if(ok)await activate(install,'client');
  }
 });
 await scenario('prepared-tree-tampering-is-detected-before-spawn',async()=>{
  const install=root('prepared-tamper');await seed(install,'client',a);await cli('stage',install,'client',b.path);
  await writeFile(join(install,'client','slots',b.digest,'client'),'changed after preparation');await command(binary,['activate',install,'client'],{success:false});assert.equal((await state(install,'client')).active.digest,a.digest);
 });
 await scenario('previous-working-payload-recovers-from-active-startup-failure',async()=>{
  const install=root('active-failure');await seed(install,'client',a);await cli('stage',install,'client',b.path);await activate(install,'client');
  await command(binary,['run',install,'client','--','-muted'],{extra:{BRICKS_FIXTURE_BEHAVIOR:'exit',BRICKS_FIXTURE_FAIL_DIGEST:b.digest}});
  const s=await state(install,'client');assert.equal(s.active.digest,a.digest);assert.ok(s.failed.includes(b.digest));
 });
 await scenario('spawn-gap-process-scan-normalizes-root-before-recovery',async()=>{
  const install=root('spawn-gap');await seed(install,'client',a);await cli('stage',install,'client',b.path);
  await command(binary,['activate',install,'client'],{success:false,extra:{BRICKS_BOOTSTRAP_FAULT:'spawned'}});
  const file=join(install,'client','state.json');const current=await state(install,'client');current.pending.process=null;await writeFile(file,JSON.stringify(current));
  const alias=install+'/../install-spawn-gap';const refused=await command(binary,['recover',alias,'client'],{success:false});assert.match(refused.stderr,/live processes/);
  await new Promise(r=>setTimeout(r,800));await cli('recover',install,'client');assert.equal((await state(install,'client')).active.digest,a.digest);
 });
 await scenario('infrastructure-receipt-error-does-not-blacklist-healthy-active',async()=>{
  const install=root('receipt-io');await seed(install,'client',a);await cli('stage',install,'client',b.path);await activate(install,'client');
  await command(binary,['run',install,'client'],{success:false,extra:{BRICKS_BOOTSTRAP_NONCE:'c'.repeat(64),BRICKS_BOOTSTRAP_DIGEST:'d'.repeat(64),BRICKS_BOOTSTRAP_RECEIPT:join(output,'missing-directory','receipt.json')}});
  const s=await state(install,'client');assert.equal(s.active.digest,b.digest);assert.ok(!s.failed.includes(b.digest));await cli('run',install,'client','--','-muted');
 });
 await scenario('installed-normal-launch-keeps-machine-tree-readonly',async()=>{
  const install=root('readonly');await seed(install,'client',a);await seed(install,'launcher',coreA);
  const {readdir,stat,chmod}=await import('node:fs/promises');
  async function freeze(path){for(const item of await readdir(path,{withFileTypes:true})){const file=join(path,item.name);if(item.isDirectory())await freeze(file);else{const mode=(await stat(file)).mode;await chmod(file,mode&0o111?0o555:0o444);}}await chmod(path,0o555);}
  async function snapshot(path){const rows=[];for(const item of await readdir(path,{withFileTypes:true})){const file=join(path,item.name);rows.push([file,item.isDirectory()?await snapshot(file):digest(await readFile(file))]);}return rows;}
  await freeze(install);const before=await snapshot(install);await cli('installed-run',install,'launcher','--','-muted');assert.deepEqual(await snapshot(install),before);
 });
 await scenario('installed-user-quit-before-game-health-does-not-relaunch',async()=>{
  const install=root('quit');await seed(install,'client',a);await seed(install,'launcher',coreA);
  const result=await command(binary,['installed-run',install,'launcher','--','-muted'],{extra:{BRICKS_FIXTURE_BEHAVIOR:'quit'}});assert.equal(result.code,0);assert.ok(!(await state(install,'client')).failed.includes(a.digest));
 });
 await scenario('installed-pair-transaction-health-commits-core-and-client',async()=>{
  const install=root('pair');await seed(install,'client',a);await seed(install,'launcher',coreA);
  const sources=join(output,'pair-sources.json');await writeFile(sources,JSON.stringify([{component:'client',path:b.path,digest:b.digest},{component:'launcher',path:coreB.path,digest:coreB.digest}]));
  await command(binary,['fixture-update',install,sources,'-muted']);assert.equal((await state(install,'client')).active.digest,b.digest);assert.equal((await state(install,'launcher')).active.digest,coreB.digest);
  const journal=JSON.parse(await readFile(join(install,'activation.json')));assert.equal(journal.phase,'committed');assert.equal(journal.plan.client.digest,b.digest);assert.equal(journal.plan.launcher.digest,coreB.digest);
  await cli('installed-run',install,'launcher','--','-muted');
 });
 await scenario('installed-durable-commit-decision-recovers-partial-pair',async()=>{
  const install=root('partial-commit');await seed(install,'client',a);await seed(install,'launcher',coreA);
  const sources=join(output,'partial-sources.json');await writeFile(sources,JSON.stringify([{component:'client',path:b.path,digest:b.digest},{component:'launcher',path:coreB.path,digest:coreB.digest}]));
  await command(binary,['fixture-update',install,sources,'-muted']);
  const journal=JSON.parse(await readFile(join(install,'activation.json')));journal.phase='committing';await writeFile(join(install,'activation.json'),JSON.stringify(journal));
  const client=await state(install,'client');client.active=client.previous;client.previous=null;client.prepared=journal.plan.client;client.pending={target:journal.plan.client,nonce:journal.plan.nonce,process:null};client.high_sequence=1;await writeFile(join(install,'client/state.json'),JSON.stringify(client));
  const before=JSON.stringify(client);await cli('installed-run',install,'launcher','--','-muted');assert.equal(JSON.stringify(await state(install,'client')),before,'ordinary launch observes durable pair without machine writes');
  await command(binary,['fixture-recover',install]);assert.equal((await state(install,'client')).active.digest,b.digest);assert.equal((await state(install,'launcher')).active.digest,coreB.digest);assert.equal(JSON.parse(await readFile(join(install,'activation.json'))).phase,'committed');
 });
 await scenario('installed-pending-gaps-blacklist-both-targets-before-replay',async()=>{
  for(const gap of ['compound-pending','compound-first-pending']){
   const install=root(gap);await seed(install,'client',a);await seed(install,'launcher',coreA);
   const sources=join(output,gap+'-sources.json');await writeFile(sources,JSON.stringify([{component:'client',path:b.path,digest:b.digest},{component:'launcher',path:coreB.path,digest:coreB.digest}]));
   const interrupted=await command(binary,['fixture-update',install,sources,'-muted'],{success:false,extra:{BRICKS_BOOTSTRAP_FAULT:gap}});assert.equal(interrupted.code,86);
   assert.equal(JSON.parse(await readFile(join(install,'activation.json'))).phase,'pending');assert.equal(Boolean((await state(install,'client')).pending),gap==='compound-first-pending');assert.equal((await state(install,'launcher')).pending,null);
   await command(binary,['fixture-recover',install]);
   for(const [component,target,working] of [['client',b,a],['launcher',coreB,coreA]]){const current=await state(install,component);assert.equal(current.active.digest,working.digest);assert.equal(current.pending,null);assert.equal(current.prepared,null);assert.ok(current.failed.includes(target.digest),'every cancelled target is durably blocked');}
   await command(binary,['fixture-update',install,sources,'-muted'],{success:false});assert.equal(JSON.parse(await readFile(join(install,'activation.json'))).phase,'aborted');
  }
 });
 await scenario('installed-worker-cancellation-and-stale-plans-cannot-switch-profile',async()=>{
  const health=join(output,'worker-profile-health'),directory=join(health,'updates');await mkdir(directory,{recursive:true});
  const profile=join(output,'historical-profile'),other=join(output,'wrong-profile');await mkdir(profile);await writeFile(join(profile,'settings.json'),'retain original');
  const extra={BRICKS_BOOTSTRAP_HEALTH_ROOT:health,BRICKS_BOOTSTRAP_PROFILE:profile};
  const nonce='a'.repeat(64),plan={request_nonce:nonce,schema:1,sources:[],profile,parent_pid:process.pid,root_pid:null,args:['-muted'],relaunch:true};
  const path=join(directory,'apply.json');await writeFile(path,JSON.stringify(plan));await writeFile(join(directory,'cancelled-'+nonce),'cancelled');
  await command(binary,['native-worker',path],{extra});await assert.rejects(readFile(join(health,'profile.json')),/ENOENT/);await assert.rejects(readFile(join(directory,'worker.json')),/ENOENT/);
  await command(binary,['fixture-profile',profile],{extra});const before=await readFile(join(health,'profile.json'),'utf8');
  await command(binary,['fixture-profile',other],{extra,success:false});assert.equal(await readFile(join(health,'profile.json'),'utf8'),before);
  await writeFile(path,JSON.stringify({...plan,profile:other}));await command(binary,['native-worker',path],{extra,success:false});assert.equal(await readFile(join(health,'profile.json'),'utf8'),before);
  const foreign=join(output,'foreign-apply.json');await writeFile(foreign,JSON.stringify(plan));await command(binary,['native-worker',foreign],{extra,success:false});assert.equal(await readFile(join(profile,'settings.json'),'utf8'),'retain original');
 });
 await scenario('installed-client-only-transaction-keeps-existing-core',async()=>{
  const install=root('client-only');await seed(install,'client',a);await seed(install,'launcher',coreA);const sources=join(output,'client-only-sources.json');await writeFile(sources,JSON.stringify([{component:'client',path:b.path,digest:b.digest}]));
  await command(binary,['fixture-update',install,sources,'-muted']);assert.equal((await state(install,'client')).active.digest,b.digest);assert.equal((await state(install,'launcher')).active.digest,coreA.digest);
 });
 await scenario('installed-core-only-transaction-proves-existing-client',async()=>{
  const install=root('core-only');await seed(install,'client',a);await seed(install,'launcher',coreA);const sources=join(output,'core-only-sources.json');await writeFile(sources,JSON.stringify([{component:'launcher',path:coreB.path,digest:coreB.digest}]));
  await command(binary,['fixture-update',install,sources,'-muted']);assert.equal((await state(install,'client')).active.digest,a.digest);assert.equal((await state(install,'launcher')).active.digest,coreB.digest);
 });
 await scenario('installed-stale-client-proof-rolls-back-pair-and-starts-working',async()=>{
  const install=root('pair-failure');await seed(install,'client',a);await seed(install,'launcher',coreA);const sources=join(output,'pair-failure-sources.json');await writeFile(sources,JSON.stringify([{component:'client',path:b.path,digest:b.digest},{component:'launcher',path:coreB.path,digest:coreB.digest}]));
  await command(binary,['fixture-update',install,sources,'-muted'],{extra:{BRICKS_FIXTURE_BEHAVIOR:'stale',BRICKS_FIXTURE_FAIL_DIGEST:b.digest}});
  assert.equal((await state(install,'client')).active.digest,a.digest);assert.equal((await state(install,'launcher')).active.digest,coreA.digest);assert.equal(JSON.parse(await readFile(join(install,'activation.json'))).phase,'aborted');
 });
 await scenario('complete-90-second-health-horizon-then-original-working-launch',async()=>{
  const install=root('horizon');await seed(install,'client',a);await cli('stage',install,'client',b.path);
  const start=performance.now();const result=await command(binary,['activate',install,'client','--','-muted'],{success:false,extra:{BRICKS_FIXTURE_BEHAVIOR:'timeout',BRICKS_FIXTURE_FAIL_DIGEST:b.digest},timeout:120000});
  const elapsed=performance.now()-start;assert.ok(elapsed>=90000 && elapsed<115000,`90s health horizon preserved: ${elapsed}`);assert.match(result.stderr,/90 seconds/);
  const s=await state(install,'client');assert.equal(s.active.digest,a.digest);assert.equal(s.pending,null);assert.ok(s.failed.includes(b.digest));report.healthHorizonMs=elapsed;
 });
 await scenario('symlink-install-root-rejected',async()=>{
  const path=join(output,'linked-root');await symlink(root('reject'),path,'dir');await command(binary,['status',path,'client'],{success:false});
 });
 assert.ok(report.scenarios.length > 0, 'nonempty explicit native scenario selection');
 if(selected.size)assert.deepEqual(new Set(report.scenarios.map(s=>s.name)),selected,'all requested native scenarios ran');
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
finally{await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,scenarios:report.scenarios.length,output,error:report.error}));}
