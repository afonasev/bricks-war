import { describe, expect, it } from 'vitest';
import { LOCALES, translate } from '../src/i18n/locale';

const spokenText = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

describe('localized visible labels remain part of their accessible names', () => {
  for (const locale of LOCALES) {
    it(`includes the installer caption in its accessible name ${locale}`, () => {
      expect(spokenText(translate(locale, 'downloadGameAria'))).toContain(spokenText(translate(locale, 'downloadGame')));
    });
    it(`includes the compact cancel caption in its full accessible name ${locale}`, () => {
      expect(spokenText(translate(locale, 'cancelDownloadAria'))).toContain(spokenText(translate(locale, 'cancelDownload')));
    });
  }
});
