import {test,expect,type Page} from '@playwright/test';
const name=(i:number)=>['Александр Екатеринбург','Екатерина Санкт-Петербург','Михаил Нижний Новгород','Елизавета Петропавловск','Константин Новосибирск','Виктория Владивосток','Анастасия Красноярск','Дмитрий Калининград'][i]!;
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:/^Сетевая игра/}).click();}
async function readable(page:Page) {
  const failures=await page.evaluate(()=>{
    const elements=[...document.querySelectorAll<HTMLElement>('.network-field-heading,strong,button,label,select')].filter(e=>e.getBoundingClientRect().height&&getComputedStyle(e).visibility!=='hidden');
    return elements.filter(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2).map(e=>`${e.tagName}:${e.textContent?.slice(0,40)}`);
  });expect(failures).toEqual([]);
}
async function readableLobby(page:Page) {
  const failures=await page.evaluate(()=>{
    const visible=(e:HTMLElement)=>e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';
    const text=[...document.querySelectorAll<HTMLElement>('.network-screen strong,.network-screen button,.network-screen textarea,.network-screen label,.network-screen .menu-select-value')].filter(visible);
    const failures=text.filter(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2).map(e=>`clipped:${e.textContent}`);
    const controls=[...document.querySelectorAll<HTMLElement>('.network-screen button,.network-screen textarea,.network-screen input,.network-screen h1,.network-screen .network-roster li')].filter(visible);
    for(let i=0;i<controls.length;i++) {
      const a=controls[i]!,r=a.getBoundingClientRect();
      if(r.left < -1 || r.right > innerWidth+1)failures.push(`outside:${a.textContent}`);
      for(const b of controls.slice(i+1)) {
        if(a.contains(b)||b.contains(a))continue;
        const q=b.getBoundingClientRect();
        if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)failures.push(`overlap:${a.textContent}/${b.textContent}`);
      }
    }
    return failures;
  });expect(failures).toEqual([]);
}
for(const count of [2,4,8])test(`${count} independent contexts create join own-seat pause return results`,async({browser,baseURL})=>{
  const contexts=await Promise.all(Array.from({length:count},(_,i)=>browser.newContext({baseURL,viewport:i===count-1?{width:390,height:844}:{width:1600,height:900}})));
  const pages=await Promise.all(contexts.map(c=>c.newPage()));const errors:string[]=[];
  for(const page of pages)page.on('pageerror',e=>errors.push(e.message));
  const host=pages[0]!;const roomName=`Independent ${count} ${Date.now()}`;
  const rulesFrames:unknown[]=[];
  host.on('websocket',socket=>socket.on('framesent',frame=>{try{const value=JSON.parse(String(frame.payload));if(value.type==='rules')rulesFrames.push(value);}catch{}}));
  try {
    await enter(host);await host.getByRole('button',{name:'Создать лобби',exact:true}).click();
    await host.getByLabel('Название лобби').fill(roomName);await host.getByLabel('Ваше имя',{exact:true}).fill(name(0));
    await host.getByRole('button',{name:'Создать',exact:true}).click();await expect(host.getByRole('heading',{name:roomName})).toBeVisible();
    for(let i=1;i<count;i++){
      const page=pages[i]!;await enter(page);
      await page.locator('.network-lobby').filter({hasText:roomName}).getByRole('button',{name:'Войти'}).click();
      await page.getByLabel('Ваше имя',{exact:true}).fill(name(i));await page.getByRole('button',{name:'Войти',exact:true}).click();
      await expect(page.getByRole('heading',{name:roomName})).toBeVisible();
    }
    await readableLobby(host);await readableLobby(pages[count-1]!);
    if(count===8) {
      const phone=pages[count-1]!;
      await phone.getByRole('combobox',{name:'Вид фигур',exact:true}).click();
      await phone.getByRole('option',{name:'Каменная крепость',exact:true}).click();
      await phone.getByRole('button',{name:'Сохранить имя и фигуры'}).click();
      await expect(phone.getByRole('combobox',{name:'Вид фигур',exact:true})).toContainText('Каменная крепость');
      for(const [width,height] of [[360,800],[390,844],[844,390],[800,900],[1600,900]] as const) {
        await phone.setViewportSize({width,height});await readableLobby(phone);
        await expect(phone.locator('.network-roster li')).toHaveCount(8);
      }
      await phone.setViewportSize({width:390,height:844});
    }
    for(const page of pages)await expect(page.getByRole('combobox',{name:'Ускорение',exact:true})).toHaveCount(0);
    await host.getByRole('combobox',{name:'Темп битвы',exact:true}).click();await host.getByRole('option',{name:'Спортивный',exact:true}).click();
    await host.getByRole('button',{name:'Применить правила'}).click();
    await expect.poll(()=>rulesFrames.some(frame=>{const command=frame as {type:string;rules:{mode:string;battleDifficulty:string;softDrop:string;conflictEnabled:boolean;matchVariant:string}};return command.type==='rules'&&command.rules.mode==='survival'&&command.rules.battleDifficulty==='sport'&&command.rules.softDrop==='slow'&&command.rules.conflictEnabled===false&&command.rules.matchVariant==='free-for-all';})).toBe(true);
    for(const page of pages.slice(1)){await expect(page.getByRole('combobox',{name:'Темп битвы',exact:true})).toBeDisabled();await expect(page.getByRole('combobox',{name:'Темп битвы',exact:true})).toContainText('Спортивный');}
    for(const page of pages){await page.getByRole('combobox',{name:'Управление на этом устройстве'}).click();await page.getByRole('option',{name:'WASD'}).click();await page.getByRole('button',{name:'Готов',exact:true}).click();}
    await expect(host.getByRole('button',{name:'Начать',exact:true})).toBeEnabled();await host.getByRole('button',{name:'Начать',exact:true}).click();
    for(const page of pages){await expect(page.locator('.network-arena')).toHaveAttribute('data-total',String(count));}
    const own=pages[count-1]!;
    await expect(own.locator('.network-field-heading').first().getByText(name(count-1),{exact:true})).toBeVisible();
    expect(await own.locator('.network-field-heading').count()).toBe(Math.min(count,4));
    await readable(own);
    await expect(host.locator('.network-arena')).toHaveAttribute('data-phase','playing');
    const pauser=pages[count-1]!;await pauser.getByRole('button',{name:'Пауза',exact:true}).click();
    for(const page of pages)await expect(page.getByRole('heading',{name:'Матч на паузе'})).toBeVisible();
    await expect(host.getByRole('button',{name:'Продолжить',exact:true})).toBeVisible();
    if(count>2)await expect(pages[1]!.getByRole('button',{name:'Продолжить',exact:true})).toHaveCount(0);
    await host.getByRole('button',{name:'Продолжить',exact:true}).click();
    await expect(host.locator('.network-arena')).toHaveAttribute('data-phase','playing');
    await pauser.getByRole('button',{name:'Пауза',exact:true}).click();
    await pauser.getByRole('button',{name:'К списку',exact:true}).click();
    await expect(pauser.getByRole('heading',{name:'Ваш текущий матч'})).toBeVisible();
    await expect(host.locator('.network-arena')).toHaveAttribute('data-phase','paused');
    await pauser.getByRole('button',{name:'Вернуться',exact:true}).click();
    await expect(pauser.getByRole('heading',{name:'Матч на паузе'})).toBeVisible();
    await host.getByRole('button',{name:'Продолжить',exact:true}).click();
    await expect(pauser.locator('.network-arena')).toHaveAttribute('data-phase','playing');
    // Repeated fresh presses span preparation/hold epochs; all locks, scores and results remain server-owned.
    for(let pass=0;pass<36;pass++){
      await Promise.all(pages.map(async page=>{if(await page.locator('.network-arena[data-alive="true"]').count()){await page.keyboard.up('s');await page.keyboard.down('s');}}));
      if(await host.getByRole('heading',{name:'Результаты',exact:true}).count())break;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    for(const page of pages){await expect(page.getByRole('heading',{name:'Результаты',exact:true})).toBeVisible({timeout:45000});await expect(page.locator('.network-roster li')).toHaveCount(count);}
    await host.getByRole('button',{name:'В лобби',exact:true}).click();await expect(host.getByRole('heading',{name:roomName})).toBeVisible();
    expect(errors).toEqual([]);
  }finally{for(const context of contexts)await context.close();}
});
