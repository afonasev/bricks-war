import { expect, test } from '@playwright/test';

test('centers desktop keyboard help diagrams and connects each mapped key to its own action', async ({ page }) => {
  const screenshots = process.env.BRICKS_RECORD_SCREENSHOTS;
  for (const viewport of [
    { width: 1440, height: 960, name: 'desktop-1440x960' },
    { width: 1280, height: 720, name: 'desktop-1280x720' },
    { width: 1280, height: 480, name: 'desktop-1280x480' },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?muted=1');
    await page.getByRole('button', { name: /^Настройки/ }).click();
    await page.getByRole('button', { name: 'Подробнее об управлении', exact: true }).click();
    await expect(page.locator('.keyboard-reference-card')).toHaveCount(2);
    await expect(page.locator('.keyboard-cluster.wasd kbd')).toHaveText(['W', 'A', 'S', 'D']);
    await expect(page.locator('.keyboard-cluster.arrows kbd')).toHaveText(['↑', '←', '↓', '→']);

    const result = await page.locator('.keyboard-reference').evaluate((reference) => {
      const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      const overlap = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
      const expected = { wasd: { rotate: 'W', left: 'A', right: 'D', drop: 'S' }, arrows: { rotate: '↑', left: '←', right: '→', drop: '↓' } } as const;
      const actionNames = { rotate: 'Повернуть', left: 'Влево', right: 'Вправо', drop: 'Ускорить падение' };
      const crosses = (a: number[], b: number[]) => {
        const [ax,ay,bx,by]=a as [number,number,number,number]; const [cx,cy,dx,dy]=b as [number,number,number,number];
        const side=(x1:number,y1:number,x2:number,y2:number,x3:number,y3:number)=>(x2-x1)*(y3-y1)-(y2-y1)*(x3-x1);
        return side(ax,ay,bx,by,cx,cy)*side(ax,ay,bx,by,dx,dy)<0 && side(cx,cy,dx,dy,ax,ay)*side(cx,cy,dx,dy,bx,by)<0;
      };
      const errors: string[] = [];
      const cards = Array.from(reference.querySelectorAll<HTMLElement>('.keyboard-reference-card'));
      const reports = cards.map(card => {
        const layout = card.dataset.keyboardCard as keyof typeof expected;
        const cardBox = rect(card); const diagramBox = rect(card.querySelector('.keyboard-help-stage')!);
        const centerDelta = Math.abs((diagramBox.left + diagramBox.right - cardBox.left - cardBox.right)/2);
        if (centerDelta>2) errors.push(`${layout}: diagram not centered`);
        if (diagramBox.left<cardBox.left-1 || diagramBox.right>cardBox.right+1 || diagramBox.top<cardBox.top-1 || diagramBox.bottom>cardBox.bottom+1) errors.push(`${layout}: diagram outside card`);
        const labels = Array.from(card.querySelectorAll<SVGTextElement>('.keyboard-help-label'));
        const visibleActions = Object.fromEntries(labels.map(label=>[label.dataset.actionLabel,label.textContent?.trim()]));
        if(JSON.stringify(visibleActions)!==JSON.stringify(actionNames)) errors.push(`${layout}: visible action names do not match`);
        const labelBoxes = labels.map(rect); const keys = Array.from(card.querySelectorAll<HTMLElement>('.keyboard-help-keys kbd'));
        const keyBoxes = keys.map(rect);
        for (let i=0;i<labelBoxes.length;i++) {
          const a=labelBoxes[i]!;
          if (a.left<cardBox.left-1 || a.right>cardBox.right+1 || a.top<cardBox.top-1 || a.bottom>cardBox.bottom+1) errors.push(`${layout}: label outside card`);
          if (keyBoxes.some(b=>overlap(a,b)) || labelBoxes.slice(i+1).some(b=>overlap(a,b))) errors.push(`${layout}: visible content overlaps`);
        }
        for (let i=0;i<keyBoxes.length;i++) if (keyBoxes.slice(i+1).some(b=>overlap(keyBoxes[i]!,b))) errors.push(`${layout}: keycaps overlap`);
        const lines=Array.from(card.querySelectorAll<SVGPathElement>('.keyboard-help-line'));
        const paths=lines.map(path=>{
          const key=path.dataset.key!; const action=path.dataset.action!;
          if (expected[layout][action as keyof typeof expected[typeof layout]]!==key) errors.push(`${layout}: ${action} linked to wrong key`);
          const nums=path.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number); const [x1,y1,x2,y2]=nums;
          const anchor=card.querySelector<SVGCircleElement>(`.keyboard-help-anchor[data-key="${key}"]`)!;
          if (x1!==Number(anchor.getAttribute('cx')) || y1!==Number(anchor.getAttribute('cy'))) errors.push(`${layout}: line does not start at key anchor`);
          const svg=card.querySelector<SVGSVGElement>('.keyboard-help-connections')!; const point=svg.createSVGPoint(); point.x=x1!;point.y=y1!;
          const keyLayer=card.querySelector<HTMLElement>('.keyboard-help-keys')!;
          if(Number(getComputedStyle(svg).zIndex)<=Number(getComputedStyle(keyLayer).zIndex)) errors.push(`${layout}: connector layer must paint above keycaps`);
          const p=point.matrixTransform(svg.getScreenCTM()!); const keyBox=rect(keys.find(k=>k.dataset.key===key)!);
          const edgeX=action==='left'?keyBox.left:action==='right'?keyBox.right:(keyBox.left+keyBox.right)/2;
          const edgeY=action==='rotate'?keyBox.top:action==='drop'?keyBox.bottom:(keyBox.top+keyBox.bottom)/2;
          if(Math.abs(p.x-edgeX)>2.5 || Math.abs(p.y-edgeY)>2.5) errors.push(`${layout}: ${action} connector (${p.x.toFixed(1)},${p.y.toFixed(1)}) misses ${key} edge (${edgeX.toFixed(1)},${edgeY.toFixed(1)})`);
          return {action,key,segment:[x1!,y1!,x2!,y2!]};
        });
        for(let i=0;i<paths.length;i++) if(paths.slice(i+1).some(other=>crosses(paths[i]!.segment,other.segment))) errors.push(`${layout}: connector lines cross`);
        if(paths.length!==4 || labels.length!==4) errors.push(`${layout}: expected four mapped actions`);
        const accessible=Array.from(card.querySelectorAll<HTMLElement>('.keyboard-help-accessibility li')).map(item=>item.textContent?.replace(/\s+/g,' ').trim());
        const expectedAccessible=['rotate','left','right','drop'].map(action=>`${expected[layout][action as keyof typeof expected[typeof layout]]} — ${actionNames[action as keyof typeof actionNames]}`);
        if(JSON.stringify(accessible)!==JSON.stringify(expectedAccessible)) errors.push(`${layout}: accessible key names or actions missing`);
        return {layout,centerDelta,paths,labels:labels.map(l=>l.textContent?.trim())};
      });
      if(overlap(rect(cards[0]!),rect(cards[1]!))) errors.push('keyboard cards overlap');
      const documentOverflow=document.documentElement.scrollWidth>innerWidth+1 || document.documentElement.scrollHeight>innerHeight+1;
      if(documentOverflow) errors.push('page overflows viewport');
      return {errors,reports,documentOverflow};
    });
    if(screenshots) await page.screenshot({path:`${screenshots}/${viewport.name}.png`});
    expect(result.errors, `${viewport.name}: ${JSON.stringify(result)}`).toEqual([]);
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto('/?muted=1');
  await page.getByRole('button',{name:/^Настройки/}).click();
  await page.locator('#open-controls').click();
  await expect(page.locator('[data-phone-controls-help]')).toBeVisible();
  await expect(page.locator('.keyboard-help-diagram')).toHaveCount(0);
  if(screenshots) await page.screenshot({path:`${screenshots}/phone-390x844.png`});
});
