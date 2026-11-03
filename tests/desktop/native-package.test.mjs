import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,symlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {generateKeyPairSync,createHash,verify} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {signNativeTree,assembleMacRoot,inspectNative,createNativeArchive,nativeReleaseEnvelope,assembleWindowsLayout} from '../../scripts/desktop/native-package.mjs';
import {validateNativeRelease} from '../../electron/native-update.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const base=process.env.BRICKS_QA_HOME||join(homedir(),'.local/state/bricks-war/qa');await mkdir(base,{recursive:true});
const output=await mkdtemp(join(base,'native-package-'));
const keys=generateKeyPairSync('ed25519');const publicKey=join(output,'fixture-public-key.pem');await writeFile(publicKey,keys.publicKey.export({format:'pem',type:'spki'}));
const target=process.env.CARGO_TARGET_DIR||join(output,'target');
const build=execFileSync('cargo',['build','--locked','--manifest-path','native/bootstrap/Cargo.toml','--features','fixture'],{env:{...process.env,CARGO_TARGET_DIR:target,BRICKS_BOOTSTRAP_TEST_KEY:publicKey},encoding:'utf8'});await writeFile(join(output,'cargo.log'),build);
const rootBinary=join(output,'fixture-root');await cp(join(target,'debug/bricks-bootstrap'),rootBinary);
const source=join(output,'client-source');await mkdir(source);const client=join(source,'client');
const c=join(output,'tiny.c');await writeFile(c,`
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc,char**argv){
 if(argc>1&&!strcmp(argv[1],"--native-profile-probe")){printf("{\\"schema\\":1,\\"profile\\":\\"%s\\"}",getenv("BRICKS_DESKTOP_QA_PROFILE"));return 0;}
 const char* receipt=getenv("BRICKS_BOOTSTRAP_RECEIPT");if(!receipt)return 4;
 char path[4096];snprintf(path,sizeof(path),"%s.tmp",receipt);FILE*f=fopen(path,"w");if(!f)return 5;
 fprintf(f,"{\\"nonce\\":\\"%s\\",\\"digest\\":\\"%s\\",\\"pid\\":%d}",getenv("BRICKS_BOOTSTRAP_NONCE"),getenv("BRICKS_BOOTSTRAP_DIGEST"),getpid());fclose(f);rename(path,receipt);usleep(600000);return 0;
}`);execFileSync('clang',['-Os',c,'-o',client]);await symlink('client',join(source,'alias'));
const core=join(output,'core-source');await mkdir(core);await cp(rootBinary,join(core,'core'));
const common={platform:'darwin',arch:process.arch==='x64'?'x86_64':process.arch,version:'1.0.0',sequence:1,privateKey:keys.privateKey};
const trees={client:await signNativeTree({...common,source,destination:join(output,'signed-client'),component:'client',entry:'client',profileProbe:true}),launcher:await signNativeTree({...common,source:core,destination:join(output,'signed-core'),component:'launcher',entry:'core',args:['core']})};
console.log(`Native package fixture: ${output}`);
test('signed tree preserves contained framework-style symlinks and matches native independent verifier',()=>{
 const actual=JSON.parse(execFileSync(rootBinary,['verify-tree','client',trees.client.path],{encoding:'utf8'}));assert.equal(actual.identity.digest,trees.client.identity.digest);assert.equal(trees.client.manifest.files.find(file=>file.path==='alias').link,'client');
});
test('fixture roots are refused by default packaging and escaping symlinks cannot enter signed trees',async()=>{
 await assert.rejects(()=>inspectNative(rootBinary),/Fixture/);
 await assert.rejects(()=>assembleMacRoot({nativeRoot:rootBinary,...trees,client:{...trees.client,identity:{...trees.client.identity,version:'9.0.0'}},publicKey:keys.publicKey,version:'9.0.0',profileName:'Bricks War',out:join(output,'altered-identity'),allowFixture:true}),/Changed native tree identity/);
 const bad=join(output,'bad-source');await mkdir(bad);await cp(client,join(bad,'client'));await symlink('../tiny.c',join(bad,'escape'));
 await assert.rejects(()=>signNativeTree({...common,source:bad,destination:join(output,'bad-destination'),component:'client',entry:'client',profileProbe:true}),/Escaping/);
});
test('separate signed outer-root assembly boots native core/client, probes original profile and keeps outer bundle unchanged',async()=>{
 const built=await assembleMacRoot({nativeRoot:rootBinary,...trees,publicKey:keys.publicKey,version:'1.0.0',profileName:'Bricks War',out:join(output,'app'),allowFixture:true});
 async function snapshot(path){const rows=[];for(const item of await readdir(path,{withFileTypes:true})){const p=join(path,item.name);if(item.isDirectory())rows.push([p,await snapshot(p)]);else if(item.isSymbolicLink())rows.push([p,'symlink']);else rows.push([p,digest(await readFile(p))]);}return rows;}
 const before=await snapshot(built.app);const profile=join(output,'existing-profile');await mkdir(profile);await writeFile(join(profile,'existing-settings.json'),'retain');
 const environment={...process.env,BRICKS_BOOTSTRAP_HEALTH_ROOT:join(output,'health'),BRICKS_DESKTOP_QA_PROFILE:profile};delete environment.BRICKS_BOOTSTRAP_PROFILE;delete environment.BRICKS_BOOTSTRAP_ROOT;
 execFileSync(join(built.app,'Contents/MacOS/bricks-bootstrap'),['-muted'],{env:environment,timeout:20000});
 assert.deepEqual(await snapshot(built.app),before);assert.equal(await readFile(join(profile,'existing-settings.json'),'utf8'),'retain');
 assert.equal(JSON.parse(await readFile(join(output,'health/profile.json'),'utf8')),profile);const state=JSON.parse(await readFile(join(profile,'native/client/state.json'),'utf8'));assert.equal(state.active.digest,trees.client.identity.digest);
});
test('native archive and release envelope bind exact bytes, both components, platform and compatibility',async()=>{
 const archive=await createNativeArchive({...trees,publicKey:keys.publicKey,out:join(output,'archive'),name:'native-darwin.zip'});const envelope=await nativeReleaseEnvelope({version:'1.0.0',contentAbi:3,contentSequence:1,packages:[archive],privateKey:keys.privateKey});
 assert.ok(verify(null,Buffer.from(envelope.payload),keys.publicKey,Buffer.from(envelope.signature,'base64')));
 const current={launcher:{sequence:0,digest:'0'.repeat(64)},client:{sequence:0,digest:'0'.repeat(64)}};
 const decoded=validateNativeRelease(envelope,keys.publicKey,'darwin',process.arch,current,'99.0.0');assert.equal(decoded.changed.length,2);assert.equal(decoded.file.sha256,digest(await readFile(archive.path)));
});

