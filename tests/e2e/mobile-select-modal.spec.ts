import { openLocalLobby } from '../helpers/localLobby';
import {test,expect} from '@playwright/test';

test('mobile lists center, cancel outside without click-through, confirm and resize cleanly',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/?muted=1');
  await openLocalLobby(page,'battle');
  const trigger=page.getByRole('combobox',{name:'Длительность матча',exact:true});
  const native=page.locator('#match-duration');
  const original=await native.inputValue();
  await trigger.click();
  const dialog=page.getByRole('dialog',{name:'Длительность матча',exact:true});
  await expect(dialog).toBeVisible();
  const rect=await dialog.boundingBox();
  expect(Math.abs(rect!.x+rect!.width/2-195)).toBeLessThan(2);
  expect(Math.abs(rect!.y+rect!.height/2-422)).toBeLessThan(2);
  expect(await dialog.evaluate(el=>getComputedStyle(el,'::backdrop').backdropFilter)).toContain('blur');
  await dialog.getByRole('option').first().press('ArrowDown');
  await page.mouse.click(40,40); // Back button is behind the backdrop.
  await expect(dialog).toHaveCount(0);
  await expect(native).toHaveValue(original);
  await expect(page.locator('#start-match')).toBeVisible();
  await trigger.click();
  await page.getByRole('dialog').getByRole('option',{name:'3 мин',exact:true}).click();
  await expect(native).toHaveValue('3');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Other list categories use the same centered modal and cancel without changes.
  for(const name of ['Режим атаки','Соперники']){
    await page.getByRole('combobox',{name,exact:true}).click();
    await expect(page.getByRole('dialog',{name,exact:true})).toBeVisible();
    await page.getByRole('dialog').getByRole('option').first().press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await trigger.click();
  await page.setViewportSize({width:1280,height:720});
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#app')).toHaveAttribute('data-layout','desktop');
});

test('network style popup centers on a short phone and outside tap keeps previous style',async({page})=>{
  await page.setViewportSize({width:390,height:400});
  await page.goto('/?muted=1');
  await page.getByRole('button',{name:/^Сетевая игра/}).click();
  await page.getByRole('button',{name:'Создать лобби',exact:true}).click();
  await page.getByRole('button',{name:'Создать',exact:true}).click();
  const native=page.locator('#network-profile select[name="tileStyle"]');
  const original=await native.inputValue();
  await page.getByRole('combobox',{name:'Вид фигур',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Вид фигур',exact:true});
  const bounds=await dialog.boundingBox();
  expect(Math.abs(bounds!.y+bounds!.height/2-200)).toBeLessThan(2);
  expect(bounds!.y).toBeGreaterThanOrEqual(15);
  expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(385);
  const list=dialog.getByRole('listbox');
  expect(await list.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await dialog.getByRole('option').first().press('ArrowUp');
  await page.mouse.click(5,5);
  await expect(dialog).toHaveCount(0);
  await expect(native).toHaveValue(original);
  await page.getByRole('combobox',{name:'Вид фигур',exact:true}).click();
  await dialog.getByRole('option',{name:'Классика',exact:true}).click();
  await expect(native).toHaveValue('classic');
  await page.getByRole('button',{name:'Покинуть',exact:true}).click();
});
