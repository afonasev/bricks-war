import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const output = resolve('evidence/block-browser-actions');
await mkdir(output, { recursive: true });
const app = await electron.launch({ args: ['.'], env: { ...process.env,
  BRICKS_DESKTOP_QA_PROFILE: resolve('build/browser-interactions-profile'), BRICKS_DESKTOP_QA_OFFLINE: '1' } });
try {
  const page = await app.firstWindow();
  await page.locator('#desktop-exit').waitFor();
  const zoom = async () => app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.setZoomFactor(2);
    return { mode: contents.getZoomMode(), factor: contents.getZoomFactor() };
  });
  assert.deepEqual(await zoom(), { mode: 'disabled', factor: 1 });
  await page.keyboard.press('Control++');
  await page.keyboard.press('Meta+-');
  assert.deepEqual(await zoom(), { mode: 'disabled', factor: 1 });
  await page.reload();
  await page.locator('#desktop-exit').waitFor();
  assert.deepEqual(await zoom(), { mode: 'disabled', factor: 1 });
  await page.locator('[data-destination="survival"]').click();
  const name = page.getByLabel('Имя игрока 1');
  await name.fill('Проверка'); await name.focus();
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('Игрок');
  assert.equal(await name.inputValue(), 'Игрок');
  await page.screenshot({ path: `${output}/native-setup.png` });
  await writeFile(`${output}/native.json`, JSON.stringify({ zoom: await zoom(), reload: true, editing: true }, null, 2));
} finally { await app.close(); }
