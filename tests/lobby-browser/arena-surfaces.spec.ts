import { test, expect, type Page } from '@playwright/test';
import { openLocalLobby } from '../helpers/localLobby';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

async function start(page: Page, teams: boolean) {
  await page.addInitScript(() => localStorage.setItem('bricks-war:language:v1','en'));
  await page.goto('/?muted=1&playtest-board-events=1&playtest-clear=normal-2');
  await openLocalLobby(page, teams ? 'team-battle' : 'battle');
  while (await page.locator('.lobby-card:not(.is-empty)').count() < 4) {
    await page.locator('[data-bot]').first().click();
    await page.locator('[data-level="easy"]').click();
  }
  await page.locator('#start-match').click();
  await expect(page.locator('.hud-card')).toHaveCount(4);
  await expect(page.locator('.match-loading')).toHaveCount(0);
  await expect(page.locator('#countdown')).toBeHidden({timeout:10000});
  await expect(page.locator('#arena-event-notice')).toBeHidden({timeout:10000});
}
async function capture(page:Page,name:string){
  const dir=process.env.BRICKS_LOBBY_EVIDENCE!;await mkdir(dir,{recursive:true});
  await page.screenshot({path:join(dir,name+'.png')});
}
async function check(page:Page,teams:boolean,mobile:boolean){
  await expect(page.locator('.hud-team')).toHaveCount(0);
  const colors=await page.locator('.hud-card').evaluateAll(cards=>cards.map(c=>getComputedStyle(c).getPropertyValue('--identity-header').trim()));
  expect(colors).toEqual(teams?['#f1dfac','#f1dfac','#c6def2','#c6def2']:['#e0edbf','#c8e9ec','#e6d2f3','#f4d3c6']);
  const surface=page.locator('.arena-screen');
  if(teams&&!mobile){
    await expect(surface).toHaveClass(/has-team-surface/);
    const geometry=await surface.evaluate(root=>{
      const cards=[...root.querySelectorAll('.hud-card')].map(c=>c.getBoundingClientRect());
      const css=getComputedStyle(root),vertical=css.getPropertyValue('--team-surface-direction').trim()==='90deg';
      const r=root.getBoundingClientRect();
      const end=Math.max(...cards.slice(0,2).map(c=>vertical?c.right:c.bottom));
      const start=Math.min(...cards.slice(2).map(c=>vertical?c.left:c.top));
      const split=parseFloat(css.getPropertyValue('--team-surface-split'))+(vertical?r.left:r.top);
      return {distance:Math.abs(split-(end+start)/2),gap:start-end};
    });
    expect(geometry.distance).toBeLessThanOrEqual(1);expect(geometry.gap).toBeGreaterThan(0);
  }else{
    await expect(surface).not.toHaveClass(/has-team-surface/);
    expect(await surface.evaluate(e=>getComputedStyle(e).backgroundImage)).not.toContain('rgb(135, 175, 206)');
  }
  const issues=await page.locator('.hud-card').evaluateAll(cards=>{
    const rects=cards.map(c=>c.getBoundingClientRect());
    const overlaps=rects.flatMap((r,i)=>rects.slice(i+1).filter(s=>Math.min(r.right,s.right)>Math.max(r.left,s.left)+1&&Math.min(r.bottom,s.bottom)>Math.max(r.top,s.top)+1));
    const clipped=cards.flatMap(card=>[...card.querySelectorAll<HTMLElement>('.hud-identity strong,.hud-stats b')].filter(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1).map(e=>e.textContent));
    return {overlaps:overlaps.length,clipped};
  });
  expect(issues).toEqual({overlaps:0,clipped:[]});
}
for(const teams of [true,false])for(const mobile of [false,true])test(`${teams?'teams':'personal'} headers ${mobile?'phone':'desktop'}`,async({page})=>{
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:960});
  await start(page,teams);await check(page,teams,mobile);await capture(page,`${teams?'teams':'personal'}-${mobile?'phone':'desktop'}`);
  if(teams&&!mobile){
    await page.setViewportSize({width:720,height:1000});
    await expect.poll(()=>page.locator('#hud-grid').getAttribute('data-layout')).toBe('grid-2x2');
    await check(page,true,false);await capture(page,'teams-desktop-two-rows');
  }
});
