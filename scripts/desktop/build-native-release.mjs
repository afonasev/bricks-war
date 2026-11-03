/** Production assembly only; never publishes or writes an installed application. */
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {sign,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {signNativeTree,assembleMacRoot,assembleWindowsLayout,createNativeArchive,nativeReleaseEnvelope} from './native-package.mjs';
import {verifyNativeReceipt} from './native-receipt.mjs';
const [output,macRoot,winRoot]=process.argv.slice(2);if(!output||!macRoot||!winRoot)throw Error('Pass external output, universal production root, Windows production root');
const out=resolve(output),version=JSON.parse(await readFile('package.json')).version;
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())throw Error('Commit source before packaging');
const privateKey=await readFile(process.env.BRICKS_CONTENT_PRIVATE_KEY??join(homedir(),'.config/bricks-war/content-private-key.pem'),'utf8'),publicKey=await readFile('electron/content-public-key.pem','utf8');
const bundled=JSON.parse(JSON.parse(await readFile('build/desktop-content/manifest.json','utf8')).payload);
if(bundled.gameVersion!==version||bundled.commit!==source)throw Error('Fresh exact-source bundled content required');
await mkdir(out);const installers=join(out,'installers');await mkdir(installers);
const packages=[];const assembly={};
for(const [platform,arch,binary,entry,clientSource] of [
 ['darwin','universal',macRoot,'Bricks War.app/Contents/MacOS/Bricks War','build/native-clients/mac-universal'],
 ['win32','x86_64',winRoot,'Bricks War.exe','build/native-clients/win-unpacked']]){
 const core=join(out,platform+'-core');await mkdir(core);const coreEntry=platform==='darwin'?'core':'core.exe';await cp(binary,join(core,coreEntry));
 const launcher=await signNativeTree({source:core,destination:join(out,platform+'-launcher'),component:'launcher',platform,arch,version,sequence:bundled.sequence,entry:coreEntry,args:['core'],privateKey});
 const client=await signNativeTree({source:clientSource,destination:join(out,platform+'-client'),component:'client',platform,arch,version,sequence:bundled.sequence,entry,profileProbe:true,privateKey});
 const pair={launcher,client};
 const built=platform==='darwin'?await assembleMacRoot({nativeRoot:binary,...pair,publicKey,version,profileName:'Bricks War',out:join(out,'mac-root')}):await assembleWindowsLayout({nativeRoot:binary,...pair,publicKey,privateKey,out:join(out,'windows-layout')});
 assembly[platform]={...pair,built};
 packages.push(await createNativeArchive({...pair,publicKey,out:join(out,platform+'-archive'),name:`Bricks-Native-${version}-${platform}-${platform==='darwin'?'universal':'x64'}.zip`}));
}
const build=(args,env={})=>execFileSync('node_modules/.bin/electron-builder',args,{stdio:'inherit',env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false',LC_ALL:'en_US.UTF-8',LANG:'en_US.UTF-8',...env}});
build(['--mac','dmg','zip','--universal','--prepackaged',assembly.darwin.built.app,'--config.directories.output='+installers,'--publish','never']);
build(['--win','nsis','--x64','--prepackaged',assembly.win32.built.legacyApp,'--config','electron-builder.native.yml','--config.directories.output='+installers,'--publish','never'],{BRICKS_NATIVE_LAYOUT:join(out,'windows-layout')});
for(const file of packages)await cp(file.path,join(installers,file.name));
await writeFile(join(installers,'native-manifest.json'),JSON.stringify(await nativeReleaseEnvelope({version,contentAbi:bundled.minShellVersion,contentSequence:bundled.sequence,packages,privateKey})));
const files=[];
for(const name of [`Bricks-War-${version}-mac-universal.dmg`,`Bricks-War-${version}-mac-universal.zip`,`Bricks-War-${version}-win-x64.exe`,...packages.map(file=>file.name),'native-manifest.json']){
 const bytes=await readFile(join(installers,name));files.push({name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const payload=JSON.stringify({schema:1,installationKind:'migration',version,source,contentSequence:bundled.sequence,protectedRollbackAbi:1,freshInstallerVersion:'1.16.0',files});
await writeFile(join(installers,'migration-only.json'),JSON.stringify({payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')}));
await verifyNativeReceipt(installers,publicKey,version,source);
await writeFile(join(out,'assembly.json'),JSON.stringify({source,version,assembly,packages},null,2));
console.log('Verified production migration package: '+installers);
