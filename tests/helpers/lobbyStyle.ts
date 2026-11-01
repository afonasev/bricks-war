import {expect,type Page,type Locator} from '@playwright/test';
/** Select a style through the visible compact wheel, never hidden options. */
export async function chooseLobbyStyle(scope:Page|Locator,style:string):Promise<void>{
 const current=scope.locator('[data-style]');await expect(current).toHaveCount(1);
 for(let i=0;i<7&&await current.getAttribute('data-style')!==style;i++)await scope.locator('[data-wheel-down]').click();
 await expect(current).toHaveAttribute('data-style',style);await current.click();
}
