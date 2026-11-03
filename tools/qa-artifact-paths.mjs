import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export function qaArtifactRoot(env = process.env, cwd = process.cwd()) {
  const root = realpathSync(cwd);
  const home = env.BRICKS_QA_HOME || join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'bricks-war', 'qa');
  const key = createHash('sha256').update(root).digest('hex').slice(0, 12);
  return join(resolve(home), `${basename(root)}-${key}`);
}

export function qaRunPaths(label, env = process.env, cwd = process.cwd()) {
  const key = `BRICKS_QA_RUN_${label.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  if (env.TEST_WORKER_INDEX !== undefined && env[key]) return JSON.parse(env[key]);
  const parent = join(qaArtifactRoot(env, cwd), label);
  mkdirSync(parent, { recursive: true });
  const runDir = mkdtempSync(join(parent, new Date().toISOString().replace(/[:.]/g, '-') + '-'));
  const paths = { runDir, report: join(runDir, 'browser.json'), artifacts: join(runDir, 'artifacts') };
  env[key] = JSON.stringify(paths);
  return paths;
}
