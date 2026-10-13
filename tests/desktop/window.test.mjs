import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOLUTIONS, windowPreferences, fitWindow } from '../../electron/window.mjs';

test('large presets round-trip through persisted JSON while old choices remain valid', () => {
  assert.ok(RESOLUTIONS.some(([w,h]) => w === 3840 && h === 2160));
  assert.ok(RESOLUTIONS.some(([w,h]) => w === 2560 && h === 1440));
  for (const [width,height] of RESOLUTIONS) {
    const saved = { width, height, fullscreen: true };
    assert.deepEqual(windowPreferences(JSON.parse(JSON.stringify(saved))), saved);
  }
});

test('4K preference fits scaled work areas and measured window borders without losing its value', () => {
  const preference = windowPreferences({width:3840,height:2160,fullscreen:false});
  for (const density of [1,1.5,2]) {
    const area = { width:3840/density, height:2160/density-32 };
    const frame = {width:16,height:39};
    const fit = fitWindow(preference, area, frame);
    assert.equal(fit.width + frame.width, area.width);
    assert.equal(fit.height + frame.height, area.height);
    assert.equal(preference.width,3840);
  }
  assert.deepEqual(fitWindow(preference, {width:640,height:420}, {width:16,height:40}), {width:624,height:380});
});
