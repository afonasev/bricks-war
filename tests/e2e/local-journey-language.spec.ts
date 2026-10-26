import { openLocalLobby } from '../helpers/localLobby';
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { LOCALES } from '../../src/i18n/locale';
import { catalogs } from '../../src/i18n/catalogs';

for (const locale of LOCALES) test(`match loading follows selected language ${locale}`, async ({ browser }) => {
  const viewport = locale === 'en' || locale === 'de' ? {width:1440,height:960} : {width:390,height:844};
  const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale,viewport});
  const page=await context.newPage();
  try {
    await page.goto('/?muted=1');
    await openLocalLobby(page,'survival');
    await page.locator('#start-match').click();
    const loading=page.locator('.match-loading');
    await expect(loading).toBeVisible();
    await expect(loading.locator('h1')).toHaveText(catalogs[locale].arenaLoadingTitle);
    await expect(loading.locator('p')).toHaveText(catalogs[locale].arenaLoadingHint);
    const clipped=await loading.locator('h1,p').evaluateAll(elements=>elements.some(element=>{
      const range=document.createRange();range.selectNodeContents(element);const r=range.getBoundingClientRect();
      return r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight;
    }));
    expect(clipped).toBe(false);
    const path=`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/loading-screenshots`;
    await mkdir(path,{recursive:true});
    await page.screenshot({path:`${path}/${locale}-${viewport.width}x${viewport.height}.png`});
    await expect(loading).toHaveCount(0);
    await expect(page.locator('.arena-screen')).toBeVisible();
  } finally { await context.close(); }
});

