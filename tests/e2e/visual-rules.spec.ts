import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

for (const viewport of [{width:1440,height:960},{width:1280,height:480},{width:390,height:844},{width:360,height:640},{width:844,height:390},{width:800,height:620}]) {
  test(`illustrated rules navigation and all cards fit ${viewport.width}x${viewport.height}`, async ({page}) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto('/');
    await page.locator('[data-destination="settings"]').click();
    await page.locator('#open-rules').click();
    await expect(page.locator('#rules-progress')).toHaveText('1 / 8');
    await expect(page.locator('#rules-prev')).toBeDisabled();
    await expect(page.locator('[data-rule-topic]')).toHaveCount(8);
    const allContent = await page.locator('#rules-card').innerText();
    expect(allContent).toContain('Собери полный ряд');
    expect(allContent).not.toContain('Огненная фигура');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#rules-progress')).toHaveText('1 / 8');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#rules-progress')).toHaveText('2 / 8');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#rules-progress')).toHaveText('1 / 8');
    await mkdir('evidence/add-visual-rules/rework-f2/screenshots', {recursive:true});
    const deckText: string[] = [];
    for (let i=0;i<8;i++) {
      await page.locator(`[data-rule-topic="${i}"]`).click();
      await expect(page.locator('#rules-progress')).toHaveText(`${i+1} / 8`);
      await expect(page.locator('.rules-art svg')).toHaveCount(1);
      deckText.push(await page.locator('#rules-card').innerText());
      const layout = await page.locator('.rules-screen').evaluate(screen=>{
        const items = [...screen.querySelectorAll<HTMLElement>('.rules-heading,.rules-art,.rules-copy,.rules-topics,.rules-navigation')];
        const rects = items.map(item=>item.getBoundingClientRect());
        const outside = rects.filter(r=>r.left < -1 || r.top < -1 || r.right > innerWidth+1 || r.bottom > innerHeight+1).length;
        const overlaps = rects.flatMap((a,i)=>rects.slice(i+1).filter(b=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1 && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)).length;
        const clipped = [...screen.querySelectorAll<HTMLElement>('h2,p,li,button')].filter(el=>el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+1).map(el=>el.textContent);
        const svg = screen.querySelector('svg')!;
        const view = svg.getBoundingClientRect();
        const svgOverflow = [...svg.querySelectorAll('text')].filter(el=>{const r=el.getBoundingClientRect();return r.left<view.left-1 || r.top<view.top-1 || r.right>view.right+1 || r.bottom>view.bottom+1;}).map(el=>el.textContent);
        return {svgOverflow,outside,overlaps,clipped,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1};
      });
      expect(layout,`card ${i+1}`).toEqual({svgOverflow:[],outside:0,overlaps:0,clipped:[],horizontalOverflow:false});
      await page.screenshot({path:`evidence/add-visual-rules/rework-f2/screenshots/${viewport.width}x${viewport.height}-card-${i+1}.png`});
    }
    const fullDeck = deckText.join('\n');
    expect(fullDeck).toContain('Очищай ряды — атакуй');
    expect(fullDeck).toContain('Две очистки подряд дают щит');
    expect(fullDeck).toContain('Аномалия — необычная фигура');
    const topicLabels = await page.locator('[data-rule-topic]').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label') ?? ''));
    expect(topicLabels.join(' ')).not.toContain('Выживание');
    expect(topicLabels.join(' ')).not.toContain('Финал Битвы');
    expect(topicLabels.join(' ')).not.toContain('Команды и сеть');
    expect(fullDeck).not.toContain('Огненная фигура');
    await expect(page.locator('#rules-next')).toBeDisabled();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#rules-progress')).toHaveText('8 / 8');
    await page.locator('#rules-prev').click();
    await expect(page.locator('#rules-progress')).toHaveText('7 / 8');
    await page.locator('#rules-next').click();
    await expect(page.locator('#rules-progress')).toHaveText('8 / 8');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen="settings"]')).toBeVisible();
    await page.locator('#open-rules').click();
    await expect(page.locator('#rules-progress')).toHaveText('1 / 8');
    await page.locator('#rules-back').click();
    await expect(page.locator('[data-screen="settings"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
