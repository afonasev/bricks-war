import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import { defineConfig } from '@playwright/test';

const qa = qaRunPaths('client-update');
export default defineConfig({
  outputDir: qa.artifacts,
  reporter: [['list'], ['json', { outputFile: qa.report }]],
  testDir: './tests/e2e',
  testMatch: 'client-update.spec.ts',
  workers: 1,
  use: {
    viewport: { width: 1440, height: 960 },
    channel: 'chrome',
    launchOptions: { args: ['--mute-audio'] },
  },
});
