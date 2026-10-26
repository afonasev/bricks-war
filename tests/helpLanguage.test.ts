import {describe,expect,it} from 'vitest';
import {DEFAULT_GAME_TUNING, MESSAGE_TEMPLATE_KEYS} from '../src/domain/gameTuning';
import {LOCALES, setLocale} from '../src/i18n/locale';
import {catalogs} from '../src/i18n/catalogs';
import {localizedTuningMessage} from '../src/ui/localizedTuningMessage';
import {gamepadControlsArtworkMarkup} from '../src/ui/localizedControlsArtwork';

describe('localized help and Lab presentation contracts',()=>{
 it('renders default templates in the selected locale without consuming placeholders or changing stored defaults',()=>{
  const before=JSON.stringify(DEFAULT_GAME_TUNING.messages);
  for(const locale of LOCALES) for(const key of MESSAGE_TEMPLATE_KEYS){
   const source=DEFAULT_GAME_TUNING.messages[key];
   const rendered=localizedTuningMessage(key,source,locale);
   expect(rendered).not.toBe('');
   expect(rendered.match(/\{\w+\}/g)??[]).toEqual(source.match(/\{\w+\}/g)??[]);
   if(locale==='ru')expect(rendered).toBe(source);
   else expect(rendered).not.toMatch(/[А-Яа-яЁё]/);
  }
  expect(JSON.stringify(DEFAULT_GAME_TUNING.messages)).toBe(before);
 });
 it('preserves every custom or unknown legacy template, including empty and HTML-like strings',()=>{
  for(const locale of LOCALES)for(const key of MESSAGE_TEMPLATE_KEYS)for(const value of ['', 'Мой <b>старт</b> 中 {rows}', 'Атака от {senders} +{rows}'])expect(localizedTuningMessage(key,value,locale)).toBe(value);
 });
 it('keeps the approved controller image layer and selected-language accessible controls',()=>{
  try{
   for(const locale of LOCALES){
    setLocale(locale,{getItem:()=>null,setItem:()=>{}});
    const markup=gamepadControlsArtworkMarkup();
    expect(markup).toContain('controls-gamepad-gameplay.png');
    if(locale==='ru')expect(markup).toContain('<img');
    else {
     expect(markup).toContain('<image');expect(markup).toContain(catalogs[locale].controlsPause);
     expect(markup).toContain(catalogs[locale].controlsMove);expect(markup).not.toMatch(/[А-Яа-яЁё]/);
    }
   }
  }finally{setLocale('ru',{getItem:()=>null,setItem:()=>{}});}
 });
});
