import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

test('public export handles a tracked inventory beyond one MiB without changing its allowlist',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'bricks-export-buffer-'));
 try{
  const source=join(scratch,'source'),target=join(scratch,'public'),bin=join(scratch,'bin');
  for(const dir of [join(source,'src'),join(source,'docs/release-notes/1.14.0'),target,bin])await mkdir(dir,{recursive:true});
  await writeFile(join(source,'src/kept.ts'),'export const value = 1;');
  await writeFile(join(source,'docs/release-notes/1.14.0/note.png'),'screenshot');
  await writeFile(join(target,'LICENSE'),'existing license');
  const git=join(bin,'git');
  await writeFile(git,`#!${process.execPath}\nif(process.argv[2]==='ls-files')process.stdout.write(('evidence/'+ 'x'.repeat(80)+'\\0').repeat(20000)+'src/kept.ts\\0docs/release-notes/1.14.0/note.png\\0');else process.stdout.write('a'.repeat(40)+'\\n');\n`);
  await chmod(git,0o755);
  execFileSync(process.execPath,[resolve('scripts/desktop/export-public.mjs'),target],{cwd:source,env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:'pipe'});
  assert.equal(await readFile(join(target,'src/kept.ts'),'utf8'),'export const value = 1;');
  assert.equal(await readFile(join(target,'docs/release-notes/1.14.0/note.png'),'utf8'),'screenshot');
  assert.equal(await readFile(join(target,'LICENSE'),'utf8'),'existing license');
  assert.equal((await readFile(join(target,'SOURCE_REVISION'),'utf8')).trim(),'a'.repeat(40));
  await assert.rejects(access(join(target,'evidence')));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
