import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPairSync,sign} from 'node:crypto';
import {GithubUpdates,localizedNotes} from '../../electron/github-updates.mjs';
import {TransferGate} from '../../electron/update-coordinator.mjs';
const key=generateKeyPairSync('ed25519');
async function fixture(t,alter={}){
 const root=await mkdtemp(join(tmpdir(),'bricks-template-github-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const payload=JSON.stringify({schema:1,game:'bricks-war',component:'content',channel:'stable',gameVersion:'2.0.0',sequence:22,minShellVersion:2,files:[{path:'index.html',sha256:'a'.repeat(64),size:4}],...alter});
 const envelope={payload,signature:sign(null,Buffer.from(payload),key.privateKey).toString('base64')};
 const release={id:9,tag_name:'content-22',draft:false,prerelease:false,published_at:'2026-10-15',body:'## Русский\n- Новое\n\n## English\n- Added',assets:[{name:'manifest.json'},{name:'a'.repeat(64),size:4,digest:'sha256:'+'a'.repeat(64)}]};
 const calls=[];const source=new GithubUpdates({gate:new TransferGate(),publicKey:key.publicKey,store:{shellVersion:2,state:{highWater:0},manifest:{sequence:1,gameVersion:'1.0.0'}},cachePath:join(root,'cache.json'),fetcher:async(url,options)=>{calls.push([url,options]);if(url.includes('api.github.com')&&url.includes('releases?'))return Response.json([release],{headers:{etag:'"test"'}});if(url.endsWith('manifest.json'))return Response.json(envelope);return new Response('',{status:404});}});
 return {source,calls,release,envelope};
}
test('GitHub API discovery verifies immutable content identity and complete assets without downloading game files',async t=>{
 const f=await fixture(t);const candidate=await f.source.discover();assert.equal(candidate.manifest.sequence,22);assert.equal(candidate.releaseId,9);assert.equal(f.calls.length,2);assert.ok(f.calls[0][0].startsWith('https://api.github.com/repos/afonasev/bricks-war/releases?'));assert.ok(!f.calls.some(([url])=>url.endsWith('a'.repeat(64))));
});
test('stable discovery rejects prerelease, wrong game/channel and incomplete packages',async t=>{
 for(const scenario of ['prerelease','game','channel','assets']){
  const f=await fixture(t,scenario==='game'?{game:'wrong'}:scenario==='channel'?{channel:'beta'}:{});if(scenario==='prerelease')f.release.prerelease=true;if(scenario==='assets')f.release.assets.pop();
  if(['game','channel'].includes(scenario))await assert.rejects(f.source.discover());else assert.equal(await f.source.discover(),null);
 }
});
test('history includes all available versions plus installed and never reselects a package',async t=>{
 const f=await fixture(t);const chosen=await f.source.discover();f.source.releases=[...Array.from({length:6},(_,i)=>({...f.release,tag_name:`content-${22-i}`})),{...f.release,tag_name:'content-1',name:'Game content 1.0.0'}];
 const before=f.calls.length;const history=await f.source.history();assert.equal(history.length,7);assert.ok(history.find(row=>row.tag==='content-17'));assert.ok(history.find(row=>row.installed&&row.tag==='content-1'));assert.equal(f.calls.length,before);assert.equal(chosen.manifest.sequence,22);assert.ok(history.every(row=>row.text==='- Новое'));
});
test('conditional API cache honors ETag without adding a second discovery policy',async t=>{
 const f=await fixture(t);await f.source.list();let conditional;
 f.source.fetcher=async(_url,options)=>{conditional=options.headers['If-None-Match'];return new Response(null,{status:304});};
 const rows=await f.source.api('releases?per_page=100&page=1');assert.equal(conditional,'"test"');assert.equal(rows[0].id,9);
});

test('authenticated content for a newer shell remains an explicit incomplete update',async t=>{
 const f=await fixture(t,{minShellVersion:3});const result=await f.source.discover();
 assert.equal(result.component,'shell-required');assert.equal(result.requiresShell,true);assert.equal(result.manifest.gameVersion,'2.0.0');assert.equal(f.calls.length,2);
});

test('minimum shell release is enforced even when ABI matches',async t=>{
 const f=await fixture(t,{minShellRelease:'1.10.0'});f.source.store.shellRelease='1.9.0';
 assert.equal((await f.source.discover()).component,'shell-required');
 f.source.store.shellRelease='1.10.0';assert.equal((await f.source.discover()).component,'content');
});

test('an incompatible newest game cannot silently fall back to an older compatible game',async t=>{
 const f=await fixture(t,{minShellVersion:4});const current=await f.source.list();
 f.source.list=async()=>[...current,{...f.release,tag_name:'content-21'}];
 f.source.shell={discover:async()=>({compatibility:{abi:3,version:'3.0.0'}})};
 const candidate=await f.source.discover();assert.equal(candidate.component,'shell-required');assert.equal(candidate.manifest.sequence,22);
});

test('invalid inventory cannot turn an incompatible manifest into a trusted update notice',async t=>{
 const f=await fixture(t,{minShellVersion:4,files:[{path:'../index.html',sha256:'a'.repeat(64),size:4}]});
 await assert.rejects(f.source.discover(),/inventory/);
});

test('seven language sections are bounded and legacy notes remain verbatim on explicit fallback',async t=>{
 const markers={ru:'Русский',en:'English',fr:'Français',de:'Deutsch',es:'Español',ja:'日本語','zh-Hans':'简体中文'};
 const body=Object.entries(markers).map(([locale,marker])=>`## ${marker}\n### Changes\n${locale} <unsafe> & player text`).join('\n\n');
 for(const locale of Object.keys(markers))assert.deepEqual(localizedNotes(body,locale),{text:`### Changes\n${locale} <unsafe> & player text`,fallback:false});
 assert.deepEqual(localizedNotes('## English\nOriginal\n## Русский\nИсходный','fr'),{text:'Original',fallback:true});
 assert.deepEqual(localizedNotes('', 'ja'),{text:'',fallback:true,notesUnavailable:'release'});
 const f=await fixture(t);await f.source.discover();
 const rows=await f.source.history('de');assert.equal(rows[0].text,'- Added');assert.equal(rows[0].fallback,true);
 assert.equal(rows.find(row=>row.installed).notesUnavailable,'installed');
});
