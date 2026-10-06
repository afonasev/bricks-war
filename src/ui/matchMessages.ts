import type { MatchMessageTemplates } from '../domain/gameTuning';

export type MatchMessageValues = Partial<Record<'level' | 'senders' | 'rows', string | number>>;

export function formatMatchMessage(template: string, values: MatchMessageValues): string {
  return template.replace(/\{(level|senders|rows)\}/g, (token, key: keyof MatchMessageValues) => (
    values[key] === undefined ? token : String(values[key])
  ));
}

export function levelUpMessage(messages: MatchMessageTemplates, level: number): string {
  return formatMatchMessage(messages.levelUp, { level: level + 1 });
}
