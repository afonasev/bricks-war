import {normalizeReleaseDate,manifestReleaseDate} from '../../electron/release-date.mjs';
/** Source packaging API; no publication, version bump or installed writes. */
import {cp,mkdir,readdir,lstat,readFile,writeFile,readlink,realpath,chmod,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,createPublicKey,sign,verify} from 'node:crypto';
import {join,relative,resolve,dirname,isAbsolute,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
const hex=bytes=>createHash('sha256').update(bytes).digest('hex');
const repository=resolve(fileURLToPath(new URL('../..',import.meta.url)));
function within(parent,target){const delta=relative(resolve(parent),resolve(target));return !delta||(!isAbsolute(delta)&&delta!=='..'&&!delta.startsWith('..'+sep));}
function external(path){const target=resolve(path);if(within(repository,target))throw Error('Native artifacts must stay outside the source checkout');return target;}
const semver=value=>typeof value==='string'&&/^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(value);
function pathName(path){
 if(typeof path!=='string'||!path||path.length>1024||!/^[\x20-\x7e]+$/.test(path)||/[\\:\0]/.test(path)||path.split('/').some(part=>!part||['.','..'].includes(part)||/[. ]$/.test(part)||/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(part)))throw Error('Unsafe portable payload path');return path;
}
async function hashFile(path){const hasher=createHash('sha256');for await(const bytes of createReadStream(path))hasher.update(bytes);return hasher.digest('hex');}
function publicFingerprint(key){const publicKey=key.type==='public'?key:createPublicKey(key);if(publicKey.asymmetricKeyType!=='ed25519')throw Error('Native releases require Ed25519');return hex(Buffer.from(publicKey.export({format:'jwk'}).x,'base64url'));}
export async function inspectNative(path,{allowFixture=false}={}){
 const bytes=await readFile(path);const marker=Buffer.from('BRICKS_BOOTSTRAP_INFO\0');const records=[];let offset=0;
 for(;;){const found=bytes.indexOf(marker,offset);if(found<0)break;offset=found+marker.length;
  if(offset+4>bytes.length)continue;const length=bytes.readUInt32LE(offset);if(length<1||length>4096||offset+4+length>bytes.length)continue;
  try{const value=JSON.parse(bytes.subarray(offset+4,offset+4+length).toString());if(value.rootAbi===1 && typeof value.fixture==='boolean' && /^[a-f0-9]{64}$/.test(value.keyFingerprint))records.push(value);}catch{/* non-record debug data */}
 }
 if(!records.length)throw Error('Native binary has no bounded build identity');
 const info=records[0];if(records.some(record=>record.rootAbi!==info.rootAbi||record.fixture!==info.fixture||record.keyFingerprint!==info.keyFingerprint||record.platform!==info.platform))throw Error('Native slices disagree on their trust identity');
 if(info.fixture&&!allowFixture)throw Error('Fixture native root cannot enter a production package');
 return {...info,architectures:[...new Set(records.map(record=>record.arch))],sha256:hex(bytes)};
}
async function inventory(root){
 const files=[],aliases=new Set();let total=0,count=0;
 async function walk(path){for(const item of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const full=join(path,item.name),name=pathName(relative(root,full).split('\\').join('/'));if(++count>60000)throw Error('Oversized native inventory');
  const metadata=await lstat(full);
  if(metadata.isSymbolicLink()){
   const link=await readlink(full);if(isAbsolute(link)||/[\\:\0]/.test(link))throw Error('Unsafe symlink');const actual=await realpath(full),base=await realpath(root);if(actual!==base&&!actual.startsWith(base+'/'))throw Error('Escaping symlink');files.push({path:name,link});
  }else if(metadata.isDirectory())await walk(full);
  else if(metadata.isFile()) {if(metadata.size>2*1024**3)throw Error('Oversized native file');total+=metadata.size;if(total>8*1024**3)throw Error('Oversized native payload');files.push({path:name,size:metadata.size,sha256:await hashFile(full),executable:Boolean(metadata.mode&0o111)});}
  else throw Error('Unsupported native entry');
  if(!metadata.isDirectory()){const alias=name.toLowerCase();if(aliases.has(alias))throw Error('Case-aliased native entry');aliases.add(alias);}
 }}
 await walk(root);return{files,total};
}
export async function signNativeTree({source,destination,component,platform,arch,version,sequence,entry,args=[],privateKey,profileProbe=false}){
 if(!['client','launcher'].includes(component)||!['darwin','win32'].includes(platform)||!['arm64','x86_64','universal'].includes(arch)||!semver(version)||!Number.isSafeInteger(sequence)||sequence<1)throw Error('Invalid native tree identity');
 external(destination);pathName(entry);if(args.length>32||args.some(arg=>typeof arg!=='string'||arg.length>4096||arg.includes('\0')))throw Error('Invalid signed launch arguments');
 if(within(source,destination))throw Error('Native tree destination must be separate');
 await mkdir(dirname(destination),{recursive:true});await mkdir(destination);await cp(source,destination,{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true});
 const manifestPath=join(destination,'bootstrap-manifest.json');
 try{await lstat(manifestPath);throw Error('Source already contains a bootstrap manifest');}catch(error){if(error.code!=='ENOENT')throw error;}
 const {files,total}=await inventory(destination);if(platform==='win32'&&files.some(file=>file.link))throw Error('Windows native tree cannot contain links');
 const launch=files.find(file=>file.path===entry);if(!launch||launch.link)throw Error('Missing native entrypoint');if(platform==='darwin'&&!launch.executable)throw Error('Signed app entrypoint is not executable');launch.executable=true;
 if(platform==='darwin'){const slices=(await exec('/usr/bin/lipo',['-archs',join(destination,entry)])).stdout.trim().split(/\s+/);if(arch==='universal'?!['arm64','x86_64'].every(slice=>slices.includes(slice)):!slices.includes(arch))throw Error('Native entrypoint architecture mismatch');}
 else{const bytes=await readFile(join(destination,entry));const offset=bytes.length>=64?bytes.readUInt32LE(60):-1;if(offset<0||offset+6>bytes.length||bytes.readUInt16LE(0)!==0x5a4d||bytes.readUInt32LE(offset)!==0x4550||bytes.readUInt16LE(offset+4)!==(arch==='x86_64'?0x8664:0xaa64))throw Error('Native PE entrypoint architecture mismatch');}
 const manifest={schema:1,game:'bricks-war',component,channel:'stable',platform,arch,version,sequence,root_abi:1,...(profileProbe?{profile_probe_abi:1}:{}),entry,args,files};
 const payload=JSON.stringify(manifest);const envelope={payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')};await writeFile(manifestPath,JSON.stringify(envelope));
 return{path:destination,identity:{digest:hex(payload),sequence,version},manifest,unpackedSize:total+Buffer.byteLength(JSON.stringify(envelope))};
}
function checkPair(launcher,client,publicKey,platform){
 for(const [component,tree] of [['launcher',launcher],['client',client]]){
  if(tree.manifest.component!==component||tree.manifest.platform!==platform||tree.manifest.root_abi!==1)throw Error('Incompatible native pair');
 }
 if(!client.manifest.profile_probe_abi)throw Error('Migration client must support the signed profile probe');
 if(launcher.manifest.arch!==client.manifest.arch)throw Error('Native pair architectures differ');
 return publicFingerprint(publicKey);
}
async function validateTreeCopy(tree,publicKey){
 const envelope=JSON.parse(await readFile(join(tree.path,'bootstrap-manifest.json'),'utf8'));
 if(!verify(null,Buffer.from(envelope.payload),publicKey,Buffer.from(envelope.signature,'base64'))||hex(envelope.payload)!==tree.identity.digest)throw Error('Changed native tree signature');
 const expected=JSON.parse(envelope.payload);if(JSON.stringify(expected)!==JSON.stringify(tree.manifest)||expected.sequence!==tree.identity.sequence||expected.version!==tree.identity.version)throw Error('Changed native tree identity');const actual=await inventory(tree.path);
 const actualFiles=actual.files.filter(file=>file.path!=='bootstrap-manifest.json');
 if(expected.platform==='win32'){const launch=actualFiles.find(file=>file.path===expected.entry);if(launch)launch.executable=true;}
 if(JSON.stringify(actualFiles)!==JSON.stringify(expected.files))throw Error('Changed native payload bytes');
}
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export async function assembleMacRoot({nativeRoot,launcher,client,publicKey,version,profileName,out,allowFixture=false}){
 external(out);const fingerprint=checkPair(launcher,client,publicKey,'darwin');const info=await inspectNative(nativeRoot,{allowFixture});
 const slices=(await exec('/usr/bin/lipo',['-archs',nativeRoot])).stdout.trim().split(/\s+/);
 if((client.manifest.arch==='universal'?!['arm64','x86_64'].every(slice=>slices.includes(slice)):!slices.includes(client.manifest.arch))||info.platform!=='darwin'||info.keyFingerprint!==fingerprint||!semver(version)||version!==client.identity.version||!profileName||/[\\/\0]/.test(profileName))throw Error('Wrong stable root identity/profile');
 await validateTreeCopy(launcher,publicKey);await validateTreeCopy(client,publicKey);
 const app=join(out,'Bricks War.app'),contents=join(app,'Contents');await mkdir(out,{recursive:true});await mkdir(app);await mkdir(join(contents,'MacOS'),{recursive:true});
 await cp(nativeRoot,join(contents,'MacOS/bricks-bootstrap'));await chmod(join(contents,'MacOS/bricks-bootstrap'),0o755);
 let iconKey='';
 const bundle=client.manifest.entry.match(/^(.+\.app)\/Contents\/MacOS\/[^/]+$/)?.[1];
 if(bundle){
  const clientContents=join(client.path,bundle,'Contents');
  const {stdout}=await exec('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIconFile',join(clientContents,'Info.plist')]);
  let icon=stdout.trim();if(!icon.endsWith('.icns'))icon+='.icns';pathName(icon);if(icon.includes('/'))throw Error('Nested app icon is unsupported');
  await mkdir(join(contents,'Resources'),{recursive:true});await cp(join(clientContents,'Resources',icon),join(contents,'Resources',icon));iconKey=`<key>CFBundleIconFile</key><string>${xml(icon)}</string>`;
 }
 const seed=join(contents,'Resources/native-seed');await mkdir(seed,{recursive:true});await cp(launcher.path,join(seed,'launcher'),{recursive:true,dereference:false,verbatimSymlinks:true});await cp(client.path,join(seed,'client'),{recursive:true,dereference:false,verbatimSymlinks:true});
 await writeFile(join(seed,'seed.json'),JSON.stringify({schema:1,profile_name:profileName,launcher:launcher.identity,client:client.identity}));
 await writeFile(join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>tech.afonasev.brickswar</string><key>CFBundleName</key><string>Bricks War</string><key>CFBundleDisplayName</key><string>Bricks War</string><key>CFBundleExecutable</key><string>bricks-bootstrap</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${xml(version)}</string><key>CFBundleVersion</key><string>${xml(version)}</string><key>LSMinimumSystemVersion</key><string>13.0.0</string>${iconKey}<key>LSUIElement</key><true/></dict></plist>`);
 return{app,info,seed,signing:'Unsigned root assembly; codesign/notarization are separate release gates. Signed payload app bundles copied unchanged.'};
}
export async function assembleWindowsLayout({nativeRoot,launcher,client,publicKey,privateKey,out,allowFixture=false}){
 external(out);const fingerprint=checkPair(launcher,client,publicKey,'win32');const info=await inspectNative(nativeRoot,{allowFixture});
 if(!allowFixture&&!/^[a-f0-9]{64}$/.test(info.iconFingerprint||''))throw Error('Production Windows root requires the existing app icon resource');
 if(info.platform!=='win32'||info.keyFingerprint!==fingerprint||!info.architectures.includes(client.manifest.arch==='arm64'?'aarch64':client.manifest.arch))throw Error('Wrong Windows native root identity');
 await validateTreeCopy(launcher,publicKey);await validateTreeCopy(client,publicKey);
 const root=join(out,'native');await mkdir(out,{recursive:true});await mkdir(root);await cp(nativeRoot,join(root,'bricks-bootstrap.exe'));
 for(const [component,tree] of [['launcher',launcher],['client',client]]){
  const slot=join(root,component,'slots',tree.identity.digest);await mkdir(dirname(slot),{recursive:true});await cp(tree.path,slot,{recursive:true,dereference:false,verbatimSymlinks:true});
  await writeFile(join(root,component,'state.json'),JSON.stringify({schema:1,active:tree.identity,previous:null,prepared:null,pending:null,failed:[],high_sequence:tree.identity.sequence,running:null}));
 }
 const legacyEntry=client.manifest.entry;if(legacyEntry.includes('/'))throw Error('Migration entry must be the original top-level app executable');
 const legacyHash=client.manifest.files.find(file=>file.path===legacyEntry).sha256;
 const legacyApp=join(out,'legacy-app');await cp(client.path,legacyApp,{recursive:true,dereference:false,verbatimSymlinks:true});
 const {unlink}=await import('node:fs/promises');await unlink(join(legacyApp,'bootstrap-manifest.json'));
 const payload=JSON.stringify({schema:1,game:'bricks-war',component:'native-seed',platform:'win32',root_abi:1,root_sha256:info.sha256,legacy_entry:legacyEntry,legacy_sha256:legacyHash,launcher:launcher.identity,client:client.identity});
 await writeFile(join(out,'installer-seed.json'),JSON.stringify({payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')}));
 const registry='SOFTWARE\\BricksWar\\NativeBootstrap'+(info.fixture?'-QA-'+info.keyFingerprint.slice(0,16):'');
 await writeFile(join(out,'native-registry.nsh'),`!define BRICKS_NATIVE_REGISTRY "${registry}"\n!define BRICKS_LEGACY_REGISTRY "Software\\e5919a2e-5a63-5e06-80d4-8586e169f51c${info.fixture?'-QA-'+info.keyFingerprint.slice(0,16):''}"\n`);
 return{root,info,legacyApp,installerGate:'Private installer seed → exclusive protected native namespace → signature/bytes validation → fixed registration → original-user shortcut. Already-native installs use signed component updates; do not overwrite machine references with a new full installer.'};
}
export async function nativeReleaseEnvelope({version,contentAbi,contentSequence,packages,privateKey,releaseDate}){
 if(!semver(version)||!Number.isSafeInteger(contentAbi)||contentAbi<3||!Number.isSafeInteger(contentSequence)||contentSequence<1||!packages.length)throw Error('Invalid native release identity');
 const files=[];
 for(const item of packages){const file=await stat(item.path);if(!file.isFile()||file.size>1024**3||!Number.isSafeInteger(item.unpackedSize)||item.unpackedSize<1||item.unpackedSize>8*1024**3||!/^[a-zA-Z0-9_.-]+\.zip$/.test(item.name))throw Error('Invalid native archive');
  files.push({platform:item.platform,arch:item.arch,minimumOS:item.platform==='darwin'?'13.0.0':'10.0.0',name:item.name,size:file.size,sha256:await hashFile(item.path),unpackedSize:item.unpackedSize,targets:item.targets.map(target=>({component:target.component,...target.identity}))});
 }
 if(releaseDate!==undefined&&!normalizeReleaseDate(releaseDate))throw Error('Invalid native release date');
 const date=normalizeReleaseDate(releaseDate)??manifestReleaseDate({sequence:contentSequence});
 const payload=JSON.stringify({schema:1,game:'bricks-war',component:'native-release',channel:'stable',rootAbi:1,version,contentAbi,contentSequence,...(date?{releaseDate:date}:{}),files});return{payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')};
}

export async function createNativeArchive({launcher,client,publicKey,out,name}){
 external(out);if(!/^[a-zA-Z0-9_.-]+\.zip$/.test(name))throw Error('Invalid native archive name');
 checkPair(launcher,client,publicKey,client.manifest.platform);await validateTreeCopy(launcher,publicKey);await validateTreeCopy(client,publicKey);
 const payload=join(out,'payload');await mkdir(out,{recursive:true});await mkdir(payload);
 await cp(launcher.path,join(payload,'launcher'),{recursive:true,dereference:false,verbatimSymlinks:true});await cp(client.path,join(payload,'client'),{recursive:true,dereference:false,verbatimSymlinks:true});
 const path=join(out,name);
 if(process.platform==='darwin')await exec('/usr/bin/ditto',['-c','-k',payload,path]);else await exec('tar.exe',['-a','-cf',path,'-C',payload,'.'],{windowsHide:true});
 return{path,name,platform:client.manifest.platform,arch:client.manifest.arch==='x86_64'?'x64':client.manifest.arch,unpackedSize:launcher.unpackedSize+client.unpackedSize,targets:[{component:'launcher',identity:launcher.identity},{component:'client',identity:client.identity}]};
}
