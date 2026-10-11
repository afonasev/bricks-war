import { describe, expect, it } from 'vitest';
import { updatePresentation } from '../src/pwa/updatePresentation';
const base = { available: false, applying: false, blocked: false, error: false };
describe('update menu presentation', () => {
  it('keeps idle web behavior and ready explicit activation', () => {
    expect(updatePresentation(base).visible).toBe(false);
    expect(updatePresentation({ ...base, available: true })).toMatchObject({ visible: true, label: 'Обновить', disabled: false });
  });
  it('shows checking and downloading without offering premature activation', () => {
    expect(updatePresentation({ ...base, phase: 'checking' })).toMatchObject({ visible: true, label: 'Проверка…', disabled: true });
    expect(updatePresentation({ ...base, phase: 'downloading' })).toMatchObject({ label: 'Загрузка…', disabled: true, status: 'Загружаем новую версию игры' });
  });
  it('offers retry on discovery failure and retains apply for an already staged update', () => {
    expect(updatePresentation({ ...base, phase: 'error', error: true })).toMatchObject({ visible: true, label: 'Повторить', disabled: false });
    expect(updatePresentation({ ...base, available: true, phase: 'ready', error: true })).toMatchObject({ visible: true, label: 'Обновить', disabled: false });
  });
  it('preserves match blocking and apply progress', () => {
    expect(updatePresentation({ ...base, available: true, blocked: true })).toMatchObject({ disabled: true, status: 'Сначала завершите сетевую игру' });
    expect(updatePresentation({ ...base, available: true, applying: true })).toMatchObject({ disabled: true, label: 'Обновление…' });
  });
});
