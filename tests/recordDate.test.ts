import { describe, expect, it } from 'vitest';
import { recordDateMarkup } from '../src/ui/recordDate';

describe('record date presentation', () => {
  it('uses the local calendar date with a full year and a small accessible label', () => {
    const timestamp = new Date(2026, 9, 12, 0, 15).getTime();
    expect(recordDateMarkup(timestamp)).toBe('<small class="record-date" aria-label="Дата рекорда 12.10.2026">12.10.2026</small>');
  });
  it('omits unknown or invalid timestamps while accepting the epoch', () => {
    for (const timestamp of [null, NaN, Infinity, 9e18]) expect(recordDateMarkup(timestamp)).toBe('');
    expect(recordDateMarkup(0)).toContain('record-date');
  });
});
