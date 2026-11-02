import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

test('network scene loads on desktop/phone and survives pause and resize',async({browser,baseURL})=>{
  const contexts=await Promise.all([browser.newContext({baseURL,viewport:{width:1440,height:960}}),browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true})]);
  const [host,guest]=await Promise.all(contexts.map(c=>c.newPage()));
  const errors:string[]=[];const room=`Background QA ${Date.now()}`;
  const out=process.env.BRICKS_BACKGROUND_NETWORK_EVIDENCE!;await mkdir(out,{recursive:true});
  try{
    for(const page of [host!,guest!]){
      page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('bricks-war:language:v1','en'));
      await page.goto('/?muted=1');await page.locator('[data-network-entry]').click();
    }
    await host!.locator('[data-net-action="create"]').click();
    await host!.locator('#network-form textarea[name="roomName"]').fill(room);
    await host!.locator('#network-form textarea[name="name"]').fill('Alex');
    await host!.locator('#network-form button[type="submit"]').click();
    await guest!.locator('[data-net-action="retry"]').click();
    await guest!.locator('.network-lobby').filter({hasText:room}).locator('[data-net-action^="join:"]').click();
    await guest!.locator('#network-form input[name="name"]').fill('Sam');
    await guest!.locator('#network-form button[type="submit"]').click();
    for(const page of [host!,guest!])await page.locator('[data-net-action="ready"]').click();
    await host!.locator('[data-net-action="start"]').click();
    const themes:string[]=[];
    for(const [index,page]of [host!,guest!].entries()){
      await expect(page.locator('.match-loading')).toHaveCount(0);
      await expect(page.locator('.network-arena')).toHaveAttribute('data-phase','playing');
      const geometry=await page.locator('.network-arena').evaluate(async arena=>{
        const style=getComputedStyle(arena),image=new Image();image.src=style.getPropertyValue('--match-background-image').trim().slice(5,-2);await image.decode();
        const cards=[...arena.querySelectorAll<HTMLElement>('.network-field-card')];
        const boxes=cards.map(c=>c.getBoundingClientRect());
        return {theme:(arena as HTMLElement).dataset.matchBackground,background:style.backgroundImage,image:[image.naturalWidth,image.naturalHeight],clipped:cards.some(c=>[...c.querySelectorAll<HTMLElement>('.hud-identity strong,.hud-stats')].some(e=>e.scrollWidth>e.clientWidth+1)),overlap:boxes.some((a,i)=>boxes.slice(i+1).some(b=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1))};
      });
      expect(geometry.theme).toMatch(/^(sunlit|drafting|evening|garden|paper)$/);expect(geometry.background).toContain(`${geometry.theme}.webp`);expect(geometry.overlap).toBe(false);expect(geometry.clipped).toBe(false);
      themes.push(geometry.theme!);await writeFile(join(out,index?'phone.json':'desktop.json'),JSON.stringify(geometry,null,2));await page.screenshot({path:join(out,index?'phone.png':'desktop.png')});
    }
    await host!.locator('[data-net-action="pause"]').first().click();await expect(host!.locator('.network-arena')).toHaveAttribute('data-phase','paused');
    await host!.locator('[data-net-action="resume"]').click();await expect(host!.locator('.network-arena')).toHaveAttribute('data-phase','playing');
    await host!.setViewportSize({width:1280,height:480});
    for(const [index,page]of [host!,guest!].entries())await expect(page.locator('.network-arena')).toHaveAttribute('data-match-background',themes[index]!);
    expect(errors).toEqual([]);
  }finally{await Promise.all(contexts.map(c=>c.close()));}
});
