import { describe, expect, it, vi } from 'vitest';
import { MATCH_BACKGROUNDS, MatchBackgroundSelection } from '../src/ui/matchBackground';

describe('cosmetic match scenery', () => {
  it('makes every approved scene reachable once per match', () => {
    const samples = [0, .2, .4, .6, .999999];
    const selection = new MatchBackgroundSelection(() => samples.shift()!);
    expect(samples.map((_,index) => index).map(index => selection.forMatch(`match-${index}`).id))
      .toEqual(['sunlit','drafting','evening','garden','paper']);
  });
  it('retains the scene across resize/pause/reconnect calls and resamples only for a new identity', () => {
    const random = vi.fn().mockReturnValueOnce(.2).mockReturnValueOnce(.8);
    const selection = new MatchBackgroundSelection(random);
    const first = selection.forMatch('room-a:match-1');
    for (let i=0;i<20;i++) expect(selection.forMatch('room-a:match-1')).toBe(first);
    expect(random).toHaveBeenCalledTimes(1);
    expect(selection.forMatch('room-a:match-2').id).toBe('paper');
    expect(random).toHaveBeenCalledTimes(2);
  });
  it('uses cosmetic crypto entropy without consuming Math.random', () => {
    const simulationRandom = vi.spyOn(Math,'random');
    try {
      expect(MATCH_BACKGROUNDS).toContain(new MatchBackgroundSelection().forMatch('new'));
      expect(simulationRandom).not.toHaveBeenCalled();
    } finally { simulationRandom.mockRestore(); }
  });
});
