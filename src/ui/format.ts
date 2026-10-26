import { translate, type Locale } from '../i18n/locale';

export function formatDuration(milliseconds: number): string {
  const totalTenths = Math.floor(milliseconds / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

export function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export interface MatchClockPresentation {
  milliseconds: number;
  label: string;
  ariaLabel: string;
}

export function matchClockPresentation(
  countUp: boolean,
  elapsedMs: number,
  remainingMs: number,
  locale: Locale = 'ru',
): MatchClockPresentation {
  return countUp
    ? { milliseconds: elapsedMs, label: translate(locale, 'elapsedLabel'), ariaLabel: translate(locale, 'elapsedAria') }
    : { milliseconds: remainingMs, label: translate(locale, 'remainingLabel'), ariaLabel: translate(locale, 'remainingAria') };
}

export function formatPieces(count: number, locale: Locale = 'ru'): string {
  if (locale !== 'ru') return translate(locale, new Intl.PluralRules(locale).select(count) === 'one' ? 'piecesOne' : 'piecesMany', { count: count.toLocaleString(locale) });
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? 'фигур'
    : mod10 === 1
      ? 'фигура'
      : mod10 >= 2 && mod10 <= 4
        ? 'фигуры'
        : 'фигур';
  return `${count} ${noun}`;
}
