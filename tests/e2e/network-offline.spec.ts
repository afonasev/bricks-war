import {test,expect} from '@playwright/test';
test('cached phone shell still starts local Survival while offline after adding network mode',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/?muted=1');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload();
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);await page.reload();
  await expect(page.getByRole('button',{name:/^Сетевая игра/})).toBeVisible();
  await page.getByRole('button',{name:/^Выживание/}).click();await page.getByRole('button',{name:'Начать',exact:true}).click();
  await expect(page.locator('#game-stage')).toBeVisible();await expect(page.getByRole('button',{name:'Поставить матч на паузу'})).toBeVisible();
});
