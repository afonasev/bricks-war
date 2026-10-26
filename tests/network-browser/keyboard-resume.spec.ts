import {openNetworkProfile} from './menuHelpers';
import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
test('network resume releases menu navigation and restores authoritative keyboard movement',async({browser,baseURL})=>{
 const contexts=await Promise.all([0,1].map(()=>browser.newContext({baseURL,locale:'ru-RU',viewport:{width:1440,height:960}})));
 const [host,guest]=await Promise.all(contexts.map(c=>c.newPage()));const frames:{held:{left:boolean;right:boolean;down:boolean}}[]=[];
 host!.on('websocket',socket=>socket.on('framesent',frame=>{try{const m=JSON.parse(String(frame.payload));if(m.type==='input')frames.push(m);}catch{}}));
 try{
  for(const p of [host!,guest!]){await p.goto('/?muted=1');await p.locator('[data-network-entry]').click();}
  const room=`Keyboard resume ${Date.now()}`;await host!.locator('[data-net-action="create"]').click();await host!.locator('[name="roomName"]').fill(room);await host!.locator('#network-form button[type="submit"]').click();await openNetworkProfile(host!);await expect(host!.locator('#network-profile')).toBeVisible();
  await guest!.locator('.network-lobby').filter({hasText:room}).locator('[data-net-action^="join:"]').click();await guest!.locator('#network-form button[type="submit"]').click();
  for(const p of [host!,guest!]){await openNetworkProfile(p);await expect(p.locator('#network-profile')).toBeVisible();await p.locator('#network-controls + .menu-select [role="combobox"]').click();await p.getByRole('option',{name:'WASD',exact:true}).click();await p.locator('[data-net-action="ready"]').click();}
  await host!.locator('[data-net-action="start"]').click();const arena=host!.locator('.network-arena');await expect(arena).toHaveAttribute('data-phase','playing');await expect(arena).toHaveAttribute('data-preparation','0',{timeout:15000});
  await host!.keyboard.down('a');await expect.poll(()=>frames.some(f=>f.held.left)).toBe(true);await host!.keyboard.up('a');
  await host!.locator('[data-net-action="pause"]:visible').click();await expect(host!.locator('#network-pause')).toBeVisible();await host!.locator('[data-net-action="resume"]').click();await expect(arena).toHaveAttribute('data-phase','playing');
  frames.length=0;const before=Number(await arena.getAttribute('data-confirmed-x'));
  await host!.keyboard.down('d');await expect.poll(()=>frames.some(f=>f.held.right),{timeout:5000}).toBe(true);
  await expect.poll(async()=>Number(await arena.getAttribute('data-confirmed-x'))).toBeGreaterThan(before);await host!.keyboard.up('d');
  await expect.poll(()=>frames.at(-1)?.held.right).toBe(false);
 }finally{
  await writeFile(process.env.BRICKS_RESUME_INPUT_REPORT??'evidence/localize-network-journey/resume-input-frames.json',JSON.stringify(frames,null,2));
  for(const c of contexts)await c.close();
 }
});
