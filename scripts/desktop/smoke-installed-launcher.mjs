/** Isolated native root -> real Electron -> signed pair update; no installed writes. */
import {_electron as electron,chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,writeFile,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {signNativeTree,assembleMacRoot,createNativeArchive,nativeReleaseEnvelope} from './native-package.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const base=process.env.BRICKS_QA_HOME||join(homedir(),'.local/state/bricks-war/qa');await mkdir(base,{recursive:true});
const out=await mkdtemp(join(base,'installed-electron-'));console.log(out);
const key=generateKeyPairSync('ed25519'),pem=join(out,'public.pem');await writeFile(pem,key.publicKey.export({format:'pem',type:'spki'}));
const target=process.env.CARGO_TARGET_DIR||join(out,'target');
execFileSync('cargo',['build','--release','--locked','--manifest-path','native/bootstrap/Cargo.toml','--features','fixture'],{env:{...process.env,CARGO_TARGET_DIR:target,BRICKS_BOOTSTRAP_TEST_KEY:pem},stdio:'pipe'});
const rootBinary=join(out,'native-root');await cp(join(target,'release/bricks-bootstrap'),rootBinary);
const profile=join(out,'existing-profile'),health=join(out,'health'),feed=join(out,'feed.json');await mkdir(profile);
await writeFile(join(profile,'retained-settings.json'),'original settings');await writeFile(feed,JSON.stringify({releases:[]}));
const bytes=Buffer.from(`<!doctype html><title>Native fixture</title><h1>Native fixture</h1><script>window.addEventListener('DOMContentLoaded',()=>window.bricksDesktop.healthy());</script>`);
const payload=JSON.stringify({schema:1,game:'bricks-war',component:'content',channel:'stable',sequence:1,gameVersion:'1.0.0',minShellVersion:3,minShellRelease:'1.13.0',files:[{path:'index.html',size:bytes.length,sha256:hash(bytes)}]});
const content={payload,signature:sign(null,Buffer.from(payload),key.privateKey).toString('base64')};
const source=join(out,'source');await mkdir(source);await cp('node_modules/electron/dist/Electron.app',join(source,'Bricks War.app'),{recursive:true,verbatimSymlinks:true});
const appRoot=join(source,'Bricks War.app/Contents/Resources/app');await mkdir(join(appRoot,'build/desktop-content'),{recursive:true});await cp('electron',join(appRoot,'electron'),{recursive:true});
await writeFile(join(appRoot,'electron/content-public-key.pem'),key.publicKey.export({format:'pem',type:'spki'}));await writeFile(join(appRoot,'build/desktop-content/index.html'),bytes);await writeFile(join(appRoot,'build/desktop-content/manifest.json'),JSON.stringify(content));
await writeFile(join(appRoot,'entry.mjs'),`
import {app} from 'electron';import {readFileSync,appendFileSync} from 'node:fs';
app.commandLine.appendSwitch('lang','en-US');
app.on('browser-window-created',(_e,w)=>w.webContents.on('did-finish-load',()=>appendFileSync(process.env.QA_WITNESS,JSON.stringify({url:w.webContents.getURL(),muted:w.webContents.isAudioMuted(),pid:process.pid,version:app.getVersion(),profile:app.getPath('userData')})+'\\n')));
globalThis.fetch=async url=>{const feed=JSON.parse(readFileSync(process.env.QA_FEED,'utf8'));if(process.env.QA_OFFLINE==='1')throw Error('isolated offline');if(url.includes('api.github.com'))return Response.json(feed.releases);if(url.endsWith('native-manifest.json'))return Response.json(feed.envelope);if(url.endsWith('.zip')){appendFileSync(process.env.QA_DOWNLOADS,url+'\\n');return new Response(readFileSync(feed.archive));}throw Error('Unexpected request '+url);};
await import('./electron/main.mjs');
`);
const arch=process.arch==='x64'?'x86_64':process.arch;
async function pair(version,sequence){
 await writeFile(join(appRoot,'package.json'),JSON.stringify({type:'module',main:'entry.mjs',name:'bricks-war',version}));
 const client=await signNativeTree({source,destination:join(out,`client-${sequence}`),component:'client',platform:'darwin',arch,version,sequence,entry:'Bricks War.app/Contents/MacOS/Electron',profileProbe:true,privateKey:key.privateKey});
 const coreSource=join(out,`core-source-${sequence}`);await mkdir(coreSource);await cp(rootBinary,join(coreSource,'core'));
 const launcher=await signNativeTree({source:coreSource,destination:join(out,`core-${sequence}`),component:'launcher',platform:'darwin',arch,version,sequence,entry:'core',args:['core'],privateKey:key.privateKey});return{client,launcher};
}
const a=await pair('1.15.0',1),b=await pair('2.0.0',2);
const built=await assembleMacRoot({nativeRoot:rootBinary,...a,publicKey:key.publicKey,version:'1.15.0',profileName:'Bricks War',out:join(out,'outer'),allowFixture:true});
const root=join(built.app,'Contents/MacOS/bricks-bootstrap');
async function snapshot(path){const rows=[];for(const item of await readdir(path,{withFileTypes:true})){const p=join(path,item.name);if(item.isDirectory())rows.push([item.name,await snapshot(p)]);else if(item.isSymbolicLink())rows.push([item.name,'link']);else rows.push([item.name,hash(await readFile(p))]);}return hash(JSON.stringify(rows));}
const before=await snapshot(built.app);
const env={...process.env,BRICKS_DESKTOP_QA_PROFILE:profile,BRICKS_BOOTSTRAP_HEALTH_ROOT:health,QA_FEED:feed,QA_WITNESS:join(out,'windows.jsonl'),QA_DOWNLOADS:join(out,'downloads.jsonl')};
for(const name of Object.keys(env))if(name.startsWith('BRICKS_BOOTSTRAP_')&&name!=='BRICKS_BOOTSTRAP_HEALTH_ROOT')delete env[name];
let app,browser;
const report={out,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source:{},scenarios:[]};
for(const name of ['electron/main.mjs','electron/native-update.mjs','electron/native-health.mjs',...(await readdir('native/bootstrap/src')).map(name=>'native/bootstrap/src/'+name),'native/bootstrap/build.rs','native/bootstrap/Cargo.toml'])report.source[name]=hash(await readFile(name));
async function launch(executablePath=root,extra={}){app=await electron.launch({executablePath,args:['-muted'],env:{...env,...extra},timeout:60000});app.process().stderr.on('data',data=>{void writeFile(join(out,'stderr.log'),data,{flag:'a'});});return app.firstWindow();}
async function game(){const end=Date.now()+20000;while(Date.now()<end){const p=app.windows().find(p=>p.url().startsWith('https://bricks.afonasev.tech/'));if(p){await p.getByRole('heading',{name:'Native fixture'}).waitFor();assert.equal(new URL(p.url()).searchParams.get('muted'),'1');return p;}await new Promise(r=>setTimeout(r,100));}throw Error('No game');}
try{
 // First boot the legacy client directly against the same original profile.
 await launch(join(a.client.path,a.client.manifest.entry));let page=await game();await page.evaluate(()=>localStorage.setItem('migration-marker','retain-me'));await app.close();app=null;
 report.scenarios.push('legacy profile populated');
 await launch();page=await game();assert.equal(await page.evaluate(()=>localStorage.getItem('migration-marker')),'retain-me');assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);await app.close();app=null;
 report.scenarios.push('native outer root/profile probe preserves original userData and localStorage');
 const archive=await createNativeArchive({...b,publicKey:key.publicKey,out:join(out,'archive'),name:'native-darwin.zip'});const envelope=await nativeReleaseEnvelope({version:'2.0.0',contentAbi:3,contentSequence:1,packages:[archive],privateKey:key.privateKey});const m=JSON.parse(envelope.payload);
 await writeFile(feed,JSON.stringify({releases:[{id:20,tag_name:'v2.0.0',draft:false,prerelease:false,assets:[{name:'native-manifest.json'},{name:archive.name,size:m.files[0].size,digest:`sha256:${m.files[0].sha256}`}]}],archive:archive.path,envelope}));
 page=await launch();await page.getByRole('button',{name:'Update and launch',exact:true}).waitFor();await page.screenshot({path:join(out,'offer-en.png')});
 await new Promise(r=>setTimeout(r,92000));assert.equal(app.windows().length,1);assert.ok(page.url().endsWith('launcher.html'));await assert.rejects(()=>readFile(env.QA_DOWNLOADS),{code:'ENOENT'});report.scenarios.push('ordinary consent remains alive beyond 90 seconds; no pre-consent archive');
 await page.getByRole('button',{name:'Update and launch',exact:true}).click();
 // The independent worker replaces the old root; attach the new real Chromium.
 const deadline=Date.now()+120000;let next;
 while(Date.now()<deadline){try{const lines=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');browser=await chromium.connectOverCDP(`http://127.0.0.1:${lines[0]}`,{timeout:1000});next=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('https://bricks.afonasev.tech/'));if(next&&await next.evaluate(async()=> (await window.bricksDesktop.check()).shellVersion)==='2.0.0')break;await browser.close();browser=null;}catch{}await new Promise(r=>setTimeout(r,500));}
 assert.ok(next&&browser,'updated client attached');await next.getByRole('heading',{name:'Native fixture'}).waitFor();assert.equal(await next.evaluate(()=>localStorage.getItem('migration-marker')),'retain-me');
 let committed;for(let i=0;i<100;i++){committed=JSON.parse(await readFile(join(profile,'native/activation.json'),'utf8'));if(committed.phase==='committed')break;await new Promise(r=>setTimeout(r,100));}assert.equal(committed.phase,'committed');assert.equal(committed.plan.client.digest,b.client.identity.digest);assert.equal(committed.plan.launcher.digest,b.launcher.identity.digest);
 report.scenarios.push('real Electron consent/worker/core+client update commits exact pair and retains profile');await next.evaluate(()=>window.bricksDesktop.exit()).catch(error=>{if(!/closed/.test(error.message))throw error;});await browser.close();browser=null;app=null;
 const worker=JSON.parse(await readFile(join(health,'updates/worker.json'),'utf8'));let exited=false;for(let i=0;i<200;i++){try{process.kill(worker.worker_pid,0);}catch{exited=true;break;}await new Promise(r=>setTimeout(r,50));}assert.ok(exited,'independent worker exits after game');
 assert.equal((await readdir(join(health,'updates'))).filter(name=>name.startsWith('prepared-')).length,0,'completed owned preparation is removed after worker finishes');
 await launch(root,{QA_OFFLINE:'1'});page=await game();assert.equal((await page.evaluate(()=>window.bricksDesktop.check())).shellVersion,'2.0.0');await app.close();app=null;report.scenarios.push('offline subsequent native boot uses updated client');
 assert.equal(await snapshot(built.app),before);assert.equal(await readFile(join(profile,'retained-settings.json'),'utf8'),'original settings');report.scenarios.push('outer .app unchanged; original settings retained');
 report.status='PASS';console.log(JSON.stringify(report));
}catch(error){report.status='FAIL';report.error=String(error.stack);throw error;}finally{await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));if(app)await app.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
 for(const line of execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n')){const match=line.trim().match(/^(\d+)\s+(.+)$/);if(match&&match[2].startsWith(out+'/')){try{process.kill(Number(match[1]),'SIGTERM');}catch{}}}
}
