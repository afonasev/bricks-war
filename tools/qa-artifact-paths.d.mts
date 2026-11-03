export function qaArtifactRoot(env?: NodeJS.ProcessEnv, cwd?: string): string;
export function qaRunPaths(label: string, env?: NodeJS.ProcessEnv, cwd?: string): {
  runDir: string;
  report: string;
  artifacts: string;
};
