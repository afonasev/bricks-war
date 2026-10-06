export function nextVersion(currentVersion: string, bump: string): string;

export function prepareDeploy(input: {
  root: string;
  bump?: string;
  now?: Date;
}): Promise<{ version: string; deployedAt: string }>;
