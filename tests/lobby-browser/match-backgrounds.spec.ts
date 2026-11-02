import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openLocalLobby } from '../helpers/localLobby';
import { chooseLocalArenaLayout } from '../../src/rendering/arenaLayout';
const themes=['sunlit','drafting','evening','garden','paper'];
async function boot(page:Page,theme:number,count=4,mode='battle') {
  await page.addInitScript(index=>{
    localStorage.setItem('bricks-war:language:v1','en');
    localStorage.setItem('bricks-war:player-names:v1',JSON.stringify(['Alex','Player 2','Player 3','Player 4']));
    const original=crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues=((array:Uint32Array)=>{
      if(array instanceof Uint32Array&&array.length===1){array[0]=Math.floor((index+.1)/5*0x100000000);return array;}
      return original(array);
    }) as typeof crypto.getRandomValues;
  },theme);
  await page.goto('/?muted=1&playtest-board-events=1&playtest-clear=normal-2');
  await openLocalLobby(page,mode);
  while(await page.locator('.lobby-card:not(.is-empty)').count()<count){
    await page.locator('[data-bot]').first().click();await page.locator('[data-level="easy"]').click();
  }
  await page.locator('#start-match').click();
  await expect(page.locator('.match-loading')).toHaveCount(0);
  await expect(page.locator('#countdown')).toBeHidden();
  await expect(page.locator('#arena-event-notice')).toBeHidden();
  await expect(page.locator('.arena-screen')).toHaveAttribute('data-match-background',themes[theme]!);
}
async function capture(page:Page,name:string,count:number){
  const inspect=()=>page.evaluate(async()=>{
    const arena=document.querySelector<HTMLElement>('.arena-screen')!,hud=document.querySelector<HTMLElement>('#hud-grid')!;
    const style=getComputedStyle(arena),cards=[...arena.querySelectorAll<HTMLElement>('.hud-card')];
    const rect=(e:Element)=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
    const overlap=(a:ReturnType<typeof rect>,b:ReturnType<typeof rect>)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1;
    const boxes=cards.map(rect),issues:string[]=[];
    boxes.forEach((r,i)=>{if(r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1)issues.push('field clipped');if(boxes.slice(i+1).some(b=>overlap(r,b)))issues.push('fields overlap');});
    for(const element of arena.querySelectorAll<HTMLElement>('.hud-identity strong,.hud-stats b'))if(element.scrollWidth>element.clientWidth+1||element.scrollHeight>element.clientHeight+1)issues.push('label clipped');
    const image=new Image();image.src=style.getPropertyValue('--match-background-image').trim().slice(5,-2);await image.decode();
    return {theme:arena.dataset.matchBackground,background:style.backgroundImage,backgroundSize:style.backgroundSize,blend:style.backgroundBlendMode,issues,width:hud.clientWidth,height:hud.clientHeight,cell:Number(hud.dataset.cellSize),header:parseFloat(hud.style.getPropertyValue('--arena-header-height')),mobile:arena.classList.contains('mobile-solo-arena'),image:[image.naturalWidth,image.naturalHeight],boxes};
  });
  await expect.poll(async()=>{const r=await inspect();return {issues:r.issues,geometry:r.mobile||r.cell===chooseLocalArenaLayout(r.width,r.height,count,r.header).cellSize};}).toEqual({issues:[],geometry:true});
  const result=await inspect();
  expect(result.issues).toEqual([]);expect(result.background).toContain(`${result.theme}.webp`);expect(result.backgroundSize).toContain('cover');
  await expect(page.locator('.arena-backdrop,.arena-horizontal-art,.arena-foliage')).toHaveCount(0);
  if(!result.mobile)expect(result.cell).toBe(chooseLocalArenaLayout(result.width,result.height,count,result.header).cellSize);
  const dir=process.env.BRICKS_LOBBY_EVIDENCE!;await mkdir(dir,{recursive:true});
  await writeFile(join(dir,name+'.json'),JSON.stringify(result,null,2));await page.screenshot({path:join(dir,name+'.png')});
  return result;
}
for(const [index,theme]of themes.entries())test(`cube-free ${theme} keeps board geometry and survives resize`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:960});await boot(page,index);await capture(page,theme+'-four',4);
  await page.setViewportSize({width:1280,height:480});await capture(page,theme+'-sides',4);
  await page.setViewportSize({width:1280,height:720});await capture(page,theme+'-dense',4);
  await expect(page.locator('.arena-screen')).toHaveAttribute('data-match-background',theme);
  await page.keyboard.press('Escape');await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.locator('#continue-match').click();await expect(page.locator('#pause-overlay')).toBeHidden();
  await expect(page.locator('.arena-screen')).toHaveAttribute('data-match-background',theme);expect(errors).toEqual([]);
});
for(const index of [0,2,3])test(`phone cube-free ${themes[index]}`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await boot(page,index);await capture(page,themes[index]+'-phone',4);
  await expect(page.locator('.mobile-touch-zones')).toBeVisible();
});
test('single-player and team arenas retain geometry and identity',async({page})=>{
  await page.setViewportSize({width:1440,height:960});await boot(page,0,1,'survival');await capture(page,'sunlit-solo',1);
  await boot(page,3,4,'team-battle');const result=await capture(page,'garden-teams',4);
  expect(result.background).toContain('linear-gradient');expect(result.blend).toContain('color');
  await expect(page.locator('.arena-screen')).toHaveClass(/has-team-surface/);
});

