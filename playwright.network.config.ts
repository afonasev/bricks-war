import { qaRunPaths } from './tools/qa-artifact-paths.mjs';
import {defineConfig} from '@playwright/test';
const qa = qaRunPaths('network');
export default defineConfig({
  outputDir: qa.artifacts,testDir:'./tests/network-browser',timeout:120000,workers:1,
  use:{baseURL:process.env.BRICKS_NETWORK_QA_ORIGIN??'http://127.0.0.1:4188',channel:'chrome',launchOptions:{args:['--mute-audio']}},
  reporter:[['list'],['json',{outputFile:process.env.BRICKS_NETWORK_QA_REPORT??qa.report}]]});
