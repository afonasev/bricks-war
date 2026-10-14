import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const out='evidence/resolution-dropdown';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
const results=[];
try {
 for(const [width,height] of [[1440,960],[1280,480],[390,844]]) {
  const page=await browser.newPage({viewport:{width,height}});
  await page.addInitScript(()=>{
   const state={width:1280,height:720,fullscreen:false,resolutions:[[960,540],[1280,720],[1440,900],[1600,900],[1920,1080],[2560,1440],[3840,2160]]};
   window.__displayCalls=[];
   window.bricksDesktop={display:async()=>state,setDisplay:async value=>{window.__displayCalls.push(value);Object.assign(state,value);return state;},updateState:async()=>({available:false,applying:false,error:false}),check:async()=>({available:false,applying:false,error:false}),apply:async()=>false,setSafeMenu:()=>{},healthy:async()=>{},exit:async()=>{}};
  });
  await page.goto('http://127.0.0.1:4187/?muted=1');
  await page.getByRole('button',{name:/Настройки/}).click();
  const wrapper=page.locator('#desktop-resolution + .menu-select');
  const trigger=wrapper.locator('[role=combobox]');
  if(width===390) await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const options=wrapper.locator('[role=option]');
  assert.equal(await options.count(),7);
  assert.equal(await wrapper.locator('.menu-select-pages').isVisible(),false);
  assert.equal(await options.evaluateAll(items=>items.every(item=>!item.hidden)),true);
  assert.equal(await wrapper.locator('.menu-select-value').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await options.evaluateAll(items=>items.every(item=>item.querySelector('strong').scrollWidth<=item.querySelector('strong').clientWidth)),true);
  const bounds=await wrapper.locator('[role=listbox]').boundingBox();
  assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1,JSON.stringify(bounds));
  await page.screenshot({path:`${out}/dropdown-${width}x${height}.png`});
  await options.filter({hasText:'3840 × 2160'}).click();
  assert.deepEqual(await page.evaluate(()=>window.__displayCalls),[{width:3840,height:2160,fullscreen:false}]);
  await trigger.press('Enter');
  await trigger.press('ArrowUp');
  await trigger.press('Escape');
  assert.equal(await page.locator('#desktop-resolution').inputValue(),'3840x2160');
  assert.equal(await page.evaluate(()=>window.__displayCalls.length),1);
  await trigger.press('Enter');
  await trigger.press('ArrowUp');
  await trigger.press('Enter');
  assert.equal(await page.locator('#desktop-resolution').inputValue(),'2560x1440');
  await trigger.evaluate(el=>el.dispatchEvent(new CustomEvent('menu-select-command',{detail:{command:'open'}})));
  await trigger.evaluate(el=>el.dispatchEvent(new CustomEvent('menu-select-command',{detail:{command:'next'}})));
  await trigger.evaluate(el=>el.dispatchEvent(new CustomEvent('menu-select-command',{detail:{command:'commit'}})));
  assert.equal(await page.locator('#desktop-resolution').inputValue(),'3840x2160');
  if(width===1440) {
   await page.locator('#open-controls .settings-icon').screenshot({path:`${out}/gamepad-centered.png`});
   await page.screenshot({path:`${out}/settings-centered.png`});
  }
  results.push({width,height,options:7,pager:false,viewportBounds:'passed',mouseCommit:'passed',keyboardCommitCancel:'passed',gamepadCommands:'passed'});
  await page.close();
 }
 await writeFile(`${out}/browser.json`,JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify(results));
} finally {await browser.close();}
