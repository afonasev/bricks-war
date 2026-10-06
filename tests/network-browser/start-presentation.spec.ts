import {expect,test} from '@playwright/test';

test('creator Start stays centered and prominent without changing eligibility',async({page})=>{
  await page.goto('/?muted=1');
  await page.getByRole('button',{name:/^Сетевая игра/}).click();
  await page.getByRole('button',{name:'Создать лобби',exact:true}).click();
  await page.getByLabel('Название лобби').fill(`Start layout ${Date.now()}`);
  await page.getByLabel('Ваше имя',{exact:true}).fill('Проверка кнопки');
  await page.getByRole('button',{name:'Создать',exact:true}).click();
  const start=page.getByRole('button',{name:'Начать',exact:true});
  await expect(start).toBeDisabled();
  for(const viewport of [{width:1440,height:960},{width:1280,height:480},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await start.scrollIntoViewIfNeeded();
    const layout=await start.evaluate(el=>{
      const r=el.getBoundingClientRect(),siblings=[...el.parentElement!.querySelectorAll('button')].filter(b=>b!==el);
      return {center:(r.left+r.right)/2,width:r.width,height:r.height,clipped:el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1,
        overlaps:siblings.some(b=>{const q=b.getBoundingClientRect();return Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1;})};
    });
    expect(Math.abs(layout.center-viewport.width/2)).toBeLessThanOrEqual(1);
    expect(layout.width).toBeGreaterThanOrEqual(viewport.width<700?300:250);
    expect(layout.height).toBeGreaterThanOrEqual(58);
    expect(layout).toMatchObject({clipped:false,overlaps:false});
    if(viewport.width!==1280)await page.screenshot({path:`evidence/center-start-button/network-${viewport.width}x${viewport.height}.png`});
  }
});
