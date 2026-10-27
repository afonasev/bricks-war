/** Local packaged custom-updater witness. Never publishes or touches /Applications.
 * Requires a fresh --dir mac arm64 package and signed desktop-content from this checkout.
 * Instrumentation is written ONLY into generated QA app.asar, never production sources.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm,statfs,appendFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {sign,createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import * as asar from '@electron/asar';
import {chromium} from '@playwright/test';
const exec=promisify(execFile), sleep=ms=>new Promise(r=>setTimeout(r,ms));
assert.equal(process.platform,'darwin','macOS host required');
const packageApp=resolve(process.argv[2]??'build/self-update-package/mac-arm64/Bricks War.app');
const id=new Date().toISOString().replaceAll(/[:.]/g,'-');
const root=resolve('build/shell-witness-'+id), output=resolve('evidence/self-update-witness',id);
await mkdir(root,{recursive:true});await mkdir(output,{recursive:true});
const report={result:'RUNNING',root,packageApp,source:(await exec('git',['rev-parse','HEAD'])).stdout.trim(),
  dirtyStatus:(await exec('git',['status','--short'])).stdout,trackedDiffSha256:createHash('sha256').update((await exec('git',['diff','--binary'])).stdout).digest('hex'),
  limitations:['Generated QA packages, not immutable public installer bytes','Local signed transport fixture, not public GitHub/CDN','Unsigned writable isolated installation; no privileged /Applications/Gatekeeper proof','Windows/UAC/shortcuts/alternate administrator: NotRun'],scenarios:[]};
await writeFile(join(output,'result.json'),JSON.stringify(report,null,2));
const space=await statfs(root);
if(space.bavail*space.bsize<=2.5*1024**3){report.result='NotRun';report.error='Need 2.5 GiB free for real extraction/replacement; no foreign cleanup';await writeFile(join(output,'result.json'),JSON.stringify(report,null,2));throw Error(report.error);}
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const installed=join(root,'Installed','Bricks War.app'), profile=join(root,'profile'), extracted=join(root,'source');
await mkdir(join(root,'Installed'));await exec('/bin/cp',['-cR',packageApp,installed]);
const executable=join(installed,'Contents/MacOS/Bricks War'), archive=join(installed,'Contents/Resources/app.asar');
asar.extractAll(archive,extracted);
const originalMain=await readFile(join(extracted,'electron/main.mjs'),'utf8');
const originalPackage=JSON.parse(await readFile(join(extracted,'package.json'),'utf8'));
const originalEnvelope=JSON.parse(await readFile(join(extracted,'build/desktop-content/manifest.json'),'utf8'));
const key=await readFile(process.env.BRICKS_CONTENT_PRIVATE_KEY??join(homedir(),'.config/bricks-war/content-private-key.pem'),'utf8');
const signed=manifest=>{const payload=JSON.stringify(manifest);return {payload,signature:sign(null,Buffer.from(payload),key).toString('base64')};};
const prelude=`import {app} from 'electron';
import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
process.env.BRICKS_DESKTOP_QA_PROFILE=${JSON.stringify(profile)};
process.env.BRICKS_DESKTOP_QA_OFFLINE='1';
app.commandLine.appendSwitch('remote-debugging-port',${JSON.stringify(String(port))});
app.on('ready',()=>writeFileSync(${JSON.stringify(join(root,'boot.json'))},JSON.stringify({version:app.getVersion(),packaged:app.isPackaged,argv:process.argv,pid:process.pid})));
globalThis.fetch=async(url,options)=>{
 options?.signal?.throwIfAborted();const value=String(url);
 appendFileSync(${JSON.stringify(join(output,'requests.jsonl'))},JSON.stringify({version:app.getVersion(),url:value})+'\\n');
 if(readFileSync(${JSON.stringify(join(root,'mode'))},'utf8')==='offline')throw Error('QA offline');
 if(value.startsWith('https://api.github.com/repos/afonasev/bricks-war/releases?'))return Response.json(JSON.parse(readFileSync(${JSON.stringify(join(root,'releases.json'))},'utf8')));
 const name=decodeURIComponent(new URL(value).pathname.split('/').at(-1));
 if(value.startsWith('https://github.com/afonasev/bricks-war/releases/download/'))return new Response(readFileSync(${JSON.stringify(root)}+'/'+name));
 throw Error('Unexpected external request '+value);
};
`;
await writeFile(join(extracted,'electron/qa-witness.mjs'),prelude);
async function variant(version,{old=false,fault=false}={}) {
 await writeFile(join(extracted,'package.json'),JSON.stringify({...originalPackage,version,main:'electron/qa-entry.mjs'}));
 // A has the same shell transport with the pre-existing absence of the new image route.
 await writeFile(join(extracted,'electron/main.mjs'),old?originalMain.replace("if (url.pathname === '/__release-image')", "if (false && url.pathname === '/__release-image')"):originalMain);
 const manifest={...JSON.parse(originalEnvelope.payload),gameVersion:version,sequence:version==='1.11.0'?100:version==='1.12.2'?200:300};
 await writeFile(join(extracted,'build/desktop-content/manifest.json'),JSON.stringify(signed(manifest)));
 await writeFile(join(extracted,'electron/qa-entry.mjs'),`import './qa-witness.mjs';\n`+(fault?`const {app}=await import('electron');app.whenReady().then(()=>app.exit(23));\n`:`await import('./main.mjs');\n`));
 await rm(archive);await asar.createPackage(extracted,archive);asar.uncacheAll();
 await exec('/usr/libexec/PlistBuddy',['-c','Set :CFBundleShortVersionString '+version,join(installed,'Contents/Info.plist')]);
 await exec('/usr/libexec/PlistBuddy',['-c','Set :CFBundleVersion '+version,join(installed,'Contents/Info.plist')]);
 const stored=join(root,'app-'+version+'.asar');await exec('/bin/cp',['-c',archive,stored]);
 if(version==='1.11.0')return;
 const name='Bricks-War-'+version+'-mac-arm64.zip',file=join(root,name);
 await exec('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',installed,file]);
 const bytes=await readFile(file),sha256=createHash('sha256').update(bytes).digest('hex');
 const shell={schema:1,game:'bricks-war',component:'shell',channel:'stable',updaterAbi:1,contentAbi:3,contentSequence:manifest.sequence,version,files:[{name,platform:'darwin',arch:'arm64',minimumOS:'13.0.0',size:bytes.length,sha256}]};
 await writeFile(join(root,'manifest-'+version+'.json'),JSON.stringify(signed(shell)));
 report[version]={size:bytes.length,sha256,signature:'Ed25519, pinned project key',fault};
}
async function select(version) {
 const info=report[version],name='Bricks-War-'+version+'-mac-arm64.zip';
 await writeFile(join(root,'shell-manifest.json'),await readFile(join(root,'manifest-'+version+'.json')));
 await writeFile(join(root,'releases.json'),JSON.stringify([{id:version==='1.12.2'?2:3,tag_name:'v'+version,draft:false,prerelease:false,body:'Local QA fixture',assets:[{name:'shell-manifest.json'},{name,size:info.size,digest:'sha256:'+info.sha256}]}]));
 await writeFile(join(root,'mode'),'online');
}
async function resetA() {
 await rm(profile,{recursive:true,force:true});await rm(archive);await exec('/bin/cp',['-c',join(root,'app-1.11.0.asar'),archive]);
 for(const key of ['CFBundleShortVersionString','CFBundleVersion'])await exec('/usr/libexec/PlistBuddy',['-c','Set :'+key+' 1.11.0',join(installed,'Contents/Info.plist')]);
 await select('1.12.2');
}
let browser,page;
async function connect(version,timeout=45000) {
 const deadline=Date.now()+timeout;let last;
 while(Date.now()<deadline){
  try {
   const boot=JSON.parse(await readFile(join(root,'boot.json'),'utf8'));assert.equal(boot.version,version);assert.equal(boot.packaged,true);
   browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1500});
   page=browser.contexts()[0].pages().find(p=>p.url().startsWith('https://bricks.afonasev.tech'));
   assert.ok(page);await page.locator('#desktop-exit').waitFor({timeout:2000});
   assert.equal((await page.evaluate(()=>window.bricksDesktop.updateState())).shellVersion,version);
   return boot;
  }catch(e){last=e;await browser?.close().catch(()=>{});browser=null;await sleep(500);}
 }
 throw Error('Cannot connect to packaged '+version+': '+last);
}
function launch(){const child=spawn(executable,['-muted'],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>appendFile(join(output,'native.log'),chunk));child.on('error',()=>{});return child;}
async function quit(){await page.evaluate(()=>{void window.bricksDesktop.exit();}).catch(()=>{});await browser?.close().catch(()=>{});browser=null;await sleep(1000);}
async function waitPhase(phases,timeout) {
 const deadline=Date.now()+timeout;let state;
 do{state=await page.evaluate(()=>window.bricksDesktop.updateState());if(phases.includes(state.phase))return state;await sleep(100);}while(Date.now()<deadline);
 throw Error('Phase timeout: '+JSON.stringify(state));
}
async function download(){await waitPhase(['available'],30000);await page.evaluate(()=>window.bricksDesktop.download());assert.equal((await waitPhase(['ready','download-error'],120000)).phase,'ready');}
async function imageRoute(){return page.evaluate(async()=> (await fetch('/__release-image?url='+encodeURIComponent('https://example.com/blocked.png'))).status);}
async function retained(){assert.equal(await page.evaluate(()=>localStorage.getItem('qa-retained')),'preserved');assert.equal((await page.evaluate(()=>window.bricksDesktop.display())).width,960);}
try {
 await writeFile(join(root,'mode'),'online');
 await variant('1.12.2');await variant('1.12.3',{fault:true});await variant('1.11.0',{old:true});
 for(const mode of ['restart','next-launch-offline']) {
  await resetA();launch();await connect('1.11.0');assert.equal(await imageRoute(),404);
  await page.evaluate(async()=>{localStorage.setItem('qa-retained','preserved');await window.bricksDesktop.setDisplay({width:960,height:540,fullscreen:false,auto:false});await window.bricksDesktop.confirmDisplay(true);});
  await download();await page.screenshot({path:join(output,mode+'-ready.png')});
  const before=JSON.parse(await readFile(join(root,'boot.json'),'utf8'));
  if(mode==='restart') {await page.evaluate(()=>{void window.bricksDesktop.apply();});await browser.close().catch(()=>{});browser=null;}
  else {await quit();assert.equal(JSON.parse(await readFile(join(root,'boot.json'),'utf8')).pid,before.pid);await access(join(profile,'shell-update/ready.json'));await writeFile(join(root,'mode'),'offline');launch();}
  const boot=await connect('1.12.2');assert.notEqual(boot.pid,before.pid);assert.equal(await imageRoute(),403);await retained();
  await page.screenshot({path:join(output,mode+'-updated.png')});
  // The helper, not this test, must commit health and clean readiness/backup.
  for(let n=0;n<100;n++){try{await access(join(profile,'shell-update/ready.json'));await sleep(100);}catch{break;}}
  await assert.rejects(access(join(profile,'shell-update/ready.json')));await assert.rejects(access(installed+'.previous-1.12.2'));
  assert.equal(await readFile(join(profile,'shell-update/healthy-version'),'utf8'),'1.12.2');
  report.scenarios.push({mode,result:'PASS',from:'1.11.0',to:'1.12.2',newMainRoute:[404,403],dataRetained:true,health:true});
  await quit();await writeFile(join(root,'mode'),'offline');launch();await connect('1.12.2');await retained();assert.equal(await imageRoute(),403);await quit();
 }
 await select('1.12.3');launch();await connect('1.12.2');await download();
 const rollbackStarted=Date.now();await page.evaluate(()=>{void window.bricksDesktop.apply();});await browser.close().catch(()=>{});browser=null;
 for(let n=0;n<100;n++){if(JSON.parse(await readFile(join(root,'boot.json'),'utf8')).version==='1.12.3')break;await sleep(100);}
 assert.equal(JSON.parse(await readFile(join(root,'boot.json'),'utf8')).version,'1.12.3','Fault package must really launch before recovery');
 await connect('1.12.2',125000);await retained();assert.equal(await imageRoute(),403);
 const recovery=JSON.parse(await readFile(join(profile,'shell-update/recovery.json'),'utf8'));assert.ok(recovery.failedVersions.includes('1.12.3'));
 await waitPhase(['install-error'],30000);
 await page.screenshot({path:join(output,'rollback.png')});
 report.scenarios.push({mode:'real-startup-failure-rollback',result:'PASS',from:'1.12.2',failed:'1.12.3',restored:'1.12.2',elapsedMs:Date.now()-rollbackStarted,recovery,dataRetained:true,productionHealthTimeoutSeconds:90});
 await quit();await writeFile(join(root,'mode'),'offline');launch();await connect('1.12.2');await retained();await quit();
 report.result='PASS';
} catch(error){report.result='FAIL';report.error=error.stack;throw error;}
finally {
 await browser?.close().catch(()=>{});
 await writeFile(join(output,'result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({result:report.result,root,output}));
}
