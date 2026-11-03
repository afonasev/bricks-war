import type { Page } from '@playwright/test';
/** Use the same visible category route as a player; wide layouts show all groups. */
export async function openPreferencesCategory(page: Page, category: string): Promise<void> {
 const tab=page.locator(`.preferences-tabs [aria-controls$="-panel-${category}"]`);
 if(await tab.isVisible()) await tab.click();
}