test('controller-started match retains the selected scene',async({page})=>{
  await page.setViewportSize({width:1440,height:960});
  await page.addInitScript(()=>{
    localStorage.setItem('bricks-war:language:v1','en');
    const pad={index:0,id:'Background QA pad',mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false})),timestamp:0};
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});Object.assign(window,{backgroundQaPad:pad});
  });
  const pulse=async(button:number)=>{
    await page.evaluate(button=>{(window as any).backgroundQaPad.buttons[button].pressed=true;},button);await page.waitForTimeout(110);
    await page.evaluate(button=>{(window as any).backgroundQaPad.buttons[button].pressed=false;},button);await page.waitForTimeout(110);
  };
  await page.goto('/?muted=1&playtest-board-events=1&playtest-clear=normal-2');await expect(page.locator('[data-play-entry]')).toBeVisible();await pulse(0);
  await expect(page.locator('.unified-lobby')).toHaveAttribute('data-menu-owner','gamepad-0');
  for(let count=2;count<=4;count++){await pulse(2);await expect(page.locator('[data-level].pad-selected')).toBeVisible();await pulse(0);await expect(page.locator('.lobby-card:not(.is-empty)')).toHaveCount(count);}
  await pulse(9);await expect(page.locator('.arena-screen')).toBeVisible();await expect(page.locator('.match-loading')).toHaveCount(0);
  await expect(page.locator('#countdown')).toBeHidden();await expect(page.locator('#arena-event-notice')).toBeHidden();
  await expect(page.locator('#app')).toHaveAttribute('data-input-mode','gamepad');await capture(page,'controller',4);
});

test('restart selects a new scene while the current match stays stable',async({page})=>{
  await page.setViewportSize({width:1440,height:960});await boot(page,0,4,'battle');
  await page.keyboard.press('Escape');await expect(page.locator('#pause-overlay')).toBeVisible();
  await expect(page.locator('.arena-screen')).toHaveAttribute('data-match-background','sunlit');
  await page.evaluate(()=>{
    const original=crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues=((array:Uint32Array)=>{if(array instanceof Uint32Array&&array.length===1){array[0]=Math.floor(.3*0x100000000);return array;}return original(array);}) as typeof crypto.getRandomValues;
  });
  await page.locator('#restart-match').click();await expect(page.locator('.match-loading')).toHaveCount(0);
  await expect(page.locator('#countdown')).toBeHidden();
  await expect(page.locator('.arena-screen')).toHaveAttribute('data-match-background','drafting');
});
