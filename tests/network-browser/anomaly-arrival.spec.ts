import {test,expect,type Page} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import {SnapshotAssembly} from '../../src/network/snapshotAssembly';
import type {ClientSnapshot} from '../../src/network/protocol';

async function enter(page:Page){await page.goto('/?muted=1');await page.getByRole('button',{name:/^Сетевая игра/}).click();}
test('real Battle clients receive one shared burn and simultaneous anomaly spawn',async({browser,baseURL})=>{
  const contexts=await Promise.all([browser.newContext({baseURL,viewport:{width:1440,height:960}}),browser.newContext({baseURL,viewport:{width:390,height:844}})]);
  const pages=await Promise.all(contexts.map(c=>c.newPage()));const [host,guest]=pages as [Page,Page];
  const snapshots:ClientSnapshot[][]=[[],[]];const errors:string[]=[];
  for(const [index,page] of pages.entries()) {
    page.on('pageerror',e=>errors.push(e.message));
    page.on('websocket',socket=>{
      const assembly=new SnapshotAssembly();
      socket.on('framereceived',frame=>{try{const snapshot=assembly.accept(JSON.parse(String(frame.payload)));if(snapshot?.state)snapshots[index]!.push(snapshot);}catch{}});
    });
  }
  try {
    await enter(host);await host.getByRole('button',{name:'Создать лобби',exact:true}).click();
    const room=`Anomaly QA ${Date.now()}`;await host.getByLabel('Название лобби').fill(room);await host.getByLabel('Ваше имя',{exact:true}).fill('QA Host');
    await host.getByRole('combobox',{name:'Режим',exact:true}).click();await host.getByRole('option',{name:'Битва',exact:true}).click();
    await host.getByRole('button',{name:'Создать',exact:true}).click();
    for(let i=0;i<2;i++){
      await host.getByRole('button',{name:'Добавить ИИ',exact:true}).click();await expect(host.locator('li[data-kind=ai]')).toHaveCount(i+1);
      const bot=host.locator('li[data-kind=ai]').nth(i);await bot.locator('summary').click();
      await bot.getByRole('combobox',{name:'Сложность ИИ',exact:true}).click();await host.getByRole('option',{name:'Эксперт',exact:true}).click();
      await bot.getByRole('button',{name:'Сохранить ИИ',exact:true}).click();
    }
    await enter(guest);await guest.locator('.network-lobby').filter({hasText:room}).getByRole('button',{name:'Войти',exact:true}).click();
    await guest.getByLabel('Ваше имя',{exact:true}).fill('QA Guest');await guest.getByRole('button',{name:'Войти',exact:true}).click();
    await host.getByRole('button',{name:'Готов',exact:true}).click();await guest.getByRole('button',{name:'Готов',exact:true}).click();
    await host.getByRole('button',{name:'Начать',exact:true}).click();
    await expect.poll(()=>snapshots.every(stream=>stream.some(s=>s.state!.anomalyArrivalSerial>0)),{timeout:80000,intervals:[100]}).toBe(true);
    const records=snapshots.map(stream=>{
      const burn=stream.find(s=>s.state!.anomalyTransition?.phase==='burning');expect(burn).toBeDefined();
      const arrived=stream.find(s=>s.state!.anomalyArrivalSerial>0)!;
      const state=arrived.state!;const alive=state.participants.filter(p=>p.board.alive);
      expect(alive.length).toBeGreaterThanOrEqual(2);
      expect(alive.every(p=>p.board.active?.definition.source==='anomaly')).toBe(true);
      expect(new Set(alive.map(p=>p.board.active!.definition.id)).size).toBe(1);
      const transition=burn!.state!.anomalyTransition!;
      const sameBurn=stream.filter(s=>s.state!.anomalyTransition?.serial===transition.serial&&s.state!.anomalyTransition.phase==='burning');
      expect(new Set(sameBurn.map(s=>s.state!.elapsedMs)).size).toBe(1);
      expect(Math.max(...sameBurn.map(s=>s.state!.anomalyTransition!.remainingMs))).toBeGreaterThan(800);
      expect(Math.min(...sameBurn.map(s=>s.state!.anomalyTransition!.remainingMs))).toBeLessThan(200);
      return {seed:state.seed,arrivalSerial:state.anomalyArrivalSerial,anomaly:alive[0]!.board.active!.definition.id,
        elapsedMs:state.elapsedMs,transitionSerial:transition.serial,targets:transition.targets.map(t=>t.participantId),
        samples:sameBurn.map(s=>({tick:s.tick,elapsed:s.state!.elapsedMs,remaining:s.state!.anomalyTransition!.remainingMs}))};
    });
    expect(records[0]!.anomaly).toBe(records[1]!.anomaly);expect(records[0]!.elapsedMs).toBe(records[1]!.elapsedMs);
    expect(records[0]!.transitionSerial).toBe(records[1]!.transitionSerial);
    for(const page of pages)await expect(page.locator('[data-event-kind="level-up"]')).toHaveCount(0);
    expect(errors).toEqual([]);
    const folder=process.env.BRICKS_ANOMALY_NETWORK_EVIDENCE??'evidence/synchronize-anomaly-arrival';await mkdir(folder,{recursive:true});
    await writeFile(`${folder}/real-network-arrival.json`,JSON.stringify(records,null,2));
  }finally{for(const context of contexts)await context.close();}
});
