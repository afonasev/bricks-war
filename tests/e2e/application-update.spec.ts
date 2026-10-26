import {test,expect} from '@playwright/test';

for(const viewport of [{width:1440,height:960},{width:1280,height:480},{width:390,height:844}]){
 test(`one application version and coordinated update with controller ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);
  await page.addInitScript(()=>{
   const qa=(window as any).__applicationQa={state:{available:true,applying:false,error:false,phase:'available',version:'2.0.0',currentVersion:'1.10.0',shellVersion:'1.10.0',requiresShell:true},downloads:0,applies:0,checks:0,cancels:0};
   const pad={index:0,id:'Xbox Controller',connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,touched:false,value:0})),timestamp:0};
   (window as any).__applicationPad=pad;Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});
   (window as any).bricksDesktop={updateState:async()=>({...qa.state}),check:async()=>{qa.checks++;return {...qa.state};},download:async()=>{qa.downloads++;qa.state.phase='downloading';return {...qa.state};},apply:async()=>{qa.applies++;return true;},cancel:async()=>{qa.cancels++;qa.state.phase='available';return {...qa.state};},setActivity:async()=>({...qa.state}),setSafeMenu:()=>{},healthy:async()=>{},history:async()=>[],display:async()=>({width:1280,height:720,fullscreen:false}),exit:async()=>{}};
  });
  await page.goto('/?muted=1');
  const button=page.locator('.client-update-button'),identity=page.locator('.release-build-info'),status=button.locator('small');
  await expect(identity).toHaveText('Версия 1.10.0');await expect(status).toBeHidden();await expect(status).toHaveText('');
  await expect(page.locator('.release-footer-credits')).toHaveText('© 2026 Evgeniy Afonasev · afonasev.tech');
  await expect(page.locator('.release-version')).toHaveText('Версия 1.10.0 ·');
  await expect(page.locator('.desktop-release-history strong')).toHaveText('Доступна версия 2.0.0');
  expect(await page.evaluate(()=>(window as any).__applicationQa.downloads)).toBe(0);
  const capture=async(phase:string)=>{
   const issues=await page.locator('.client-update-button,.desktop-release-history,.release-build-info').evaluateAll(nodes=>nodes.flatMap(el=>{const e=el as HTMLElement;if(e.hidden||!e.getClientRects().length)return [];const r=e.getBoundingClientRect();return r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1||e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1||getComputedStyle(e).textOverflow==='ellipsis'?[e.className]:[];}));
   expect(issues).toEqual([]);
   await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/coordinate-app-updates/browser'}/runtime-${viewport.width}-${phase}.png`});
  };
  await capture('available');
  const press=async(index:number)=>{await page.evaluate(index=>{(window as any).__applicationPad.buttons[index].pressed=true;},index);await page.waitForTimeout(60);await page.evaluate(index=>{(window as any).__applicationPad.buttons[index].pressed=false;},index);await page.waitForTimeout(60);};
  for(let i=0;i<16&&!await button.evaluate(el=>el===document.activeElement);i++)await press(12);
  await expect(button).toBeFocused();await capture('controller');await press(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).__applicationQa.downloads)).toBe(1);await expect(button).toBeEnabled();await expect(status).toHaveText('Отменить');
  await button.click();await expect.poll(()=>page.evaluate(()=>(window as any).__applicationQa.cancels)).toBe(1);await expect(button.locator('strong')).toHaveText('Обновить');await button.click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__applicationQa.downloads)).toBe(2);
  await page.evaluate(()=>{(window as any).__applicationQa.state.phase='ready';});await expect(button).toHaveText('Перезапустить');await expect(identity).toHaveText('Версия 1.10.0');
  await capture('ready');await button.click();await expect.poll(()=>page.evaluate(()=>(window as any).__applicationQa.applies)).toBe(1);
  await page.evaluate(()=>{(window as any).__applicationQa.state.phase='shell-required';});
  await expect(button).toBeDisabled();await expect(status).toHaveText('Нужна новая оболочка. Обновление пока недоступно.');await expect(identity).toHaveText('Версия 1.10.0');await capture('shell-required');
  expect(await page.evaluate(()=>(window as any).__applicationQa.checks)).toBe(1);
 });
}
