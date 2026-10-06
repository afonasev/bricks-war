import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:/^Сетевая игра/}).click();}
test('same-match return reuses renderer, clears held input and resizes after list orientation changes',async({browser,baseURL})=>{
  const contexts=await Promise.all([{width:1440,height:960},{width:390,height:844}].map(viewport=>browser.newContext({baseURL,viewport})));
  const [host,guest]=await Promise.all(contexts.map(c=>c.newPage()));
  const errors:string[]=[];for(const page of [host!,guest!])page.on('pageerror',error=>errors.push(error.message));
  const room=`Retained ${Date.now()}`,evidence=process.env.BRICKS_NETWORK_RETURN_EVIDENCE_DIR??'evidence/fix-network-eight-player-gates/return';await mkdir(evidence,{recursive:true});
  try {
    await enter(host!);await host!.getByRole('button',{name:'Создать лобби',exact:true}).click();await host!.getByLabel('Название лобби').fill(room);await host!.getByLabel('Ваше имя',{exact:true}).fill('Возврат создателя');await host!.getByRole('button',{name:'Создать',exact:true}).click();
    await expect(host!.getByRole('heading',{name:room})).toBeVisible();await enter(guest!);await guest!.locator('.network-lobby').filter({hasText:room}).getByRole('button',{name:'Войти'}).click();await guest!.getByLabel('Ваше имя',{exact:true}).fill('Игрок после возврата');await guest!.getByRole('button',{name:'Войти',exact:true}).click();
    for(const page of [host!,guest!]){await expect(page.getByRole('heading',{name:room})).toBeVisible();await page.getByRole('combobox',{name:'Управление на этом устройстве'}).click();await page.getByRole('option',{name:'WASD'}).click();await page.getByRole('button',{name:'Готов',exact:true}).click();}
    await host!.getByRole('button',{name:'Начать',exact:true}).click();await expect(guest!.locator('.network-arena')).toHaveAttribute('data-phase','playing');await expect(guest!.locator('.network-arena')).toHaveAttribute('data-preparation','0',{timeout:15000});
    await guest!.evaluate(()=>{(window as any).__returnCanvas=document.querySelector('#network-canvas canvas');});
    const credential=await guest!.evaluate(()=>JSON.parse(localStorage.getItem('bricks-network-seat-v1')!));let epoch=0;const results:unknown[]=[];
    for(const [width,height] of [[844,390],[390,844],[1440,960]] as const){
      await guest!.keyboard.down('a');await guest!.getByRole('button',{name:'Пауза',exact:true}).click();await guest!.getByRole('button',{name:'К списку',exact:true}).click();await expect(guest!.getByRole('heading',{name:'Ваш текущий матч'})).toBeVisible();
      await expect(guest!.locator('canvas')).toHaveCount(0);await guest!.setViewportSize({width,height});await guest!.getByRole('button',{name:'Вернуться',exact:true}).click();
      await expect(guest!.getByRole('heading',{name:'Матч на паузе'})).toBeVisible();await host!.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(guest!.locator('.network-arena')).toHaveAttribute('data-phase','playing');
      expect(await guest!.evaluate(()=>document.querySelector('#network-canvas canvas')===(window as any).__returnCanvas)).toBe(true);await expect(guest!.locator('canvas')).toHaveCount(1);
      const response=await guest!.request.post(`${baseURL}/api/network/current`,{headers:{Origin:baseURL!},data:{credential}});expect(response.ok()).toBe(true);const snapshot=await response.json();expect(snapshot.connectionEpoch).toBeGreaterThan(epoch);epoch=snapshot.connectionEpoch;expect(snapshot.seats.every((s:any)=>s.connected&&!s.absence)).toBe(true);
      const x=await guest!.locator('.network-arena').getAttribute('data-presented-x');await new Promise(r=>setTimeout(r,350));await expect(guest!.locator('.network-arena')).toHaveAttribute('data-presented-x',x!);await guest!.keyboard.up('a');await guest!.keyboard.press('d');await expect(guest!.locator('.network-arena')).toHaveAttribute('data-presented-x',String(Number(x)+1));
      const layout=await guest!.evaluate(()=>{
        const canvas=document.querySelector('canvas')!.getBoundingClientRect(),stage=document.querySelector('#network-stage')!.getBoundingClientRect();
        const controls=[...document.querySelectorAll<HTMLElement>('.network-field-heading,.shield-inventory,.hud-next-piece,.arena-topline button,.arena-topline output,.mobile-match-actions button,.mobile-match-actions output')].filter(e=>e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden');const failures:string[]=[];
        for(const e of controls){const r=e.getBoundingClientRect();if(e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2)failures.push(`clipped:${e.textContent}`);if(r.left<0||r.right>innerWidth+1||r.top<0||r.bottom>innerHeight+1)failures.push(`outside:${e.textContent}`);}
        for(let i=0;i<controls.length;i++)for(const b of controls.slice(i+1)){const a=controls[i]!;if(a.contains(b)||b.contains(a))continue;const r=a.getBoundingClientRect(),q=b.getBoundingClientRect();if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)failures.push(`overlap:${a.textContent}/${b.textContent}`);}
        const mobile=document.querySelector('.mobile-match-actions') as HTMLElement;const isMobile=mobile&&getComputedStyle(mobile).display!=='none';
        if(isMobile)for(const card of document.querySelectorAll<HTMLElement>('.network-field-card'))for(const control of controls.filter(c=>c.matches('.shield-inventory,.hud-next-piece,.mobile-match-actions button,.mobile-match-actions output'))){const r=card.getBoundingClientRect(),q=control.getBoundingClientRect();if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)failures.push(`board/chrome:${control.textContent}`);}
        return {canvas:{width:canvas.width,height:canvas.height},stage:{width:stage.width,height:stage.height},failures};
      });expect(layout.failures).toEqual([]);expect(layout.canvas.width).toBeGreaterThan(0);expect(layout.canvas.height).toBeGreaterThan(0);expect(Math.abs(layout.canvas.width-layout.stage.width)).toBeLessThanOrEqual(2);expect(Math.abs(layout.canvas.height-layout.stage.height)).toBeLessThanOrEqual(2);
      await guest!.screenshot({path:`${evidence}/return-${width}x${height}.png`});results.push({width,height,epoch,layout});
    }
    await guest!.getByRole('button',{name:'Пауза',exact:true}).click();await guest!.getByRole('button',{name:'К списку',exact:true}).click();await guest!.getByRole('button',{name:'Главное меню',exact:true}).click();await expect(guest!.getByRole('button',{name:/^Сетевая игра/})).toBeVisible();
    expect(await guest!.evaluate(()=>(window as any).__returnCanvas.parentNode)).toBeNull();expect(errors).toEqual([]);await writeFile(`${evidence}/results.json`,JSON.stringify({results,errors},null,2));
  }finally{for(const context of contexts)await context.close();}
});
