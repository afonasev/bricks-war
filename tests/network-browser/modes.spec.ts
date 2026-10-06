import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const evidence=process.env.BRICKS_NETWORK_MODES_EVIDENCE_DIR??'evidence/add-network-battle-teams/browser';
async function enter(page:Page){await page.goto('/?muted=1');await page.getByRole('button',{name:/^Сетевая игра/}).click();}
async function pick(page:Page,label:string,value:string){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();}
for(const viewport of [{width:1440,height:960},{width:390,height:844}])test(`network Battle/Teams preferences and authoritative join/return ${viewport.width}`,async({browser,baseURL})=>{
 const hostContext=await browser.newContext({baseURL,viewport});const guestContext=await browser.newContext({baseURL,viewport});const host=await hostContext.newPage(),guest=await guestContext.newPage();const errors:string[]=[];for(const p of [host,guest])p.on('pageerror',e=>errors.push(e.message));
 const room=`Modes ${viewport.width} ${Date.now()}`;
 try {
  await enter(host);await host.getByRole('button',{name:'Создать лобби',exact:true}).click();await host.getByLabel('Название лобби').fill(room);await host.getByLabel('Ваше имя',{exact:true}).fill('Создатель');
  await pick(host,'Режим','Битва');await expect(host.getByRole('combobox',{name:'Длительность',exact:true})).toContainText('До победы');await expect(host.getByRole('combobox',{name:'Цель атак',exact:true})).toContainText('Всем соперникам');
  await pick(host,'Длительность','По времени');await pick(host,'Минуты','7');await pick(host,'Атаки','Выключены');await pick(host,'Ускорение','Быстрое');await mkdir(evidence,{recursive:true});await host.screenshot({path:`${evidence}/battle-create-${viewport.width}.png`,fullPage:true});await host.getByRole('button',{name:'Создать',exact:true}).click();await expect(host.getByRole('heading',{name:room})).toBeVisible();
  await expect(host.getByRole('combobox',{name:'Минуты',exact:true})).toContainText('7');await pick(host,'Управление на этом устройстве','Стрелки');
  // Guest has conflicting creator defaults: joining must not replay them to the room.
  await guest.goto('/?muted=1');await guest.evaluate(()=>localStorage.setItem('bricks-war:network-setup:v1',JSON.stringify({mode:'team-battle',profiles:{battle:{battleDifficulty:'sport',durationMinutes:2}},personal:{name:'Участник',controls:'keyboard',tileStyle:'classic',teamId:'team-2'}})));
  await guest.getByRole('button',{name:/^Сетевая игра/}).click();await guest.locator('.network-lobby').filter({hasText:room}).getByRole('button',{name:'Войти',exact:true}).click();await expect(guest.getByLabel('Ваше имя',{exact:true})).toHaveValue('Участник');await guest.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(guest.getByRole('heading',{name:room})).toBeVisible();await expect(guest.getByRole('combobox',{name:'Минуты',exact:true})).toContainText('7');await expect(guest.getByRole('combobox',{name:'Атаки',exact:true})).toContainText('Выключены');
  await host.getByRole('button',{name:'Готов',exact:true}).click();await host.reload();await host.getByRole('button',{name:/^Сетевая игра/}).click();await host.getByRole('button',{name:'Вернуться',exact:true}).click();await expect(host.getByRole('button',{name:'Готов',exact:true})).toBeVisible();await expect(host.getByRole('combobox',{name:'Управление на этом устройстве'})).toContainText('Стрелки');await expect(host.getByRole('combobox',{name:'Минуты',exact:true})).toContainText('7');
  await pick(host,'Режим','Командный бой');await expect(guest.getByRole('combobox',{name:'Режим',exact:true})).toContainText('Командный бой');await expect(host.getByRole('combobox',{name:'Длительность',exact:true})).toContainText('До победы');
  for(let n=1;n<=2;n++){await host.getByRole('button',{name:'Добавить ИИ',exact:true}).click();await expect(host.locator('li[data-kind=ai]')).toHaveCount(n);}
  await expect(host.getByRole('button',{name:'Начать',exact:true})).toBeDisabled();
  await mkdir(evidence,{recursive:true});await host.screenshot({path:`${evidence}/teams-lobby-${viewport.width}.png`,fullPage:true});
  await host.locator('#network-rules').scrollIntoViewIfNeeded();await host.screenshot({path:`${evidence}/teams-rules-${viewport.width}.png`,fullPage:true});
  const geometry=await host.evaluate(()=>{
   const controls=Array.from(document.querySelectorAll<HTMLElement>('.network-personal-panel button,.network-rules-panel button,.network-personal-panel .menu-select-trigger,.network-rules-panel .menu-select-trigger')).filter(e=>e.getBoundingClientRect().width>0);
   const overlaps:string[]=[];for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i]!.getBoundingClientRect(),b=controls[j]!.getBoundingClientRect();if(a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1)overlaps.push(`${controls[i]!.textContent}/${controls[j]!.textContent}`);}
   return {overlaps,overflow:document.documentElement.scrollWidth>innerWidth};});expect(geometry).toEqual({overlaps:[],overflow:false});
  for(const p of [host,guest])await p.getByRole('button',{name:'Готов',exact:true}).click();await expect(host.getByRole('button',{name:'Начать',exact:true})).toBeEnabled();await host.getByRole('button',{name:'Начать',exact:true}).click();await expect(host.locator('.network-arena')).toHaveAttribute('data-phase','playing');await expect(guest.locator('.network-arena')).toHaveAttribute('data-phase','playing');await expect(host.locator('.network-own-card')).toContainText('К1');await expect(guest.locator('.network-own-card')).toContainText('К2');
  await host.screenshot({path:`${evidence}/teams-arena-${viewport.width}.png`,fullPage:true});
  await host.getByRole('button',{name:'Пауза',exact:true}).click();await expect(guest.getByRole('heading',{name:'Матч на паузе'})).toBeVisible();await guest.reload();await guest.getByRole('button',{name:/^Сетевая игра/}).click();await guest.getByRole('button',{name:'Вернуться',exact:true}).click();await expect(guest.getByRole('heading',{name:'Матч на паузе'})).toBeVisible();await expect(guest.locator('.network-own-card')).toContainText('К2');
  expect(errors).toEqual([]);
 }finally{await hostContext.close();await guestContext.close();}
});
