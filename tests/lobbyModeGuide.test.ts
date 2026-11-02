import {describe,it,expect} from 'vitest';
import {LOCALES} from '../src/i18n/locale';
import {modeGuideCopy} from '../src/i18n/lobbyModeGuideCopy';
import {lobbyModeGuide,lobbyModeGuideMarkup} from '../src/ui/lobbyModeGuide';

describe('localized three-step lobby mode guide',()=>{
 for(const locale of LOCALES)it(`has complete distinct mode guidance in ${locale}`,()=>{
  expect(Object.keys(modeGuideCopy[locale]).sort()).toEqual(Object.keys(modeGuideCopy.en).sort());
  expect(Object.values(modeGuideCopy[locale]).every(value=>value.trim().length>0)).toBe(true);
  for(const mode of ['battle','team-battle','survival'] as const){
   const guide=lobbyModeGuide(mode,false,locale);
   expect(guide.steps).toHaveLength(3);expect(new Set(guide.steps.map(step=>step.title)).size).toBe(3);
  }
 });
 it('changes only the victory explanation when battle duration becomes timed',()=>{
  for(const mode of ['battle','team-battle'] as const){
   const unlimited=lobbyModeGuide(mode,false,'en'),timed=lobbyModeGuide(mode,true,'en');
   expect(timed.steps.slice(0,2)).toEqual(unlimited.steps.slice(0,2));
   expect(timed.steps[2]!.body).toContain('time runs out');expect(unlimited.steps[2]!.body).not.toContain('time runs out');
   expect(timed.steps[2]!.body).toContain(mode==='battle'?'score decides':'team scores decide');
  }
 });
 it('survival stays independent of the saved battle duration and explains pressure and no attacks',()=>{
  const guide=lobbyModeGuide('survival',false,'en');expect(guide).toEqual(lobbyModeGuide('survival',true,'en'));
  expect(guide.steps.map(step=>step.art)).toEqual(['clear','pressure','record']);
  expect(guide.steps[1]!.body).toContain('3:00');expect(guide.note).toContain('No attacks');
 });
 it('preserves canonical detailed markup separately from the brief guide',()=>{
  const details='<ul><li>Exact timing and tie rules</li></ul>';
  const html=lobbyModeGuideMarkup('battle',true,details,'en');
  expect(html).toContain(`class="lobby-mode-details" hidden>${details}`);
  expect(html).toContain('data-guide-timed="true"');expect(html).toContain('time runs out');
 });
});
