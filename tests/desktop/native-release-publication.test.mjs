import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyNativeReceipt} from '../../scripts/desktop/native-receipt.mjs';
import {isPublicSource} from '../../scripts/desktop/public-source.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('public SDK export includes native source/recipe and excludes private state',()=>{
 for(const name of ['native/bootstrap/Cargo.toml','native/bootstrap/src/main.rs','native/bootstrap/build.rs','native/bootstrap/Cargo.lock','electron-builder.native.yml','docs/desktop-native-migration.md'])assert.ok(isPublicSource(name),name);
 for(const name of ['openspec/changes/example/delivery.json','build/client.exe','.config/bricks-war/content-private-key.pem','evidence/key.pem'])assert.ok(!isPublicSource(name),name);
});
test('migration receipt binds both native packages and installers to exact signed bytes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bricks-receipt-')),keys=generateKeyPairSync('ed25519'),version='1.16.1',source='a'.repeat(40);
 const signed=value=>{const payload=JSON.stringify(value);return JSON.stringify({payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')});};
 try{
  await assert.rejects(verifyNativeReceipt(directory,keys.publicKey,version,source),/ENOENT/);
  const files=[];async function file(name,bytes){await writeFile(join(directory,name),bytes);files.push({name,size:Buffer.byteLength(bytes),sha256:hash(bytes)});return files.at(-1);}
  for(const suffix of ['mac-universal.dmg','mac-universal.zip','win-x64.exe'])await file(`Bricks-War-${version}-${suffix}`,'installer '+suffix);
  const native=[];for(const [platform,arch] of [['darwin','universal'],['win32','x64']]){
   const item=await file(`native-${platform}.zip`,'archive '+platform);native.push({...item,platform,arch,minimumOS:platform==='darwin'?'13.0.0':'10.0.0',unpackedSize:100,targets:['launcher','client'].map(component=>({component,version,sequence:1,digest:'b'.repeat(64)}))});
  }
  await file('native-manifest.json',signed({schema:1,game:'bricks-war',component:'native-release',channel:'stable',rootAbi:1,version,contentAbi:3,contentSequence:1,files:native}));
  await writeFile(join(directory,'migration-only.json'),signed({schema:1,installationKind:'migration',version,source,contentSequence:1,protectedRollbackAbi:1,freshInstallerVersion:'1.16.0',files}));
  assert.equal((await verifyNativeReceipt(directory,keys.publicKey,version,source)).version,version);
  const originalReceipt=await readFile(join(directory,'migration-only.json'),'utf8');
  for(const freshInstallerVersion of ['1.16.1','2.0.0','invalid']){
   const receipt=JSON.parse(JSON.parse(originalReceipt).payload);receipt.freshInstallerVersion=freshInstallerVersion;await writeFile(join(directory,'migration-only.json'),signed(receipt));
   await assert.rejects(verifyNativeReceipt(directory,keys.publicKey,version,source),/identity/);
  }
  await writeFile(join(directory,'migration-only.json'),originalReceipt);
  await assert.rejects(verifyNativeReceipt(directory,keys.publicKey,version,'c'.repeat(40)),/identity/);
  await writeFile(join(directory,files[2].name),'changed installer');
  await assert.rejects(verifyNativeReceipt(directory,keys.publicKey,version,source),/Changed migration asset/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
