import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sign,generateKeyPairSync,createHash } from 'node:crypto';
import {ShellUpdate,validateShell,shellHelperCommand} from '../../electron/shell-update.mjs';
import {replaceApplication,applicationEnvironment,recordShellFailure,failedShellVersions} from '../../electron/shell-helper.mjs';
const keys=generateKeyPairSync('ed25519');
function envelope(overrides={}) { const payload=JSON.stringify({schema:1,game:'bricks-war',component:'shell',channel:'stable',updaterAbi:1,contentSequence:1,version:'2.0.0',files:[{name:'Bricks-War-2.0.0-mac-universal.zip',platform:'darwin',arch:'universal',minimumOS:'13.0.0',size:100,sha256:'a'.repeat(64)}],...overrides});return {payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')}; }
test('shell trust binds publisher, game, channel, version and architecture',()=>{
  assert.equal(validateShell(envelope(),keys.publicKey,'darwin','arm64','1.0.0').version,'2.0.0');
  for(const change of [{channel:'beta'},{game:'other'},{component:'content'},{version:'1.0.0'}])assert.throws(()=>validateShell(envelope(change),keys.publicKey,'darwin','arm64','1.0.0'));
  assert.throws(()=>validateShell(envelope(),keys.publicKey,'win32','x64','1.0.0'));
  assert.throws(()=>validateShell({...envelope(),signature:'bad'},keys.publicKey,'darwin','arm64','1.0.0'));
});
function operations(healthy=true,failMove=false) {
 const files=new Set(['/Applications/Bricks War.app']);const events=[];let checks=0;
 return {events,files,exists:async path=>files.has(path),copy:async(from,to)=>{files.add(to);events.push('copy');},remove:async path=>{files.delete(path);events.push('remove');},move:async(from,to)=>{if(failMove&&from.includes('.incoming-'))throw Error('disk');assert.ok(files.has(from));files.delete(from);files.add(to);events.push([from,to]);},launch:async(target,args)=>events.push(['launch',target,args]),healthy:async()=>{checks++;return healthy;},wait:async()=>{},saveFailure:async version=>events.push(['failed',version]),checks:()=>checks};
}
const plan={executable:'/Applications/Bricks War.app/Contents/MacOS/Bricks War',application:'/profile/staged/Bricks War.app',version:'2.0.0',args:['-muted','--custom']};
test('app replacement preserves previous bundle until successful startup and forwards arguments',async()=>{
 const ops=operations();assert.equal(await replaceApplication(plan,ops),true);assert.ok(!ops.files.has('/Applications/Bricks War.app.previous-2.0.0'));assert.equal(ops.checks(),1);assert.deepEqual(ops.events.find(e=>Array.isArray(e)&&e[0]==='launch'),['launch','/Applications/Bricks War.app',['-muted','--custom']]);
});
test('failed startup restores previous app and blocks automatic reinstallation of failed version',async()=>{
 const ops=operations(false);await assert.rejects(replaceApplication(plan,ops),/health/);assert.ok(ops.files.has('/Applications/Bricks War.app'));assert.ok(!ops.files.has('/Applications/Bricks War.app.previous-2.0.0'));assert.deepEqual(ops.events.at(-2),['failed','2.0.0']);assert.equal(ops.checks(),90);
});
test('failure between bundle renames restores the existing app',async()=>{
 const ops=operations(true,true);await assert.rejects(replaceApplication(plan,ops),/disk/);assert.ok(ops.files.has('/Applications/Bricks War.app'));
});
test('unsupported updater ABI and OS cannot become shell candidates',()=>{
 assert.throws(()=>validateShell(envelope({updaterAbi:99}),keys.publicKey,'darwin','arm64','1.0.0','26.0.0'));
 assert.throws(()=>validateShell(envelope(),keys.publicKey,'darwin','arm64','1.0.0','12.0.0'));
});

test('relaunched game cannot inherit the helper-only Electron Node mode',()=>{assert.deepEqual(applicationEnvironment({ELECTRON_RUN_AS_NODE:'1',QA:'keep'}),{QA:'keep'});});

test('failed copy removes only incoming partial files, keeping the working app untouched',async()=>{
 const ops=operations();ops.copy=async(_from,to)=>{ops.files.add(to);throw Error('copy failed');};await assert.rejects(replaceApplication(plan,ops),/copy failed/);assert.ok(ops.files.has('/Applications/Bricks War.app'));assert.equal(ops.files.size,1);
});
test('early shell cancellation before preflight completion sends zero package requests',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bricks-shell-cancel-'));t.after(()=>rm(root,{recursive:true,force:true}));const updater=new ShellUpdate({root,platform:'darwin'});updater.selected={release:{},manifest:{version:'2.0.0',file:{size:1}},envelope:{}};let requests=0;updater.bytes=async()=>{requests++;throw Error('unexpected');};const preparing=updater.prepare(()=>{});updater.controller.abort();await assert.rejects(preparing);assert.equal(requests,0);assert.equal(updater.ready,undefined);
});
test('incompatible newest shell does not block the next compatible release',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bricks-shell-select-'));t.after(()=>rm(root,{recursive:true,force:true}));const updater=new ShellUpdate({root,platform:'darwin',arch:'arm64',version:'1.0.0',publicKey:keys.publicKey});
 const incompatible=envelope({version:'3.0.0',updaterAbi:99}),compatible=envelope();updater.bytes=async tag=>Buffer.from(JSON.stringify(tag==='v3.0.0'?incompatible:compatible));const assets=[{name:'shell-manifest.json'},{name:'Bricks-War-2.0.0-mac-universal.zip',size:100,digest:'sha256:'+'a'.repeat(64)}];const result=await updater.discover([{tag_name:'v3.0.0',assets},{tag_name:'v2.0.0',assets}]);assert.equal(result.manifest.gameVersion,'2.0.0');
});
test('multiple failed versions remain blocked across restarts rather than alternating',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bricks-shell-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));await recordShellFailure(root,'3.0.0');await recordShellFailure(root,'2.0.0');assert.deepEqual(await failedShellVersions(root),['3.0.0','2.0.0']);const updater=new ShellUpdate({root,platform:'darwin',arch:'arm64',version:'1.0.0',publicKey:keys.publicKey});updater.bytes=async()=>{throw Error('blocked version fetched');};assert.equal(await updater.discover([{tag_name:'v3.0.0',assets:[{name:'shell-manifest.json'}]},{tag_name:'v2.0.0',assets:[{name:'shell-manifest.json'}]}]),null);
});

