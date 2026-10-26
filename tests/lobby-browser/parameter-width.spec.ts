import { openLocalLobby } from '../helpers/localLobby';
import {test,expect,type Page} from '@playwright/test';
const evidence=process.env.BRICKS_LOBBY_EVIDENCE ?? 'evidence/stable-parameter-width/runtime';
async function open(page:Page,locale:string){await page.addInitScript(locale=>localStorage.setItem('bricks-war:language:v1',locale),locale);await page.goto('/?muted=1');await openLocalLobby(page,'battle');await expect(page.locator('.lobby-cycle')).toHaveCount(3);}
async function geometry(page:Page){return page.locator('.lobby-settings').evaluate(root=>[...root.querySelectorAll('.mode-settings label,.lobby-cycle,.lobby-help,.lobby-mode')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}));}
async function readable(page:Page){const issues=await page.locator('.lobby-settings').evaluate(root=>{
 const controls=[...root.querySelectorAll<HTMLElement>('button')];
 const rects=controls.map(e=>e.getBoundingClientRect());
 return {clipped:controls.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.id||e.className),outside:rects.filter(r=>r.left<0||r.right>innerWidth+1).length,overlap:rects.flatMap((a,i)=>rects.slice(i+1).filter(b=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)).length};
});if(issues.overlap)console.log(await page.locator('.lobby-settings').evaluate(root=>[...root.querySelectorAll('button')].map(e=>({id:e.id||e.className,rect:e.getBoundingClientRect().toJSON()}))));expect(issues).toEqual({clipped:[],outside:0,overlap:0});}
for(const locale of ['ru','en'])for(const [width,height] of [[1440,960],[1280,480],[390,844],[360,800]])test(`parameter geometry stays fixed through every value ${locale} ${width}`,async({page})=>{
 await page.setViewportSize({width:width!,height:height!});await open(page,locale);const before=await geometry(page);
 for(const [id,count] of [['match-duration',10],['attack-mode',3],['battle-difficulty',3]] as const){for(let i=0;i<count;i++){await page.locator('#'+id).click();expect(await geometry(page)).toEqual(before);await readable(page);}}
 await page.locator('#attack-mode').click();await page.locator('#attack-mode').click();
 await page.screenshot({path:`${evidence}/stable-${locale}-${width}.png`,fullPage:true});
 await page.locator('[data-cycle-mode]').click();expect(await geometry(page)).toEqual(before);await readable(page);
});
for(const locale of ['fr','de','es','zh-Hans','ja'])test(`localized phone parameter geometry ${locale}`,async({page})=>{
 await page.setViewportSize({width:360,height:800});await open(page,locale);const before=await geometry(page);
 for(const [id,count] of [['match-duration',10],['attack-mode',3],['battle-difficulty',3]] as const)for(let i=0;i<count;i++){await page.locator('#'+id).click();expect(await geometry(page)).toEqual(before);await readable(page);}
});
