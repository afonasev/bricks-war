import { describe, expect, it } from 'vitest';
import { formatPieces, matchClockPresentation } from '../src/ui/format';
import { recordDateMarkup } from '../src/ui/recordDate';
import { globalRatingMarkup } from '../src/ui/ratingPanel';
import { LOCALES, type Locale } from '../src/i18n/locale';

import { DEFAULT_GAME_TUNING } from '../src/domain/gameTuning';
import { MatchEngine, COUNTDOWN_MS } from '../src/simulation/match';
import { humanPair } from './fixtures';
import { globalMatchEvent } from '../src/ui/matchEventPresentation';
import { localValidationMessage } from '../src/ui/localValidation';
import { hudIdentityForParticipant } from '../src/ui/hudIdentity';

describe('local journey presentation without stored-data changes', () => {
  it('keeps the established Russian noun contract and formats other selected locales', () => {
    expect([1,2,5,11,21].map(n=>formatPieces(n))).toEqual(['1 фигура','2 фигуры','5 фигур','11 фигур','21 фигура']);
    expect(formatPieces(1,'en')).toBe('1 piece'); expect(formatPieces(2,'en')).toBe('2 pieces');
    expect(formatPieces(1,'fr')).toBe('1 pièce'); expect(formatPieces(2,'fr')).toBe('2 pièces');
    expect(formatPieces(1,'de')).toBe('1 Figur'); expect(formatPieces(2,'de')).toBe('2 Figuren');
    expect(formatPieces(2,'es')).toBe('2 piezas');
    expect(formatPieces(2,'zh-Hans')).toBe('2 个方块'); expect(formatPieces(2,'ja')).toBe('2 ブロック');
  });
  it('uses locale calendar presentation and accessible copy without changing the timestamp', () => {
    const timestamp=new Date(2026,9,12,0,15).getTime();
    const expected:Record<Locale,string>={ru:'12.10.2026',en:'10/12/2026',fr:'12/10/2026',de:'12.10.2026',es:'12/10/2026','zh-Hans':'2026/10/12',ja:'2026/10/12'};
    for(const [locale,date] of Object.entries(expected)) {
      const markup=recordDateMarkup(timestamp,locale as Locale);
      expect(markup).toContain(`>${date}</small>`);
      if(locale!=='ru') expect(markup).not.toContain('Дата рекорда');
      expect(recordDateMarkup(null,locale as Locale)).toBe('');
    }
    expect(timestamp).toBe(new Date(2026,9,12,0,15).getTime());
  });
  it('escapes and preserves names while formatting rating scores for the selected locale', () => {
    const data={top:[{name:'<b>Анна中</b>',lineScore:123456,elapsedMs:60000,finishedAt:1,rank:1}],own:[]};
    const before=JSON.stringify(data);
    const en=globalRatingMarkup(data,[], 'en'), de=globalRatingMarkup(data,[],'de');
    expect(en).toContain('&lt;b&gt;Анна中&lt;/b&gt;'); expect(en).toContain('123,456');
    expect(de).toContain('123.456'); expect(en).not.toContain('<b>Анна中</b>');
    expect(JSON.stringify(data)).toBe(before);
    expect(globalRatingMarkup({top:[],own:[]},[],'en')).toContain('No results yet. Play your first match!');
  });
});

// Presentation arguments must not alter elapsed/remaining values or team palette assignment.
describe('localized HUD presentation', () => {
  it('keeps timing values and team identities in every locale', () => {
    for (const locale of LOCALES) {
      const elapsed = matchClockPresentation(true, 12345, 67890, locale);
      const remaining = matchClockPresentation(false, 12345, 67890, locale);
      expect(elapsed.milliseconds).toBe(12345);
      expect(remaining.milliseconds).toBe(67890);
      expect(elapsed.ariaLabel).not.toBe(remaining.ariaLabel);
      expect(hudIdentityForParticipant(0, 'teams', locale).palette).toBe('team-1');
      expect(hudIdentityForParticipant(3, 'teams', locale).palette).toBe('team-2');
      if (locale !== 'ru') expect(elapsed.label + remaining.ariaLabel).not.toMatch(/[А-Яа-яЁё]/);
    }
    expect(hudIdentityForParticipant(0,'teams').teamLabel).toBe('СОЛНЦЕ');
    expect(hudIdentityForParticipant(3,'teams').teamLabel).toBe('НЕБО');
  });
});

describe('localized notices and validation preserve application contracts', () => {
  it('translates default notices while preserving custom templates and engine values', () => {
    const engine = new MatchEngine(humanPair(), 7);
    engine.step(COUNTDOWN_MS);
    const before = JSON.stringify(engine.state);
    for (const locale of LOCALES) {
      const normal = globalMatchEvent(engine.state, DEFAULT_GAME_TUNING.messages, locale);
      expect(normal?.kind).toBe('round-start');
      if (locale !== 'ru') expect(normal?.title).not.toMatch(/[А-Яа-яЁё]/);
      expect(globalMatchEvent(engine.state, {...DEFAULT_GAME_TUNING.messages, roundStart:'Мой <b>старт</b> 中'}, locale)?.title).toBe('Мой <b>старт</b> 中');
    }
    expect(JSON.stringify(engine.state)).toBe(before);
  });
  it('localizes only known validation messages and retains unknown/custom text verbatim', () => {
    const original = 'Каждый контроллер можно назначить только одному игроку.';
    expect(localValidationMessage(original,'ru')).toBe(original);
    expect(localValidationMessage(original,'en')).toBe('Each controller can be assigned to only one player.');
    for (const locale of LOCALES) expect(localValidationMessage('Custom error: <b>Анна中</b>',locale)).toBe('Custom error: <b>Анна中</b>');
  });
});
