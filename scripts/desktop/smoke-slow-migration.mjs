/** Isolated real packaged bridge cancellation and >120-second native migration. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,appendFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {sign,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFile,spawn,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
const repo=process.cwd(),require=createRequire(join(repo,'package.json'));
const asar=require('@electron/asar'),{chromium}=require('@playwright/test');
const exec=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const [bridgeInput,nativeInput]=process.argv.slice(2);assert.ok(bridgeInput&&nativeInput,'Pass bridge .app and SDK assembly directory');
const native=resolve(nativeInput),assembly=JSON.parse(await readFile(join(native,'assembly.json'),'utf8')),version=assembly.version;
const base=process.env.BRICKS_QA_HOME??join(homedir(),'.local/state/bricks-war/qa');await mkdir(base,{recursive:true});
const out=join(base,'packaged-slow-'+Date.now());await mkdir(out);console.log(out);
const installed=join(out,'Bricks War.app'),profile=join(out,'profile'),feedPath=join(out,'feed.json');
await exec('/bin/cp',['-cR',resolve(bridgeInput),installed]);
const extracted=join(out,'extracted'),archive=join(installed,'Contents/Resources/app.asar');asar.extractAll(archive,extracted);
const pkg=JSON.parse(await readFile(join(extracted,'package.json'),'utf8')),oldVersion=pkg.version;
const zip=join(native,`installers/Bricks-War-${version}-mac-universal.zip`),bytes=await readFile(zip);
const bundled=JSON.parse(JSON.parse(await readFile(join(extracted,'build/desktop-content/manifest.json'),'utf8')).payload);
const file={name:`Bricks-War-${version}-mac-universal.zip`,platform:'darwin',arch:'universal',minimumOS:'13.0.0',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
const key=await readFile(process.env.BRICKS_CONTENT_PRIVATE_KEY??join(homedir(),'.config/bricks-war/content-private-key.pem'),'utf8');
const payload=JSON.stringify({schema:1,game:'bricks-war',component:'shell',channel:'stable',updaterAbi:2,installationKind:'migration',contentAbi:3,contentSequence:assembly.assembly.darwin.client.manifest.sequence,version,files:[file]});
const envelope={payload,signature:sign(null,Buffer.from(payload),key).toString('base64')};
await writeFile(feedPath,JSON.stringify({zip,envelope,releases:[{id:30,tag_name:'v'+version,draft:false,prerelease:false,assets:[{name:'shell-manifest.json'},{name:file.name,size:file.size,digest:'sha256:'+file.sha256}]}]}));
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const events=join(out,'events.jsonl');
const prelude=`import {readFileSync,appendFileSync} from 'node:fs';
const event=value=>appendFileSync(${JSON.stringify(events)},JSON.stringify({...value,at:Date.now()})+'\\n');
globalThis.fetch=async(input,options={})=>{
 const url=String(input),feed=JSON.parse(readFileSync(${JSON.stringify(feedPath)},'utf8'));
 options.signal?.throwIfAborted();
 if(url.includes('api.github.com'))return Response.json(feed.releases);
 if(url.endsWith('shell-manifest.json'))return Response.json(feed.envelope);
 if(url.endsWith('.zip')){
  const bytes=readFileSync(feed.zip);event({kind:'download-start'});let timer;
  return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,1024));timer=setTimeout(()=>{event({kind:'download-complete'});controller.enqueue(bytes.subarray(1024));controller.close();},125000);},cancel(){clearTimeout(timer);event({kind:'download-cancelled'});}}));
 }
 throw Error('Unexpected isolated request '+url);
};
await import('./main.mjs');
`;
await writeFile(join(extracted,'electron/qa-slow-entry.mjs'),prelude);await writeFile(join(extracted,'package.json'),JSON.stringify({...pkg,main:'electron/qa-slow-entry.mjs'}));
await asar.createPackage(extracted,archive);asar.uncacheAll();
const report={out,oldVersion,version,source:assembly.source,status:'RUNNING',scenarios:[],limitations:['QA copy instruments transport only; candidate native ZIP and signed trees unchanged','Windows/UAC NotRun, explicit user deferral','No installed user app/profile touched; all launches -muted']};
let browser,page;
function launch(){const child=spawn(join(installed,'Contents/MacOS/Bricks War'),['-muted','--lang=en-US','--remote-debugging-port='+port],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,BRICKS_DESKTOP_QA_PROFILE:profile,BRICKS_DESKTOP_QA_OFFLINE:'1'},stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',data=>appendFile(join(out,'runtime.log'),data));}
async function connect(kind,timeout=60000){const deadline=Date.now()+timeout;let last;while(Date.now()<deadline){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});page=browser.contexts().flatMap(c=>c.pages()).find(p=>kind==='launcher'?p.url().endsWith('launcher.html'):p.url().startsWith('https://bricks.afonasev.tech/'));assert.ok(page);if(kind==='game')await page.locator('#desktop-exit').waitFor({timeout:1000});return;}catch(error){last=String(error);await browser?.close().catch(()=>{});browser=null;await sleep(500);}}throw Error('Connect '+kind+': '+last);}
async function lines(){try{return (await readFile(events,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code==='ENOENT')return [];throw error;}}
async function quit(){await page.evaluate(()=>window.bricksDesktop.exit()).catch(()=>{});await browser.close().catch(()=>{});browser=null;await sleep(1200);}
try{
 launch();await connect('launcher');await page.getByRole('button',{name:'Update and launch',exact:true}).waitFor();assert.equal((await lines()).length,0,'No archive before consent');await page.getByRole('button',{name:'Update and launch',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).waitFor();for(let i=0;i<100 && !(await lines()).some(item=>item.kind==='download-start');i++)await sleep(20);assert.ok((await lines()).some(item=>item.kind==='download-start'));await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await browser.close().catch(()=>{});browser=null;await connect('game');assert.equal((await page.evaluate(()=>window.bricksDesktop.updateState())).shellVersion,oldVersion);assert.ok((await lines()).some(item=>item.kind==='download-cancelled'));await assert.rejects(access(join(profile,'shell-update/ready.json')),{code:'ENOENT'});await page.evaluate(()=>{localStorage.setItem('slow-migration-marker','retained');localStorage.setItem('bricks-war:language:v1','en');});report.scenarios.push('Cancel stalled archive aborts reader and opens working bridge without ready receipt');await quit();
 launch();await connect('launcher');await page.getByRole('button',{name:'Update and launch',exact:true}).click();const started=Date.now();await sleep(121000);assert.ok(!((await lines()).filter(item=>item.kind==='download-complete').length),'Still transferring after 120 seconds');await page.getByRole('button',{name:'Cancel',exact:true}).waitFor();await page.screenshot({path:join(out,'beyond-120s-en.png')});await browser.close();browser=null;
 await connect('game',120000);assert.equal((await page.evaluate(()=>window.bricksDesktop.updateState())).shellVersion,version);assert.equal(new URL(page.url()).searchParams.get('muted'),'1');assert.equal(await page.evaluate(()=>localStorage.getItem('slow-migration-marker')),'retained');const history=await lines();const complete=history.find(item=>item.kind==='download-complete');const start=history.filter(item=>item.kind==='download-start').at(-1);assert.ok(complete.at-start.at>=125000);const state=JSON.parse(await readFile(join(profile,'native/client/state.json'),'utf8'));assert.equal(state.active.digest,assembly.assembly.darwin.client.identity.digest);assert.equal(await readFile(join(profile,'shell-update/healthy-version'),'utf8'),version);await page.screenshot({path:join(out,'native-updated-en.png')});report.scenarios.push({scenario:'Real packaged slow bridge→production native migration, profile retained, exact signed client health',streamMs:complete.at-start.at,totalMs:Date.now()-started,zipSha256:file.sha256});await quit();report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error.stack);throw error;}finally{await browser?.close().catch(()=>{});await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));for(const line of execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n')){const match=line.trim().match(/^(\d+)\s+(.+)$/);if(match&&match[2].startsWith(out+'/'))try{process.kill(Number(match[1]),'SIGTERM');}catch{}}}
