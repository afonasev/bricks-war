import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {ShellUpdate} from '../../electron/shell-update.mjs';
import {TransferGate} from '../../electron/update-coordinator.mjs';
const keys=generateKeyPairSync('ed25519');
export const bytes=Buffer.from('trusted slow installer');
export async function fixture(t,fetcher){
 const root=await mkdtemp(join(tmpdir(),'bricks-duration-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file={name:'Bricks-War-2.0.0-win-x64.exe',platform:'win32',arch:'x64',minimumOS:'10.0.0',protectedRollbackAbi:1,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const manifest={schema:1,game:'bricks-war',component:'shell',channel:'stable',version:'2.0.0',updaterAbi:2,contentAbi:3,contentSequence:1,files:[file]};
 const payload=JSON.stringify(manifest),envelope={payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')};
 const shell=new ShellUpdate({root,platform:'win32',arch:'x64',version:'1.0.0',publicKey:keys.publicKey,fetcher,gate:new TransferGate()});shell.selected={manifest:{...manifest,file},envelope,release:{tag_name:'v2.0.0'}};return shell;
}
