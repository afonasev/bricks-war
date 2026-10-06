import { expect, test, type Page } from '@playwright/test';

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  const list = page.getByRole('listbox', { name: label, exact: true });
  const item = list.getByRole('option', { name: new RegExp(`^${option}(?:\\.|$)`) });
  while (!(await item.isVisible())) await list.getByRole('button', { name: 'Следующие →', exact: true }).click();
  await item.click();
}
test('new defaults and independent Battle setup survive reload and other modes', async ({ page }) => {
  await page.goto('/?muted=1');
  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.locator('#match-duration')).toHaveValue('until-victory');
  await expect(page.locator('#attack-mode')).toHaveValue('all-opponents');
  await choose(page, 'Длительность матча', '7 мин');
  await choose(page, 'Режим атаки', 'Только лидеру');
  await choose(page, 'Сложность битвы', 'Спортивный');
  await choose(page, 'Стиль участника 1', 'Морские кристаллы');
  await page.getByRole('button', { name: '← Главное меню', exact: true }).click();
  await page.getByRole('button', { name: /^Выживание/ }).click();
  await page.getByRole('button', { name: '← Главное меню', exact: true }).click();
  await page.getByRole('button', { name: /^Командный бой/ }).click();
  await expect(page.locator('#match-duration')).toHaveValue('until-victory');
  await expect(page.locator('#attack-mode')).toHaveValue('all-opponents');
  await choose(page, 'Длительность матча', '9 мин');
  await choose(page, 'Режим атаки', 'Выключены');
  await page.reload();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.locator('#match-duration')).toHaveValue('7');
  await expect(page.locator('#attack-mode')).toHaveValue('hunt-leader');
  await expect(page.locator('#battle-difficulty')).toHaveValue('sport');
  await expect(page.locator('[data-tile-style="0"]')).toHaveValue('sea-crystals');
  await page.screenshot({ path: 'evidence/persist-match-settings/battle-restored.png' });
  await page.getByRole('button', { name: '← Главное меню', exact: true }).click();
  await page.getByRole('button', { name: /^Командный бой/ }).click();
  await expect(page.locator('#match-duration')).toHaveValue('9');
  await expect(page.locator('#attack-mode')).toHaveValue('off');
});

test('phone Battle preserves attack, duration and AI selections on reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?muted=1');
  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.locator('#match-duration')).toHaveValue('until-victory');
  await expect(page.locator('#attack-mode')).toHaveValue('all-opponents');
  await choose(page, 'Длительность матча', '3 мин');
  await choose(page, 'Режим атаки', 'Выключены');
  await choose(page, 'Соперники', '3 ИИ');
  await page.reload();
  await page.getByRole('button', { name: /^Битва/ }).click();
  await expect(page.locator('#match-duration')).toHaveValue('3');
  await expect(page.locator('#attack-mode')).toHaveValue('off');
  await expect(page.locator('[data-mobile-setting="aiCount"]')).toHaveValue('3');
  await page.screenshot({ path: 'evidence/persist-match-settings/phone-restored.png' });
});
