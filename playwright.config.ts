import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import { defineConfig } from '@playwright/test';

const localQaPort = Number(process.env.BRICKS_LOCAL_QA_PORT ?? 4187);

const qa = qaRunPaths('e2e');
export default defineConfig({
  outputDir: qa.artifacts,
  reporter: [['list'], ['json', { outputFile: qa.report }]],
  testDir: './tests/e2e',
  workers: process.env.BRICKS_QA_WORKERS ? Number(process.env.BRICKS_QA_WORKERS) : undefined,
  use: {
    locale: 'ru-RU', // Existing Russian-copy scenarios now declare their system preference explicitly.
    baseURL: `http://127.0.0.1:${localQaPort}`,
    viewport: { width: 1440, height: 960 },
    channel: 'chrome',
    launchOptions: { args: ['--mute-audio'] },
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${localQaPort} --strictPort`,
    port: localQaPort,
    reuseExistingServer: false,
  },
});
