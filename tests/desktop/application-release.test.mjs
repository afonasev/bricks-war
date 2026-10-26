import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {requirePublishedShell} from '../../scripts/desktop/application-release.mjs';
const keys=generateKeyPairSync('ed25519');
function fixture(overrides={}){
 const files=[['mac.zip','darwin','universal'],['win.exe','win32','x64']].map(([name,platform,arch])=>({name,platform,arch,minimumOS:platform==='darwin'?'13.0.0':'10.0.0',size:4,sha256:'a'.repeat(64)}));
 const manifest={schema:1,game:'bricks-war',component:'shell',channel:'stable',updaterAbi:1,contentAbi:3,contentSequence:10,version:'2.0.0',files,...overrides};
 const payload=JSON.stringify(manifest),envelope={payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')};
 const release={tag_name:'v2.0.0',draft:false,prerelease:false,assets:[{name:'shell-manifest.json'},...files.map(f=>({name:f.name,size:f.size,digest:`sha256:${f.sha256}`}))]};
 return {envelope,release};
}
const content={gameVersion:'2.1.0',sequence:20,minShellVersion:3,minShellRelease:'2.0.0'};
test('dependent content publication requires complete trusted packages on both platforms',async()=>{
 const f=fixture();assert.equal(await requirePublishedShell(content,[f.release],async()=>f.envelope,keys.publicKey),'v2.0.0');
 for(const change of ['missing','digest','draft','prerelease']){
  const f=fixture();if(change==='missing')f.release.assets.pop();if(change==='digest')f.release.assets[2].digest='sha256:'+'b'.repeat(64);if(['draft','prerelease'].includes(change))f.release[change]=true;
  await assert.rejects(requirePublishedShell(content,[f.release],async()=>f.envelope,keys.publicKey),/Publish complete/);
 }
});
test('signed ABI and minimum release must cover the new game before publication',async()=>{
 for(const requirements of [{...content,minShellVersion:4},{...content,minShellRelease:'2.0.1'}]){
  const f=fixture();await assert.rejects(requirePublishedShell(requirements,[f.release],async()=>f.envelope,keys.publicKey),/Publish complete/);
 }
});
test('a forged shell manifest never authorizes a partial content publication',async()=>{
 const f=fixture();f.envelope.signature='forged';await assert.rejects(requirePublishedShell(content,[f.release],async()=>f.envelope,keys.publicKey),/signature/);
});
test('release identity and out-of-order bundle sequence cannot conceal an older bundled game',async()=>{
 for(const change of [{version:'3.0.0'},{contentSequence:21}]){
  const f=fixture(change);await assert.rejects(requirePublishedShell(content,[f.release],async()=>f.envelope,keys.publicKey),/Publish complete/);
 }
});
