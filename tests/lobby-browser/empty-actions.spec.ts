import { openLocalLobby } from '../helpers/localLobby';
import {test,expect} from '@playwright/test';
const evidence=process.env.BRICKS_LOBBY_EVIDENCE ?? 'evidence/align-empty-actions/runtime';
for(const locale of ['ru','en'])for(const [width,height] of [[1440,960],[1280,480],[390,844],[360,800]])test(`empty actions share icon and text columns ${locale} ${width}`,async({page})=>{
 await page.setViewportSize({width:width!,height:height!});await page.addInitScript(locale=>localStorage.setItem('bricks-war:language:v1',locale),locale);
 await page.goto('/?muted=1');await openLocalLobby(page,'battle');
 const card=page.locator('.lobby-card.is-empty').first();await expect(card.locator('button')).toHaveCount(2);
 const positions=await card.evaluate(card=>{
  const box=card.getBoundingClientRect(),plus=card.querySelector('.lobby-plus')!.getBoundingClientRect();
  const rows=[...card.querySelectorAll<HTMLButtonElement>('button')].map(button=>{
   const r=button.getBoundingClientRect(),key=button.querySelector('kbd')!.getBoundingClientRect();
   const text=[...button.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent!.trim())!;
   const range=document.createRange();range.selectNodeContents(text);const label=range.getBoundingClientRect();
   return {left:r.left,icon:key.left,text:label.left,right:r.right,top:r.top,bottom:r.bottom,clipped:button.scrollWidth>button.clientWidth+1};
  });return {rows,center:(box.left+box.right)/2,plus:(plus.left+plus.right)/2,box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom}};
 });
 expect(positions.rows[0]!.left).toBe(positions.rows[1]!.left);
 expect(positions.rows[0]!.icon).toBe(positions.rows[1]!.icon);
 expect(positions.rows[0]!.text).toBeCloseTo(positions.rows[1]!.text,1);
 expect(positions.plus).toBeCloseTo(positions.center,1);
 expect(positions.rows.every(r=>!r.clipped&&r.left>=positions.box.left&&r.right<=positions.box.right&&r.top>=positions.box.top&&r.bottom<=positions.box.bottom)).toBe(true);
 await page.screenshot({path:`${evidence}/actions-${locale}-${width}.png`,fullPage:true});
});
