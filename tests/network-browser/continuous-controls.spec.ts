import {test,expect} from '@playwright/test';
import {delayRelay} from './delayRelay';
import {mkdir,writeFile} from 'node:fs/promises';

for(const oneWay of [[50,100],[175,225]] as const)test(`continuous own lifecycle with one-way ${oneWay[0]}-${oneWay[1]}ms`,async({browser,baseURL})=>{
  const relay=await delayRelay(baseURL!,()=>{},()=>{},{oneWayMs:oneWay,compression:true});
  const contexts=await Promise.all([browser.newContext({baseURL,viewport:{width:1440,height:960}}),browser.newContext({baseURL,viewport:{width:390,height:844}})]);
  await contexts[1]!.addInitScript(({url})=>{const Native=window.WebSocket;window.WebSocket=class extends Native{
    constructor(target:string|URL,protocols?:string|string[]){super(new URL(target,location.href).pathname==='/network/socket'?url:target,protocols);}
  };},{url:relay.url});
  const [host,guest]=await Promise.all(contexts.map(c=>c.newPage()));
  const errors:string[]=[],serverErrors:unknown[]=[],inputs:unknown[]=[];let connections=0;
  guest!.on('websocket',socket=>{if(socket.url()!==relay.url)return;connections++;socket.on('framesent',f=>{try{const m=JSON.parse(String(f.payload));if(m.type==='input')inputs.push(m);}catch{}});socket.on('framereceived',f=>{try{const m=JSON.parse(String(f.payload));if(m.type==='error')serverErrors.push(m);}catch{}});});
  for(const page of [host!,guest!])page.on('pageerror',e=>errors.push(e.message));
  const room=`Smooth ${Date.now()}`;
  try {
    for(const page of [host!,guest!]){await page.goto('/');await page.getByRole('button',{name:/^Сетевая игра/}).click();}
    await host!.getByRole('button',{name:'Создать лобби',exact:true}).click();await host!.getByLabel('Название лобби').fill(room);await host!.getByLabel('Ваше имя',{exact:true}).fill('Host');await host!.getByRole('button',{name:'Создать',exact:true}).click();
    await expect(host!.getByRole('heading',{name:room})).toBeVisible();
    await guest!.locator('.network-lobby').filter({hasText:room}).getByRole('button',{name:'Войти'}).click();await guest!.getByLabel('Ваше имя',{exact:true}).fill('Guest');await guest!.getByRole('button',{name:'Войти',exact:true}).click();
    for(const page of [host!,guest!]){
      await expect(page.getByRole('heading',{name:room})).toBeVisible();await expect(page.locator('.network-seat-state').filter({hasText:'Возвращается'})).toHaveCount(0);
      if(await page.locator('#network-controls').inputValue()!=='keyboard'){await page.getByRole('combobox',{name:'Управление на этом устройстве'}).click();await page.getByRole('option',{name:'WASD',exact:true}).click();}
      await expect(page.locator('#network-controls')).toHaveValue('keyboard');
    }
    // Finish all local dropdowns before ready snapshots rebuild the other lobby.
    for(const page of [host!,guest!]){await page.getByRole('button',{name:'Готов',exact:true}).click();await expect(page.getByRole('button',{name:'Снять готовность',exact:true})).toBeVisible();}
    await host!.getByRole('button',{name:'Начать',exact:true}).click();await expect(guest!.locator('.network-arena')).toHaveAttribute('data-phase','playing',{timeout:15000});
    await expect(guest!.locator('.network-arena')).toHaveAttribute('data-preparation','0',{timeout:15000});
    // Capture on animation frames, including all intermediate snapshots, not just endpoints.
    const trace=await guest!.evaluate(async()=>{
      const arena=document.querySelector<HTMLElement>('.network-arena')!;
      const rows:{at:number;x:number;y:number;spawn:number;confirmedSpawn:number;status:string;direction:number}[]=[];
      let direction=0,stopped=false;
      const record=()=>{if(stopped)return;rows.push({at:performance.now(),x:Number(arena.dataset.presentedX),y:Number(arena.dataset.presentedY),spawn:Number(arena.dataset.presentedSpawn),confirmedSpawn:Number(arena.dataset.spawnSerial),status:document.querySelector('#network-status')?.textContent??'',direction});requestAnimationFrame(record);};record();
      const key=(type:string,code:string)=>document.body.dispatchEvent(new KeyboardEvent(type,{code,key:code,bubbles:true}));
      const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
      for(let cycle=0;cycle<6;cycle++){
        direction=cycle%2?1:-1;const code=direction<0?'KeyA':'KeyD';key('keydown',code);await wait(700);key('keyup',code);direction=0;
        key('keydown','KeyW');key('keyup','KeyW');key('keydown','KeyS');await wait(2200);key('keyup','KeyS');await wait(350);
      }
      await wait(1200);stopped=true;return rows;
    });
    const rollback=trace.slice(1).filter((r,i)=>r.spawn===trace[i]!.spawn&&r.direction!==0&&r.direction===trace[i]!.direction&&r.direction*(r.x-trace[i]!.x)<0);
    const directory=process.env.BRICKS_NETWORK_LATENCY_EVIDENCE_DIR??'/tmp/bricks-smooth-controls';await mkdir(directory,{recursive:true});
    await writeFile(`${directory}/continuous-${oneWay[0]}.json`,JSON.stringify({oneWay,rollback,serverErrors,errors,connections,inputs,trace},null,2));
    expect(trace.some(r=>r.status.includes('Задержка'))).toBe(false);
    expect(Math.max(...trace.map(r=>r.spawn))-trace[0]!.spawn).toBeGreaterThanOrEqual(3);
    expect(trace.some(r=>r.spawn>r.confirmedSpawn)).toBe(true);
    expect(rollback).toEqual([]);expect(serverErrors).toEqual([]);expect(errors).toEqual([]);expect(connections).toBe(1);

  }finally{for(const c of contexts)await c.close();await relay.close();}
});
