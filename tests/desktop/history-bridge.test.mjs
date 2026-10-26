import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('isolated preload forwards history language without exposing an additional channel or changing legacy invocation', async () => {
  let bridge; const calls=[];
  const electron={contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'bricksDesktop');bridge=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve([]);}}};
  runInNewContext(await readFile(new URL('../../electron/preload.cjs',import.meta.url),'utf8'),{require:name=>{assert.equal(name,'electron');return electron;}});
  await bridge.history('fr'); await bridge.history();
  assert.deepEqual(calls,[['desktop:history','fr'],['desktop:history',undefined]]);
});
