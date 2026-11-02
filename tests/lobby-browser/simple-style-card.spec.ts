import {test,expect} from '@playwright/test';
for(const [width,height]of [[1440,960],[1280,480],[320,740],[390,844],[844,390]])test(`simple style card ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width:width!,height:height!});await page.addInitScript(()=>localStorage.setItem('bricks-war:language:v1','en'));await page.goto('/?muted=1');await page.locator('[data-play-entry]').click();const card=page.locator('[data-lobby-slot="0"]');await expect(card).toBeVisible();await card.scrollIntoViewIfNeeded();
 const positions=()=>card.evaluate(e=>{const r=e.getBoundingClientRect();return ['.lobby-card-mark','h2','.lobby-ready','.lobby-piece','.lobby-style-label'].map(s=>{const b=e.querySelector(s)!.getBoundingClientRect();return {x:b.left-r.left,y:b.top-r.top,w:b.width,h:b.height};});});
 async function centeredPreview(){
  const geometry=await card.evaluate(e=>{
   const c=e.getBoundingClientRect(),piece=e.querySelector('.lobby-piece')!.getBoundingClientRect();
   const selectors=['h2','.lobby-ready','.lobby-piece','.lobby-style-label','[data-wheel-up]','[data-wheel-down]'];
   const parts=selectors.flatMap(s=>[...e.querySelectorAll<HTMLElement>(s)]).map(el=>({selector:selectors.find(s=>el.matches(s)),r:el.getBoundingClientRect(),clipped:el.scrollWidth>el.clientWidth+1})).filter(p=>p.r.width&&p.r.height);
   return {mobile:document.querySelector('#app')!.getAttribute('data-layout')==='mobile',offset:Math.abs((piece.left+piece.right-c.left-c.right)/2),width:piece.width,height:piece.height,
    clipped:parts.filter(p=>p.clipped||p.r.left<c.left||p.r.right>c.right||p.r.top<c.top||p.r.bottom>c.bottom).map(p=>p.selector),
    overlaps:parts.flatMap((a,i)=>parts.slice(i+1).filter(b=>Math.min(a.r.right,b.r.right)>Math.max(a.r.left,b.r.left)+1&&Math.min(a.r.bottom,b.r.bottom)>Math.max(a.r.top,b.r.top)+1).map(b=>[a.selector,b.selector]))};
  });
  expect(geometry.offset).toBeLessThan(1);expect(geometry.clipped).toEqual([]);expect(geometry.overlaps).toEqual([]);
  if(geometry.mobile){expect(geometry.width).toBeGreaterThanOrEqual(144);expect(geometry.height).toBeGreaterThanOrEqual(96);}
 }
 await centeredPreview();
 const before=await positions(),tint=await card.evaluate(e=>getComputedStyle(e).backgroundImage),original=await card.locator('.lobby-style-label').innerText();await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/ready-${width}.png`});await card.click();await expect(card).toHaveClass(/is-style-editing/);await expect(card.locator('.lobby-editor-title,.lobby-theme-list,.lobby-theme-wheel>small')).toHaveCount(0);
 await centeredPreview();expect(await card.evaluate(e=>getComputedStyle(e).backgroundImage)).not.toBe(tint);const after=await positions();for(let i=0;i<before.length;i++)if(before[i]!.w>0)for(const key of ['x','y','w','h']as const)expect(after[i]![key]).toBeCloseTo(before[i]![key],0);
 await card.locator('.lobby-style-content').hover();await expect(card.locator('.lobby-style-content')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(card.locator('.lobby-style-content')).toHaveCSS('box-shadow','none');await expect(card.locator('.lobby-well')).toHaveCSS('background-image','none');await expect(card.locator('.lobby-well')).toHaveCSS('border-top-width','0px');const current=card.locator('[data-style]');
 if(width! > 760){await card.locator('[data-wheel-down]').hover();await expect(card.locator('[data-wheel-down]')).toHaveCSS('background-color','rgb(243, 246, 235)');await expect(card.locator('[data-wheel-down]')).toHaveCSS('box-shadow',/inset/);await expect(current).toHaveCSS('background-color','rgba(0, 0, 0, 0)');}
 const styles=new Set<string>();
 for(let i=0;i<7;i++){styles.add((await current.getAttribute('data-style'))!);const overflow=await card.locator('.lobby-style-content').evaluate(e=>e.scrollWidth>e.clientWidth+1);expect(overflow).toBe(false);await card.locator('[data-wheel-down]').click();}expect(styles.size).toBe(7);await expect(card.locator('.lobby-style-label')).toHaveText(original);
 for(let i=0;i<4;i++)await card.locator('[data-wheel-down]').click();await card.locator('.lobby-style-preview').evaluate(e=>Promise.all(e.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>null))));await page.screenshot({path:`${process.env.BRICKS_LOBBY_EVIDENCE}/editing-${width}.png`});await card.locator('[data-cancel]').click();await expect(card).not.toHaveClass(/is-editing/);await expect(card.locator('.lobby-style-label')).toHaveText(original);
 await card.click();await card.locator('[data-wheel-down]').click();const selected=await card.locator('.lobby-style-label').innerText();await current.click();await expect(card).not.toHaveClass(/is-editing/);await expect(card.locator('.lobby-style-label')).toHaveText(selected);
 // Keyboard uses the same wheel and atomic confirmation/cancellation as the pad.
 await card.click();const saved=await current.getAttribute('data-style');
 await page.keyboard.press('ArrowDown');expect(await current.getAttribute('data-style')).not.toBe(saved);
 await page.keyboard.press('ArrowUp');await expect(current).toHaveAttribute('data-style',saved!);
 await page.keyboard.press('ArrowDown');const keyboardChoice=await card.locator('.lobby-style-label').innerText();
 await expect(current).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(current).toHaveCSS('box-shadow','none');
 await page.keyboard.press('Enter');await expect(card).not.toHaveClass(/is-editing/);await expect(card.locator('.lobby-style-label')).toHaveText(keyboardChoice);
 await card.click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');await expect(card).not.toHaveClass(/is-editing/);await expect(card.locator('.lobby-style-label')).toHaveText(keyboardChoice);
});
