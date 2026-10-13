import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const evidence = 'evidence/add-client-4k-support';

async function fit(page: Page): Promise<void> {
  const issues = await page.evaluate(() => {
    const visible = (el: HTMLElement) => !el.closest('[hidden]') && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
    const nodes = [...document.querySelectorAll<HTMLElement>('button,input,.hud-card,.hud-identity strong,.hud-stats,.menu-workshop-art')].filter(visible);
    const outside = nodes.filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1; }).map(el => el.className || el.id);
    const controls = nodes.filter(el => el.matches('button,input') && !el.matches('[type="range"]'));
    const overlap = controls.flatMap((a,i) => controls.slice(i+1).filter(b => {
      if (a.contains(b) || b.contains(a)) return false;
      const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
      return Math.min(r.right,s.right) > Math.max(r.left,s.left)+1 && Math.min(r.bottom,s.bottom) > Math.max(r.top,s.top)+1;
    }).map(b => [a.textContent,b.textContent]));
    const clipped = [...document.querySelectorAll<HTMLElement>('.hud-identity strong,.hud-stats b,.hud-stats span')].filter(visible).filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent);
    return { outside, overlap, clipped, scroll: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1 };
  });
  expect(issues).toEqual({outside:[],overlap:[],clipped:[],scroll:false});
}

async function buffer(page: Page, density: number): Promise<unknown> {
  await expect.poll(() => page.locator('canvas').first().evaluate((c: HTMLCanvasElement) => c.width === Math.round(c.parentElement!.clientWidth * devicePixelRatio))).toBe(true);
  const measured = await page.locator('canvas').first().evaluate((c: HTMLCanvasElement) => ({ width:c.width, height:c.height, cssWidth:c.getBoundingClientRect().width, cssHeight:c.getBoundingClientRect().height, parentWidth:c.parentElement!.clientWidth, parentHeight:c.parentElement!.clientHeight, dpr:devicePixelRatio }));
  expect(measured.dpr).toBe(density);
  expect(measured.width).toBe(Math.round(measured.parentWidth * density));
  expect(measured.height).toBe(Math.round(measured.parentHeight * density));
  expect(measured.cssWidth).toBeCloseTo(measured.parentWidth, 1);
  expect(measured.cssHeight).toBeCloseTo(measured.parentHeight, 1);
  return measured;
}

for (const [width,height,density] of [[3840,2160,1],[2560,1440,1],[2560,1440,1.5],[1920,1080,2]] as const) {
  test.describe(`${width}x${height}-dpr${density}`, () => {
    test.use({ viewport:{width,height}, deviceScaleFactor:density });
    for (const players of [1,4]) {
      test(`${players} players keep approved menu, buffer, HUD and resize aligned`, async ({page}) => {
        test.setTimeout(45_000);
        await mkdir(`${evidence}/screenshots`, {recursive:true});
        const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(({players}) => {
          const pads = [0,1].map(index => ({index,id:`QA pad ${index}`,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,touched:false,value:0})),timestamp:0}));
          Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>pads});
          Object.assign(window,{qa4kPads:pads});
          localStorage.setItem('bricks-war:slot-selections:v1',JSON.stringify(players===4?['human-1','human-2','gamepad-0','gamepad-1']:['human-1','off','off','off']));
          localStorage.setItem('bricks-war:player-names:v1',JSON.stringify(Array(4).fill('Александр Великий')));
          localStorage.setItem('bricks-war:solo-records:v1',JSON.stringify(Array.from({length:10},(_,i)=>({id:`r${i}`,name:'Александр Великий',elapsedMs:600000,lineScore:10000-i,finishedAt:1780000000000,placedPieces:1000}))));
        }, {players});
        const id = `${width}x${height}-dpr${density}-${players}p`;
        await page.goto('/?muted=1');
        for (const destination of ['survival','battle','team-battle','network','settings']) {
          await page.locator(destination === 'network' ? '[data-network-entry]' : `[data-destination="${destination}"]`).hover();
          await expect(page.locator('.menu-showcase')).toHaveAttribute('data-preview',destination);
          await expect.poll(()=>page.locator('.menu-workshop-art').evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
          await fit(page);
          if (players===1 && width===3840) await page.screenshot({path:`${evidence}/screenshots/menu-${destination}-4k.png`});
        }
        await page.locator('[data-destination="settings"]').click(); await fit(page);
        await page.locator('#settings-back').click();
        await page.locator('[data-destination="survival"]').click();
        if (players===4) {
          await page.evaluate(()=>{ (window as any).qa4kPads.forEach((pad:any)=>{pad.buttons[3].pressed=true;}); });
          await expect(page.locator('[data-player-name]')).toHaveCount(4);
          await page.evaluate(()=>{ (window as any).qa4kPads.forEach((pad:any)=>{pad.buttons[3].pressed=false;}); });
        }
        await fit(page);
        await page.locator('#start-match').click();
        await expect(page.locator('.hud-card')).toHaveCount(players);
        await expect(page.locator('.match-loading')).toHaveCount(0);
        await page.waitForFunction(()=>document.querySelector('#match-clock')?.textContent !== '00:00');
        const initial = await buffer(page,density); await fit(page);
        await page.screenshot({path:`${evidence}/screenshots/arena-${id}.png`});
        await page.keyboard.press('Escape'); await expect(page.locator('#continue-match')).toBeVisible(); await fit(page);
        if (players===1) await page.screenshot({path:`${evidence}/screenshots/pause-${id}.png`});
        await page.locator('#continue-match').click();
        await page.setViewportSize({width:1101,height:701});
        const resized = await buffer(page,density); await fit(page);
        await page.setViewportSize({width,height});
        await buffer(page,density); await fit(page);
        expect(errors).toEqual([]);
        await writeFile(`${evidence}/buffer-${id}.json`,JSON.stringify({initial,resized,errors},null,2));
      });
    }
  });
}

test('density changes while playing update the buffer without changing logical HUD layout',async({page,context})=>{
  await page.setViewportSize({width:1440,height:960});
  await page.goto('/?muted=1'); await page.locator('[data-destination="survival"]').click();
  await page.locator('#start-match').click(); await expect(page.locator('.match-loading')).toHaveCount(0);
  await page.waitForFunction(()=>document.querySelector('#match-clock')?.textContent !== '00:00');
  await buffer(page,1);
  const before=await page.locator('.hud-card').first().boundingBox();
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:2,mobile:false});
  await buffer(page,2);
  expect(await page.locator('.hud-card').first().boundingBox()).toEqual(before);
  await fit(page);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await buffer(page,1);
});

test('phone canvas policy and touch controls remain unchanged',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/?muted=1'); await page.locator('[data-destination="survival"]').click();
  await page.locator('#start-match').click(); await expect(page.locator('.match-loading')).toHaveCount(0);
  const measured=await buffer(page,1); await fit(page);
  await page.screenshot({path:`${evidence}/screenshots/phone-arena.png`});
  await writeFile(`${evidence}/phone-buffer.json`,JSON.stringify(measured,null,2));
});
