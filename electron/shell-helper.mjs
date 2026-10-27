import { readFile,writeFile,rename,rm,access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export function applicationEnvironment(environment) { const result={...environment};delete result.ELECTRON_RUN_AS_NODE;return result; }
export async function failedShellVersions(root) {
  try {const record=JSON.parse(await readFile(join(root,'recovery.json'),'utf8'));return [...new Set([...(record.failedVersions??[]),record.failedVersion].filter(value=>typeof value==='string'))];}
  catch(error){if(error.code==='ENOENT')return [];throw error;}
}
export async function recordShellFailure(root,version,reason) {
  const versions=await failedShellVersions(root);versions.push(version);
  const file=join(root,'recovery.json');await writeFile(file+'.tmp',JSON.stringify({failedVersions:[...new Set(versions)],reason}));await rename(file+'.tmp',file);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
export async function replaceApplication(plan, operations) {
  const { exists,move,copy,launch,healthy,wait,saveFailure } = operations;
  const target = plan.executable.slice(0,plan.executable.indexOf('.app/') + 4);
  if (!target.endsWith('.app') || !plan.application) throw Error('Invalid app replacement plan');
  const previous = `${target}.previous-${plan.version}`, incoming = `${target}.incoming-${plan.version}`;
  if(await exists(previous) || await exists(incoming))throw Error('Existing recovery bundle requires review');
  try{await copy(plan.application,incoming);}catch(error){if(await exists(incoming))await operations.remove(incoming);throw error;}
  let moved = false;
  try {
    await move(target,previous); moved = true;
    await move(incoming,target);
    await launch(target,plan.args);
    for (let attempt=0; attempt<90; attempt++) { if (await healthy(plan.version)) {
      // Health commits the new installation. Cleanup must never enter rollback.
      try { await operations.remove(previous); } catch (error) { try { await operations.cleanupFailure?.(error); } catch { /* preserve committed application */ } }
      return true;
    } await wait(1000); }
    throw Error('Updated app failed startup health');
  } catch (error) {
    if (moved) {
      await operations.stopNew?.(target);
      if (await exists(target)) await operations.remove(target);
      await move(previous,target);
      try{await saveFailure(plan.version);}finally{await launch(target,plan.args);error.recovered=true;}
    }
    if(await exists(incoming))await operations.remove(incoming);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2]) {
  // This external helper manipulates physical bundles, including app.asar files.
  // Electron's virtual ASAR filesystem must not intercept recursive removal.
  process.noAsar = true;
  const plan = JSON.parse(await readFile(process.argv[2],'utf8'));
  const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
  const exists = async path => { try { await access(path); return true; } catch { return false; } };
  const filesystem = async (command,args,normal) => {
    try { return await normal(); } catch (error) {
      if (!['EACCES','EPERM'].includes(error.code) && !/Permission denied|Operation not permitted/.test(String(error.stderr))) throw error;
      const script = [command,...args].map(quote).join(' ');
      return exec('/usr/bin/osascript',['-e',`do shell script ${JSON.stringify(script)} with administrator privileges`]);
    }
  };
  const start = async () => {
    await writeFile(join(plan.root,'helper-started'),String(plan.parentPid));
    for (let count=0; count<120; count++) { try { process.kill(plan.parentPid,0); await sleep(500); } catch { break; } if (count===119) throw Error('Game did not exit'); }
    await rm(join(plan.root,'healthy-version'),{force:true});
    if (plan.platform === 'win32') {
      // NSIS consumes application launch arguments after silent setup.
      const child = spawn(plan.file,['/S','--updated',...plan.args],{detached:true,stdio:'ignore'}); child.unref(); return;
    }
    await replaceApplication(plan,{
      cleanupFailure:error=>writeFile(join(plan.root,'cleanup-error.txt'),String(error)),
      exists, remove:path=>filesystem('/bin/rm',['-rf',path],()=>rm(path,{recursive:true,force:true})), move:(from,to)=>filesystem('/bin/mv',[from,to],()=>rename(from,to)),
      copy:(from,to)=>filesystem('/usr/bin/ditto',[from,to],()=>exec('/usr/bin/ditto',[from,to])),
      launch:async (target,args)=>{ await exec('/usr/bin/open',['-n',target,'--args',...args],{env:applicationEnvironment(process.env)}); },
      healthy:async version=>{ try{return (await readFile(join(plan.root,'healthy-version'),'utf8'))===version;}catch{return false;} },
      wait:sleep,saveFailure:version=>recordShellFailure(plan.root,version,'startup-or-install-failed'),
      stopNew:async target=>{
        await exec('/usr/bin/osascript',['-e',`tell application ${JSON.stringify(target)} to quit`],{timeout:3000}).catch(()=>{});
        const users=async()=>{const text=(await exec('/bin/ps',['-axo','pid=,command='])).stdout;return text.split('\n').flatMap(line=>{const match=/^\s*(\d+)\s+(.+)$/.exec(line);return match && Number(match[1])!==process.pid && match[2].startsWith(target+'/Contents/MacOS/') ? [Number(match[1])] : [];});};
        for(const pid of await users()){try{process.kill(pid,'SIGTERM');}catch{}}
        for(let attempt=0;attempt<40;attempt++){if(!(await users()).length)return;await sleep(100);}
        throw Error('Updated game still owns its files; recovery bundle retained');
      },
    });
    try {
      await rm(join(plan.root,'ready.json'),{force:true});
      await rm(plan.file,{force:true});
      for(const name of ['staged','activation'])await rm(join(plan.root,name),{recursive:true,force:true});
    } catch (error) { await writeFile(join(plan.root,'cleanup-error.txt'),String(error)).catch(()=>{}); }
  };
  start().catch(async error => {
    // Standard /Applications may require an OS privilege prompt for filesystem changes.
    await writeFile(join(plan.root,'last-error.txt'),String(error));
    if(error.message!=='Game did not exit' && !error.recovered){
      await recordShellFailure(plan.root,plan.version,'replacement-failed').catch(()=>{});
      const target=plan.executable.slice(0,plan.executable.indexOf('.app/')+4);
      if(await exists(target))await exec('/usr/bin/open',['-n',target,'--args',...plan.args],{env:applicationEnvironment(process.env)}).catch(()=>{});
    }
  });
}
