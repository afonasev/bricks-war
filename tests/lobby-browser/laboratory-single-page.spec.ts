import {test, expect, type Page} from '@playwright/test';

async function openLab(page: Page, locale = 'en') {
  await page.addInitScript(locale => localStorage.setItem('bricks-war:language:v1', locale), locale);
  await page.goto('/?muted=1');
  await page.locator('[data-destination="settings"]').click();
  await page.locator('#open-settings-lab').click();
  await expect(page.locator('.laboratory-single-page')).toBeVisible();
}

// Every field is traversed, including all profiles and message templates below the fold.
async function expectAllFieldsReachable(page: Page) {
  const result = await page.locator('.debug-lab-content').evaluate(content => {
    const fields = [...content.querySelectorAll<HTMLElement>('.debug-field')];
    const issues: unknown[] = [];
    for (const field of fields) {
      field.scrollIntoView({block: 'center', inline: 'nearest'});
      const r = field.getBoundingClientRect(), view = content.getBoundingClientRect();
      if (field.closest('[hidden]') || r.width <= 0 || r.top < view.top - 1 || r.bottom > view.bottom + 1 || r.left < view.left - 1 || r.right > view.right + 1) issues.push(['field',field.textContent]);
      for (const el of field.querySelectorAll<HTMLElement>('input,textarea,b,small')) {
        const b = el.getBoundingClientRect();
        if (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1 || el.scrollWidth > el.clientWidth + 1) issues.push(['overflow',el.getAttribute('aria-label') || el.textContent]);
        if (el.matches('b,small')) {
          const range = document.createRange(); range.selectNodeContents(el);
          const text = range.getBoundingClientRect();
          if (text.left < b.left - 1 || text.right > b.right + 1) issues.push(['text',el.textContent]);
        }
      }
    }
    const viewport = content.getBoundingClientRect();
    for (const el of document.querySelectorAll<HTMLElement>('.debug-lab-actions button,#close-debug-lab')) {
      const r = el.getBoundingClientRect();
      if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight || (r.top < viewport.bottom - 1 && r.bottom > viewport.top + 1)) issues.push(['action',el.textContent]);
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) issues.push(['action text',el.textContent]);
    }
    content.scrollTop = 0;
    return {count:fields.length,issues,viewport:{height:viewport.height,top:viewport.top,bottom:viewport.bottom},documentOverflow:document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight};
  });
  expect(result.count).toBe(51);
  expect(result.issues).toEqual([]);
  expect(result.viewport.height).toBeGreaterThan(80);
  expect(result.documentOverflow).toBe(false);
}

for (const [width,height,locale] of [[1440,960,'en'],[1280,480,'en'],[390,844,'en'],[320,640,'en'],[844,390,'en'],[390,844,'ru'],[320,640,'ru'],[390,844,'es']] as const) {
  test(`single-page laboratory ${width}x${height} ${locale}`,async({page}) => {
    await page.setViewportSize({width,height});
    const errors:string[]=[]; page.on('pageerror', e=>errors.push(e.message));
    await openLab(page,locale);
    await expect(page.locator('.desktop-lab-pages,[data-lab-previous],[data-lab-next]')).toHaveCount(0);
    await expect(page.locator('.debug-group')).toHaveCount(6);
    await expect(page.locator('.debug-group[hidden],.debug-field[hidden],.debug-ai-card[hidden]')).toHaveCount(0);
    await expectAllFieldsReachable(page);
    const first=page.locator('[data-tuning-key="minimumGravityMs"]'),last=page.locator('[data-message-key="shieldBlock"]');
    await first.fill('215');
    await last.fill('Custom {rows}');
    await page.locator('#save-debug-tuning').click();
    await expect(page.locator('#debug-save-status')).toBeVisible();
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bricks-war:game-tuning:v1')!))).toMatchObject({minimumGravityMs:215,messages:{shieldBlock:'Custom {rows}'}});
    await expectAllFieldsReachable(page);
    await page.reload(); await page.locator('[data-destination="settings"]').click(); await page.locator('#open-settings-lab').click();
    await expect(first).toHaveValue('215'); await expect(last).toHaveValue('Custom {rows}');
    await page.setViewportSize({width:width===390?1440:390,height:width===390?960:844});
    await expect(first).toHaveValue('215'); await expect(last).toHaveValue('Custom {rows}');
    await page.setViewportSize({width,height});
    await expectAllFieldsReachable(page);
    await page.locator('#reset-debug-tuning').click(); await expect(first).toHaveValue('200'); await expect(last).not.toHaveValue('Custom {rows}');
    await expectAllFieldsReachable(page);
    await page.locator('.laboratory-single-page').evaluate(e=>Promise.all(e.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>null))));
    await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/lab-${width}-${locale}.png`});
    expect(errors).toEqual([]);
  });
}

test('phone release-save feedback stays visible on error without writing configuration',async({page})=>{
  await page.setViewportSize({width:320,height:640}); await openLab(page);
  await page.route('**/__debug/game-tuning',route=>route.request().method()==='POST'?route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'QA save rejected'})}):route.continue());
  await page.locator('#save-release-tuning').click();
  await expect(page.locator('#debug-save-status')).toContainText('QA save rejected');
  await expect(page.locator('#debug-save-status')).toBeVisible();
  await expectAllFieldsReachable(page);
  await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/lab-phone-save-error.png`});
});

