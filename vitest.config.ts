import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vitest/config';

const packageInfo = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Preserve Vite's serve-mode globals without production assets/PWA/build plugins.
export default defineConfig({
  define: {
    __BRICKS_WAR_VERSION__: JSON.stringify(`${packageInfo.version}-dev`),
    __BRICKS_WAR_DEPLOYED_AT__: JSON.stringify(''),
  },
  test: {
    environment: 'node',
    // Share the existing QA worker override so timing gates can run without
    // competing simulation suites; assertions and scenario counts are unchanged.
    maxWorkers: process.env.BRICKS_QA_WORKERS ? Number(process.env.BRICKS_QA_WORKERS) : undefined,
    include: ['tests/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'] },
  },
});
