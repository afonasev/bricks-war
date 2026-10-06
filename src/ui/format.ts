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
  label: 'ПРОШЛО ВРЕМЕНИ' | 'ОСТАЛОСЬ ВРЕМЕНИ';
  ariaLabel: 'Прошедшее время матча' | 'Оставшееся время матча';
}

export function matchClockPresentation(
  countUp: boolean,
  elapsedMs: number,
  remainingMs: number,
): MatchClockPresentation {
  return countUp
    ? { milliseconds: elapsedMs, label: 'ПРОШЛО ВРЕМЕНИ', ariaLabel: 'Прошедшее время матча' }
    : { milliseconds: remainingMs, label: 'ОСТАЛОСЬ ВРЕМЕНИ', ariaLabel: 'Оставшееся время матча' };
}

export function formatPieces(count: number): string {
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
