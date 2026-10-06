import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import type {InputEnvelope} from '../../src/network/protocol';

type AuditWindow=Window & {zoneInputs:InputEnvelope[];zonePointer:number;zonePhases:{at:number;phase:string;tick:number}[]};
const inputs=(page:Page)=>page.evaluate(()=>(window as unknown as AuditWindow).zoneInputs);
const clear=(page:Page)=>page.evaluate(()=>{(window as unknown as AuditWindow).zoneInputs.length=0;});
async function enter(page:Page) {
  await page.goto('/?muted=1');
  await page.getByRole('button',{name:/^Сетевая игра/}).click();
}

test('phone colored zones share viewport gestures without leaking Pause input',async({browser,baseURL})=>{
  const hostContext=await browser.newContext({baseURL,viewport:{width:1600,height:900}});
  const phoneContext=await browser.newContext({baseURL,viewport:{width:390,height:844}});
  await phoneContext.addInitScript(()=>{
    const audit=window as unknown as AuditWindow;audit.zoneInputs=[];audit.zonePhases=[];
    new MutationObserver(()=>{
      const arena=document.querySelector<HTMLElement>('.network-arena');
      if(arena&&arena.dataset.phase!==audit.zonePhases.at(-1)?.phase)
        audit.zonePhases.push({at:performance.timeOrigin+performance.now(),phase:arena.dataset.phase!,tick:Number(arena.dataset.tick)});
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-phase']});
    document.addEventListener('pointerdown',e=>{audit.zonePointer=e.pointerId;},true);
    const send=WebSocket.prototype.send;
    WebSocket.prototype.send=function(data) {
      if(typeof data==='string'){const message=JSON.parse(data);if(message.type==='input')audit.zoneInputs.push(message);}
      return send.call(this,data);
    };
  });
  const host=await hostContext.newPage(),phone=await phoneContext.newPage();
  try {
    const room=`Mobile zones ${Date.now()}`;
    await enter(host);await host.getByRole('button',{name:'Создать лобби',exact:true}).click();
    await host.getByLabel('Название лобби').fill(room);await host.getByRole('button',{name:'Создать',exact:true}).click();
    await expect(host.getByRole('heading',{name:room})).toBeVisible();
    await enter(phone);await phone.locator('.network-lobby').filter({hasText:room}).getByRole('button',{name:'Войти'}).click();
    await phone.getByLabel('Ваше имя',{exact:true}).fill('Константин Александрович Ерофеев');
    await phone.getByRole('button',{name:'Войти',exact:true}).click();
    for(const page of [host,phone])await page.getByRole('button',{name:'Готов',exact:true}).click();
    await host.getByRole('button',{name:'Начать',exact:true}).click();
    await expect(phone.locator('.network-arena')).toHaveAttribute('data-phase','playing');
    await expect(phone.locator('.network-arena')).toHaveAttribute('data-preparation','0',{timeout:15000});
    await expect(phone.locator('[data-network-mobile-zones]')).toBeVisible();
    await expect(phone.locator('.network-touch')).toBeHidden();
    const start=Number(await phone.locator('.network-arena').getAttribute('data-confirmed-x'));
    await clear(phone);await phone.mouse.move(50,810);await phone.mouse.down();
    await expect.poll(async()=>Number(await phone.locator('.network-arena').getAttribute('data-confirmed-x'))).toBeLessThan(start);
    await phone.mouse.move(350,810); // A held gesture remains the action where it began.
    expect((await inputs(phone)).every(i=>i.held.left&&!i.held.right&&!i.rotate)).toBe(true);
    await phone.mouse.up();expect((await inputs(phone)).at(-1)!.held).toEqual({left:false,right:false,down:false});

    await clear(phone);await phone.mouse.move(180,300);await phone.mouse.down();
    await phone.waitForTimeout(180);await phone.mouse.up();
    expect((await inputs(phone)).filter(i=>i.rotate)).toHaveLength(1);
    expect((await inputs(phone)).every(i=>!i.held.left&&!i.held.right&&!i.held.down)).toBe(true);

    await clear(phone);await phone.mouse.move(190,810);await phone.mouse.down();
    expect((await inputs(phone)).at(-1)!.held.down).toBe(true);
    await phone.locator('#network-stage').evaluate(stage=>stage.dispatchEvent(new PointerEvent('pointercancel',{pointerId:(window as unknown as AuditWindow).zonePointer,bubbles:true})));
    expect((await inputs(phone)).at(-1)!.held.down).toBe(false);await phone.mouse.up();
    await clear(phone);await phone.mouse.move(340,810);await phone.mouse.down();
    await phone.mouse.move(335,810); // Activate native pointer capture before releasing it.
    await phone.locator('#network-stage').evaluate(stage=>stage.releasePointerCapture((window as unknown as AuditWindow).zonePointer));
    await phone.mouse.move(330,810);
    await expect.poll(async()=>(await inputs(phone)).at(-1)!.held.right).toBe(false);await phone.mouse.up();

    await clear(phone);await phone.getByRole('button',{name:'Пауза',exact:true}).click();
    await expect(phone.getByRole('heading',{name:'Матч на паузе'})).toBeVisible();
    await expect(phone.locator('[data-network-mobile-zones]')).toBeHidden();
    expect(await inputs(phone)).toEqual([]);
    await phone.getByRole('button',{name:'Продолжить',exact:true}).click();
    await expect(phone.locator('.network-arena')).toHaveAttribute('data-phase','playing');
    await phone.mouse.move(340,810);await phone.mouse.down();
    expect((await inputs(phone)).at(-1)!.held.right).toBe(true);await phone.mouse.up();

    for(const [width,height,mobile] of [[360,800,true],[844,390,true],[800,900,false],[1600,900,false]] as const) {
      await phone.setViewportSize({width,height});
      await expect(phone.locator('[data-network-mobile-zones]')).toBeVisible({visible:mobile});
      await expect.poll(()=>phone.evaluate(()=>{
        const stage=document.querySelector('#network-stage')!.getBoundingClientRect();
        const headers=[...document.querySelectorAll<HTMLElement>('.network-field-heading')];
        return headers.every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1;})&&(!matchMedia('(max-width:760px), (max-width:900px) and (max-height:600px)').matches||(stage.width===innerWidth&&stage.height===innerHeight));
      })).toBe(true);
    }
  }finally{
    const directory=process.env.BRICKS_NETWORK_MOBILE_EVIDENCE_DIR;
    if(directory){await mkdir(directory,{recursive:true});await writeFile(`${directory}/phone-phases-${Date.now()}.json`,JSON.stringify(await phone.evaluate(()=>(window as unknown as AuditWindow).zonePhases),null,2));}
    await hostContext.close();await phoneContext.close();
  }
});
