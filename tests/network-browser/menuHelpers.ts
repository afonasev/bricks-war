import {expect,type Page} from '@playwright/test';
/** Personal controls moved into the own-card disclosure; exercise its real UI. */
export async function openNetworkProfile(page:Page):Promise<void> {
  const editor=page.locator('.network-personal-panel');
  await expect(editor).toHaveCount(1);
  if(!await editor.evaluate(e=>e.hasAttribute('open')))await editor.locator('summary').click();
  await expect(page.locator('#network-profile')).toBeVisible();
}
