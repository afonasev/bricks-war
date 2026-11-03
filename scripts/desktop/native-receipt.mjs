import {compareVersions} from '../../electron/compatibility.mjs';
/** A signed build receipt binds migration capability to exact SDK-produced assets. */
import {readFile} from 'node:fs/promises';
import {createHash,verify} from 'node:crypto';
import {join} from 'node:path';
import {validateNativeRelease} from '../../electron/native-update.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyNativeReceipt(directory,key,version,source) {
 const envelope=JSON.parse(await readFile(join(directory,'migration-only.json'),'utf8'));
 if(typeof envelope.payload!=='string'||!verify(null,Buffer.from(envelope.payload),key,Buffer.from(envelope.signature??'','base64')))throw Error('Invalid migration build receipt signature');
 const receipt=JSON.parse(envelope.payload);
 if(receipt.schema!==1||!Number.isSafeInteger(receipt.contentSequence)||receipt.contentSequence<1||receipt.installationKind!=='migration'||receipt.version!==version||receipt.source!==source||receipt.protectedRollbackAbi!==1||(!/^\d+\.\d+\.\d+$/.test(receipt.freshInstallerVersion??'')||compareVersions(receipt.freshInstallerVersion,version)>=0)||!Array.isArray(receipt.files))throw Error('Wrong migration build receipt identity');
 for(const file of receipt.files){
  if(!/^[A-Za-z0-9_.-]+$/.test(file.name))throw Error('Unsafe migration receipt asset');
  const bytes=await readFile(join(directory,file.name));if(bytes.length!==file.size||hash(bytes)!==file.sha256)throw Error('Changed migration asset: '+file.name);
 }
 const native=JSON.parse(await readFile(join(directory,'native-manifest.json'),'utf8'));
 for(const [platform,arch] of [['darwin','arm64'],['win32','x64']]){
  const manifest=validateNativeRelease(native,key,platform,arch,{launcher:{sequence:0},client:{sequence:0}},platform==='darwin'?'13.0.0':'10.0.0');
  const file=receipt.files.find(file=>file.name===manifest.file.name);
  if(manifest.version!==version||manifest.contentSequence!==receipt.contentSequence||!file||file.sha256!==manifest.file.sha256||file.size!==manifest.file.size||manifest.file.targets.some(target=>target.version!==version))throw Error('Native archive receipt mismatch');
 }
 for(const suffix of ['mac-universal.dmg','mac-universal.zip','win-x64.exe'])if(!receipt.files.some(file=>file.name===`Bricks-War-${version}-${suffix}`))throw Error('Missing migration installer');
 if(!receipt.files.some(file=>file.name==='native-manifest.json'))throw Error('Missing signed native manifest');
 return receipt;
}
