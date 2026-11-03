import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import {defineConfig} from '@playwright/test';
const qa = qaRunPaths('template');
export default defineConfig({
  outputDir: qa.artifacts,testDir:'./tests/e2e',testMatch:['template-alignment.spec.ts','desktop-update.spec.ts','startup-muted.spec.ts','gamepad-roster.spec.ts'],workers:1,use:{baseURL:'http://127.0.0.1:4197',viewport:{width:1440,height:960},channel:'chrome',launchOptions:{args:['--mute-audio']}},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4197 --strictPort',port:4197,reuseExistingServer:true},reporter:[['list'],['json',{outputFile: qa.report}]]});
