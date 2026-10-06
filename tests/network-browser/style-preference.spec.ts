import {expect,test} from '@playwright/test';

for(const viewport of [{width:1600,height:900},{width:390,height:844}])test(`random default and remembered style for create/join ${viewport.width}`,async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,viewport});const other=await browser.newContext({baseURL});
  const page=await context.newPage();const host=await other.newPage();
  const enter=async(p:typeof page)=>{await p.goto('/?muted=1');await p.getByRole('button',{name:/^Сетевая игра/}).click();};
  const create=async(p:typeof page,name:string)=>{
    await p.getByRole('button',{name:'Создать лобби',exact:true}).click();await p.getByLabel('Название лобби').fill(name);
    await p.getByRole('button',{name:'Создать',exact:true}).click();await expect(p.getByRole('heading',{name,exact:true})).toBeVisible();
  };
  const style=page.getByRole('combobox',{name:'Вид фигур',exact:true});
  const pick=async(label:string)=>{await style.click();await page.getByRole('option',{name:label,exact:true}).click();await page.getByRole('button',{name:'Сохранить имя и фигуры',exact:true}).click();await expect(style).toContainText(label);};
  try {
    await enter(page);await create(page,`Default ${viewport.width} ${Date.now()}`);await expect(style).toContainText('Случайный');
    await pick('Каменная крепость');await page.reload();await page.getByRole('button',{name:/^Сетевая игра/}).click();await page.getByRole('button',{name:'Вернуться',exact:true}).click();await expect(style).toContainText('Каменная крепость');
    await page.getByRole('button',{name:'Покинуть',exact:true}).click();await create(page,`Remember ${Date.now()}`);await expect(style).toContainText('Каменная крепость');
    await page.getByRole('button',{name:'Покинуть',exact:true}).click();await enter(host);const room=`Join styles ${Date.now()}`;await create(host,room);await expect(host.getByRole('combobox',{name:'Вид фигур',exact:true})).toContainText('Случайный');
    await page.locator('.network-lobby').filter({hasText:room}).getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(style).toContainText('Каменная крепость');
    await expect(host.getByRole('combobox',{name:'Вид фигур',exact:true})).toContainText('Случайный');
    await pick('Случайный');await page.getByRole('button',{name:'Покинуть',exact:true}).click();await create(page,`Random again ${Date.now()}`);await expect(style).toContainText('Случайный');
    await page.getByRole('button',{name:'Покинуть',exact:true}).click();await host.getByRole('button',{name:'Покинуть',exact:true}).click();
  } finally {await context.close();await other.close();}
});
