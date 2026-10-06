import { describe, expect, it } from 'vitest';
import { formatMatchMessage, levelUpMessage } from '../src/ui/matchMessages';
import { DEFAULT_GAME_TUNING } from '../src/domain/gameTuning';

describe('match message templates', () => {
  it('resolves documented tokens and preserves unknown text', () => {
    expect(formatMatchMessage('ОТ: {senders} · +{rows} · {unknown}', { senders: 'ИИ 2', rows: 3 })).toBe('ОТ: ИИ 2 · +3 · {unknown}');
    expect(formatMatchMessage('{level}/{rows}', { level: 4 })).toBe('4/{rows}');
  });

  it('uses the editable level-up template', () => {
    expect(levelUpMessage({ ...DEFAULT_GAME_TUNING.messages, levelUp: 'ЭТАП {level}' }, 2)).toBe('ЭТАП 3');
  });

  it('ships concise centered conflict-message defaults', () => {
    expect(formatMatchMessage(DEFAULT_GAME_TUNING.messages.incomingAttack, { senders: 'Аня', rows: 1 })).toBe('Вас атакует Аня +1');
    expect(DEFAULT_GAME_TUNING.messages.activeDefense).toBe('Блок!');
    expect(DEFAULT_GAME_TUNING.messages.shieldBlock).toBe('Сработал щит!');
  });
});
