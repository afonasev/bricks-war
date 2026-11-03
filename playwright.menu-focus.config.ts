import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import { defineConfig } from '@playwright/test';
import smoke from './playwright.smoke.config';
const qa = qaRunPaths('menu-focus');
export default defineConfig({
  ...smoke,
  outputDir: qa.artifacts,
  reporter: [['list'], ['json', { outputFile: qa.report }]], testMatch: ['menu-focus.spec.ts'], grep: undefined, timeout: 60000 });
