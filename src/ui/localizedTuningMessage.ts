import { DEFAULT_GAME_TUNING, type MatchMessageTemplates } from '../domain/gameTuning';
import { translate, type Locale } from '../i18n/locale';

const keys = { roundStart:'noticeRoundStart', levelUp:'messageDefaultLevel', finalPushTitle:'noticeFinalTitle', finalPushHint:'noticeFinalHint', incomingAttack:'messageDefaultIncoming', attackImpact:'messageDefaultImpact', activeDefense:'messageDefaultDefense', shieldBlock:'messageDefaultShield' } as const;
/** Render current defaults in the selected language; custom/unknown legacy values remain verbatim. */
export function localizedTuningMessage(key: keyof MatchMessageTemplates, value: string, locale: Locale): string {
  return value === DEFAULT_GAME_TUNING.messages[key]
    ? translate(locale, keys[key], {level:'{level}',senders:'{senders}',rows:'{rows}'})
    : value;
}
