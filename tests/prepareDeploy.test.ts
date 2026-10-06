import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextVersion, prepareDeploy } from '../scripts/prepare-deploy.mjs';

describe('deployment version preparation', () => {
  it.each([
    ['0.1.0', 'patch', '0.1.1'],
    ['0.1.7', 'minor', '0.2.0'],
    ['2.4.8', 'major', '3.0.0'],
  ])('bumps %s with %s', (current, bump, expected) => {
    expect(nextVersion(current, bump)).toBe(expected);
  });

  it('rejects invalid semantic versions and bump levels', () => {
    expect(() => nextVersion('1.2.3-dev', 'patch')).toThrow(/SemVer core/);
    expect(() => nextVersion('1.2.3', 'preview')).toThrow(/VERSION_BUMP/);
  });

  it('keeps package metadata and deployment metadata synchronized', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bricks-war-release-'));
    await mkdir(join(root, 'config'));
    await Promise.all([
      writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bricks-war', version: '0.1.0' })),
      writeFile(join(root, 'package-lock.json'), JSON.stringify({ name: 'bricks-war', version: '0.1.0', packages: { '': { version: '0.1.0' } } })),
    ]);
    const result = await prepareDeploy({ root, bump: 'minor', now: new Date('2026-09-02T10:11:12.000Z') });
    const [packageInfo, lockInfo, metadata] = await Promise.all([
      readFile(join(root, 'package.json'), 'utf8').then(JSON.parse),
      readFile(join(root, 'package-lock.json'), 'utf8').then(JSON.parse),
      readFile(join(root, 'config/deployment-build.json'), 'utf8').then(JSON.parse),
    ]);
    expect(result).toEqual({ version: '0.2.0', deployedAt: '2026-09-02T10:11:12.000Z' });
    expect(packageInfo.version).toBe('0.2.0');
    expect(lockInfo.version).toBe('0.2.0');
    expect(lockInfo.packages[''].version).toBe('0.2.0');
    expect(metadata).toEqual(result);
  });
});
