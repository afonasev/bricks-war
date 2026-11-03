import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import {defineConfig} from '@playwright/test';
const qa = qaRunPaths('pad-hints');
export default defineConfig({
  outputDir: qa.artifacts,testDir:'./tests/e2e',testMatch:'settings-pad-hints.spec.ts',workers:1,use:{baseURL:'http://127.0.0.1:4197',channel:'chrome',launchOptions:{args:['--mute-audio']}},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4197 --strictPort',port:4197,reuseExistingServer:true},reporter:[['list'],['json',{outputFile: qa.report}]]});
