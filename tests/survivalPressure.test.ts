import { describe, expect, it } from 'vitest';
import { COUNTDOWN_MS, FIXED_STEP_MS, MatchEngine, survivalPressureInterval } from '../src/simulation/match';
import { nearestAttackWarning } from '../src/simulation/attackQueue';
import { encodeMatchState } from '../src/simulation/match';
import { prepareClearPlaytest } from '../src/ui/clearPlaytest';
import { conflictPresentationForParticipant } from '../src/rendering/conflictPresentation';
import { AudioEventTracker } from '../src/audio/audioEvents';
import { humanPair } from './fixtures';

function fixture(network = false) {
  const e = new MatchEngine(humanPair(), 173, 5, {}, null, true, network ? 'network' : 'local');
  e.step(COUNTDOWN_MS); e.state.finalPushActive = true;
  e.state.nextPressureAtMs = 1_000_000_000;
  return e;
}
const gray = (e: MatchEngine) => e.state.participants[0]!.board.grid.filter(r => r.every(c => c === 'garbage')).length;

describe('continued Survival pressure', () => {
  it('preserves the initial cadence and continues through every late boundary to a one-second floor', () => {
    expect([1,2,10].map(n=>survivalPressureInterval(180000,n))).toEqual([15000,14000,6000]);
    expect([284999,285000,314999,315000,344999,345000,375000,405000,900000]
      .map(t=>survivalPressureInterval(t,11))).toEqual([5000,5000,5000,4000,4000,3000,2000,1000,1000]);
    const e=fixture();e.state.elapsedMs=284999;e.state.nextPressureAtMs=285000;e.state.pressureRows=10;
    const observed:number[]=[];
    for(let i=0;i<50;i++){
      const at=e.state.nextPressureAtMs;if(at>410000)break;
      e.state.elapsedMs=at-1;e.step(1);observed.push(e.state.nextPressureAtMs-at);
    }
    expect(observed.slice(0,6)).toEqual([5000,5000,5000,5000,5000,5000]);
    expect(observed).toContain(4000);expect(observed).toContain(3000);expect(observed).toContain(2000);
    expect(observed.slice(-5)).toEqual([1000,1000,1000,1000,1000]);
  });
  it('actually inserts a row every second after independent full warnings, while older rises are still present', () => {
    const e=fixture();e.state.elapsedMs=404999;e.state.nextPressureAtMs=405000;e.step(1);
    expect(e.state.attackQueues.p1![0]!.remainingMs).toBe(3000);
    e.step(1000);e.step(1000);expect(gray(e)).toBe(0);
    e.step(1000);expect(gray(e)).toBe(1);
    expect(e.state.attackQueues.p1!.filter(a=>a.phase==='warning').map(a=>a.remainingMs)).toEqual([1000,2000,3000]);
    expect(conflictPresentationForParticipant(e.state,'p1').warningProgress).toBeCloseTo(2/3);
    e.step(1000);expect(gray(e)).toBe(2);e.step(1000);expect(gray(e)).toBe(3);
  });
  it('one real clear blocks exactly one nearest warning and leaves later warnings live', () => {
    const e=fixture();e.enqueueBoardAttack('p1',1,'pressure');e.step(1000);e.enqueueBoardAttack('p1',1,'pressure');
    const first=e.state.attackQueues.p1![0]!;
    prepareClearPlaytest(e.state.participants[0]!.board,'normal',1);
    e.step(FIXED_STEP_MS);
    expect(first.defended).toBe(true);
    expect(e.state.attackResolutionEvents.filter(a=>a.participantId==='p1'&&a.defended)).toHaveLength(1);
    expect(nearestAttackWarning(e.state.attackQueues.p1)).toMatchObject({remainingMs:3000-FIXED_STEP_MS,defended:false});
  });
  it('consumes one shield per overlapping row and still inserts an unprotected later row', () => {
    const e=fixture();e.state.participants[0]!.shieldCount=1;e.state.participants[0]!.shieldReady=true;
    e.enqueueBoardAttack('p1',1,'pressure');e.step(1000);e.enqueueBoardAttack('p1',1,'pressure');
    e.step(2000);expect(e.state.participants[0]!.shieldCount).toBe(0);expect(gray(e)).toBe(0);
    for(let n=0;n<150;n++)e.step(FIXED_STEP_MS);
    expect(gray(e)).toBe(1);
  });
  it('freezes all overlapping clocks on pause and restores their exact state', () => {
    const e=fixture();e.enqueueBoardAttack('p1',1,'pressure');e.step(1000);e.enqueueBoardAttack('p1',1,'pressure');
    const queues=structuredClone(e.state.attackQueues);const time=e.state.elapsedMs;
    e.pause('manual');e.step(60000);expect(e.state.attackQueues).toEqual(queues);expect(e.state.elapsedMs).toBe(time);
    const restored=MatchEngine.restore(JSON.parse(JSON.stringify(e.checkpoint())));
    e.resume('manual');restored.resume('manual');
    for(let n=0;n<220;n++){e.step(FIXED_STEP_MS);restored.step(FIXED_STEP_MS);expect(restored.checkpoint()).toEqual(e.checkpoint());}
  });
  it('retains late pressure through authoritative own prediction, checkpoint restore and warning audio', () => {
    const e=fixture(true);e.state.elapsedMs=404999;e.state.nextPressureAtMs=405000;e.step(1);
    const predicted=MatchEngine.restorePrediction(encodeMatchState(e.state),e.predictionCheckpoint());
    const tracker=new AudioEventTracker();tracker.sync(e.state);
    let warnings=0;
    for(let n=0;n<280;n++){
      e.step(FIXED_STEP_MS);predicted.stepOwnPrediction('p1',FIXED_STEP_MS);
      expect(predicted.state.participants[0]).toEqual(e.state.participants[0]);
      // Activation serials belong to confirmed presentation; prediction advances only its own board.
      const gameplay = (queue: typeof e.state.attackQueues.p1) => queue?.map(({activationSerial: _confirmedPresentation, ...event})=>event);
      expect(gameplay(predicted.state.attackQueues.p1)).toEqual(gameplay(e.state.attackQueues.p1));
      warnings+=tracker.sync(e.state).filter(a=>a.type==='attack-warning').length;
    }
    expect(warnings).toBeGreaterThanOrEqual(4);expect(gray(e)).toBeGreaterThanOrEqual(2);
  });
  it('preserves serial three-second Battle warnings', () => {
    const e=new MatchEngine(humanPair(),173,5);e.step(COUNTDOWN_MS);
    e.enqueueBoardAttack('p1',1,'pressure');e.enqueueBoardAttack('p1',1,'pressure');
    expect(e.state.attackQueues.p1!.map(a=>a.phase)).toEqual(['warning','queued']);
    e.step(3000);expect(e.state.attackQueues.p1![1]!.phase).toBe('queued');
    e.step(600);expect(e.state.attackQueues.p1![0]).toMatchObject({phase:'warning',remainingMs:3000});
  });
});

it.each([2,4,8])('applies common late pressure to all %i authoritative network boards and preserves cadence after elimination', count=>{
 const configs=Array.from({length:count},(_,i)=>({id:`p${i}`,label:`Human ${i}`,controller:'mobile-touch' as const}));
 const e=new MatchEngine(configs,173,5,{},null,true,'network');e.step(COUNTDOWN_MS);
 e.state.elapsedMs=404999;e.state.nextPressureAtMs=405000;e.state.finalPushActive=true;e.step(1);
 expect(new Set(Object.values(e.state.attackQueues).map(q=>q[0]!.serial)).size).toBe(count);
 for(let n=0;n<180;n++)e.step(FIXED_STEP_MS);
 for(const p of e.state.participants)expect(p.board.grid.filter(r=>r.every(c=>c==='garbage'))).toHaveLength(1);
 const next=e.state.nextPressureAtMs;e.eliminate('p0');
 e.state.elapsedMs=next-1;e.step(1);expect(e.state.nextPressureAtMs).toBe(next+1000);
 for(const p of e.state.participants.slice(1))expect(e.state.attackQueues[p.config.id]!.some(a=>a.phase==='warning')).toBe(true);
});
