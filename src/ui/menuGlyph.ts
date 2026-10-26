/** Small outline glyphs share the lobby device icons' quiet, rounded language. */
export function menuGlyph(kind: 'play' | 'network' | 'settings' | 'exit' | 'gamepad'): string {
  const paths = {
    play: '<path d="m10 6 13 10-13 10Z"/>',
    network: '<rect x="3" y="4" width="11" height="9" rx="2"/><rect x="18" y="19" width="11" height="9" rx="2"/><path d="M8 16v8h7m9-8V8h-7"/>',
    settings: '<path d="M6 8h20M6 16h20M6 24h20"/><circle cx="12" cy="8" r="3"/><circle cx="22" cy="16" r="3"/><circle cx="10" cy="24" r="3"/>',
    gamepad: '<path d="M9 9h14c4 0 8 14 5 16-3 2-7-4-9-4h-6c-2 0-6 6-9 4-3-2 1-16 5-16Z"/><path d="M10 12v7m-3-3h6"/><circle cx="23" cy="13" r="1"/><circle cx="26" cy="17" r="1"/>',
    exit: '<path d="M16 3v13M9 7a12 12 0 1 0 14 0"/>',
  };
  return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">${paths[kind]}</svg>`;
}
