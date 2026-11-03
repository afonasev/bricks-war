import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import { defineConfig } from '@playwright/test';
const qa = qaRunPaths('clock');
export default defineConfig({
  outputDir: qa.artifacts,
  reporter: [['list'], ['json', { outputFile: qa.report }]],testDir:'./tests/e2e',testMatch:'match-clock-layout.spec.ts',workers:1,retries:0,use:{baseURL:'http://127.0.0.1:4187',viewport:{width:1440,height:960},channel:'chrome',launchOptions:{args:['--mute-audio']}},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4187 --strictPort',url:'http://127.0.0.1:4187',reuseExistingServer:false}});
