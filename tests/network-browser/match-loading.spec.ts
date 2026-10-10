import { expect, test, type Page } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

async function enter(page: Page): Promise<void> {
  await page.goto('/?muted=1'); await page.getByRole('button', { name: /^Сетевая игра/ }).click();
}
async function pick(page: Page, label: string, value: string): Promise<void> {
  await page.getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name: value, exact: true }).click();
}
async function observe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { added: 0, removed: 0, count: 0, countdown: '' };
    (window as any).__loading = state;
    new MutationObserver(records => {
      for (const r of records) {
        for (const n of r.addedNodes) if (n instanceof Element && n.matches('.match-loading')) { state.added = performance.now(); state.count++; }
        for (const n of r.removedNodes) if (n instanceof Element && n.matches('.match-loading')) { state.removed = performance.now(); state.countdown = document.querySelector('#network-countdown')?.textContent ?? ''; }
      }
    }).observe(document.body, { childList: true });
  });
}
for (const mode of ['Выживание', 'Битва', 'Командный бой']) {
  test(`shared loading preserves authoritative countdown and recovery in ${mode}`, async ({ browser, baseURL }) => {
    const contexts = await Promise.all([{ width: 1440, height: 960 }, { width: 390, height: 844 }].map(viewport => browser.newContext({ baseURL, viewport })));
    const [host, guest] = await Promise.all(contexts.map(c => c.newPage()));
    const errors: string[] = []; for (const p of [host!, guest!]) p.on('pageerror', error => errors.push(error.message));
    const modeId = mode === 'Выживание' ? 'solo' : mode === 'Битва' ? 'battle' : 'teams';
    const room = `Load ${modeId} ${Date.now()}`; const results: unknown[] = [];
    try {
      await enter(host!); await host!.getByRole('button', { name: 'Создать лобби', exact: true }).click();
      await host!.getByLabel('Название лобби').fill(room); await host!.getByLabel('Ваше имя', { exact: true }).fill('Создатель');
      if (mode !== 'Выживание') await pick(host!, 'Режим', mode); await host!.getByRole('button', { name: 'Создать', exact: true }).click();
      await expect(host!.getByRole('heading', { name: room })).toBeVisible();
      await enter(guest!); await guest!.locator('.network-lobby').filter({ hasText: room }).getByRole('button', { name: 'Войти', exact: true }).click();
      await guest!.getByLabel('Ваше имя', { exact: true }).fill('Участник'); await guest!.getByRole('button', { name: 'Войти', exact: true }).click();
      if (mode === 'Командный бой') for (let i = 1; i <= 2; i++) { await host!.getByRole('button', { name: 'Добавить ИИ', exact: true }).click(); await expect(host!.locator('[data-kind=ai]')).toHaveCount(i); }
      for (const p of [host!, guest!]) {
        await expect(p.getByRole('heading', { name: room })).toBeVisible(); await p.getByRole('button', { name: 'Готов', exact: true }).click(); await observe(p);
      }
      await host!.getByRole('button', { name: 'Начать', exact: true }).click();
      await expect(host!.locator('.match-loading')).toBeVisible(); await expect(guest!.locator('.match-loading')).toBeVisible();
      await mkdir('evidence/add-match-loading-screen/network', { recursive: true });
      if (mode === 'Выживание') await Promise.all([host!.screenshot({ path: 'evidence/add-match-loading-screen/network/loading-wide.png' }), guest!.screenshot({ path: 'evidence/add-match-loading-screen/network/loading-phone.png' })]);
      for (const p of [host!, guest!]) {
        await expect(p.locator('.match-loading')).toHaveCount(0);
        const timing = await p.evaluate(() => (window as any).__loading);
        expect(timing.count).toBe(1); expect(timing.removed - timing.added).toBeGreaterThanOrEqual(1_000);
        // One second of server countdown has elapsed, rather than a new local 3 being replayed.
        expect(Number(timing.countdown)).toBeGreaterThan(0);
        const credential = await p.evaluate(() => JSON.parse(localStorage.getItem('bricks-network-seat-v1')!));
        const response = await p.request.post(`${baseURL}/api/network/current`, { headers: { Origin: baseURL! }, data: { credential } });
        expect(response.ok()).toBe(true); const snapshot = await response.json();
        await writeFile(`evidence/add-match-loading-screen/network/diagnostic-${modeId}-${p === host ? 'host' : 'guest'}.json`, JSON.stringify({ timing, state: snapshot.state, tick: snapshot.tick }, null, 2));
        expect(snapshot.state.countdownMs).toBeLessThan(2_000);
        expect(Number(timing.countdown)).toBeLessThanOrEqual(2);
        results.push({ mode, timing, serverCountdownMs: snapshot.state.countdownMs });
      }
      await expect(host!.locator('.network-arena')).toHaveAttribute('data-phase', 'playing');
      // Existing same-match return path must reuse the canvas without another loading cycle.
      await guest!.evaluate(() => { (window as any).__canvas = document.querySelector('canvas'); });
      await guest!.getByRole('button', { name: 'Пауза', exact: true }).click();
      await expect(host!.getByRole('heading', { name: 'Матч на паузе' })).toBeVisible();
      await guest!.getByRole('button', { name: 'К списку', exact: true }).click(); await guest!.getByRole('button', { name: 'Вернуться', exact: true }).click();
      await expect(guest!.getByRole('heading', { name: 'Матч на паузе' })).toBeVisible();
      expect(await guest!.evaluate(() => document.querySelector('canvas') === (window as any).__canvas)).toBe(true);
      await expect(guest!.locator('.match-loading')).toHaveCount(0); expect(await guest!.evaluate(() => (window as any).__loading.count)).toBe(1);
      expect(errors).toEqual([]);
      await writeFile(`evidence/add-match-loading-screen/network/${mode === 'Выживание' ? 'survival' : mode === 'Битва' ? 'battle' : 'teams'}.json`, JSON.stringify({ results, errors }, null, 2));
    } finally { for (const context of contexts) await context.close(); }
  });
}
