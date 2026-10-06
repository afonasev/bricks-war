export interface PlaytestLocation {
  hostname: string;
  search: string;
}

function isLocalHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

export function startsMutedForPlaytest(location: PlaytestLocation = window.location): boolean {
  if (!isLocalHost(location.hostname)) return false;
  const value = new URLSearchParams(location.search).get('muted');
  return value !== null && value !== '0' && value.toLowerCase() !== 'false';
}
