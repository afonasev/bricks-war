import {test,expect} from '@playwright/test';
import {delayRelay} from './delayRelay';
import {mkdir,writeFile} from 'node:fs/promises';
for(const profile of ['late','bandwidth'] as const)test(`guest ${profile} delivery does not create a reconnect loop`,async({browser,baseURL})=>{
  let gameplayInputs=0;const relay=await delayRelay(baseURL!,()=>{gameplayInputs++;},()=>{},profile==='late'?{oneWayMs:[400,500]}:{oneWayMs:[50,100],bytesPerSecond:32000,compression:true});
  const hostContext=await browser.newContext({baseURL,viewport:{width:1600,height:900}});
  const guestContext=await browser.newContext({baseURL,viewport:{width:390,height:844}});
  await guestContext.addInitScript(({url})=>{const Native=window.WebSocket;window.WebSocket=class extends Native{
    constructor(target:string|URL,protocols?:string|string[]){const resolved=new URL(target,location.href);super(resolved.pathname==='/network/socket'?url:target,protocols);}
  };},{url:relay.url});
  const host=await hostContext.newPage(),guest=await guestContext.newPage();
  let guestSockets=0,guestCloses=0,recoveries=0;const errors:string[]=[];
  guest.on('websocket',socket=>{if(socket.url()!==relay.url)return;guestSockets++;socket.on('close',()=>guestCloses++);});
  for(const page of [host,guest])page.on('pageerror',e=>errors.push(e.message));
  const room=`Recovery ${profile} ${Date.now()}`;
  try {
    for(const page of [host,guest]){await page.goto('/');await page.getByRole('button',{name:/^Сетевая игра/}).click();}
    await host.getByRole('button',{name:'Создать лобби',exact:true}).click();await host.getByLabel('Название лобби').fill(room);await host.getByLabel('Ваше имя',{exact:true}).fill('Host');await host.getByRole('button',{name:'Создать',exact:true}).click();
    await expect(host.getByRole('heading',{name:room})).toBeVisible();
    await guest.locator('.network-lobby').filter({hasText:room}).getByRole('button',{name:'Войти'}).click();await guest.getByLabel('Ваше имя',{exact:true}).fill('Guest');await guest.getByRole('button',{name:'Войти',exact:true}).click();
    for(const page of [host,guest]){await expect(page.getByRole('heading',{name:room})).toBeVisible();await expect(page.locator('.network-seat-state').filter({hasText:'Возвращается'})).toHaveCount(0);const control=page.getByRole('combobox',{name:'Управление на этом устройстве'});if(await page.locator('#network-controls').inputValue()!=='keyboard'){await control.click();await page.getByRole('option',{name:'WASD',exact:true}).click();}await expect(page.locator('#network-controls')).toHaveValue('keyboard');await expect(control).toContainText('WASD');}
    for(const page of [host,guest])await page.getByRole('button',{name:'Готов',exact:true}).click();
    await expect(host.getByRole('button',{name:'Начать',exact:true})).toBeEnabled({timeout:15000});await host.getByRole('button',{name:'Начать',exact:true}).click();
    await expect(guest.locator('.network-arena')).toHaveAttribute('data-phase','playing',{timeout:15000});
    const credential=await guest.evaluate(()=>JSON.parse(localStorage.getItem('bricks-network-seat-v1')!));
    const started=performance.now();let initialEpoch:number|null=null;let inputs=0;
    while(performance.now()-started<15000){
      await guest.keyboard.down(inputs%2?'d':'a');await new Promise(resolve=>setTimeout(resolve,350));await guest.keyboard.up(inputs%2?'d':'a');inputs++;
      if((await guest.locator('#network-status').textContent())?.includes('Задержка'))recoveries++;
      const response=await guest.request.post(`${baseURL}/api/network/current`,{headers:{Origin:baseURL!},data:{credential}});expect(response.ok()).toBe(true);
      const snapshot=await response.json();initialEpoch??=snapshot.connectionEpoch;
      expect(snapshot.connectionEpoch).toBe(initialEpoch);expect(snapshot.seats.every((s:{connected:boolean;absence:unknown})=>s.connected&&!s.absence)).toBe(true);expect(snapshot.state.phase).toBe('playing');
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    await expect(guest.locator('#network-status')).toHaveText('Подключено',{timeout:5000});
    expect(gameplayInputs).toBeGreaterThan(0);expect(guestSockets).toBe(1);expect(guestCloses).toBe(0);expect(errors).toEqual([]);
    expect(relay.metrics().maxQueuedBytes).toBeLessThan(128*1024);
    const evidence='evidence/fix-network-reconnect-loop';await mkdir(evidence,{recursive:true});
    await writeFile(`${evidence}/recovery-${profile}.json`,JSON.stringify({profile,guestSockets,guestCloses,initialEpoch,inputs,gameplayInputs,recoveries,maxQueuedBytes:relay.metrics().maxQueuedBytes,errors},null,2));
    await host.screenshot({path:`${evidence}/recovery-${profile}-wide.png`});await guest.screenshot({path:`${evidence}/recovery-${profile}-phone.png`});
  }finally{await hostContext.close();await guestContext.close();await relay.close();}
});
