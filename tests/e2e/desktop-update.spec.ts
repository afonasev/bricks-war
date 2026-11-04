import { test, expect } from '@playwright/test';
for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 480 }, { width: 390, height: 844 }]) {
  test(`native game never shows launcher update states at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      const qa = (window as any).__desktopQA = {
        state: { available: false, applying: false, error: true, phase: 'check-error' },
        checks: 0, applies: 0, downloads: 0,
      };
      (window as any).bricksDesktop = {
        updateState: async () => ({ ...qa.state }),
        check: async () => {
          qa.checks++;
          if (qa.checks > 1) throw Error('Discovery repeated');
          return { ...qa.state };
        },
        download:async()=>{qa.downloads++;qa.state.phase='downloading';return {...qa.state};},cancel:async()=>{qa.state.phase='available';return {...qa.state};},setActivity:async()=>({...qa.state}),history:async()=>[],
        apply: async () => { qa.applies++; return true; }, setSafeMenu: () => {}, healthy: async () => {},
        display: async () => ({ width: 1280, height: 720, fullscreen: false }), exit: async () => {},
      };
    });
    await page.goto('/?muted=1');
    // Supersedes the old in-menu update UI contract: every native update state
    // belongs to the pre-game launcher, including failure and prepared targets.
    const updateUI = page.locator('.client-update-button, .client-update-status, .client-update-announcement, .desktop-release-history');
    for (const phase of ['checking', 'available', 'downloading', 'verifying', 'paused', 'check-error', 'download-error', 'install-error', 'shell-required', 'ready']) {
      await page.evaluate(phase => { (window as any).__desktopQA.state = {available:true,applying:false,error:phase.endsWith('error'),phase,version:'9.9.9',currentVersion:'1.16.4'}; }, phase);
      await expect(updateUI).toHaveCount(0);
    }
    const issues = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLElement>('.main-menu-screen button, .main-menu-brand-row h1')]
        .filter(e => e.getClientRects().length && !e.hidden).map(e => ({name:e.className,rect:e.getBoundingClientRect()}));
      const issues: string[] = [];
      for (const {name,rect:r} of controls) if(r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1) issues.push(name);
      for(const [a,{rect:x}] of controls.entries()) for(const [b,{rect:y}] of controls.entries()) if(b>a&&Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1)issues.push('overlap');
      return issues;
    });
    expect(issues).toEqual([]);
    await expect.poll(() => page.evaluate(() => (window as any).__desktopQA.checks)).toBe(0);
    expect(await page.evaluate(() => (window as any).__desktopQA.applies)).toBe(0);
    expect(await page.evaluate(() => (window as any).__desktopQA.downloads)).toBe(0);
    await page.screenshot({path:`${process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/align-game-template'}/native-game-${viewport.width}x${viewport.height}.png`});
  });
}
