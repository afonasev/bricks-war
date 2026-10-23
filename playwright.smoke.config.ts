import { defineConfig } from '@playwright/test';

const rawPort = process.env.BRICKS_LOCAL_QA_PORT ?? '4187';
const localQaPort = Number(rawPort);
if (!/^[0-9]+$/.test(rawPort) || !Number.isInteger(localQaPort) || localQaPort < 1 || localQaPort > 65535) {
  throw new Error('BRICKS_LOCAL_QA_PORT must be an integer from 1 to 65535');
}
const origin = `http://127.0.0.1:${localQaPort}`;

// Existing assertions, current source, one owned origin; no stale dist reuse.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['desktop-fit.spec.ts', 'mobile-release-parity.spec.ts'],
  grep: /(all desktop screens fit (1440x960|1280x480)|keeps the supported phone release flow touch-accessible|explains phone controls and omits desktop-only fullscreen settings)$/,
  workers: 1,
  retries: 0,
  use: {
    locale: 'ru-RU', // Existing Russian-copy scenarios now declare their system preference explicitly.
    baseURL: origin,
    viewport: { width: 1440, height: 960 },
    channel: 'chrome',
    launchOptions: { args: ['--mute-audio'] },
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${localQaPort} --strictPort`,
    url: origin,
    reuseExistingServer: false,
  },
});
