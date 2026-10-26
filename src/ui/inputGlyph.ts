import { text } from '../i18n/locale';
export function gamepadFaceLabels(id: string): readonly [string, string, string, string] {
  if (/dualsense|dualshock|playstation|sony|054c/i.test(id)) return ['✕', '○', '□', '△'];
  if (/nintendo|switch|057e/i.test(id)) return ['B', 'A', 'Y', 'X'];
  if (/xbox|xinput|045e/i.test(id)) return ['A', 'B', 'X', 'Y'];
  return [text('bottom'), text('right'), text('left'), text('top')];
}


export type FaceAction = 'confirm' | 'back' | 'ai' | 'roster' | 'reset';
export function faceGlyph(action: FaceAction, classes = '', compact = false): string {
  const letter = ({confirm:'A',back:'B',ai:'X',roster:'Y',reset:'Y'} as const)[action];
  return `<b class="input-badge input-${action} input-glyph ${compact ? 'is-compact' : ''} ${classes}" data-face-action="${action}" aria-hidden="true">${letter}</b>`;
}
export function refreshFaceGlyphs(root: ParentNode, id = 'Xbox'): void {
  const labels = gamepadFaceLabels(id);
  root.querySelectorAll<HTMLElement>('[data-face-action]').forEach(glyph => {
    const index = ({confirm:0,back:1,ai:2,roster:3,reset:3} as const)[glyph.dataset.faceAction as FaceAction];
    const symbol = labels[index]!;
    if (glyph.textContent !== symbol) glyph.textContent = symbol;
    glyph.dataset.faceSymbol = symbol;
  });
}
