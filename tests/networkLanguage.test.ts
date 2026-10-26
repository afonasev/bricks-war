import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {networkCatalogs,networkText,localizedNetworkMessage,KNOWN_NETWORK_MESSAGE_KEYS,networkAiName,networkAiDifficulty} from '../src/network/presentationCopy';
import {LOCALES,setLocale,translate} from '../src/i18n/locale';

describe('network presentation boundary',()=>{
 it('has complete translated keys and interpolation tokens in all supported languages',()=>{
  const params=(s:string)=>[...s.matchAll(/\{(\w+)\}/g)].map(v=>v[1]).sort();
  for(const locale of LOCALES){
   expect(Object.keys(networkCatalogs[locale]).sort()).toEqual(Object.keys(networkCatalogs.en).sort());
   for(const [key,en] of Object.entries(networkCatalogs.en)){
    const value=networkCatalogs[locale][key as keyof typeof networkCatalogs.en];
    expect(value.trim()).not.toBe('');expect(params(value)).toEqual(params(en));
    if(locale!=='ru')expect(value,`${locale}.${key}`).not.toMatch(/[А-Яа-яЁё]/);
   }
  }
 });
 it('translates exact known owned raw messages without modifying the raw lifecycle value',()=>{
  for(const [raw,key] of Object.entries(KNOWN_NETWORK_MESSAGE_KEYS))for(const locale of LOCALES){
   expect(localizedNetworkMessage(raw,locale)).toBe(networkText(key,locale));
  }
  const raw='Подключено';setLocale('de',null);
  try{expect(localizedNetworkMessage(raw)).toBe(networkCatalogs.de.connected);expect(raw).toBe('Подключено');}finally{setLocale('en',null);}
 });
 it('preserves unknown diagnostics and user-looking text exactly, including inherited object property names',()=>{
  for(const locale of LOCALES)for(const raw of ['Unknown service error 123','Мой матч <中> {rows}','constructor','toString','__proto__',''])expect(localizedNetworkMessage(raw,locale)).toBe(raw);
 });
 it('translates generated AI difficulty names while retaining human and custom names',()=>{
  setLocale('en',null);
  expect(networkAiName('ai','Лёгкий','easy')).toBe('Easy');
  expect(networkAiName('human','Лёгкий','easy')).toBe('Лёгкий');
  expect(networkAiName('ai','Мой ИИ <中>','easy')).toBe('Мой ИИ <中>');
  expect(networkAiName('ai','Unknown legacy name')).toBe('Unknown legacy name');
 });
 it('preserves original RU network AI names and the prior translation keys in every other locale',()=>{
  const raw={easy:'Лёгкий',medium:'Средний',hard:'Сложный',expert:'Эксперт'} as const;
  const keys={easy:'difficultyEasy',medium:'difficultyMedium',hard:'difficultyHard',expert:'difficultyExpert'} as const;
  for(const difficulty of Object.keys(raw) as (keyof typeof raw)[])for(const locale of LOCALES){
   expect(networkAiDifficulty(difficulty,locale)).toBe(locale==='ru'?raw[difficulty]:translate(locale,keys[difficulty]));
   expect(networkAiName('ai',raw[difficulty],difficulty,locale)).toBe(networkAiDifficulty(difficulty,locale));
  }
 });
 it('covers every current app-owned server/client Russian message at the display boundary',()=>{
  // Golden inventory is derived from the unchanged raw service/client contracts, not from the translation map.
  for(const name of ['src/network/client.ts','server/rooms.ts','server/http.ts']){
   const source=readFileSync(name,'utf8').replace(/^const aiNames:.*$/m,'');
   const messages=[...source.matchAll(/'([^'\n]*[А-Яа-яЁё][^'\n]*)'/g)].map(v=>v[1]!);
   expect(messages.length).toBeGreaterThan(0);
   for(const raw of messages)expect(Object.hasOwn(KNOWN_NETWORK_MESSAGE_KEYS,raw),`${name}: ${raw}`).toBe(true);
  }
 });
});
