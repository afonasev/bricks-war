import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/prototype',
  use: {
    baseURL: 'http://127.0.0.1:4191',
    viewport: { width: 1440, height: 900 },
    channel: 'chrome',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4191',
    port: 4191,
    reuseExistingServer: false,
  },
});
