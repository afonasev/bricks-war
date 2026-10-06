import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const evidence='evidence/add-network-ai-slots/browser';
async function enter(page:Page){await page.goto('/?muted=1');await page.getByRole('button',{name:/^Сетевая игра/}).click();}
async function geometry(page:Page){
  const failures=await page.evaluate(()=>{
    const visible=(e:HTMLElement)=>e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';
    const text=[...document.querySelectorAll<HTMLElement>('.network-screen strong,.network-screen button,.network-screen textarea,.network-screen label,.network-screen summary,.network-screen .menu-select-value')].filter(visible);
    const errors=text.filter(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2).map(e=>`clipped:${e.textContent}`);
    const elements=[...document.querySelectorAll<HTMLElement>('.network-screen button,.network-screen textarea,.network-screen input,.network-screen h1,.network-screen h2,.network-screen .network-roster li,.network-screen summary,.network-screen .menu-select')].filter(visible);
    for(let i=0;i<elements.length;i++){
      const a=elements[i]!,r=a.getBoundingClientRect();if(r.left< -1||r.right>innerWidth+1)errors.push(`outside:${a.textContent}`);
      for(const b of elements.slice(i+1)){if(a.contains(b)||b.contains(a))continue;const q=b.getBoundingClientRect();if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)errors.push(`overlap:${a.textContent}/${b.textContent}`);}
    }return errors;
  });expect(failures).toEqual([]);
}
test('phone creator manages six AI, human opponent required, mixed roster and readable controls',async({browser,baseURL})=>{
  test.setTimeout(120000);await mkdir(evidence,{recursive:true});
  const contexts=await Promise.all([browser.newContext({baseURL,viewport:{width:390,height:844}}),browser.newContext({baseURL,viewport:{width:1440,height:960}})]);
  const [host,guest]=await Promise.all(contexts.map(c=>c.newPage())) as [Page,Page];const errors:string[]=[];
  for(const page of [host,guest])page.on('pageerror',error=>errors.push(error.message));
  const room=`ИИ и друзья ${Date.now()}`;
  try{
    await enter(host);await host.getByRole('button',{name:'Создать лобби',exact:true}).click();
    await host.getByLabel('Название лобби').fill(room);await host.getByLabel('Ваше имя',{exact:true}).fill('Александр Екатеринбург');
    await host.getByRole('button',{name:'Создать',exact:true}).click();
    for(let i=0;i<6;i++){await host.getByRole('button',{name:'Добавить ИИ',exact:true}).click();await expect(host.locator('.network-roster li[data-kind="ai"]')).toHaveCount(i+1);}
    await expect(host.getByRole('button',{name:'Добавить ИИ',exact:true})).toBeDisabled();
    await host.getByRole('button',{name:'Готов',exact:true}).click();await expect(host.getByRole('button',{name:'Начать',exact:true})).toBeDisabled();
    await host.screenshot({path:`${evidence}/phone-one-human-blocked.png`,fullPage:true});
    await enter(guest);await guest.locator('.network-lobby').filter({hasText:room}).getByRole('button',{name:'Войти'}).click();
    await guest.getByLabel('Ваше имя',{exact:true}).fill('Екатерина Санкт-Петербург');await guest.getByRole('button',{name:'Войти',exact:true}).click();
    await expect(guest.locator('.network-roster li')).toHaveCount(8);await expect(guest.getByRole('button',{name:'Добавить ИИ',exact:true})).toHaveCount(0);await expect(guest.locator('.network-ai-editor')).toHaveCount(0);
    let editor=host.locator('.network-ai-editor').first();await editor.locator('summary').click();
    await expect(host.locator('.network-roster li[data-kind=ai] strong').first()).toHaveText('Средний');
    await expect(editor.getByRole('combobox',{name:'Вид фигур ИИ',exact:true})).toContainText('Случайный');
    await expect(editor.getByLabel('Имя ИИ',{exact:true})).toHaveCount(0);
    await host.screenshot({path:`${evidence}/phone-ai-default.png`,fullPage:true});
    await editor.getByRole('combobox',{name:'Сложность ИИ',exact:true}).click();await host.getByRole('option',{name:'Эксперт',exact:true}).click();
    await editor.getByRole('combobox',{name:'Вид фигур ИИ',exact:true}).click();await host.getByRole('option',{name:'Каменная крепость',exact:true}).click();
    await editor.getByRole('button',{name:'Сохранить ИИ',exact:true}).click();
    await expect(guest.locator('.network-roster li[data-kind=ai] strong').first()).toHaveText('Эксперт');
    await expect(host.getByRole('button',{name:'Готов',exact:true})).toBeVisible();
    for(const [width,height,label] of [[1440,960,'wide'],[1280,480,'short-wide'],[360,800,'phone360'],[390,844,'phone390'],[844,390,'landscape']] as const){
      await host.setViewportSize({width,height});editor=host.locator('.network-ai-editor').first();await editor.locator('summary').click();await geometry(host);
      await host.screenshot({path:`${evidence}/lobby-${label}-editor.png`,fullPage:true});await editor.locator('summary').click();await geometry(host);
      await host.locator('.network-heading').scrollIntoViewIfNeeded();
      await host.screenshot({path:`${evidence}/lobby-${label}.png`,fullPage:true});
    }
    await host.setViewportSize({width:390,height:844});
    const last=host.locator('.network-ai-editor').last();await last.locator('summary').click();await last.getByRole('button',{name:'Удалить ИИ',exact:true}).click();
    await expect(host.locator('.network-roster li')).toHaveCount(7);await host.getByRole('button',{name:'Добавить ИИ',exact:true}).click();await expect(host.locator('.network-roster li')).toHaveCount(8);
    for(const page of [host,guest])await page.getByRole('button',{name:'Готов',exact:true}).click();
    await expect(host.getByRole('button',{name:'Начать',exact:true})).toBeEnabled();await host.getByRole('button',{name:'Начать',exact:true}).click();
    for(const page of [host,guest])await expect(page.locator('.network-arena')).toHaveAttribute('data-total','8');
    await expect(host.locator('.network-arena')).toHaveAttribute('data-phase','playing');
    await host.getByRole('button',{name:'Пауза',exact:true}).click();await expect(guest.getByRole('heading',{name:'Матч на паузе'})).toBeVisible();
    await host.screenshot({path:`${evidence}/phone-mixed-pause.png`,fullPage:true});
    await host.getByRole('button',{name:'Продолжить',exact:true}).click();
    await host.screenshot({path:`${evidence}/phone-mixed-arena.png`,fullPage:true});await guest.screenshot({path:`${evidence}/wide-mixed-arena.png`,fullPage:true});
    await host.reload();await host.getByRole('button',{name:/^Сетевая игра/}).click();await host.getByRole('button',{name:'Вернуться',exact:true}).click();
    await expect(host.locator('.network-arena')).toHaveAttribute('data-total','8');await expect(host.locator('.network-arena')).toHaveAttribute('data-phase','playing');
    expect(errors).toEqual([]);
  }finally{for(const context of contexts)await context.close();}
});
