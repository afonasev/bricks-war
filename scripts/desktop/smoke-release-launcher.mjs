/** Real bundled game and launcher, offline, isolated profile and muted startup. */
import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,mkdtemp,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
const [executable,expected]=process.argv.slice(2);
if(!executable||!expected)throw Error('Pass Electron executable (or source) and expected version');
const out=await mkdtemp(join(process.env.BRICKS_QA_HOME??join(homedir(),'.local/state/bricks-war/qa'),'release-launcher-'));
await mkdir(join(out,'profile'));
const app=await electron.launch({...(executable==='source'?{}:{executablePath:resolve(executable)}),args:[...(executable==='source'?['.']:[]),'-muted','--lang=en-US'],env:{...process.env,BRICKS_DESKTOP_QA_PROFILE:join(out,'profile'),BRICKS_DESKTOP_QA_OFFLINE:'1'},timeout:60000});
const report={out,expected,status:'RUNNING'};console.log(out);
app.process().stderr.on('data',data=>appendFile(join(out,'stderr.log'),data));app.process().on('exit',(code,signal)=>{report.exit={code,signal};});
try{
 const launcher=await app.firstWindow();await launcher.getByRole('button',{name:'Play',exact:true}).waitFor();
 await launcher.locator('.brand').evaluate(img=>img.decode());
 await launcher.screenshot({path:join(out,'launcher-en.png'),timeout:15000});
 await launcher.getByRole('button',{name:'Play',exact:true}).click();
 let game;for(let i=0;i<100;i++){game=app.windows().find(p=>p.url().startsWith('https://bricks.afonasev.tech/'));if(game)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(game,'Game launched after Play');await game.locator('#desktop-exit').waitFor({timeout:30000});
 const state=await game.evaluate(()=>window.bricksDesktop.updateState());assert.equal(state.currentVersion,expected);assert.equal(state.shellVersion,expected);
 assert.equal(new URL(game.url()).searchParams.get('muted'),'1');
 await game.evaluate(()=>{localStorage.setItem('bricks-war:language:v1','en');});await game.reload();await game.locator('#desktop-exit').waitFor();
 await game.locator('.concept-brand-logo').evaluate(img=>img.decode());
 for(const size of [{width:1440,height:960},{width:390,height:844}]){
  await game.setViewportSize(size);
  assert.equal(await game.locator('.client-update-button,.client-update-status,.client-update-announcement,.desktop-release-history').count(),0);
  await game.screenshot({path:join(out,`game-${size.width}-en.png`)});
 }
 report.packaged=await app.evaluate(({app})=>app.isPackaged);report.state=state;report.url=game.url();report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error.stack);throw error;}finally{await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));await app.close();console.log(JSON.stringify(report));}
