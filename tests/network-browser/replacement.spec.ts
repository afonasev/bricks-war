import {test,expect} from '@playwright/test';
test('replacement tab preserves shared seat credential and recovers after reload',async({context,page})=>{
  const room=`Replacement ${Date.now()}`;
  await page.goto('/');await page.getByRole('button',{name:/^Сетевая игра/}).click();await page.getByRole('button',{name:'Создать лобби',exact:true}).click();
  await page.getByLabel('Название лобби').fill(room);await page.getByLabel('Ваше имя',{exact:true}).fill('Original tab');await page.getByRole('button',{name:'Создать',exact:true}).click();await expect(page.getByRole('heading',{name:room})).toBeVisible();
  const replacement=await context.newPage();await replacement.goto('/');await replacement.getByRole('button',{name:/^Сетевая игра/}).click();await replacement.getByRole('button',{name:'Вернуться',exact:true}).click();
  await expect(replacement.getByRole('heading',{name:room})).toBeVisible();await expect(page.getByText('Управление открыто в другой вкладке.',{exact:true})).toBeVisible();
  expect(await replacement.evaluate(()=>!!localStorage.getItem('bricks-network-seat-v1'))).toBe(true);
  await replacement.reload();await replacement.getByRole('button',{name:/^Сетевая игра/}).click();await replacement.getByRole('button',{name:'Вернуться',exact:true}).click();
  await expect(replacement.getByRole('heading',{name:room})).toBeVisible();await expect(replacement.locator('#network-status')).toContainText('Подключено');
});
