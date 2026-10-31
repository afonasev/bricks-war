import { defineConfig } from '@playwright/test';
import { lobbyQaPaths } from './tools/lobby-qa-paths.mjs';

// Focused lobby tests use the explicitly owned Vite dev origin, never dist/preview.
const paths = lobbyQaPaths();
export default defineConfig({
  testDir: './tests/lobby-browser',
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${process.env.BRICKS_LOCAL_QA_PORT ?? 4287}`,
    locale: 'ru-RU',
    viewport: { width: 1440, height: 960 },
    channel: 'chrome',
    launchOptions: { args: ['--mute-audio'] },
  },
  metadata: { lobbyQa: paths },
  reporter: [['list'], ['json', { outputFile: paths.report }]],
  outputDir: paths.artifacts,
});
