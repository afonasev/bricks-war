import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPairSync,verify} from 'node:crypto';
import {nativeReleaseEnvelope} from '../../scripts/desktop/native-package.mjs';
test('native release signer uses the same explicit bundled date, supports historical sequence and rejects bad dates',async()=>{
 const out=await mkdtemp(join(tmpdir(),'bricks-date-')),key=generateKeyPairSync('ed25519');try{
 const path=join(out,'client.zip');await writeFile(path,'archive');
 const options={version:'1.0.0',contentAbi:3,contentSequence:Date.parse('2026-11-03T12:00:00Z'),packages:[{path,name:'client.zip',platform:'darwin',arch:'universal',unpackedSize:10,targets:[]}],privateKey:key.privateKey};
 const envelope=await nativeReleaseEnvelope({...options,releaseDate:'2026-11-04'});assert.ok(verify(null,Buffer.from(envelope.payload),key.publicKey,Buffer.from(envelope.signature,'base64')));assert.equal(JSON.parse(envelope.payload).releaseDate,'2026-11-04');
 assert.equal(JSON.parse((await nativeReleaseEnvelope(options)).payload).releaseDate,'2026-11-03');await assert.rejects(nativeReleaseEnvelope({...options,releaseDate:'2026-02-30'}),/release date/);
 }finally{await rm(out,{recursive:true,force:true});}
});
