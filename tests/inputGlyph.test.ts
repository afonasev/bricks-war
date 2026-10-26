import { describe, it, expect } from 'vitest';
import { faceGlyph, gamepadFaceLabels } from '../src/ui/inputGlyph';
import { gamepadFooterAction, footerResetButtonMarkup } from '../src/ui/gamepadFooterHints';
describe('shared semantic input glyphs', () => {
  it('keeps meaning independent of controller face labels', () => {
    expect(gamepadFaceLabels('Xbox')).toEqual(['A','B','X','Y']);
    expect(gamepadFaceLabels('Sony DualSense')).toEqual(['✕','○','□','△']);
    expect(gamepadFaceLabels('Nintendo Switch')).toEqual(['B','A','Y','X']);
    expect(faceGlyph('back')).toContain('data-face-action="back"');
    expect(faceGlyph('confirm','',true)).toContain('is-compact');
  });
  it('uses the same bounded component in static guidance and clickable reset', () => {
    expect(gamepadFooterAction('select','confirm')).toContain('data-hint-label');
    expect(gamepadFooterAction('select','confirm')).toContain(faceGlyph('confirm'));
    expect(footerResetButtonMarkup()).toContain(faceGlyph('reset'));
  });
});
