import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname as pathDir} from 'node:path';
import {execFileSync} from 'node:child_process';

test('public export preserves published installer links and workflow with a large tracked inventory',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'bricks-export-buffer-'));
 try{
  const source=join(scratch,'source'),target=join(scratch,'public'),bin=join(scratch,'bin');
  for(const dir of [join(source,'src'),join(source,'docs/release-notes/1.14.0'),target,bin])await mkdir(dir,{recursive:true});
  await writeFile(join(source,'src/kept.ts'),'export const value = 1;');
  await writeFile(join(source,'docs/release-notes/1.14.0/note.png'),'screenshot');
  await writeFile(join(target,'LICENSE'),'existing license');
  const published = '<!-- bricks-war-downloads:start -->\nDownload EXE / Download DMG: published installer 0.9.0\n[Installer list](https://github.com/afonasev/bricks-war/releases?q=tag%3Av0)\n<!-- bricks-war-downloads:end -->';
  await writeFile(join(target,'README.md'),'# Bricks War\n\n'+published+'\n');
  const automationFiles = ['.github/workflows/installer-downloads.yml', '.github/scripts/installer_downloads.py', '.github/scripts/test_installer_downloads.py'];
  for (const name of [...automationFiles, '.github/workflows/private.yml']) {
    await mkdir(pathDir(join(source,name)),{recursive:true}); await writeFile(join(source,name),name);
  }
  const git=join(bin,'git');
  const inventory = ['src/kept.ts', 'docs/release-notes/1.14.0/note.png', ...automationFiles, '.github/workflows/private.yml'];
  await writeFile(git,`#!${process.execPath}\nif(process.argv[2]==='ls-files')process.stdout.write(('evidence/'+ 'x'.repeat(80)+'\\0').repeat(20000)+${JSON.stringify(inventory.join('\0')+'\0')});else process.stdout.write('a'.repeat(40)+'\\n');\n`);
  await chmod(git,0o755);
  execFileSync(process.execPath,[resolve('scripts/desktop/export-public.mjs'),target],{cwd:source,env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:'pipe'});
  assert.equal(await readFile(join(target,'src/kept.ts'),'utf8'),'export const value = 1;');
  assert.equal(await readFile(join(target,'docs/release-notes/1.14.0/note.png'),'utf8'),'screenshot');
  assert.equal(await readFile(join(target,'LICENSE'),'utf8'),'existing license');
  assert.equal((await readFile(join(target,'SOURCE_REVISION'),'utf8')).trim(),'a'.repeat(40));
  const readme = await readFile(join(target,'README.md'),'utf8');
  assert.match(readme, /Download EXE/); assert.match(readme, /Download DMG/);
  assert.match(readme, /releases\?q=tag%3Av0/);
  assert.ok(readme.includes(published));
  for (const name of automationFiles) assert.equal(await readFile(join(target,name),'utf8'),name);
  await assert.rejects(access(join(target,'.github/workflows/private.yml')));
  await assert.rejects(access(join(target,'evidence')));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
