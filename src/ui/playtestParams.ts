export interface PlaytestLocation {
  hostname: string;
  search: string;
}

export function startsMutedForPlaytest(location: PlaytestLocation = window.location): boolean {
  const value = new URLSearchParams(location.search).get('muted');
  return value !== null && value !== '0' && value.toLowerCase() !== 'false';
}
