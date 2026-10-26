import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',testMatch:'launch-l04.spec.ts',workers:1,retries:0,timeout:45000,reporter:[['json',{outputFile:'evidence/localize-native-updates/browser.json'}]],use:{baseURL:'http://127.0.0.1:4487',channel:'chrome',launchOptions:{args:['--mute-audio']},serviceWorkers:'block'}});
