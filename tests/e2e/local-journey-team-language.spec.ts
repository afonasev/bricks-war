import { openLocalLobby } from '../helpers/localLobby';
import {test,expect} from '@playwright/test';
import {LOCALES} from '../../src/i18n/locale';
import {catalogs} from '../../src/i18n/catalogs';
for(const locale of LOCALES) test(`localized Team Battle short desktop ${locale}`,async({browser})=>{
 const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale,viewport:{width:1280,height:480}});
 const page=await context.newPage();
 await page.route('**/api/network/**',route=>route.fulfill({status:503,body:'local QA offline fixture'}));
 try {
  await page.goto('/?muted=1');await openLocalLobby(page,'team-battle');
  await expect(page.locator('#setup-error')).toHaveText(catalogs[locale].validationTeams);
  await expect(page.locator('#start-match')).toBeDisabled();
  // Empty slots expose Add AI before they expose the controller selector.
  await page.locator('[data-add-ai="3"]').click();
  await page.locator('[data-slot="3"]').selectOption('ai-expert',{force:true});
  await expect(page.locator('#setup-error')).toHaveText('');
  await expect(page.locator('#start-match')).toBeEnabled();
  await expect(page.locator('[data-slot="3"]')).toHaveValue('ai-expert');
  await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/setup-hud-screenshots/${locale}-team-setup-1280x480.png`});
  await page.locator('#start-match').click();await expect(page.locator('.match-loading')).toBeVisible();
  await expect(page.locator('.match-loading')).toHaveCount(0);await expect(page.locator('#countdown')).toBeHidden();
  await expect(page.locator('.hud-card')).toHaveCount(4);
  await expect(page.locator('.hud-team')).toHaveText([catalogs[locale].teamSunShort,catalogs[locale].teamSunShort,catalogs[locale].teamSkyShort,catalogs[locale].teamSkyShort]);
  await expect(page.locator('.hud-identity strong').nth(3)).toHaveText(catalogs[locale].aiLabel);
  await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/setup-hud-screenshots/${locale}-team-hud-1280x480.png`});
 } finally {await context.close();}
});

for(const locale of LOCALES) test(`localized Team results preserve names and team summaries ${locale}`,async({browser})=>{
 test.setTimeout(60_000);
 const context=await browser.newContext({locale:locale==='zh-Hans'?'zh-CN':locale,viewport:{width:1440,height:960}});
 const page=await context.newPage();
 await page.route('**/api/network/**',route=>route.fulfill({status:503,body:'local QA offline fixture'}));
 try {
  await page.goto('/?muted=1&playtest-fast=20');
  await openLocalLobby(page,'team-battle');
  await page.locator('[data-add-ai="3"]').click();
  await page.locator('[data-player-name="0"]').fill('<b>Анна中</b>');
  await page.locator('[data-player-name="1"]').fill('Second player');
  await page.locator('#match-duration').selectOption('2',{force:true});
  await page.locator('#start-match').click();
  const result=page.locator('.results-panel');await expect(result).toBeVisible({timeout:36_000});
  expect([catalogs[locale].resultsTimeout,catalogs[locale].resultsLastSurvivor,catalogs[locale].resultsSimultaneous]).toContain(await result.locator('#results-title').innerText());
  await expect(result.locator('.team-results')).toContainText(catalogs[locale].teamSun);
  await expect(result.locator('.team-results')).toContainText(catalogs[locale].teamSky);
  await expect(result.locator('.team-results')).toContainText('<b>Анна中</b>');
  await expect(result.locator('.results-list li')).toHaveCount(4);
  await expect(result.locator('.results-list')).toContainText('<b>Анна中</b>');
  await expect(result.locator('.results-list')).toContainText('Second player');
  await expect(result.locator('.results-list strong').filter({hasText:catalogs[locale].aiLabel})).toHaveCount(2);
  await expect(result.locator('#play-again')).toBeEnabled();
  if(locale!=='ru') expect((await result.innerText()).replaceAll('<b>Анна中</b>','')).not.toMatch(/[А-Яа-яЁё]/);
  await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-local-game-journey'}/results-screenshots/${locale}-team-1440x960.png`});
  await result.locator('#play-again').click();await expect(page.locator('.match-loading')).toBeVisible();
  await expect(page.locator('.hud-card')).toHaveCount(4);
 } finally {await context.close();}
});
