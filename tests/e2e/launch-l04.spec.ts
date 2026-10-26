import {test,expect, type Page} from '@playwright/test';
import {updateEn,updateRu,updateFr,updateDe,updateEs,updateJa,updateZhHans} from '../../src/i18n/updateCatalogs';
const resources={en:updateEn,ru:updateRu,fr:updateFr,de:updateDe,es:updateEs,ja:updateJa,'zh-Hans':updateZhHans};
const viewports=[{width:1440,height:960},{width:1280,height:480},{width:390,height:844}];
async function readable(page:Page, selector:string){
 const issues=await page.locator(selector).evaluateAll(elements=>elements.flatMap(el=>{
  const node=el as HTMLElement;if(node.hidden||!node.getClientRects().length)return [];
  const r=node.getBoundingClientRect();const style=getComputedStyle(node);
  return r.left < -1 || r.right > innerWidth+1 || r.top < -1 || r.bottom > innerHeight+1 || node.scrollWidth > node.clientWidth+1 || node.scrollHeight > node.clientHeight+1 || style.textOverflow==='ellipsis' ? [{text:node.textContent,rect:r.toJSON(),client:[node.clientWidth,node.clientHeight],scroll:[node.scrollWidth,node.scrollHeight]}] : [];
 }));expect(issues).toEqual([]);
 const overlaps=await page.evaluate(()=>{
  const nodes=[...document.querySelectorAll<HTMLElement>('.client-update-button,.client-update-status,.client-update-announcement,.desktop-release-history,.desktop-cancel-download,.desktop-download,.mode-choice,.concept-brand-heading,.release-guidance-footer')].filter(node=>!node.hidden&&node.getClientRects().length&&!node.closest('[hidden]'));
  return nodes.flatMap((a,i)=>nodes.slice(i+1).flatMap(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return !a.contains(b)&&!b.contains(a)&&Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1 ? [[a.className,b.className]] : [];}));
 });expect(overlaps).toEqual([]);
}
for(const [locale,copy] of Object.entries(resources))for(const viewport of viewports){
 test(`${locale} native phases and history ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);
  await page.addInitScript(({locale})=>{
   localStorage.setItem('bricks-war:language:v1',locale);
   const qa=(window as any).__nativeQa={state:{available:false,applying:false,error:true,phase:'check-error',currentVersion:'1.10.0',shellVersion:'1.10.0'},checks:0,applies:0,cancels:0,downloads:0,historyLocale:'',historyError:false};
   (window as any).bricksDesktop={updateState:async()=>({...qa.state}),check:async()=>{qa.checks++;return {...qa.state};},download:async()=>{qa.downloads++;return {...qa.state};},cancel:async()=>{qa.cancels++;return {...qa.state};},setActivity:async()=>({...qa.state}),apply:async()=>{qa.applies++;return true;},setSafeMenu:()=>{},healthy:async()=>{},display:async()=>({width:1280,height:720,fullscreen:false}),exit:async()=>{},history:async(locale:string)=>{qa.historyLocale=locale;if(qa.historyError)throw Error('offline diagnostic');return [{version:'2.0.0',date:'2026-10-24T00:00:00Z',text:'Original <img src=x onerror=alert(1)> & user text',installed:false,fallback:true},{version:'1.10.0',date:null,text:'',notesUnavailable:'installed',fallback:true,installed:true},{version:'1.10.0',component:'shell',date:null,text:'diagnostic shell row',fallback:false,installed:true}];}};
  },{locale});
  await page.goto('/?muted=1');
  const button=page.locator('.client-update-button');
  await expect(button.locator('strong')).toHaveText(copy.updateCheckFailed);await expect(button).toBeDisabled();
  await expect(page.locator('.release-build-info')).toContainText(copy.buildIdentity.replace('{game}','1.10.0'));
  const cases=[['shell-required',copy.updateAction,true],['check-error',copy.updateCheckFailed,true],['checking',copy.updateChecking,true],['downloading',copy.updateDownloading.replace('{progress}','42'),false],['verifying',copy.updateVerifying,false],['paused',copy.updatePaused,false],['install-error',copy.updateInstallFailed,true],['download-error',copy.updateRetry,false],['ready',copy.updateRestart,false]] as const;
  for(const [phase,label,disabled] of cases){
   await page.evaluate(phase=>{Object.assign((window as any).__nativeQa.state,{phase,available:true,error:phase.includes('error'),progress:42.9,version:'2.0.0'});},phase);
   await expect(button.locator('strong')).toHaveText(label);expect(await button.isDisabled()).toBe(disabled);
   await expect(page.locator('.client-update-slot > :visible')).toHaveCount(2);
   await expect(page.locator('.client-update-slot > :visible:not(button)')).toHaveCount(0);
   try { await readable(page,'.client-update-button,.client-update-status,.client-update-announcement,.desktop-release-history,.desktop-cancel-download'); } catch(error) { await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-native-updates/screenshots'}/FAIL-${locale}-${viewport.width}-${phase}.png`}); throw error; }
   if(phase==='downloading'){
    await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-native-updates/screenshots'}/${locale}-${viewport.width}-downloading.png`});
    await button.click();expect(await page.evaluate(()=>(window as any).__nativeQa.cancels)).toBe(1);
   }
  }
  expect(await page.evaluate(()=>(window as any).__nativeQa.applies)).toBe(0);
  await button.click();await expect.poll(()=>page.evaluate(()=>(window as any).__nativeQa.applies)).toBe(1);
  await page.locator('.desktop-release-history').click();
  const dialog=page.getByRole('dialog',{name:copy.releaseHistory});await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText('diagnostic shell row');await expect(dialog.locator('pre')).toHaveCount(2);
  await expect(dialog.locator('pre').first()).toHaveText('Original <img src=x onerror=alert(1)> & user text');await expect(dialog.locator('img')).toHaveCount(0);
  await expect(dialog).toContainText(copy.historyFallback);await expect(dialog).toContainText(copy.historyInstalledUnavailable);
  expect(await page.evaluate(()=>(window as any).__nativeQa.historyLocale)).toBe(locale);
  await readable(page,'[data-release-history], [data-history-back]');
  await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-native-updates/screenshots'}/${locale}-${viewport.width}-history.png`});
  await page.getByRole('button',{name:copy.historyClose,exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(page.locator('.desktop-release-history')).toBeFocused();
  await page.evaluate(()=>{Object.assign((window as any).__nativeQa.state,{phase:'idle',available:false,error:false});});
  await expect(button).toBeHidden();await expect(page.locator('.desktop-release-history')).toBeHidden();
  await page.locator('[data-destination=settings]').click();
  const settingsHistory=page.locator('#open-release-history');await settingsHistory.click();
  await expect(dialog).toBeVisible();await expect(dialog.locator('pre')).toHaveCount(2);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(settingsHistory).toBeFocused();
  await readable(page,'#open-release-history,.settings-utility .settings-navigation');
  await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/two-update-actions/browser'}/${locale}-${viewport.width}-settings.png`});
  await page.evaluate(()=>{(window as any).__nativeQa.historyError=true;});await settingsHistory.click();await expect(page.locator('[data-release-history] [role=status]')).toHaveText(copy.historyUnavailable);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__nativeQa.checks)).toBe(1);
 });
}
for(const [locale,copy] of Object.entries(resources))test(`${locale} web installer label and phone exclusion`,async({page})=>{
 await page.addInitScript(locale=>{localStorage.setItem('bricks-war:language:v1',locale);Object.defineProperty(navigator,'platform',{value:'MacIntel'});},locale);
 await page.route('**/desktop/latest.json',route=>route.fulfill({json:{mac:{url:'/desktop/installers/current.dmg'}}}));
 await page.goto('/?muted=1');const download=page.getByRole('button',{name:copy.downloadGameAria,exact:true});await expect(download).toBeVisible();await expect(download).toHaveText('⇩'+copy.downloadGame);await readable(page,'.desktop-download');
 await page.setViewportSize({width:390,height:844});await expect(download).toBeHidden();
});
