import { defineConfig } from '@playwright/test';

const localQaPort = Number(process.env.BRICKS_LOCAL_QA_PORT ?? 4187);

export default defineConfig({
  testDir: './tests/e2e',
  workers: process.env.BRICKS_QA_WORKERS ? Number(process.env.BRICKS_QA_WORKERS) : undefined,
  use: {
    baseURL: `http://127.0.0.1:${localQaPort}`,
    viewport: { width: 1440, height: 960 },
    channel: 'chrome',
    launchOptions: { args: ['--mute-audio'] },
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${localQaPort}`,
    port: localQaPort,
    reuseExistingServer: false,
  },
});
