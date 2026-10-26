import { openLocalLobby } from '../helpers/localLobby';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { catalogs } from '../../src/i18n/catalogs';
import { LANGUAGE_NAMES, LOCALES, type Locale } from '../../src/i18n/locale';
// @ts-expect-error Test-only Node fixture has no TS declaration.
import { startClientUpdateServer } from '../helpers/clientUpdateServer.mjs';

const screenshots = process.env.BRICKS_CANDIDATE_EVIDENCE ?? 'evidence/localize-pwa-offline/screenshots';

async function selectLanguage(page: Page, locale: Locale) {
  await page.locator('.settings-language-section [data-menu-select-trigger]').click();
  await page.getByRole('option', { name: LANGUAGE_NAMES[locale], exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('[data-language]')).toHaveValue(locale);
}

for (const locale of LOCALES) test(`PWA install guidance is localized and fits ${locale}`, async ({ browser }) => {
  const context = await browser.newContext({ locale: locale === 'zh-Hans' ? 'zh-CN' : `${locale}-XX`, viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  try {
    await page.goto('/?muted=1&pwa-install-hint=1');
    await page.locator('[data-destination="settings"]').click();
    await selectLanguage(page, locale);
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
      return { href: link.getAttribute('href'), data: await (await fetch(link.href)).json() as Record<string, unknown> };
    });
    expect(manifest.href).toBe(`./manifest-${locale}.webmanifest`);
    expect(manifest.data.lang).toBe(locale);
    expect(manifest.data.description).toBe(catalogs[locale].pwaManifestDescription);
    expect(manifest.data.start_url).toBe('./');
    expect(manifest.data.scope).toBe('./');
    expect(manifest.data).not.toHaveProperty('id');
    await page.locator('#settings-back').click();

    const hint = page.locator('.pwa-install-hint');
    await expect(hint).toBeVisible();
    const expected = catalogs[locale].pwaInstallBeforeShare + catalogs[locale].pwaShareAction
      + catalogs[locale].pwaInstallBetweenActions + catalogs[locale].pwaAddToHomeScreen + catalogs[locale].pwaInstallAfterActions;
    await expect(hint.locator('p')).toHaveText(expected);
    const dismiss = hint.locator('[data-dismiss-pwa-hint]');
    await expect(dismiss).toHaveAttribute('aria-label', catalogs[locale].pwaInstallDismissAria);

    await mkdir(screenshots, { recursive: true });
    for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 480 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const layout = await hint.evaluate(element => {
        const box = element.getBoundingClientRect();
        const text = element.querySelector('p')!;
        const firstChoice = document.querySelector('[data-destination="survival"]')!.getBoundingClientRect();
        return {
          inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
          textFits: text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 1,
          clearOfMenu: box.bottom <= firstChoice.top || box.top >= firstChoice.bottom || box.right <= firstChoice.left || box.left >= firstChoice.right,
        };
      });
      expect(layout.inside).toBe(true);
      expect(layout.textFits).toBe(true);
      expect(layout.clearOfMenu).toBe(true);
      await page.screenshot({ path: `${screenshots}/${locale}-${viewport.width}x${viewport.height}.png` });
    }

    await dismiss.click();
    await expect(hint).toHaveCount(0);
    await page.goto('/?muted=1');
    await expect(page.locator('.pwa-install-hint')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
  } finally {
    await context.close();
  }
});

test('production shell keeps selected language and player data through offline reload and online recovery', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/?muted=1');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.locator('[data-destination="settings"]').click();
  await selectLanguage(page, 'ja');
  await page.locator('#settings-back').click();
  await openLocalLobby(page,'survival');
  await page.locator('[data-player-name="0"]').fill('Offline QA name');
  await page.locator('#start-match').click();
  await expect(page.locator('.arena-screen')).toBeVisible();
  const savedName = await page.evaluate(() => localStorage.getItem('bricks-war:player-names:v1'));
  expect(savedName).toContain('Offline QA name');

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  const offlineManifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
    return { href: link.getAttribute('href'), data: await (await fetch(link.href)).json() as Record<string, unknown> };
  });
  expect(offlineManifest.href).toBe('./manifest-ja.webmanifest');
  expect(offlineManifest.data.lang).toBe('ja');
  expect(offlineManifest.data.description).toBe(catalogs.ja.pwaManifestDescription);
  await expect(page.locator('[data-destination="survival"]')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('bricks-war:language:v1'))).toBe('ja');
  expect(await page.evaluate(() => localStorage.getItem('bricks-war:player-names:v1'))).toBe(savedName);
  await openLocalLobby(page,'survival');
  await expect(page.locator('[data-player-name="0"]')).toHaveValue('Offline QA name');
  await page.locator('#start-match').click();
  await expect(page.locator('.arena-screen')).toBeVisible();

  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  expect(await page.evaluate(() => localStorage.getItem('bricks-war:player-names:v1'))).toBe(savedName);
  await openLocalLobby(page,'survival');
  await expect(page.locator('[data-player-name="0"]')).toHaveValue('Offline QA name');
});

test('a staged worker applies only after the explicit update click and stays available offline', async ({ page, context }) => {
  const updateServer = await startClientUpdateServer();
  try {
    updateServer.setRelease('A');
    await page.goto(`${updateServer.origin}/?muted=1`);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.evaluate(() => localStorage.setItem('bricks-war:language:v1', 'fr'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    updateServer.setRelease('B');
    await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting))).toBe(true);
    await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'A');
    const manifestBeforeApply = await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
      return (await (await fetch(link.href)).json() as Record<string, unknown>).lang;
    });
    expect(manifestBeforeApply).toBe('fr');
    await page.getByRole('button', { name: catalogs.fr.updateAction, exact: true }).click();
    await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'B');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('meta[name="qa-release"]')).toHaveAttribute('content', 'B');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  } finally {
    await updateServer.close();
  }
});
