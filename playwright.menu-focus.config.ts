import { defineConfig } from '@playwright/test';
import smoke from './playwright.smoke.config';
export default defineConfig({ ...smoke, testMatch: ['menu-focus.spec.ts'], grep: undefined, timeout: 60000 });
