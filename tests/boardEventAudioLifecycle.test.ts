import {describe,it,expect,vi} from 'vitest';
import {GameAudio} from '../src/audio/GameAudio';
import {MatchEngine,COUNTDOWN_MS} from '../src/simulation/match';
import {humanPair} from './fixtures';
import {drawBoardEventEffects} from '../src/rendering/boardEventEffects';
import type Phaser from 'phaser';

describe('selected board event lifecycle',()=>{
 it('freezes a warning voice at automatic/manual holds and resumes at its active-time offset once',()=>{
  const audio=new GameAudio(),e=new MatchEngine(humanPair(),173);e.step(COUNTDOWN_MS);
  const sources:{start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;connect:ReturnType<typeof vi.fn>}[]=[];
  const context={currentTime:10,createBufferSource:()=>{const source={start:vi.fn(),stop:vi.fn(),connect:vi.fn()};sources.push(source);return source;},
   createGain:()=>({gain:{value:1},connect:vi.fn()}),createStereoPanner:()=>({pan:{value:0},connect:vi.fn()})};
  const internals=audio as unknown as {context:AudioContext;sfxBus:GainNode;boardEventBuffers:Map<string,AudioBuffer>};
  internals.context=context as unknown as AudioContext;internals.sfxBus={} as GainNode;internals.boardEventBuffers.set('warning',{duration:3} as AudioBuffer);
  audio.sync(e.state);e.enqueueBoardAttack('p1',1,'pressure');audio.sync(e.state);expect(sources).toHaveLength(1);expect(sources[0]!.start).toHaveBeenCalledWith(10.008,0);
  e.step(1000);audio.sync(e.state);e.state.globalEventHold={kind:'final-push',remainingMs:2000,durationMs:2000};audio.sync(e.state);expect(sources[0]!.stop).toHaveBeenCalledTimes(1);
  audio.sync(e.state);expect(sources).toHaveLength(1);e.state.globalEventHold=null;audio.sync(e.state);expect(sources).toHaveLength(2);expect(sources[1]!.start).toHaveBeenCalledWith(10.008,1);
  e.pause('manual');audio.sync(e.state);expect(sources[1]!.stop).toHaveBeenCalledTimes(1);e.resume('manual');audio.sync(e.state);expect(sources).toHaveLength(3);audio.sync(e.state);expect(sources).toHaveLength(3);
  audio.enterMenu();expect(sources[2]!.stop).toHaveBeenCalledTimes(1);audio.startGame();expect(sources[2]!.stop).toHaveBeenCalledTimes(1);
 });
 it('keeps block reflection after a different recipient overwrites the impact notice and shares shield geometry',()=>{
  const e=new MatchEngine(humanPair(),173);e.step(COUNTDOWN_MS);e.enqueueBoardAttack('p1',3,'pressure');
  const head=e.state.attackQueues.p1![0]!;head.phase='rise';head.defended=true;head.remainingMs=600;
  e.state.conflictImpactEvent={serial:2,incomingRows:{p2:1},maxRows:1,pulseMs:700,defendedRecipientIds:[]};
  const commands:unknown[][]=[];const graphics=new Proxy({},{get:(_target,name)=>(...args:unknown[])=>commands.push([name,...args])}) as Phaser.GameObjects.Graphics;
  drawBoardEventEffects(graphics,e.state,'p1',0,0,200,400);expect(commands.some(c=>c[0]==='lineStyle'&&c[2]===0xe5ac19)).toBe(true);
  const block=structuredClone(commands);commands.length=0;head.phase='shield';head.defended=false;
  e.state.shieldPresentations=[{serial:1,participantId:'p1',remainingMs:600,durationMs:1100,absorbedRows:1,remainingRows:2,deferredImpacts:[]}];
  drawBoardEventEffects(graphics,e.state,'p1',0,0,200,400);
  const neutral=(calls:unknown[][])=>calls.map(c=>c.map(v=>v===0x12a6e6||v===0xe5ac19?'reflection-color':v));
  expect(neutral(commands)).toEqual(neutral(block));
 });
});
