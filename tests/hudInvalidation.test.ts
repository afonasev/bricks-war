import { describe, expect, it } from 'vitest';
import { participantLevelUpNoticeKey } from '../src/ui/hudInvalidation';

describe('HUD invalidation', () => {
  it('keeps an active Survival level-up notice stable while its timer counts down', () => {
    const event = { serial: 4, level: 3, anomalyId: 'anomaly-3', pulseMs: 1_000 };
    const mountedKey = participantLevelUpNoticeKey(event);

    event.pulseMs = 450;
    expect(participantLevelUpNoticeKey(event)).toBe(mountedKey);

    event.pulseMs = 0;
    expect(participantLevelUpNoticeKey(event)).not.toBe(mountedKey);
  });
});
