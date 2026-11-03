import test from 'node:test';
import assert from 'node:assert/strict';
import { installerDownloadSection, installerReleases, withInstallerDownloads } from '../../scripts/desktop/download-presentation.mjs';
import { localizedNotes } from '../../electron/github-updates.mjs';

test('player download view filters native tags and links both published platform installers', () => {
  const section = installerDownloadSection('1.13.0');
  assert.equal(new URL(installerReleases('2.0.0')).searchParams.get('q'), 'tag:v2');
  assert.equal(new URL(installerReleases('1.13.0')).searchParams.get('q'), 'tag:v1');
  for (const name of ['Bricks-War-1.13.0-win-x64.exe', 'Bricks-War-1.13.0-mac-universal.dmg']) {
    assert.ok(section.includes(`https://github.com/afonasev/bricks-war/releases/download/v1.13.0/${name}`));
  }
  for (const version of ['content-42', 'v1.13.0', '1.13.0/evil', '1.13.0-beta']) assert.throws(() => installerDownloadSection(version));
});

test('presentation updates are idempotent and preserve localized installed-client history', () => {
  const notes = '## Русский\n### Исправления\n- Исправлена ошибка.\n\n## English\n### Fixed\n- Fixed a bug.\n';
  const body = withInstallerDownloads(notes, '1.13.0');
  assert.equal(withInstallerDownloads(body, '1.13.0'), body);
  const changed = withInstallerDownloads(body, '1.14.0');
  assert.equal((changed.match(/bricks-war-downloads:start/g) ?? []).length, 1);
  assert.ok(!changed.includes('/v1.13.0/'));
  for (const locale of ['ru', 'en', 'fr']) assert.deepEqual(localizedNotes(body, locale), localizedNotes(notes, locale));
});
