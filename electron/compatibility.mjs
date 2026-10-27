// ABI 3 includes the rating HTTP bridge and coordinated application updates.
export const CONTENT_ABI = 3;
export const MIN_SHELL_RELEASE = '1.13.0';

export function compareVersions(a, b) {
  const parse = value => { const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? ''); if (!match) throw Error('Invalid stable version'); return match.slice(1).map(Number); };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

export function supportsContent(manifest, shellAbi, shellRelease) {
  return manifest.minShellVersion <= shellAbi && (!manifest.minShellRelease
    || Boolean(shellRelease && compareVersions(shellRelease, manifest.minShellRelease) >= 0));
}
