import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.env.BRICKS_HISTORY_EVIDENCE??'evidence/release-history-images/native');
await mkdir(output,{recursive:true});
const app=await electron.launch({args:['.','-muted'],env:{...process.env,
  BRICKS_DESKTOP_QA_PROFILE:resolve('build/history-images-qa-profile')}});
try {
  const page=await app.firstWindow();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,960));
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-destination="settings"]').click();await page.locator('#open-release-history').click();
  const list=page.locator('[data-history-scroll]'),image=list.locator('img').first();
  await image.waitFor({state:'attached',timeout:30000});await image.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{const image=document.querySelector('.release-notes img');return image?.complete&&image.naturalWidth>0;},null,{timeout:30000});
  const rendered=await image.evaluate(element=>({src:element.getAttribute('src'),width:element.naturalWidth,height:element.naturalHeight}));
  assert.match(rendered.src,/^\/__release-image\?url=/);
  const blocked=await page.evaluate(async()=>{const response=await fetch('/__release-image?url='+encodeURIComponent('https://example.com/private.png'));return response.status;});
  assert.equal(blocked,403);
  const csp=await page.evaluate(async()=>{const response=await fetch('/');return response.headers.get('Content-Security-Policy');});
  assert.match(csp,/img-src 'self' data: blob:/);assert.equal(csp.includes('raw.githubusercontent.com'),false);
  await image.evaluate(element=>element.scrollIntoView({block:'start'}));
  await page.screenshot({path:output+'/history-images.png'});
  await list.focus();await list.press('End');await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-release-history]').count(),0);
  assert.equal(await page.locator('#open-release-history').evaluate(element=>element===document.activeElement),true);
  assert.deepEqual(errors,[]);
  await writeFile(output+'/result.json',JSON.stringify({result:'PASS',surface:'real Electron development shell',startup:'-muted and isolated QA profile',liveReleaseNotes:'GitHub content1.12.1',image:rendered,untrustedImageStatus:blocked,cspUnchanged:true,closeRestoresFocus:true,pageErrors:errors,installedWindowsAcceptance:'NotRun'},null,2));
} finally {await app.close();}
