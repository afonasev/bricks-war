/** Real localized launcher review: isolated signed content, no installed writes. */
import {_electron as electron} from '@playwright/test';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {generateKeyPairSync,sign} from 'node:crypto';
import {digest} from '../../electron/content.mjs';
const base=process.env.BRICKS_QA_HOME??join(homedir(),'.local/state/bricks-war/qa');await mkdir(base,{recursive:true});const out=await mkdtemp(join(base,'warm-review-'));console.log(out);
const root=join(out,'app');await mkdir(join(root,'build/desktop-content'),{recursive:true});await cp('electron',join(root,'electron'),{recursive:true});const key=generateKeyPairSync('ed25519');await writeFile(join(root,'electron/content-public-key.pem'),key.publicKey.export({format:'pem',type:'spki'}));
const bytes=Buffer.from('<!doctype html><title>Review fixture</title><h1>Review game</h1>');const make=(version,sequence,releaseDate)=>{const payload=JSON.stringify({schema:1,game:'bricks-war',component:'content',channel:'stable',gameVersion:version,sequence,releaseDate,minShellVersion:3,minShellRelease:'1.13.0',files:[{path:'index.html',size:bytes.length,sha256:digest(bytes)}]});return{payload,signature:sign(null,Buffer.from(payload),key.privateKey).toString('base64')};};const current=make('1.16.3',1,'2026-11-03'),target=make('1.16.4',2,'2026-11-04');
await writeFile(join(root,'build/desktop-content/index.html'),bytes);await writeFile(join(root,'build/desktop-content/manifest.json'),JSON.stringify(current));await writeFile(join(root,'package.json'),JSON.stringify({name:'bricks-war',type:'module',version:'1.16.3',main:'entry.mjs'}));await writeFile(join(root,'target.json'),JSON.stringify(target));
const installerName='Bricks-War-1.16.5-win-x64.exe';
const installerFile={name:installerName,platform:'win32',arch:'x64',minimumOS:'0.0.0',size:100,sha256:'a'.repeat(64)};
const installerPayload=JSON.stringify({schema:1,game:'bricks-war',component:'shell',channel:'stable',updaterAbi:1,contentAbi:3,contentSequence:3,releaseDate:'2026-11-05',version:'1.16.5',files:[installerFile]});
await writeFile(join(root,'shell.json'),JSON.stringify({payload:installerPayload,signature:sign(null,Buffer.from(installerPayload),key.privateKey).toString('base64')}));
await writeFile(join(root,'entry.mjs'),`
import {app,shell} from 'electron';
import {readFileSync} from 'node:fs';
import {ShellUpdate} from './electron/shell-update.mjs';
const state=process.env.QA_STATE;
const manual=state.startsWith('manual-');
const discover=ShellUpdate.prototype.discover;
if(manual)ShellUpdate.prototype.discover=function(...args){this.platform='win32';this.arch='x64';return discover.apply(this,args);};
globalThis.openedInstallers=[];
shell.openExternal=async url=>{
 globalThis.openedInstallers.push(url);
 if(state==='manual-link-failed')throw Error('QA browser unavailable');
};
app.getLocale=()=> 'ru';
globalThis.fetch=async url=>{
 if(state==='failed')throw Error('Review offline');
 if(String(url).includes('api.github.com')){
  if(state==='current')return Response.json([]);
  if(manual)return Response.json([{id:5,tag_name:'v1.16.5',published_at:'2026-11-05',assets:[{name:'shell-manifest.json'},{name:'${installerName}',size:100,digest:'sha256:${installerFile.sha256}'}]}]);
  return Response.json([{id:2,tag_name:'content-2',draft:false,prerelease:false,published_at:'2026-11-04T12:00:00Z',assets:[{name:'manifest.json'},{name:'${digest(bytes)}',size:${bytes.length},digest:'sha256:${digest(bytes)}'}]}]);
 }
 if(String(url).endsWith('shell-manifest.json'))return Response.json(JSON.parse(readFileSync(new URL('./shell.json',import.meta.url))));
 if(String(url).endsWith('manifest.json'))return Response.json(JSON.parse(readFileSync(new URL('./target.json',import.meta.url))));
 throw Error('No payload transfer during review');
};
await import('./electron/main.mjs');
`);
const report={out,status:'RUNNING',fixtures:'Versions/dates illustrate the approved design, not a published 1.16.4 release',scenarios:[]};let app;
async function geometry(page){assert.deepEqual(await page.evaluate(()=>{const list=[...document.querySelectorAll('.brand,h1,#eyebrow,#description,#notice,#version,main button:not([hidden])')].filter(e=>e.getClientRects().length);const rects=list.map(e=>({e,r:e.getBoundingClientRect()}));const errors=[];if(document.documentElement.scrollHeight>innerHeight+1)errors.push('vertical overflow');for(const {e,r}of rects)if(r.left<0||r.top<0||r.right>innerWidth+.5||r.bottom>innerHeight+.5||e.scrollWidth>e.clientWidth+1)errors.push({text:e.textContent,box:r.toJSON(),viewport:[innerWidth,innerHeight],width:[e.clientWidth,e.scrollWidth]});for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i].r,b=rects[j].r;if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)errors.push('overlap');}return errors;}),[]);}
try{
 for(const state of ['current','failed','update','update-recovery','manual-recovery','manual-link-failed']){
  const profile = join(out,'profile-'+state);
  if (state.endsWith('-recovery') || state==='manual-link-failed') {
    await mkdir(join(profile,'content'),{recursive:true});
    await writeFile(join(profile,'content/state.json'),JSON.stringify({highWater:1,trial:true,current:'release-1',previous:null}));
  }
  app=await electron.launch({executablePath:electronPath,args:[root,'-muted'],env:{...process.env,QA_STATE:state,BRICKS_DESKTOP_QA_PROFILE:profile},timeout:30000});
  const page=await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.locator('#actions button').first().waitFor();
  assert.equal(await page.locator('#hint').count(),0);
  assert.ok(await page.locator('.brand').evaluate(e=>e.complete&&e.naturalWidth>0));
  assert.equal(await page.locator('html').getAttribute('lang'),'ru');
  assert.equal(await page.getByRole('button',{name:'Обновить',exact:true}).count(),state.startsWith('update')?1:0);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  const heading = {current:'Установлена последняя версия',failed:'Не удалось проверить обновления','manual-recovery':'Доступен установщик для Windows','manual-link-failed':'Доступен установщик для Windows'}[state] ?? 'Найдена новая версия';
  await page.getByRole('heading',{name:heading,exact:true}).waitFor();
  assert.match(await page.locator('#version').textContent(),state==='current'?/Обновлений нет/:/3 ноября 2026/);
  if(state.startsWith('update'))assert.match(await page.locator('#description').textContent(),/4 ноября 2026/);
  if(state.endsWith('-recovery'))assert.match(await page.locator('#notice').textContent(),/Предыдущее обновление/);
  if(state.startsWith('manual-')){
    await page.getByRole('button',{name:'Скачать установщик',exact:true}).click();
    assert.deepEqual(await app.evaluate(()=>globalThis.openedInstallers),[`https://github.com/afonasev/bricks-war/releases/download/v1.16.5/${installerName}`]);
    assert.ok(await page.getByRole('button',{name:'Играть',exact:true}).isEnabled());
    if(state==='manual-link-failed')await page.getByText(/Не удалось открыть ссылку на установщик/).waitFor();
  }
  for(const [label,width,height]of [['desktop',760,580],['narrow',360,640],['short',760,420],['narrow-short',360,420]]){await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),[width,height]);await page.waitForFunction(([w,h])=>innerWidth===w&&innerHeight===h,[width,height]);await geometry(page);await page.screenshot({path:join(out,state+'-'+label+'-ru.png')});report.scenarios.push({state,label,width,height,pass:true});}
  if(state==='update'){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(760,580));await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'update');await page.screenshot({path:join(out,'controller-focus-ru.png')});}
  await page.getByRole('button',{name:'Выйти',exact:true}).click();await app.close().catch(()=>{});app=null;
 }
 const handoff=join(out,'profile-handoff');await mkdir(join(handoff,'shell-update'),{recursive:true});const receipt=join(handoff,'shell-update/launch-args.json');await writeFile(receipt,JSON.stringify({version:'1.16.3',args:['-muted']}));
 app=await electron.launch({executablePath:electronPath,args:[root,'-muted'],env:{...process.env,QA_STATE:'current',BRICKS_DESKTOP_QA_PROFILE:handoff},timeout:30000});let page=await app.firstWindow();page.setDefaultTimeout(15000);await page.getByRole('heading',{name:'Review game',exact:true}).waitFor();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);await assert.rejects(access(receipt),{code:'ENOENT'});await app.close();app=null;
 app=await electron.launch({executablePath:electronPath,args:[root,'-muted'],env:{...process.env,QA_STATE:'current',BRICKS_DESKTOP_QA_PROFILE:handoff},timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(15000);await page.getByRole('heading',{name:'Установлена последняя версия',exact:true}).waitFor();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);await page.getByRole('button',{name:'Выйти',exact:true}).click();await app.close().catch(()=>{});app=null;report.scenarios.push({state:'legacy-handoff',pass:true,note:'Matching receipt auto-launches game once; next ordinary boot shows persistent launcher'});
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error.stack);throw error;}finally{await app?.close().catch(()=>{});await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
