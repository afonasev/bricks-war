import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import { defineConfig } from '@playwright/test';

const qa = qaRunPaths('prototype');
export default defineConfig({
  outputDir: qa.artifacts,
  reporter: [['list'], ['json', { outputFile: qa.report }]],
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
