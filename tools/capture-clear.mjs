import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.BRICKS_CLEAR_BASE ?? 'http://127.0.0.1:5187';
const output = process.env.BRICKS_CLEAR_OUTPUT ?? path.resolve('artifacts/playtest/clear-presentation');
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const viewport of [
    { name: 'wide', width: 1280, height: 800 },
    { name: 'phone', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: 'no-preference',
      serviceWorkers: 'block',
    });
    try {
      for (const mode of ['normal', 'fire']) {
        for (let lines = 1; lines <= 4; lines += 1) {
          const page = await context.newPage();
          try {
            await page.goto(`${base}/?playtest-clear=${mode}-${lines}&muted=1`);
            await page.getByRole('button', { name: /Выживание/ }).click();
            const removeSecond = page.getByRole('button', { name: 'Удалить Игрок 2' });
            if (await removeSecond.count()) await removeSecond.click();
            await page.locator('#start-match').click();
            const score = [0, 100, 300, 500, 800][lines];
            await page.waitForFunction((expected) => document.querySelector('#hud-grid')?.textContent?.includes(`${expected} очков`), score, { timeout: 12_000 });
            const prefix = path.join(output, `${viewport.name}-${mode}-${lines}`);
            await page.waitForTimeout(mode === 'fire' ? 450 : 35);
            await page.screenshot({ path: `${prefix}-during.png` });
            if (mode === 'fire') await page.waitForTimeout(700);
            else await page.waitForTimeout(260);
            await page.screenshot({ path: `${prefix}-fall.png` });
            if (mode === 'fire') await page.waitForTimeout(450);
            else await page.waitForTimeout(350);
            await page.screenshot({ path: `${prefix}-after.png` });
            const text = await page.locator('#hud-grid').innerText();
            console.log(`${viewport.name} ${mode} ${lines}: ${text.replace(/\s+/g, ' ').slice(0, 95)}`);
          } finally {
            await page.close();
          }
        }
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
