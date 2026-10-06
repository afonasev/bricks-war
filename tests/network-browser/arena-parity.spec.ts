import { test, expect } from '@playwright/test';

test('ordinary arena surfaces retain complete network names and disjoint HUD across viewports', async ({ browser, baseURL }) => {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ baseURL, viewport: { width: 1600, height: 900 } })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const host = pages[0]!;
  const room = `Arena parity ${Date.now()}`;
  try {
    for (const page of pages) {
      await page.goto('/?muted=1');
      await page.getByRole('button', { name: 'Сетевая игра Выживание' }).click();
    }
    await host.getByRole('button', { name: 'Создать лобби', exact: true }).click();
    await host.getByLabel('Название лобби').fill(room);
    await host.getByLabel('Ваше имя', { exact: true }).fill('Константин Александрович Ерофеев');
    await host.getByRole('button', { name: 'Создать', exact: true }).click();
    for (const [index, page] of pages.slice(1).entries()) {
      await page.getByRole('button', { name: 'Обновить', exact: true }).click();
      await page.locator('.network-lobby').filter({ hasText: room }).getByRole('button', { name: 'Войти' }).click();
      await page.getByLabel('Ваше имя', { exact: true }).fill(`Александра Владивостокская ${index + 1}`);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
    }
    for (const page of pages) await page.getByRole('button', { name: 'Готов', exact: true }).click();
    await host.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(host.locator('.network-arena')).toHaveAttribute('data-phase', 'playing');
    for (const [width, height] of [[1600,900],[800,900],[1280,480],[360,800],[390,844],[844,390]]) {
      await host.setViewportSize({ width: width!, height: height! });
      await expect(host.locator('.network-field-card')).toHaveCount(4);
      await expect.poll(() => host.evaluate(() => {
        const visible = (element: Element) => element.getBoundingClientRect().width > 0;
        const rect = (element: Element) => element.getBoundingClientRect();
        const overlap = (a: DOMRect, b: DOMRect) => Math.min(a.right,b.right) - Math.max(a.left,b.left) > 1 && Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top) > 1;
        const cards = [...document.querySelectorAll<HTMLElement>('.network-field-card')];
        const chrome = [...document.querySelectorAll<HTMLElement>('button[data-net-action="pause"],.round-timer,#network-mobile-clock,.shield-inventory,.arena-brand')].filter(visible);
        for (const [index, card] of cards.entries()) {
          const r = rect(card);
          if (r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) return false;
          if (cards.slice(index + 1).some(other => overlap(r,rect(other)))) return false;
          const header = card.querySelector<HTMLElement>('.network-field-heading')!;
          const children = [...header.querySelectorAll<HTMLElement>('strong,.hud-stats,small')];
          for (const child of children) {
            const box = rect(child);
            if (child.scrollWidth > child.clientWidth + 1 || child.scrollHeight > child.clientHeight + 1 || box.bottom > rect(header).bottom + 1) return false;
          }
          for (let i = 0; i < children.length; i++) if (children.slice(i + 1).some(other => overlap(rect(children[i]!),rect(other)))) return false;
          if (chrome.some(control => overlap(r,rect(control)))) return false;
        }
        for (const [index, control] of chrome.entries()) if (chrome.slice(index + 1).some(other => overlap(rect(control),rect(other)))) return false;
        return true;
      })).toBe(true);
      await expect(host.locator('.network-own-card .hud-next-piece')).toBeVisible();
      await expect(host.locator('.network-own-card .hud-identity')).toHaveText('Константин Александрович Ерофеев');
    }
    await host.getByRole('button', { name: 'Пауза', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Матч на паузе' })).toBeVisible();
    await host.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(host.locator('.network-arena')).toHaveAttribute('data-phase', 'playing');
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