test('post-health partial backup cleanup failure never rolls back the healthy application',async()=>{
 const ops=operations();const original=ops.remove;ops.remove=async path=>{if(path.includes('.previous-')){ops.files.delete(path);throw Error('partial cleanup');}return original(path);};
 ops.cleanupFailure=async()=>{throw Error('log disk full');};assert.equal(await replaceApplication(plan,ops),true);assert.ok(ops.files.has('/Applications/Bricks War.app'));assert.ok(!ops.events.some(e=>Array.isArray(e)&&e[0]==='failed'));
});


test('coordinated shell preparation cannot advertise readiness until all content is verified',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bricks-shell-deferred-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bytes=Buffer.from('signed installer fixture');
 const file={name:'Bricks-War-2.0.0-win-x64.exe',platform:'win32',arch:'x64',minimumOS:'10.0.0',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const signed=envelope({contentAbi:3,files:[file]});const manifest=validateShell(signed,keys.publicKey,'win32','x64','1.0.0','10.0.0');
 const shell=new ShellUpdate({root,platform:'win32'});shell.selected={release:{tag_name:'v2.0.0'},manifest,envelope:signed};shell.bytes=async()=>bytes;
 const plan=await shell.prepare(()=>{},()=>{},{deferReady:true});
 assert.equal(shell.ready,undefined);await assert.rejects(readFile(join(root,'ready.json')),{code:'ENOENT'});
 await shell.commitPrepared(plan);assert.equal(shell.ready.version,'2.0.0');assert.equal(JSON.parse(await readFile(join(root,'ready.json'))).version,'2.0.0');
});

test('signed shell capability metadata cannot contain an invalid ABI',()=>{
 for(const contentAbi of [0,-1,1.5,'3'])assert.throws(()=>validateShell(envelope({contentAbi}),keys.publicKey,'darwin','arm64','1.0.0'),/content ABI/);
 assert.equal(validateShell(envelope({contentAbi:3}),keys.publicKey,'darwin','arm64','1.0.0').contentAbi,3);
});


test('Windows helper launch permits only its process script and preserves spaced paths as arguments',async()=>{
 const helper='C:\\Users\\Game Player\\shell-helper.ps1',plan='C:\\Users\\Game Player\\apply.json';
 assert.deepEqual(shellHelperCommand('win32',helper,plan),['powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,plan]]);
 const recovery=await readFile(new URL('../../electron/shell-helper.ps1',import.meta.url),'utf8');
 assert.match(recovery, /'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File'/);
 assert.doesNotMatch(recovery,/Set-ExecutionPolicy/);
 assert.deepEqual(shellHelperCommand('darwin','/profile/helper.mjs','/profile/apply.json','/Applications/Bricks War.app/Contents/MacOS/Bricks War'),['/Applications/Bricks War.app/Contents/MacOS/Bricks War',['/profile/helper.mjs','/profile/apply.json']]);
});
