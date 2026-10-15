import {expect,it} from 'vitest';
import {stickAxis,gamepadControls} from '../src/controllers/gamepads';
import {normalizeReleaseSettings,DEFAULT_RELEASE_SETTINGS} from '../src/ui/releaseSettings';
import {GameAudio} from '../src/audio/GameAudio';
it('legacy mute migrates once into master zero, preserving channel levels and false/zero',()=>{
 const migrated=normalizeReleaseSettings({muted:true,music:0.3,effects:0.6});expect(migrated).toMatchObject({master:0,muted:false,music:0.3,effects:0.6});expect(normalizeReleaseSettings(migrated)).toEqual(migrated);expect(normalizeReleaseSettings({master:0,music:0,effects:0,calmEffects:false})).toMatchObject({master:0,music:0,effects:0,calmEffects:false});
});
it('stick curve filters drift, rescales sensitivity and keeps default digital threshold',()=>{
 expect(stickAxis(0.15,1,0.2)).toBe(0);expect(stickAxis(0.6,2,0.2)).toBeCloseTo(1);expect(stickAxis(-0.6,0.5,0.2)).toBeCloseTo(-0.25);expect(stickAxis(NaN)).toBe(0);
 const buttons=Array.from({length:16},()=>({pressed:false})); const pad={axes:[0.6,0],buttons} as unknown as Gamepad;
 expect(gamepadControls(pad,DEFAULT_RELEASE_SETTINGS).right).toBe(true);expect(gamepadControls(pad,{...DEFAULT_RELEASE_SETTINGS,stickDeadzone:0.4}).right).toBe(false);
 buttons[15]!.pressed=true;expect(gamepadControls(pad,{...DEFAULT_RELEASE_SETTINGS,stickDeadzone:0.5,stickSensitivity:0.5}).right).toBe(true);
});
it('new input preferences reject corrupt values and clamp to advertised ranges',()=>{
 expect(normalizeReleaseSettings({stickSensitivity:Infinity,stickDeadzone:-1})).toMatchObject({stickSensitivity:1,stickDeadzone:0});expect(normalizeReleaseSettings({stickSensitivity:3,stickDeadzone:0.9})).toMatchObject({stickSensitivity:2,stickDeadzone:0.5});
});
it('session mute cannot be cleared by changing master or channel levels',()=>{
 const audio=new GameAudio(false,{master:0.8,music:0.7,effects:0.6},true);audio.setMasterVolume(1);audio.setMusicVolume(1);audio.toggleMuted();expect(audio.isMuted()).toBe(true);expect(audio.getMasterVolume()).toBe(1);
});
