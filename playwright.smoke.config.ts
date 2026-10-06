import { defineConfig } from '@playwright/test';

// Existing assertions, current source, one owned origin; no stale dist reuse.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['desktop-fit.spec.ts', 'mobile-release-parity.spec.ts'],
  grep: /(all desktop screens fit (1440x960|1280x480)|keeps the supported phone release flow touch-accessible|explains phone controls and omits desktop-only fullscreen settings)$/,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4187',
    viewport: { width: 1440, height: 960 },
    channel: 'chrome',
    launchOptions: { args: ['--mute-audio'] },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4187 --strictPort',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: false,
  },
});