for(const width of [1440,390]) test(`keyboard and controller scroll through laboratory ${width}`,async({page})=>{
  await page.setViewportSize({width,height:width===1440?960:844});
  await page.addInitScript(()=>{
    const pad={index:0,id:'Xbox QA',connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0})),timestamp:0};
    Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]}); (window as any).labPad=pad;
  });
  await openLab(page);
  const first=page.locator('[data-tuning-key="minimumGravityMs"]'); await first.focus();
  // Native Tab must reach every mounted control and scroll the field viewport.
  for(let i=0;i<50;i++) await page.keyboard.press('Tab');
  await expect(page.locator('[data-message-key="shieldBlock"]')).toBeFocused();
  expect(await page.locator('.debug-lab-content').evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  const before=await first.inputValue();
  // Desktop hover selects a row; phone touch deliberately does not. Reopen the
  // phone screen to exercise its real initial controller selection at bottom actions.
  if(width>760) { await first.hover(); await expect(first).toBeFocused(); }
  else {
    await page.locator('#close-debug-lab').click(); await page.locator('#open-settings-lab').click();
    // Reset is in the left bottom column; move right to Save (aligned with
    // numeric inputs), then up into the visible form before traversing down.
    for(const button of [15,12]) {
      await page.evaluate(button=>{(window as any).labPad.buttons[button].pressed=true;},button);
      await page.waitForTimeout(90);
      await page.evaluate(button=>{(window as any).labPad.buttons[button].pressed=false;},button);
      await page.waitForTimeout(90);
    }
    await expect(page.locator('.debug-lab-content input:focus')).toHaveCount(1);
  }
  let reachedLowerGroup=false;
  for(let i=0;i<22;i++) {
    await page.evaluate(button=>{(window as any).labPad.buttons[button].pressed=true;},13);
    await page.waitForTimeout(90);
    await page.evaluate(button=>{(window as any).labPad.buttons[button].pressed=false;},13);
    await page.waitForTimeout(90);
    reachedLowerGroup=await page.evaluate(()=>Boolean(document.activeElement?.closest('[data-lab-group="battle"],[data-lab-group="ai"],[data-lab-group="tilt"],[data-lab-group="messages"]')));
    if(reachedLowerGroup)break;
  }
  expect(reachedLowerGroup).toBe(true); await expect(first).toHaveValue(before);
  const focused=await page.evaluate(()=>{
    const el=document.activeElement!; const r=el.getBoundingClientRect(),view=el.closest('.debug-lab-content')!.getBoundingClientRect();
    return r.top>=view.top-1&&r.bottom<=view.bottom+1;
  }); expect(focused).toBe(true);
  await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/lab-controller-${width}.png`});
});
