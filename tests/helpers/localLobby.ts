import { expect,type Page } from '@playwright/test';
/** User route: one Play entry, then the existing lobby mode switch. */
export async function openLocalLobby(page: Page, requested = 'battle'): Promise<void> {
    const aliases: Record<string,string> = {'Кто больше':'survival','Выживание':'survival','Битва':'battle','Командный бой':'team-battle'};
    const mode = aliases[requested] ?? requested;
    await page.locator('[data-play-entry]').click();
    const lobby = page.locator('.unified-lobby'); await expect(lobby).toBeVisible();
    for(let i=0;i<3 && await lobby.getAttribute('data-mode')!==mode;i++) await page.locator('[data-cycle-mode]').click();
    await expect(lobby).toHaveAttribute('data-mode',mode);
}
