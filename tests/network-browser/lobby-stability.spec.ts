import {test,expect} from '@playwright/test';
for(const viewport of [{width:1600,height:900},{width:390,height:844}])test(`lobby controls survive return countdown ${viewport.width}`,async({browser,baseURL})=>{
  const hostContext=await browser.newContext({baseURL,viewport});
  const guestContext=await browser.newContext({baseURL});
  const host=await hostContext.newPage(),guest=await guestContext.newPage();
  const room=`Lobby stability ${Date.now()}`;
  try{
    for(const page of [host,guest]){await page.goto('/');await page.getByRole('button',{name:/^Сетевая игра/}).click();}
    await host.getByRole('button',{name:'Создать лобби',exact:true}).click();await host.getByLabel('Название лобби').fill(room);await host.getByLabel('Ваше имя',{exact:true}).fill('Host');await host.getByRole('button',{name:'Создать',exact:true}).click();
    await expect(host.getByRole('heading',{name:room})).toBeVisible();
    await guest.locator('.network-lobby').filter({hasText:room}).getByRole('button',{name:'Войти'}).click();await guest.getByLabel('Ваше имя',{exact:true}).fill('Guest');await guest.getByRole('button',{name:'Войти',exact:true}).click();await expect(guest.getByRole('heading',{name:room})).toBeVisible();
    await guestContext.close();
    const countdown=host.locator('.network-seat-state').filter({hasText:'Возвращается'});
    await expect(countdown).toBeVisible();const before=await countdown.textContent();
    await host.getByRole('combobox',{name:'Управление на этом устройстве'}).click();
    const option=await host.getByRole('option',{name:/WASD/}).elementHandle({timeout:5000});
    await expect.poll(()=>countdown.textContent()).not.toBe(before);
    expect(await option!.evaluate(node=>node.isConnected)).toBe(true);
    await host.getByRole('option',{name:'Стрелки',exact:true}).click();await expect(host.locator('#network-controls')).toHaveValue('arrows');
    await expect(host.getByRole('button',{name:'Начать',exact:true})).toBeDisabled();
    if(process.env.BRICKS_NETWORK_LOBBY_SCREENSHOTS)await host.screenshot({path:`${process.env.BRICKS_NETWORK_LOBBY_SCREENSHOTS}/lobby-${viewport.width}.png`});
  }finally{await hostContext.close();await guestContext.close();}
});
