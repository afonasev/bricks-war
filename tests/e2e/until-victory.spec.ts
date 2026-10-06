import { expect, test, type Page } from '@playwright/test';

async function chooseVictory(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: 'Длительность матча', exact: true }).click();
  await page.getByRole('option', { name: /До победы$/ }).click();
  await expect(page.locator('#match-duration')).toHaveValue('until-victory');
}

for (const mode of ['Битва', 'Командный бой']) {
  test(`${mode} supports until-victory with a growing active clock and pause`, async ({ page }) => {
    await page.goto('/?muted=1');
    await page.getByRole('button', { name: new RegExp(`^${mode}`) }).click();
    if (mode === 'Командный бой') {
      const addAi = page.getByRole('button', { name: 'Добавить ИИ', exact: true });
      while (await addAi.count()) await addAi.first().click();
    }
    await chooseVictory(page);
    await expect(page.getByText(mode === 'Командный бой' ? 'До последней команды; одновременно — по очкам' : 'До последнего выжившего; одновременно — по очкам', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: new RegExp(`^${mode}`) }).click();
    await expect(page.locator('#match-duration')).toHaveValue('until-victory');
    await page.getByRole('button', { name: 'Начать' }).click();
    await expect(page.locator('#round-timer')).toHaveAttribute('aria-label', 'Прошедшее время матча');
    await expect(page.locator('#match-clock')).toHaveText('00:02', { timeout: 10000 });
    await page.locator('#manual-pause').click();
    const time = await page.locator('#match-clock').textContent();
    await page.waitForTimeout(1200);
    await expect(page.locator('#match-clock')).toHaveText(time!);
    await page.locator('#continue-match').click();
    await expect(page.locator('#match-clock')).not.toHaveText(time!);
  });
}

test('phone Battle selects until-victory and displays an increasing timer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?muted=1');
  await page.getByRole('button', { name: /^Битва/ }).click();
  await chooseVictory(page);
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('#mobile-match-timer')).toHaveAttribute('aria-label', 'Прошедшее время матча');
  await expect(page.locator('#mobile-match-timer')).toHaveText('00:02', { timeout: 10000 });
  await expect(page.locator('.hud-card')).toHaveCount(2);
});

test('simultaneous final elimination explains the score exception and Repeat keeps the policy', async ({ page }) => {
  test.setTimeout(50000);
  await page.goto('/?muted=1&playtest-fast=20');
  await page.getByRole('button', { name: /^Битва/ }).click();
  const removeAi = page.locator('[data-remove-slot="2"]');
  if (await removeAi.count()) await removeAi.click();
  await chooseVictory(page);
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('#results-title')).toHaveText('Одновременное выбывание', { timeout: 36000 });
  await expect(page.locator('.results-panel')).toContainText('Последние соперники выбыли одновременно');
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.locator('#round-timer')).toHaveAttribute('aria-label', 'Прошедшее время матча');
});
