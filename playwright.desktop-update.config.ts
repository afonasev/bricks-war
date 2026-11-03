import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import { defineConfig } from '@playwright/test';
const qa = qaRunPaths('desktop-update');
export default defineConfig({
  outputDir: qa.artifacts,
  reporter: [['list'], ['json', { outputFile: qa.report }]],
  testDir: './tests/e2e',
  testMatch: 'desktop-update.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4187', viewport: { width: 1440, height: 960 },
    channel: 'chrome', launchOptions: { args: ['--mute-audio'] } },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4187 --strictPort', port: 4187, reuseExistingServer: false },
});
