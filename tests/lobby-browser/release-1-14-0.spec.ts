import {test,expect} from '@playwright/test';
import {openLocalLobby} from '../helpers/localLobby';
for(const [width,height]of [[1440,960],[390,844]]as const)test(`release English settings ready and pressure ${width}`,async({page})=>{
 await page.setViewportSize({width,height});await page.addInitScript(()=>localStorage.setItem('bricks-war:language:v1','en'));
 await page.goto('/?muted=1&playtest-board-events=1');await page.locator('[data-destination="settings"]').click();
 await page.locator('#reset-local-records').click();await expect(page.locator('[data-record-reset-confirm]')).toBeVisible();
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/settings-${width}.png`});await page.locator('[data-record-reset-cancel]').click();
 await page.locator('#open-settings-lab').click();await expect(page.locator('.laboratory-single-page')).toBeVisible();
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/laboratory-${width}.png`});
 await page.locator('#close-debug-lab').click();await page.locator('#settings-back').click();
 await openLocalLobby(page,'survival');await page.locator('#start-match').click();
 await expect(page.locator('.match-loading')).toHaveCount(0);await expect(page.locator('#countdown')).toBeVisible();
 await expect(page.locator('#countdown')).toHaveText('Ready?');await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/ready-${width}.png`});
 await expect(page.locator('#countdown')).toBeHidden();
 await page.evaluate(()=>{const e=(window as any).__boardEffectsQA.engine;e.state.elapsedMs=404999;e.state.nextPressureAtMs=405000;e.state.finalPushActive=true;});
 await expect.poll(()=>page.locator('.hud-card').first().getAttribute('data-gray-rows'),{timeout:8000}).toBe('1');
 await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/pressure-${width}.png`});
});
