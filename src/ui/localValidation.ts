import { translate, type Locale } from '../i18n/locale';
import type { MessageKey } from '../i18n/catalogs';

const keys: Readonly<Record<string, MessageKey>> = {
  "Нужно выбрать от 2 до 4 участников или одного игрока для выживания.": "validationPlayers",
  "Каждый контроллер можно назначить только одному игроку.": "validationController",
  "Для каждого ИИ нужно выбрать сложность.": "validationAi",
  "В выживании нужен от 1 до 4 игроков без ИИ.": "validationSurvival",
  "Длительность матча должна быть от 2 до 10 минут.": "validationDuration",
  "Для режима 2×2 нужны четыре участника: по двое в каждой команде.": "validationTeams",
};

export function localValidationMessage(message: string, locale: Locale): string {
  const key = keys[message];
  return key ? translate(locale, key) : message;
}
