import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openLocalLobby } from '../helpers/localLobby';

const output = process.env.BRICKS_ANNOUNCEMENTS_OUTPUT ?? 'evidence/match-announcements/runtime';
const viewports = [
  { locale: 'ru', width: 1440, height: 960, controller: false },
  { locale: 'ru', width: 390, height: 844, controller: false },
  { locale: 'en', width: 320, height: 568, controller: false },
  { locale: 'en', width: 1280, height: 720, controller: true },
];
for (const item of viewports) for (const mode of ['survival', 'battle']) {
  test(`essential announcements ${mode} ${item.locale} ${item.width}`, async ({ page }) => {
    await page.setViewportSize(item);
    await page.addInitScript(({ locale, controller }) => {
      localStorage.setItem('bricks-war:language:v1', locale);
      if (controller) {
        const pad = { index: 0, id: 'Announcement QA Pad', connected: true, mapping: 'standard', axes: [0, 0],
          buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: 0 };
        Object.assign(window, { __announcementPad: pad });
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
      }
    }, item);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?muted=1&playtest-board-events=1');
    await openLocalLobby(page, mode);
    if (mode === 'battle') {
      await page.locator('#match-duration').click(); // Until victory -> timed two-minute match.
      await page.locator('[data-bot]').first().click();
      await page.locator('[data-level="easy"]').click();
    }
    await page.locator('#start-match').click();
    await expect(page.locator('.match-loading')).toHaveCount(0);
    await expect(page.locator('#countdown')).toBeVisible();
    await expect(page.locator('#countdown')).toHaveText(item.locale === 'ru' ? 'Готовы?' : 'Ready?');
    await mkdir(output, { recursive: true });
    const key = `${mode}-${item.locale}-${item.width}`;
    await page.screenshot({ path: `${output}/${key}-ready.png` });
    await expect(page.locator('#countdown')).toBeHidden();
    await expect(page.locator('#arena-event-notice')).toBeHidden();
    await expect(page.locator('.player-event-notice')).toHaveCount(0);
    // Cross the real pressure boundary; keep the simulation's own event hold and pause clocks.
    await page.evaluate(() => {
      const e = (window as any).__boardEffectsQA.engine;
      e.state.elapsedMs = e.state.pressureStartMs - 1;
      e.state.remainingMs = e.state.durationMs - e.state.elapsedMs;
    });
    const notice = page.locator('#arena-event-notice');
    await expect(notice).toBeVisible();
    const title = mode === 'survival'
      ? item.locale === 'ru' ? 'Фаза давления' : 'Pressure phase'
      : item.locale === 'ru' ? 'Финальный рывок' : 'Final push';
    await expect(notice.locator('.ready-label')).toHaveText(title);
    await expect(notice).toHaveText(title);
    await expect(notice).toHaveAttribute('aria-label', title);
    await expect(notice.locator('small,.arena-announcement-detail,.match-event-icon')).toHaveCount(0);
    await page.waitForTimeout(300);
    const layout = await notice.evaluate(element => {
      const parts = [...element.querySelectorAll<HTMLElement>('.ready-label,.ready-blocks')];
      const rects = parts.map(part => part.getBoundingClientRect());
      return {
        inside: rects.every(r => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight),
        readable: parts.every(p => p.scrollWidth <= p.clientWidth + 1 && p.scrollHeight <= p.clientHeight + 1),
        overlaps: rects.some((r, i) => rects.slice(i + 1).some(q =>
          Math.min(r.right, q.right) - Math.max(r.left, q.left) > 1 &&
          Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top) > 1)),
        metrics: parts.map(p => ({className: p.className, width:p.clientWidth, scrollWidth:p.scrollWidth, height:p.clientHeight, scrollHeight:p.scrollHeight})),
        outline: getComputedStyle(element.querySelector('.ready-label')!).webkitTextStrokeColor,
      };
    });
    await writeFile(`${output}/${key}.json`, JSON.stringify({ item, mode, title, layout, errors }, null, 2));
    await page.screenshot({ path: `${output}/${key}-announcement.png` });
    expect(layout.inside).toBe(true);
    expect(layout.readable).toBe(true);
    expect(layout.overlaps).toBe(false);
    expect(layout.outline).toBe('rgb(100, 51, 15)');
    if (item.controller) {
      await page.evaluate(() => { (window as any).__announcementPad.buttons[9].pressed = true; });
      await expect(page.locator('#pause-overlay')).toBeVisible();
      const frozen = await page.evaluate(() => (window as any).__boardEffectsQA.engine.state.globalEventHold.remainingMs);
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => (window as any).__boardEffectsQA.engine.state.globalEventHold.remainingMs)).toBe(frozen);
      await page.evaluate(() => { (window as any).__announcementPad.buttons[9].pressed = false; });
      await page.waitForTimeout(60);
      await page.locator('#continue-match').click();
    }
    await expect(notice).toBeHidden();
    // Survival starts a real three-second pressure warning at this same boundary.
    // Let that higher-priority outcome finish before sampling a separate cleanup.
    await expect(page.locator('.hud-card').first()).not.toHaveAttribute('data-event-kind', 'incoming-attack', { timeout: 8_000 });
    await page.evaluate(() => {
      const e = (window as any).__boardEffectsQA.engine;
      e.state.cleanupSerial++;
      e.state.cleanupEvents = [{ serial: e.state.cleanupSerial, participantId: e.state.participants[0].config.id, rows: 2, pulseMs: 800 }];
    });
    await expect(page.locator('.hud-card').first()).toHaveAttribute('data-event-kind', 'cleanup');
    await expect(page.locator('.player-event-notice')).toHaveCount(0);
    await expect(page.locator('.hud-card').first().locator('.player-event-symbol .match-event-icon')).toHaveAttribute('data-icon', 'cleanup');
    expect(errors).toEqual([]);
    await writeFile(`${output}/${key}.json`, JSON.stringify({ item, mode, title, layout, errors }, null, 2));
  });
}
