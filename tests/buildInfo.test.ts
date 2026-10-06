import { describe, expect, it } from 'vitest';
import { formatBuildInfo } from '../src/ui/buildInfo';

describe('build information', () => {
  it('labels a development version without a date', () => {
    expect(formatBuildInfo('0.1.0-dev', '')).toBe('Версия 0.1.0-dev');
  });

  it('labels a deployed production version with its date', () => {
    expect(formatBuildInfo('0.2.0', '2026-09-02T10:11:12.000Z', 'en-GB')).toMatch(/^Версия 0\.2\.0 · Деплой .*2026$/);
  });
});
