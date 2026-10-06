import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/network-browser',timeout:120000,workers:1,
  use:{baseURL:process.env.BRICKS_NETWORK_QA_ORIGIN??'http://127.0.0.1:4188',channel:'chrome',launchOptions:{args:['--mute-audio']}},
  reporter:[['list'],['json',{outputFile:process.env.BRICKS_NETWORK_QA_REPORT??'/tmp/bricks-network-browser-results.json'}]]});
