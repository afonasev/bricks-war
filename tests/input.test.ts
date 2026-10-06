import { describe, expect, it } from 'vitest';
import {
  HORIZONTAL_REPEAT_DELAY_MS,
  HORIZONTAL_REPEAT_INTERVAL_MS,
  HumanInputRouter,
  isManualPauseKey,
} from '../src/controllers/input';
import { humanPair } from './fixtures';

describe('human input routing', () => {
  it('isolates WASD and arrow mappings', () => {
    const input = new HumanInputRouter();
    input.configure(humanPair());
    input.setEnabled(true);
    input.handleKeyDown('KeyA');
    input.handleKeyDown('ArrowRight');
    const actions = input.drain();
    expect(actions.get('p1')).toEqual(['move-left']);
    expect(actions.get('p2')).toEqual(['move-right']);
  });

  it('tracks soft drop press and release once', () => {
    const input = new HumanInputRouter();
    input.configure(humanPair());
    input.setEnabled(true);
    input.handleKeyDown('KeyS');
    input.handleKeyDown('KeyS', true);
    input.handleKeyUp('KeyS');
    expect(input.drain().get('p1')).toEqual(['soft-drop-on', 'soft-drop-off']);
  });

  it('routes gamepad controls through the same repeat and soft-drop path', () => {
    const input = new HumanInputRouter();
    input.configure([{ id: 'pad-player', label: 'Pad', controller: 'gamepad-0' }]);
    input.setEnabled(true);
    input.updateGamepad('gamepad-0', { left: true, right: false, down: true, rotate: true });
    expect(input.drain().get('pad-player')).toEqual(['move-left', 'soft-drop-on', 'rotate-clockwise']);
    input.step(HORIZONTAL_REPEAT_DELAY_MS);
    expect(input.drain().get('pad-player')).toEqual(['move-left']);
    input.updateGamepad('gamepad-0', { left: false, right: false, down: false, rotate: false });
    expect(input.drain().get('pad-player')).toEqual(['soft-drop-off']);
  });

  it('releases a disconnected gamepad without affecting other players', () => {
    const input = new HumanInputRouter();
    input.configure([
      { id: 'pad-player', label: 'Pad', controller: 'gamepad-0' },
      { id: 'keys-player', label: 'Keys', controller: 'human-1' },
    ]);
    input.setEnabled(true);
    input.updateGamepad('gamepad-0', { left: false, right: false, down: true, rotate: false });
    input.handleKeyDown('KeyA');
    input.drain();
    input.updateGamepad('gamepad-0', null);
    expect(input.drain().get('pad-player')).toEqual(['soft-drop-off']);
    input.step(HORIZONTAL_REPEAT_DELAY_MS);
    expect(input.drain().get('keys-player')).toEqual(['move-left']);
  });

  it('uses deterministic delayed horizontal repeat and ignores browser repeat', () => {
    const input = new HumanInputRouter();
    input.configure(humanPair());
    input.setEnabled(true);
    input.handleKeyDown('KeyA');
    input.handleKeyDown('KeyA', true);
    expect(input.drain().get('p1')).toEqual(['move-left']);
    input.step(HORIZONTAL_REPEAT_DELAY_MS - 1);
    expect(input.drain().size).toBe(0);
    input.step(1);
    expect(input.drain().get('p1')).toEqual(['move-left']);
    input.step(HORIZONTAL_REPEAT_INTERVAL_MS);
    expect(input.drain().get('p1')).toEqual(['move-left']);
    input.handleKeyUp('KeyA');
    input.step(HORIZONTAL_REPEAT_INTERVAL_MS * 2);
    expect(input.drain().size).toBe(0);
  });

  it('does not repeat rotation from the browser key repeat event', () => {
    const input = new HumanInputRouter();
    input.configure(humanPair());
    input.setEnabled(true);
    input.handleKeyDown('KeyW');
    input.handleKeyDown('KeyW', true);
    expect(input.drain().get('p1')).toEqual(['rotate-clockwise']);
  });

  it('captures configured keys but queues nothing while disabled', () => {
    const input = new HumanInputRouter();
    input.configure(humanPair());
    expect(input.handleKeyDown('ArrowLeft')).toBe(true);
    expect(input.drain().size).toBe(0);
  });

  it('recognizes only a non-repeating Escape as a manual pause toggle', () => {
    expect(isManualPauseKey({ code: 'Escape', repeat: false })).toBe(true);
    expect(isManualPauseKey({ code: 'Escape', repeat: true })).toBe(false);
    expect(isManualPauseKey({ code: 'KeyP', repeat: false })).toBe(false);
  });

  it('freezes held input cadence and applies a release made during pause on resume', () => {
    const input = new HumanInputRouter();
    input.configure(humanPair());
    input.setEnabled(true);
    input.handleKeyDown('KeyA');
    input.drain();
    input.step(HORIZONTAL_REPEAT_DELAY_MS - 20);
    input.setEnabled(false);
    input.step(1_000);
    expect(input.drain().size).toBe(0);
    input.setEnabled(true);
    input.step(19);
    expect(input.drain().size).toBe(0);
    input.step(1);
    expect(input.drain().get('p1')).toEqual(['move-left']);

    input.handleKeyDown('KeyS');
    expect(input.drain().get('p1')).toEqual(['soft-drop-on']);
    input.setEnabled(false);
    input.handleKeyUp('KeyS');
    expect(input.drain().size).toBe(0);
    input.setEnabled(true);
    expect(input.drain().get('p1')).toEqual(['soft-drop-off']);
  });

  it('discards held keyboard and gamepad controls for an automatic event hold until release', () => {
    const input = new HumanInputRouter();
    input.configure([
      { id: 'keys', label: 'Keys', controller: 'human-1' },
      { id: 'pad', label: 'Pad', controller: 'gamepad-0' },
    ]);
    input.setEnabled(true);
    input.handleKeyDown('KeyA');
    input.updateGamepad('gamepad-0', { left: false, right: false, down: true, rotate: false });
    input.drain();

    input.setEnabled(false, true);
    input.handleKeyDown('KeyA', true);
    input.updateGamepad('gamepad-0', { left: false, right: false, down: true, rotate: false });
    input.setEnabled(true);
    input.updateGamepad('gamepad-0', { left: false, right: false, down: true, rotate: false });
    input.step(HORIZONTAL_REPEAT_DELAY_MS * 2);
    expect(input.drain().size).toBe(0);

    input.handleKeyUp('KeyA');
    input.updateGamepad('gamepad-0', { left: false, right: false, down: false, rotate: false });
    input.handleKeyDown('KeyA');
    input.updateGamepad('gamepad-0', { left: false, right: false, down: true, rotate: false });
    const resumedActions = input.drain();
    expect(resumedActions.get('keys')).toEqual(['move-left']);
    expect(resumedActions.get('pad')).toEqual(['soft-drop-on']);
  });
});
