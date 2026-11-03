import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureNativeHealth, notifyNativeHealth } from '../../electron/native-health.mjs';
const nonce='a'.repeat(64),digest='b'.repeat(64);
test('ordinary Electron startup has no native receipt',async()=>{assert.equal(captureNativeHealth({}),null);assert.equal(await notifyNativeHealth(null),false);});
test('capture consumes complete contract, preserves unrelated environment, rejects incomplete/aliased identity',()=>{
  const environment={BRICKS_BOOTSTRAP_NONCE:nonce,BRICKS_BOOTSTRAP_DIGEST:digest,BRICKS_BOOTSTRAP_RECEIPT:`/private/client-${nonce}.json`,BRICKS_BOOTSTRAP_ROOT:'/installation'};
  const contract=captureNativeHealth(environment);assert.equal(contract.digest,digest);assert.ok(Object.isFrozen(contract));assert.deepEqual(environment,{BRICKS_BOOTSTRAP_ROOT:'/installation'});
  for(const extra of [{},{BRICKS_BOOTSTRAP_DIGEST:'c'},{BRICKS_BOOTSTRAP_DIGEST:digest,BRICKS_BOOTSTRAP_RECEIPT:'/tmp/healthy-version'}]){
    assert.throws(()=>captureNativeHealth({BRICKS_BOOTSTRAP_NONCE:nonce,...extra}),/Invalid native/);
  }
});
test('exact nonce/digest/PID receipt is atomically published in private directory',async()=>{
  // macOS tmpdir may be reached through /var symlink; use canonical directory.
  const {realpath}=await import('node:fs/promises');const dir=await realpath(await mkdtemp(join(tmpdir(),'bricks-health-')));
  try{
    const receipt=join(dir,`client-${nonce}.json`);const contract=captureNativeHealth({BRICKS_BOOTSTRAP_NONCE:nonce,BRICKS_BOOTSTRAP_DIGEST:digest,BRICKS_BOOTSTRAP_RECEIPT:receipt});
    assert.equal(await notifyNativeHealth(contract,1234),true);assert.deepEqual(JSON.parse(await readFile(receipt,'utf8')),{nonce,digest,pid:1234});
    assert.deepEqual(await readdir(dir),[`client-${nonce}.json`]);await assert.rejects(()=>notifyNativeHealth(contract,0),/Invalid health process/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('linked receipt directory cannot redirect health',async()=>{
  const {realpath}=await import('node:fs/promises');const dir=await realpath(await mkdtemp(join(tmpdir(),'bricks-health-')));
  try{await symlink(dir,join(dir,'link'),'dir');await assert.rejects(()=>notifyNativeHealth({nonce,digest,receipt:join(dir,'link',`client-${nonce}.json`)}),/Unsafe native/);assert.deepEqual(await readdir(dir),['link']);}
  finally{await rm(dir,{recursive:true,force:true});}
});
