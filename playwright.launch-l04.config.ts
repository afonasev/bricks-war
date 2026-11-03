import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import { defineConfig } from '@playwright/test';
const qa = qaRunPaths('launch-l04');
export default defineConfig({
  outputDir: qa.artifacts,testDir:'./tests/e2e',testMatch:'launch-l04.spec.ts',workers:1,retries:0,timeout:45000,reporter:[['json',{outputFile: qa.report}]],use:{baseURL:'http://127.0.0.1:4487',channel:'chrome',launchOptions:{args:['--mute-audio']},serviceWorkers:'block'}});
