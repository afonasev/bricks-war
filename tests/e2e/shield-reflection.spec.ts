import { expect, test, type Page } from '@playwright/test';

async function start(page: Page, rows: number, capture?: number) {
  await page.goto(`/?muted=1&playtest-shield-impact=1&playtest-shield-rows=${rows}${capture === undefined ? '' : `&playtest-shield-capture=${capture}`}`);
  await page.getByRole('button', {name:/^Выживание/}).click();
  const remove = page.getByRole('button',{name:'Удалить Игрок 2'});
  if (await remove.count()) await remove.click();
  await page.locator('#start-match').click();
}

test('shows shield first, then exactly the unabsorbed rows without a blocked text notice', async ({page}) => {
  await start(page,4);
  const card = page.locator('.hud-card').first();
  await expect.poll(async () => Number(await card.getAttribute('data-shield-remaining-ms'))).toBeGreaterThan(0);
  await expect(card).toHaveAttribute('data-gray-rows','0');
  await expect(card).toHaveAttribute('data-shield-debt','3');
  await expect(page.locator('[data-event-kind="shield-block"]')).toHaveCount(0);
  await expect(card).toHaveAttribute('data-gray-rows','3');
  await expect(card).toHaveAttribute('data-shield-debt','0');
});

test('full absorption keeps the real grid unchanged on phone with reduced motion', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await start(page,1);
  const card = page.locator('.hud-card').first();
  await expect.poll(async () => Number(await card.getAttribute('data-shield-remaining-ms'))).toBeGreaterThan(0);
  await expect(card).toHaveAttribute('data-gray-rows','0');
  await expect(card).toHaveAttribute('data-shield-remaining-ms','0');
  await expect(card).toHaveAttribute('data-gray-rows','0');
  await expect(page.getByText('Сработал щит!',{exact:true})).toHaveCount(0);
});

test('freezes and resumes the residual debt with ordinary pause', async ({page}) => {
  await start(page,4);
  const card = page.locator('.hud-card').first();
  await expect.poll(async () => Number(await card.getAttribute('data-shield-remaining-ms'))).toBeGreaterThan(0);
  await page.locator('#manual-pause').click();
  const remaining = await card.getAttribute('data-shield-remaining-ms');
  await page.waitForTimeout(800);
  await expect(card).toHaveAttribute('data-shield-remaining-ms',remaining!);
  await expect(card).toHaveAttribute('data-gray-rows','0');
  await page.locator('#continue-match').click();
  await expect(card).toHaveAttribute('data-gray-rows','3');
});