test('cross-built Windows root is inspectable without executing it; one-time installer seed pins exact root and both trees',async()=>{
 execFileSync('cargo',['build','--locked','--manifest-path','native/bootstrap/Cargo.toml','--target','x86_64-pc-windows-gnu','--features','fixture'],{env:{...process.env,CARGO_TARGET_DIR:target,BRICKS_BOOTSTRAP_TEST_KEY:publicKey},stdio:'pipe'});
 const windowsRoot=join(output,'windows-root.exe');await cp(join(target,'x86_64-pc-windows-gnu/debug/bricks-bootstrap.exe'),windowsRoot);
 const clientSource=join(output,'windows-client-source');await mkdir(clientSource);execFileSync('x86_64-w64-mingw32-gcc',['-Os',c,'-o',join(clientSource,'client.exe')]);
 const coreSource=join(output,'windows-core-source');await mkdir(coreSource);await cp(windowsRoot,join(coreSource,'core.exe'));
 const clientTree=await signNativeTree({...common,source:clientSource,destination:join(output,'windows-client'),component:'client',platform:'win32',arch:'x86_64',entry:'client.exe',profileProbe:true});
 const launcherTree=await signNativeTree({...common,source:coreSource,destination:join(output,'windows-core'),component:'launcher',platform:'win32',arch:'x86_64',entry:'core.exe',args:['core']});
 const layout=await assembleWindowsLayout({nativeRoot:windowsRoot,client:clientTree,launcher:launcherTree,publicKey:keys.publicKey,privateKey:keys.privateKey,out:join(output,'windows-layout'),allowFixture:true});
 assert.equal(layout.info.platform,'win32');assert.equal(layout.info.fixture,true);assert.ok(layout.info.architectures.includes('x86_64'));
 const seed=JSON.parse(await readFile(join(output,'windows-layout/installer-seed.json'),'utf8'));assert.ok(verify(null,Buffer.from(seed.payload),keys.publicKey,Buffer.from(seed.signature,'base64')));
 const identity=JSON.parse(seed.payload);assert.equal(identity.root_sha256,digest(await readFile(windowsRoot)));assert.equal(identity.client.digest,clientTree.identity.digest);assert.equal(identity.launcher.digest,launcherTree.identity.digest);assert.equal(identity.legacy_entry,'client.exe');assert.equal(identity.legacy_sha256,digest(await readFile(join(clientSource,'client.exe'))));assert.equal(digest(await readFile(join(layout.legacyApp,'client.exe'))),identity.legacy_sha256);
 const registry=await readFile(join(output,'windows-layout/native-registry.nsh'),'utf8');assert.match(registry,/NativeBootstrap-QA-/,'fixture installer cannot register the production native root');
});
