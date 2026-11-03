import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import { defineConfig } from '@playwright/test';
const qa = qaRunPaths('language');
export default defineConfig({
  outputDir: qa.artifacts,
  testDir: './tests/e2e', testMatch: ['language.spec.ts'], workers: 1, retries: 0,
  timeout: 40_000,
  use: { baseURL: 'http://127.0.0.1:4397', viewport: { width: 1440, height: 960 }, channel: 'chrome', launchOptions: { args: ['--mute-audio'] } },
  reporter: [['list'], ['json', { outputFile: process.env.BRICKS_LANGUAGE_REPORT ?? qa.report }]],
});
