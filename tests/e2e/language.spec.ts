import { test, expect, type Page } from '@playwright/test';
import { catalogs } from '../../src/i18n/catalogs';
import { LOCALES, LANGUAGE_NAMES, type Locale } from '../../src/i18n/locale';
const shots = 'evidence/add-persistent-game-language/screenshots';
async function choose(page: Page, locale: Locale) {
  await page.locator('.settings-language-section [data-menu-select-trigger]').click();
  await page.getByRole('option', { name: LANGUAGE_NAMES[locale], exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('[data-language]')).toHaveValue(locale);
}
async function settingsFit(page: Page) {
  const issues = await page.locator('[data-screen="settings"]').evaluate(main => {
    const visible = (el: HTMLElement) => !el.closest('[hidden]') && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
    const nodes = [...main.querySelectorAll<HTMLElement>('button,input,h1,h2,label,strong,small,.menu-select-value')].filter(visible);
    const offscreen = nodes.filter(el => {const r=el.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1 || r.top < -1 || r.bottom > innerHeight+1;}).map(el=>el.textContent);
    const clipped = nodes.filter(el => el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+1).map(el=>({text:el.textContent,cw:el.clientWidth,sw:el.scrollWidth,ch:el.clientHeight,sh:el.scrollHeight}));
    const controls=nodes.filter(el=>el.matches('button,input'));
    const overlap=controls.flatMap((el,i)=>controls.slice(i+1).filter(other=>{if(el.contains(other)||other.contains(el))return false;const a=el.getBoundingClientRect(),b=other.getBoundingClientRect();return Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1;}).map(other=>[el.textContent,other.textContent]));
    const list=main.querySelector('.settings-list')!;
    return {offscreen,clipped,overlap,scroll:list.scrollHeight>list.clientHeight+1};
  });
  expect(issues).toEqual({offscreen:[],clipped:[],overlap:[],scroll:false});
}
for (const locale of LOCALES) test(`first supported system ${locale}, manual choice, settings, reset and reload`, async ({browser}) => {
  const context = await browser.newContext({ locale: locale === 'zh-Hans' ? 'zh-TW' : `${locale}-XX`, viewport:{width:1440,height:960} });
  const page = await context.newPage();
  const errors: string[]=[];page.on('pageerror', e=>errors.push(e.message));
  await page.goto('/?muted=1');
  await expect(page.locator('html')).toHaveAttribute('lang',locale);
  await expect(page.locator('.startup-loading-status')).toHaveText(catalogs[locale].loading);
  await page.locator('[data-destination="settings"]').click();
  await expect(page.getByRole('heading',{name:catalogs[locale].settings,exact:true})).toBeVisible();
  await expect(page.locator('#master-volume')).toHaveAttribute('aria-label',catalogs[locale].masterAria);
  await settingsFit(page);
  await page.screenshot({path:`${shots}/${locale}-desktop.png`});
  const before=await page.evaluate(()=>localStorage.getItem('bricks-war:release-settings:v1'));
  const next=LOCALES[(LOCALES.indexOf(locale)+1)%LOCALES.length]!;
  await choose(page,next);
  expect(await page.evaluate(()=>localStorage.getItem('bricks-war:release-settings:v1'))).toBe(before);
  await expect(page.locator('[data-reset-preferences]')).toContainText(catalogs[next].reset);
  await page.locator('[data-reset-preferences]').click();
  await expect(page.locator('html')).toHaveAttribute('lang',next);
  await page.locator('#settings-back').click();
  await expect(page.locator('[data-destination="settings"] strong')).toHaveText(catalogs[next].settings);
  await page.reload();
  await expect(page.locator('.startup-loading-status')).toHaveText(catalogs[next].loading);
  await page.locator('[data-destination="settings"]').click();
  await expect(page.locator('[data-language]')).toHaveValue(next);
  expect(errors).toEqual([]);
  await context.close();
});
test('unsupported and corrupt storage fall back through system preferences; blocked storage stays playable',async({browser})=>{
  const context=await browser.newContext({locale:'it-IT'});const page=await context.newPage();
  await page.addInitScript(()=>localStorage.setItem('bricks-war:language:v1','{broken'));
  await page.goto('/?muted=1');await expect(page.locator('html')).toHaveAttribute('lang','en');
  await page.locator('[data-destination="settings"]').click();await choose(page,'ja');
  await context.close();
  const blocked=await browser.newContext({locale:'fr-CA'});const p=await blocked.newPage();
  await p.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get:()=>{throw Error('storage blocked');}});});
  await p.goto('/?muted=1');await expect(p.locator('html')).toHaveAttribute('lang','fr');
  await p.locator('[data-destination="settings"]').click();await choose(p,'de');
  await expect(p.locator('[data-language-status]')).toHaveText(catalogs.de.saveFailed);
  await p.locator('#settings-back').click();await expect(p.locator('[data-destination="settings"] strong')).toHaveText(catalogs.de.settings);
  await blocked.close();
});
test('V2 viewport fit and phone modal autonyms',async({page})=>{
  await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();await choose(page,'ru');
  for(const [width,height] of [[1440,960],[1280,720],[1280,480]]){
    await page.setViewportSize({width:width!,height:height!});await expect(page.locator('[data-language]')).toHaveValue('ru');
    await settingsFit(page);await page.screenshot({path:`${shots}/v2-${width}x${height}.png`});
  }
  await page.setViewportSize({width:390,height:844});await page.reload();await page.locator('[data-destination="settings"]').click();
  const order = await page.locator('.settings-list').evaluate(list => ['.settings-language-section','.settings-audio-section','.settings-display-section','.settings-stick-section'].map(selector => list.querySelector(selector)!.getBoundingClientRect().top));
  expect(order.every((top,index) => index===0 || top > order[index-1]!)).toBe(true);
  await page.screenshot({path:`${shots}/v2-phone.png`});
  await page.locator('.settings-language-section [data-menu-select-trigger]').click();
  await expect(page.locator('dialog.menu-select-modal')).toBeVisible();
  for(const locale of LOCALES)await expect(page.getByRole('option',{name:LANGUAGE_NAMES[locale],exact:true})).toBeVisible();
  await page.screenshot({path:`${shots}/v2-phone-open.png`});
  await page.getByRole('option',{name:'简体中文',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','zh-Hans');
  await page.screenshot({path:`${shots}/zh-phone.png`});
  await page.locator('#open-controls').scrollIntoViewIfNeeded();
  await expect(page.locator('#open-controls')).toBeVisible();
  await expect(page.locator('[data-stick="stickDeadzone"]')).toBeVisible();
  await page.screenshot({path:`${shots}/zh-phone-bottom.png`});
});
test('localized startup error remains usable before app startup',async({browser})=>{
 const context=await browser.newContext({locale:'ja-JP'});const page=await context.newPage();
 await page.goto('/?muted=1');await expect(page.locator('#startup-loading')).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new ErrorEvent('error',{message:'Language QA startup failure',error:new Error('Language QA startup failure')})));
 await expect(page.getByRole('heading',{name:catalogs.ja.errorTitle})).toBeVisible();
 await expect(page.getByRole('button',{name:catalogs.ja.reload})).toBeEnabled();
 await expect(page.locator('#startup-error')).toContainText('Language QA startup failure');await page.screenshot({path:`${shots}/ja-startup-error.png`});await context.close();
});

