import { test, expect } from '@playwright/test';
for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 480 }, { width: 390, height: 844 }]) {
  test(`native update error, progress, retry and explicit apply fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      const qa = (window as any).__desktopQA = {
        state: { available: false, applying: false, error: true, phase: 'check-error' },
        checks: 0, applies: 0,
      };
      (window as any).bricksDesktop = {
        updateState: async () => ({ ...qa.state }),
        check: async () => {
          qa.checks++;
          if (qa.checks > 1) throw Error('Discovery repeated');
          return { ...qa.state };
        },
        download:async()=>{qa.state.phase='downloading';return {...qa.state};},cancel:async()=>{qa.state.phase='available';return {...qa.state};},setActivity:async()=>({...qa.state}),history:async()=>[],
        apply: async () => { qa.applies++; return true; }, setSafeMenu: () => {}, healthy: async () => {},
        display: async () => ({ width: 1280, height: 720, fullscreen: false }), exit: async () => {},
      };
    });
    await page.goto('/?muted=1');
    const button = page.locator('.client-update-button');
    await expect(button.locator('strong')).toHaveText('Проверка недоступна'); await expect(button).toBeDisabled();
    await expect(button.locator('small')).toHaveText('Не удалось проверить обновления. Следующая проверка — при запуске игры.');
    for (const phase of ['checking', 'downloading', 'check-error']) {
      await page.evaluate(phase => { (window as any).__desktopQA.state.phase = phase; }, phase);
      await expect(button.locator('strong')).toHaveText(phase === 'checking' ? 'Проверка…' : phase === 'downloading' ? 'Загрузка 0%' : 'Проверка недоступна');
      if (phase === 'downloading') { await expect(button).toBeEnabled();await expect(button.locator('small')).toHaveText('Отменить'); } else await expect(button).toBeDisabled();
      const issues = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll<HTMLElement>('.client-update-button, .client-update-status, .client-update-announcement')]
          .filter(e => !e.hidden && e.getClientRects().length);
        const issues: string[] = [];
        for (const node of nodes) {
          const r = node.getBoundingClientRect();
          if (r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1
            || node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1) issues.push(node.className);
          if (getComputedStyle(node).textOverflow === 'ellipsis') issues.push('ellipsis');
        }
        const controls = [...document.querySelectorAll<HTMLElement>('.main-menu-screen button, .main-menu-brand-row h1')]
          .filter(e => e.getClientRects().length && !e.hidden).map(e => ({ name: e.className, rect: e.getBoundingClientRect() }));
        for (const [a, { rect: x }] of controls.entries()) for (const [b, { rect: y }] of controls.entries()) {
          if (b <= a) continue;
          if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1
            && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1) issues.push('overlap');
        }
        return issues;
      });
      expect(issues).toEqual([]);
    }
    await page.screenshot({ path: `${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/align-game-template'}/error-${viewport.width}x${viewport.height}.png` });
    await page.evaluate(()=>{(window as any).__desktopQA.state={available:true,applying:false,error:false,phase:'ready'};});
    await expect(button.locator('strong')).toHaveText('Перезапустить'); await expect(button).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__desktopQA.applies)).toBe(0);
    await page.screenshot({ path: `${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/align-game-template'}/ready-${viewport.width}x${viewport.height}.png` });
    await button.click();
    await expect.poll(() => page.evaluate(() => (window as any).__desktopQA.applies)).toBe(1);
  });
}
