import { setLocale, LOCALES, translate } from '../src/i18n/locale';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { nativeUpdatePresentation, updatePresentation } from '../src/pwa/updatePresentation';
beforeEach(() => setLocale('ru',null));
afterEach(() => setLocale('en',null));
const base = { available: false, applying: false, blocked: false, error: false };
describe('update menu presentation', () => {
  it('keeps idle web behavior and ready explicit activation', () => {
    expect(updatePresentation(base).visible).toBe(false);
    expect(updatePresentation({ ...base, available: true })).toMatchObject({ visible: true, label: 'Обновить', disabled: false });
  });
  it('shows checking and downloading without offering premature activation', () => {
    expect(updatePresentation({ ...base, phase: 'checking' })).toMatchObject({ visible: true, label: 'Проверка…', disabled: true });
    expect(updatePresentation({ ...base, phase: 'verifying' })).toMatchObject({visible:true,label:'Проверка пакета…',disabled:true});
    expect(updatePresentation({ ...base, phase: 'downloading' })).toMatchObject({ label: 'Загрузка 0%', disabled: true, status: 'Можно продолжить играть: загрузка приостановится на время матча.' });
  });
  it('offers retry on discovery failure and retains apply for an already staged update', () => {
    expect(updatePresentation({ ...base, phase: 'check-error', error: true })).toMatchObject({ visible: true, label: 'Проверка недоступна', disabled: true });
    expect(updatePresentation({ ...base, available: true, phase: 'ready', error: true })).toMatchObject({ visible: true, label: 'Перезапустить', disabled: false });
  });
  it('preserves match blocking and apply progress', () => {
    expect(updatePresentation({ ...base, available: true, blocked: true })).toMatchObject({ disabled: true, status: 'Сначала завершите сетевую игру' });
    expect(updatePresentation({ ...base, available: true, applying: true })).toMatchObject({ disabled: true, label: 'Обновление…' });
  });
  it('distinguishes web apply failures from native download failures', () => {
    expect(updatePresentation({ ...base, available: true, error: true }).status).toBe(translate('ru', 'updateApplyHelp'));
    expect(updatePresentation({ ...base, available: true, phase: 'download-error', error: true }).status).toBe(translate('ru', 'updateDownloadHelp'));
  });
});

it('renders every phase in all supported languages without changing state semantics', () => {
  const phases = ['idle','checking','available','downloading','verifying','paused','ready','error','check-error','download-error','install-error','shell-required'] as const;
  for (const phase of phases) {
    const state = {...base,available:true,phase,error:phase==='download-error',version:'9.8.7',progress:42.9};
    setLocale('ru',null); const original = updatePresentation(state);
    for (const locale of LOCALES) {
      setLocale(locale,null); const result = updatePresentation(state);
      expect([result.visible,result.disabled]).toEqual([original.visible,original.disabled]);
      expect(result.label).not.toBe('');
      expect(result.label+result.status).not.toMatch(/\{\w+\}/);
      if (phase==='downloading') expect(result.label).toBe(translate(locale,'updateDownloading',{progress:42}));
      if (phase==='available') expect(result.status).toBe(translate(locale,'updateVersion',{version:'9.8.7'}));
      if (phase==='install-error') expect(result.status).toBe(translate(locale,'updateInstallHelp'));
      if (phase==='download-error') expect(result.status).toBe(translate(locale,'updateDownloadHelp'));
    }
  }
  for (const locale of LOCALES) {
    setLocale(locale,null);
    expect(updatePresentation({...base,available:true,error:true}).status).toBe(translate(locale,'updateApplyHelp'));
  }
});


it('shows a full update and keeps a missing required shell explicit in every language',()=>{
 for(const locale of LOCALES){
  setLocale(locale,null);
  const available=updatePresentation({...base,available:true,phase:'available',requiresShell:true,version:'2.0.0'});
  expect(available.disabled).toBe(false);expect(available.status).toBe(translate(locale,'updateVersion',{version:'2.0.0'}));
  expect(available.announcement).toBe(translate(locale,'updateVersion',{version:'2.0.0'}));
  const blocked=updatePresentation({...base,phase:'shell-required',requiresShell:true,version:'2.0.0'});
  expect(blocked.visible).toBe(true);expect(blocked.disabled).toBe(true);
  expect(blocked.status).toBe(translate(locale,'updateShellUnavailable'));
  expect(blocked.label).toBe(translate(locale,'updateShellRequired'));
 }
});

it('keeps native details inside two actions and preserves cancel, blocking and compatibility', () => {
  for (const locale of LOCALES) {
    setLocale(locale, null);
    expect(nativeUpdatePresentation(base).visible).toBe(false);
    const state = {...base, available:true, phase:'available' as const, version:'2.0.0', requiresShell:true};
    expect(nativeUpdatePresentation(state)).toMatchObject({heading:translate(locale,'updateVersion',{version:'2.0.0'}), hint:'',disabled:false,cancel:false});
    for (const phase of ['downloading','verifying','paused'] as const) {
      expect(nativeUpdatePresentation({...state,phase,blocked:true})).toMatchObject({cancel:true,disabled:false,hint:translate(locale,'cancelDownload')});
    }
    expect(nativeUpdatePresentation({...state,blocked:true})).toMatchObject({disabled:true,cancel:false,hint:translate(locale,'updateBlocked')});
    expect(nativeUpdatePresentation({...state,phase:'shell-required'})).toMatchObject({label:translate(locale,'updateAction'),disabled:true,cancel:false,hint:translate(locale,'updateShellUnavailable')});
    expect(nativeUpdatePresentation({...state,phase:'ready'})).toMatchObject({label:translate(locale,'updateRestart'),hint:'',disabled:false});
    expect(nativeUpdatePresentation({...state,phase:'downloading',applying:true}).cancel).toBe(false);
  }
});