test('language change in pause preserves the current canvas and unrelated preferences',async({browser})=>{
 const context=await browser.newContext({locale:'ru-RU',viewport:{width:390,height:844},hasTouch:true});const page=await context.newPage();
 await page.goto('/?muted=1');await page.locator('[data-destination="survival"]').click();await page.locator('#start-match').click();
 await page.getByRole('button',{name:'Поставить матч на паузу'}).click();await page.getByRole('button',{name:'Настройки',exact:true}).click();
 const canvas=await page.locator('canvas').first().elementHandle();expect(canvas).not.toBeNull();
 await page.locator('#music-volume').fill('37');await page.locator('#music-volume').dispatchEvent('input');
 const saved=await page.evaluate(()=>localStorage.getItem('bricks-war:release-settings:v1'));
 await choose(page,'ja');await expect(page.locator('#pause-settings-panel h2').first()).toHaveText(catalogs.ja.settings);
 expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true);
 expect(await page.evaluate(()=>localStorage.getItem('bricks-war:release-settings:v1'))).toBe(saved);
 await expect(page.locator('#music-volume')).toHaveValue('37');
 await page.screenshot({path:`${shots}/ja-pause-preferences.png`});
 await page.locator('#pause-settings-back').click();await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true);await context.close();
});
test('controller selector has one selected focus and localized family hints',async({browser})=>{
 const context=await browser.newContext({locale:'ru-RU'});const page=await context.newPage();
 await page.addInitScript(()=>{
 const pad={id:'Xbox QA virtual pad',connected:true,index:0,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,touched:false,value:0})),timestamp:0};
 Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});
 (window as any).__localePad=pad;
 });
 await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();
 const trigger=page.locator('.settings-language-section [data-menu-select-trigger]');await trigger.focus();
 await page.keyboard.press('ArrowDown');
 // Use real keyboard navigation to return to selector, then open and commit a choice.
 await trigger.press('Enter');await expect(trigger).toHaveAttribute('aria-expanded','true');
 await page.screenshot({path:`${shots}/v2-controller-open.png`});
 await page.getByRole('option',{name:'Deutsch',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('lang','de');
 await expect(page.locator('.is-ui-selected')).toHaveCount(1);
 await expect(page.locator('.settings-language-section [data-menu-select-trigger]')).toHaveClass(/is-ui-selected/);
 await expect(page.locator('.release-footer-actions')).toContainText(catalogs.de.confirm);
 await expect(page.locator('.release-footer-actions .input-confirm')).toHaveText('A');
 await page.screenshot({path:`${shots}/v2-controller-focus.png`});await context.close();
});

test('long Latin and CJK settings fit supported desktop heights',async({page})=>{
 await page.goto('/?muted=1');await page.locator('[data-destination="settings"]').click();
 for(const locale of LOCALES){
  await choose(page,locale);
  for(const height of [720,480]){
   await page.setViewportSize({width:1280,height});await settingsFit(page);
   await page.screenshot({path:`${shots}/${locale}-1280x${height}.png`});
  }
 }
});

test('JavaScript disabled has an accessible static English fallback',async({browser})=>{
 const context=await browser.newContext({javaScriptEnabled:false,locale:'ja-JP'});const page=await context.newPage();
 await page.goto('/?muted=1');await expect(page.getByText('Enable JavaScript to play Bricks War.',{exact:true})).toBeVisible();
 await expect(page.locator('#startup-loading')).toBeHidden();await page.screenshot({path:`${shots}/noscript-en.png`});await context.close();
});
