import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: ['language.spec.ts'], workers: 1, retries: 0,
  timeout: 40_000,
  use: { baseURL: 'http://127.0.0.1:4397', viewport: { width: 1440, height: 960 }, channel: 'chrome', launchOptions: { args: ['--mute-audio'] } },
  reporter: [['list'], ['json', { outputFile: process.env.BRICKS_LANGUAGE_REPORT ?? 'evidence/add-persistent-game-language/browser/result.json' }]],
});
