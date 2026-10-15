import {test,expect} from '@playwright/test';
for(const viewport of [{width:1440,height:960},{width:390,height:844}]){
 test(`preferences, reset and keyboard navigation ${viewport.width}`,async({page})=>{
  await page.setViewportSize(viewport);await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();
  await expect(page.locator('.audio-toggle')).toHaveCount(0);await expect(page.locator('.input-badge').first()).toBeHidden();
  await page.locator('#master-volume').press('ArrowDown');await expect(page.locator('#music-volume')).toBeFocused();
  await page.locator('[data-stick="stickSensitivity"]').fill('150');await page.locator('[data-stick="stickDeadzone"]').fill('20');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('bricks-war:release-settings:v1')!));expect(saved).toMatchObject({stickSensitivity:1.5,stickDeadzone:0.2});
  await page.locator('[data-reset-preferences="input"]').click();await expect(page.locator('[data-stick="stickSensitivity"]')).toHaveValue('100');await expect(page.locator('[data-stick="stickDeadzone"]')).toHaveValue('0');
  await page.locator('#master-volume').press('Home');await expect(page.locator('#master-volume')).toHaveValue('0');
  await page.reload();await page.locator('[data-destination="settings"]').click();await expect(page.locator('#master-volume')).toHaveValue('0');
  await page.locator('[data-stick="stickSensitivity"]').focus();
  const issues=await page.evaluate(()=>{
   const issues:string[]=[];if(document.documentElement.scrollHeight>innerHeight+1)issues.push('body scroll');
   for(const label of document.querySelectorAll<HTMLElement>('.volume-control')){const children=[...label.children].map(el=>el.getBoundingClientRect());for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++){const a=children[i]!,b=children[j]!;if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)issues.push('slider overlap');}}
   return issues;
  });expect(issues).toEqual([]);
  await page.screenshot({path:`evidence/align-game-template/preferences-${viewport.width}.png`});
 });
}
test('pause has the same preference values and stays paused on settings return',async({page})=>{
 await page.goto('/?muted=1');await page.locator('[data-destination="survival"]').click();await page.locator('#start-match').click();await expect(page.locator('.arena-screen')).toBeVisible();await expect(page.locator('.match-loading')).toHaveCount(0);await page.keyboard.press('Escape');await page.locator('#pause-settings').click();
 await expect(page.locator('#master-volume')).toBeVisible();await expect(page.locator('[data-stick="stickDeadzone"]')).toHaveCount(1);
 await page.locator('[data-stick="stickDeadzone"]').fill('25');await page.locator('#pause-settings-back').click();await expect(page.locator('#pause-menu-panel')).toBeVisible();await expect(page.locator('#pause-overlay')).toBeVisible();
 await page.locator('#pause-settings').click();await expect(page.locator('[data-stick="stickDeadzone"]')).toHaveValue('25');await page.screenshot({path:'evidence/align-game-template/pause-settings.png'});
});
for(const viewport of [{width:1440,height:960},{width:1280,height:480},{width:390,height:844}]){
 test(`desktop consent, progress, history and display rollback ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);await page.addInitScript(()=>{
   const qa:any=(window as any).__templateQA={checks:0,downloads:0,applies:0,activity:[],confirmed:[],state:{available:true,applying:false,error:false,phase:'available',version:'2.0.0',shellVersion:'1.6.2',currentVersion:'1.6.2'}};
   (window as any).bricksDesktop={updateState:async()=>({...qa.state}),check:async()=>{qa.checks++;return {...qa.state};},download:async()=>{qa.downloads++;qa.state.phase='downloading';qa.state.progress=35;return {...qa.state};},cancel:async()=>{qa.state.phase='available';return {...qa.state};},setActivity:async(value:boolean)=>{qa.activity.push(value);return {...qa.state};},apply:async()=>{qa.applies++;return true;},setSafeMenu:()=>{},healthy:async()=>{},exit:async()=>{},display:async()=>({width:1280,height:720,fullscreen:false,resolutions:[[1280,720],[1440,900]]}),setDisplay:async(value:any)=>value,confirmDisplay:async(value:boolean)=>{qa.confirmed.push(value);return {width:1280,height:720,fullscreen:false};},history:async()=>[{version:'2.0.0',date:'2026-10-15',text:'### Новое\n- Новая возможность',fallback:false,installed:false},{version:'1.6.2',date:'2026-10-13',text:'### Исправления\n- Установленная версия',fallback:false,installed:true}]};
  });
  await page.goto('/?muted=1');const button=page.locator('.client-update-button');await expect(button).toHaveText('Обновить');
  expect(await page.evaluate(()=>(window as any).__templateQA.downloads)).toBe(0);await button.click();await expect(button).toHaveText('Загрузка 35%');await expect(button).toBeDisabled();await page.locator('.desktop-cancel-download').click();await expect(button).toHaveText('Обновить');
  await page.locator('.desktop-release-history').click();await expect(page.locator('[data-release-history]')).toContainText('установлена');await expect(page.locator('[data-release-history]')).toContainText('Новая возможность');await page.screenshot({path:`evidence/align-game-template/history-${viewport.width}.png`});await page.locator('[data-history-back]').click();
  expect(await page.evaluate(()=>(window as any).__templateQA.checks)).toBe(1);
  await page.evaluate(()=>{(window as any).__templateQA.state.phase='ready';});await expect(button).toHaveText('Перезапустить');await page.screenshot({path:`evidence/align-game-template/update-ready-${viewport.width}.png`});
  await page.locator('[data-destination="settings"]').click();await page.getByRole('combobox',{name:/Разрешение окна/}).click();await page.getByRole('option',{name:'1440 × 900',exact:true}).click();await expect(page.locator('[data-display-confirm]')).toBeVisible();await page.locator('[data-display-no]').click();expect(await page.evaluate(()=>(window as any).__templateQA.confirmed)).toEqual([false]);
 });
}

test('storage failure stays visible and reset preserves records and profiles',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('template-test-record','keep');const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='bricks-war:release-settings:v1')throw Error('quota');return original.call(this,key,value);};});
 await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();await page.locator('#master-volume').press('ArrowLeft');await expect(page.locator('[data-preferences-status]')).toContainText('Не удалось сохранить');await page.locator('[data-reset-preferences="all"]').click();await expect(page.locator('[data-preferences-status]')).toContainText('Не удалось сохранить');expect(await page.evaluate(()=>localStorage.getItem('template-test-record'))).toBe('keep');
});

test('network menu uses arrows and shared preferences without a live server',async({page})=>{
 await page.route('**/api/network/lobbies?*',route=>route.fulfill({json:{rooms:[],next:null}}));
 await page.goto('/?muted=1');await page.locator('[data-network-entry]').click();await expect(page.locator('[data-network-view="list"]')).toBeVisible();await page.getByRole('button',{name:'Настройки',exact:true}).click();await expect(page.locator('[data-network-preferences]')).toBeVisible();await page.locator('#master-volume').press('ArrowDown');await expect(page.locator('#music-volume')).toBeFocused();await page.locator('[data-network-prefs-back]').click();await expect(page.locator('[data-network-preferences]')).toHaveCount(0);await page.getByRole('button',{name:'Создать лобби',exact:true}).click();await expect(page.locator('#network-form')).toBeVisible();await page.getByRole('textbox',{name:'Ваше имя',exact:true}).fill('Игрок');await page.getByRole('textbox',{name:'Ваше имя',exact:true}).press('Enter');await expect(page.getByRole('textbox',{name:'Ваше имя',exact:true})).not.toBeFocused();
});