for (const locale of LOCALES) test(`localized Survival results preserve names and replay ${locale}`, async ({ browser }) => {
  // Accelerated integration witness; the separate final ordinary IAB game has no playtest flags.
  test.setTimeout(60_000);
  const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale,viewport:{width:390,height:844}});
  const page=await context.newPage();
  await page.route('**/api/network/**',route=>route.fulfill({status:503,body:'local QA offline rating fixture'}));
  const name='<b>Анна中</b>';
  try {
    await page.goto('/?muted=1&playtest-fast=20&playtest-score=123456');
    await openLocalLobby(page,'survival');
    await page.locator('[data-player-name="0"]').fill(name);
    await page.locator('#start-match').click();
    const result=page.locator('.survival-results-panel');
    await expect(result).toBeVisible({timeout:45_000});
    await expect(result.locator('#results-title')).toHaveText(catalogs[locale].resultsTitle);
    await expect(result.locator('#match-results-heading')).toHaveText(catalogs[locale].currentMatch);
    await expect(result.locator('[data-rating="local"]')).toHaveText(catalogs[locale].ratingLocal);
    await expect(result.locator('[data-rating="global"]')).toHaveText(catalogs[locale].ratingGlobal);
    await expect(result.locator('.result-controller')).toContainText(catalogs[locale].touchController);
    await expect(result.locator('.survival-match-results strong')).toHaveText(name);
    await expect(result.locator('#play-again')).toHaveText(`${catalogs[locale].replay}↻`);
    await expect(result.locator('#results-main-menu')).toHaveText(catalogs[locale].menu);
    if(locale!=='ru') expect((await result.innerText()).replaceAll(name,'')).not.toMatch(/[А-Яа-яЁё]/);
    const snapshot=await page.evaluate(()=>({names:localStorage.getItem('bricks-war:player-names:v1'),records:localStorage.getItem('bricks-war:solo-records:v1')}));
    expect(snapshot.names).toContain(name); expect(snapshot.records).toContain(name);
    await expect(result.locator('#play-again')).toBeEnabled();
    await expect(result.locator('.results-actions')).toBeVisible();
    await mkdir(`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/results-screenshots`,{recursive:true});
    await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/results-screenshots/${locale}-390x844.png`});
    await expect(result.locator('#play-again')).toBeEnabled();
    await result.locator('#play-again').click();
    await expect(page.locator('.match-loading')).toBeVisible();
    await expect(page.locator('.survival-results-panel')).toHaveCount(0);
    await expect(page.locator('.hud-card')).toHaveCount(1);
    expect(await page.evaluate(()=>localStorage.getItem('bricks-war:player-names:v1'))).toBe(snapshot.names);
  } finally {await context.close();}
});

for (const locale of LOCALES) test(`localized setup HUD and pause ${locale}`, async ({browser})=>{
  const viewport=locale==='en'||locale==='de'?{width:1440,height:960}:{width:390,height:844};
  const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale,viewport});
  const page=await context.newPage();
  await page.route('**/api/network/**',route=>route.fulfill({status:503,body:'local QA offline fixture'}));
  try {
    await page.goto('/?muted=1');
    await openLocalLobby(page,'survival');
    await expect(page.locator('[data-player-name="0"]')).toHaveAttribute('aria-label',catalogs[locale].playerNameAria.replace('{index}','1'));
    await page.locator('[data-player-name="0"]').fill('Анна中');
    await expect(page.locator('#start-match')).toBeEnabled();
    await mkdir(`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/setup-hud-screenshots`,{recursive:true});
    await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/setup-hud-screenshots/${locale}-setup.png`});
    await page.locator('#start-match').click();
    await expect(page.locator('.match-loading')).toBeVisible();
    await expect(page.locator('.match-loading')).toHaveCount(0);
    await expect(page.locator('.hud-card').first().locator('.hud-identity strong')).toHaveText('Анна中');
    await expect(page.locator('.hud-card').first().locator('.hud-next-piece')).toHaveAttribute('aria-label',catalogs[locale].nextPieceAria);
    await expect(page.locator('#mobile-match-timer,#round-timer')).toHaveAttribute('aria-label',catalogs[locale].elapsedAria);
    const canvas=await page.locator('canvas').first().elementHandle();
    if (viewport.width===390) await page.locator('#manual-pause').click();
    else await page.keyboard.press('Escape');
    await expect(page.locator('#pause-overlay')).toBeVisible();
    await expect(page.locator('#pause-title')).toHaveText(catalogs[locale].pausedTitle);
    await expect(page.locator('#continue-match')).toHaveText(catalogs[locale].journeyContinue);
    await expect(page.locator('#restart-match')).toHaveText(catalogs[locale].journeyRestart);
    await expect(page.locator('#pause-settings')).toHaveText(catalogs[locale].settings);
    await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/setup-hud-screenshots/${locale}-pause.png`});
    await page.locator('#continue-match').click();
    await expect(page.locator('#pause-overlay')).toBeHidden();
    expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true);
    if(locale!=='ru') expect(await page.locator('.hud-stats').allTextContents()).not.toEqual(expect.arrayContaining([expect.stringMatching(/[А-Яа-яЁё]/)]));
  } finally {await context.close();}
});

for (const locale of LOCALES) test(`localized phone Battle three AI ${locale}`, async ({browser})=>{
  const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale,viewport:{width:390,height:844}});
  const page=await context.newPage();
  await page.route('**/api/network/**',route=>route.fulfill({status:503,body:'local QA offline fixture'}));
  try {
    await page.goto('/?muted=1');
    await openLocalLobby(page,'battle');
    await page.locator('[data-player-name="0"]').fill('Анна中');
    await page.locator('[data-mobile-setting="aiCount"]').selectOption('3',{force:true});
    await page.locator('[data-mobile-setting="aiDifficulty"]').selectOption('expert',{force:true});
    await expect(page.locator('[data-mobile-setting="aiCount"]')).toHaveValue('3');
    await expect(page.locator('[data-mobile-setting="aiDifficulty"]')).toHaveValue('expert');
    await expect(page.locator('#start-match')).toBeEnabled();
    await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/setup-hud-screenshots/${locale}-battle-setup.png`});
    await page.locator('#start-match').click();
    await expect(page.locator('.match-loading')).toBeVisible();
    await expect(page.locator('.match-loading')).toHaveCount(0);
    await expect(page.locator('.hud-card')).toHaveCount(4);
    await expect(page.locator('#countdown')).toBeHidden();
    await expect(page.locator('.mobile-ai-card .hud-identity strong')).toHaveText(Array(3).fill(catalogs[locale].aiExpert));
    await expect(page.locator('.mobile-player-card .hud-identity strong')).toHaveText('Анна中');
    await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/setup-hud-screenshots/${locale}-battle-hud.png`});
    const boxes=await page.locator('.hud-card').evaluateAll(cards=>cards.map(card=>({box:card.getBoundingClientRect().toJSON(),labels:[...card.querySelectorAll('.hud-identity strong,.hud-stats b,.hud-stats span')].map(element=>{const range=document.createRange();range.selectNodeContents(element);return {text:element.textContent,box:range.getBoundingClientRect().toJSON()};})})));
    await test.info().attach('hud-label-boxes',{body:JSON.stringify(boxes),contentType:'application/json'});
    const clipped=await page.locator('.hud-card').evaluateAll(cards=>cards.some(card=>{
      const box=card.getBoundingClientRect();
      return [...card.querySelectorAll('.hud-identity strong,.hud-stats b,.hud-stats span')].filter(element=>element.getClientRects().length>0).some(element=>{
        const range=document.createRange();range.selectNodeContents(element);const text=range.getBoundingClientRect();
        return text.left<box.left-1||text.right>box.right+1;
      });
    }));
    expect(clipped).toBe(false);
    await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/setup-hud-screenshots/${locale}-battle-hud.png`});
  } finally {await context.close();}
});
