import test from 'node:test';
import assert from 'node:assert/strict';
import { gameUrl, startupMuted } from '../../electron/startup.mjs';

test('desktop quiet launch flag and QA profile both activate startup mute', () => {
  assert.equal(startupMuted(['/app', '-muted']), true);
  assert.equal(startupMuted(['/app', '--muted']), false);
  assert.equal(startupMuted(['/app'], '/tmp/qa-profile'), true);
  assert.equal(startupMuted(['/app'], ''), false);
  assert.equal(startupMuted(['/app']), false);
});

test('desktop update URL retains quiet launch state without changing ordinary launches', () => {
  assert.equal(gameUrl('https://game.example', true), 'https://game.example/?muted=1');
  assert.equal(gameUrl('https://game.example', false), 'https://game.example/');
});
