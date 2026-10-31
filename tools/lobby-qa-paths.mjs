import { mkdirSync, mkdtempSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

// Workers reload the config: inherit the runner's paths rather than allocate a run.
export function lobbyQaPaths(env = process.env, cwd = process.cwd()) {
  if (env.TEST_WORKER_INDEX !== undefined && env.BRICKS_LOBBY_QA_PATHS) {
    return JSON.parse(env.BRICKS_LOBBY_QA_PATHS);
  }
  const parent = resolve(cwd, env.BRICKS_LOBBY_OUTPUT ?? 'test-results/lobby');
  mkdirSync(parent, { recursive: true });
  const runDir = mkdtempSync(join(parent, new Date().toISOString().replace(/[:.]/g, '-') + '-'));
  const runId = basename(runDir);
  // Legacy overrides remain usable as parent/name hints, never overwrite targets.
  const reportHint = env.BRICKS_LOBBY_REPORT || env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  const report = reportHint
    ? join(dirname(resolve(cwd, reportHint)), runId, basename(reportHint))
    : join(runDir, 'browser.json');
  const runtime = env.BRICKS_LOBBY_EVIDENCE
    ? join(resolve(cwd, env.BRICKS_LOBBY_EVIDENCE), runId, 'runtime')
    : join(runDir, 'runtime');
  const paths = { runDir, report, runtime, artifacts: join(runDir, 'artifacts') };
  mkdirSync(dirname(report), { recursive: true });
  mkdirSync(runtime, { recursive: true });
  env.BRICKS_LOBBY_EVIDENCE = runtime;
  // Playwright's reporter env override takes precedence over config.outputFile.
  env.PLAYWRIGHT_JSON_OUTPUT_FILE = report;
  env.BRICKS_LOBBY_QA_PATHS = JSON.stringify(paths);
  return paths;
}
