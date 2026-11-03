import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import { defineConfig } from '@playwright/test';
const qa = qaRunPaths('setup-input');
export default defineConfig({
  outputDir: qa.artifacts,
 testDir:'./tests/e2e', testMatch:['ai-difficulty-picker.spec.ts','gamepad-roster.spec.ts','start-action.spec.ts','startup-muted.spec.ts'], workers:2, retries:0,
 reporter:[['list'], ['json',{outputFile: qa.report}]],
 use:{baseURL:'http://127.0.0.1:4187',viewport:{width:1440,height:960},channel:'chrome',launchOptions:{args:['--mute-audio']}},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4187 --strictPort',port:4187,reuseExistingServer:false},
});
