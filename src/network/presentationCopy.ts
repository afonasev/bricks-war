import { getLocale, translate } from '../i18n/locale';
import type { Locale } from '../i18n/locale';
import type { AiDifficulty } from '../domain/types';
import { networkEn, networkRu, networkFr, networkDe, networkEs, networkJa, networkZhHans } from '../i18n/networkCatalogs';
import { networkUiEn, networkUiRu, networkUiFr, networkUiDe, networkUiEs, networkUiJa, networkUiZhHans, type NetworkUiKey } from '../i18n/networkUiCatalogs';
import { networkErrorEn, networkErrorRu, networkErrorFr, networkErrorDe, networkErrorEs, networkErrorJa, networkErrorZhHans, KNOWN_NETWORK_ERRORS } from '../i18n/networkErrorCatalogs';
export const networkCatalogs = {
 en:{...networkEn,...networkUiEn,...networkErrorEn}, ru:{...networkRu,...networkUiRu,...networkErrorRu},
 fr:{...networkFr,...networkUiFr,...networkErrorFr}, de:{...networkDe,...networkUiDe,...networkErrorDe},
 es:{...networkEs,...networkUiEs,...networkErrorEs}, ja:{...networkJa,...networkUiJa,...networkErrorJa},
 'zh-Hans':{...networkZhHans,...networkUiZhHans,...networkErrorZhHans},
} as const;
export type NetworkCopyKey = keyof typeof networkCatalogs.en;
export function networkText(key:NetworkCopyKey, locale:Locale=getLocale(), values?:Record<string,string|number>):string {
 return networkCatalogs[locale][key].replace(/\{(\w+)\}/g,(_,name:string)=>String(values?.[name]??''));
}
export function networkUiText(key:NetworkUiKey,locale:Locale=getLocale(),values?:Record<string,string|number>):string {return networkText(key,locale,values);}
/** Raw client/service status remains unchanged; only the exact owned text is translated for display. */
export const KNOWN_NETWORK_MESSAGE_KEYS:Readonly<Record<string,NetworkCopyKey>>={...KNOWN_NETWORK_ERRORS,'No network match':'noNetworkMatch'};
export function localizedNetworkMessage(message:string,locale:Locale=getLocale()):string {
 return Object.hasOwn(KNOWN_NETWORK_MESSAGE_KEYS,message)?networkText(KNOWN_NETWORK_MESSAGE_KEYS[message]!,locale):message;
}
const aiDefaults={easy:'Лёгкий',medium:'Средний',hard:'Сложный',expert:'Эксперт'} as const;
const aiKeys={easy:'difficultyEasy',medium:'difficultyMedium',hard:'difficultyHard',expert:'difficultyExpert'} as const;
/** Translate only generated AI difficulty names. Human and unknown legacy/custom names stay verbatim. */
export function networkAiDifficulty(difficulty:AiDifficulty,locale:Locale=getLocale()):string {return locale==='ru'?aiDefaults[difficulty]:translate(locale,aiKeys[difficulty]);}
export function networkAiName(kind:string,name:string,difficulty?:AiDifficulty,locale:Locale=getLocale()):string {
 return kind==='ai'&&difficulty&&name===aiDefaults[difficulty]?networkAiDifficulty(difficulty,locale):name;
}
