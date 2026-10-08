import {describe,it,expect} from 'vitest';
import {MatchEngine,COUNTDOWN_MS,SHIELD_PRESENTATION_MS,FIXED_STEP_MS} from '../src/simulation/match';
import {humanPair} from './fixtures';
import {AudioEventTracker} from '../src/audio/audioEvents';
import {prepareClearPlaytest} from '../src/ui/clearPlaytest';
function fixture(){const e=new MatchEngine([...humanPair(),{id:'p3',label:'Маша',controller:'ai',difficulty:'easy'}],173,5);e.step(COUNTDOWN_MS);return e;}
function advance(e:MatchEngine,ms:number){for(let n=0;n<ms;n+=FIXED_STEP_MS)e.step(Math.min(FIXED_STEP_MS,ms-n));}
const gray=(e:MatchEngine,id='p2')=>e.state.participants.find(p=>p.config.id===id)!.board.grid.filter(r=>r.some(c=>c==='garbage')).length;
describe('per recipient FIFO',()=>{
 it('keeps two sender attacks and pressure distinct with full windows after each rise',()=>{
  const e=fixture();e.enqueueBoardAttack('p2',1,'conflict','p1');advance(e,1000);
  e.enqueueBoardAttack('p2',3,'conflict','p3');e.enqueueBoardAttack('p2',1,'pressure');
  const q=e.state.attackQueues.p2!;expect(q.map(a=>a.rows)).toEqual([1,3,1]);expect(q[0]!.remainingMs).toBeCloseTo(2000);
  advance(e,2000);expect(gray(e)).toBe(1);expect(q[0]!.phase).toBe('rise');expect(q[1]!.phase).toBe('queued');
  advance(e,600);expect(q[0]).toMatchObject({senderId:'p3',remainingMs:3000,phase:'warning'});
  advance(e,3000);expect(gray(e)).toBe(4);advance(e,600);expect(q[0]).toMatchObject({reason:'pressure',remainingMs:3000});
  advance(e,3000);expect(gray(e)).toBe(5);advance(e,600);expect(q).toHaveLength(0);
 });
 it('cancels unfinished clear and queued attacks immediately at timed expiry',()=>{
  const e=fixture();e.state.nextPressureAtMs=e.state.durationMs+1;prepareClearPlaytest(e.state.participants[0]!.board,'normal',2);
  e.step(FIXED_STEP_MS);e.enqueueBoardAttack('p2',3,'conflict','p1');e.enqueueBoardAttack('p2',1,'pressure');
  e.state.elapsedMs=e.state.durationMs-1;e.state.remainingMs=1;
  const score=e.state.participants[0]!.score,inventory=e.state.participants[1]!.shieldCount;
  const r=MatchEngine.restore(JSON.parse(JSON.stringify(e.checkpoint())));
  e.step(1);r.step(1);expect(r.checkpoint()).toEqual(e.checkpoint());
  expect(e.state.phase).toBe('results');expect(e.state.endReason).toBe('timeout');expect(e.state.remainingMs).toBe(0);
  expect(e.state.attackQueues).toEqual({});expect(e.state.pendingConflict).toBeNull();expect(e.state.clearPresentations).toEqual([]);
  advance(e,5000);expect(gray(e)).toBe(0);expect(e.state.participants[0]!.score).toBe(score);expect(e.state.participants[1]!.shieldCount).toBe(inventory);
 });
 it('expiry cancels an impact due on exactly the same tick',()=>{
  const e=fixture();e.state.nextPressureAtMs=Infinity;e.enqueueBoardAttack('p2',3,'conflict','p1');
  e.state.attackQueues.p2![0]!.remainingMs=1;e.state.elapsedMs=e.state.durationMs-1;e.step(1);
  expect(e.state.phase).toBe('results');expect(gray(e)).toBe(0);expect(e.state.attackResolutionSerial).toBe(0);
 });
 it('preserves two staggered blocks in the durable resolution ledger',()=>{
  const e=fixture(),t=new AudioEventTracker();t.sync(e.state);
  e.enqueueBoardAttack('p2',1,'pressure');advance(e,500);e.enqueueBoardAttack('p3',1,'pressure');
  e.state.attackQueues.p2![0]!.defended=true;e.state.attackQueues.p3![0]!.defended=true;
  advance(e,3000);expect(e.state.attackQueues.p2![0]).toMatchObject({defended:true,phase:'rise'});
  expect(e.state.attackQueues.p2![0]!.remainingMs).toBeCloseTo(600);
  expect(t.sync(e.state).filter(e=>e.type==='active-defense')).toHaveLength(2);
  expect(t.sync(e.state).filter(e=>e.type==='active-defense')).toHaveLength(0);
 });
 it('partial shield waits for reflection and residual rise without spending twice',()=>{
  const e=fixture(),p=e.state.participants[1]!;p.shieldCount=1;
  e.enqueueBoardAttack('p2',3,'conflict','p1');e.enqueueBoardAttack('p2',1,'conflict','p3');advance(e,3000);
  expect(p.shieldCount).toBe(0);expect(gray(e)).toBe(0);expect(e.state.attackQueues.p2![0]!.phase).toBe('shield');
  advance(e,SHIELD_PRESENTATION_MS);expect(gray(e)).toBe(2);expect(e.state.attackQueues.p2![0]!.phase).toBe('rise');
  advance(e,600);expect(e.state.attackQueues.p2![0]!.remainingMs).toBe(3000);expect(e.state.shieldInventorySerial).toBe(1);
 });
 it('a real active clear blocks only the current event, including pressure',()=>{
  const e=fixture();e.enqueueBoardAttack('p2',1,'pressure');e.enqueueBoardAttack('p2',3,'conflict','p1');
  prepareClearPlaytest(e.state.participants[1]!.board,'normal',1);advance(e,3000);
  expect(gray(e)).toBe(0);expect(e.state.attackQueues.p2![0]!.defended).toBe(true);expect(e.state.attackQueues.p2![1]!.defended).toBe(false);
  advance(e,1100);advance(e,3000);expect(gray(e)).toBe(3);
 });
 it('checkpoint and own prediction retain all lifecycle phases deterministically',()=>{
  for(const phase of ['warning','shield','rise'] as const){const e=fixture();e.state.participants[1]!.shieldCount=1;e.enqueueBoardAttack('p2',3,'conflict','p1');e.enqueueBoardAttack('p2',1,'pressure');
   if(phase!=='warning')advance(e,3000);if(phase==='rise')advance(e,SHIELD_PRESENTATION_MS);
   const r=MatchEngine.restore(JSON.parse(JSON.stringify(e.checkpoint())));
   for(let n=0;n<300;n++){e.step(FIXED_STEP_MS);r.step(FIXED_STEP_MS);expect(r.checkpoint()).toEqual(e.checkpoint());}
  }
 });
 it('pause freezes queues and elimination discards only its recipient',()=>{
  const e=fixture();e.enqueueBoardAttack('p2',1,'pressure');e.enqueueBoardAttack('p3',1,'pressure');e.pause('manual');const before=e.checkpoint();advance(e,5000);expect(e.checkpoint()).toEqual(before);e.resume('manual');e.eliminate('p2');expect(e.state.attackQueues.p2).toBeUndefined();expect(e.state.attackQueues.p3).toHaveLength(1);
 });
 it('simultaneous targets keep independent warnings',()=>{
  const e=fixture();e.enqueueBoardAttack('p2',1,'conflict','p1');advance(e,1000);e.enqueueBoardAttack('p3',3,'conflict','p1');advance(e,2000);expect(gray(e,'p2')).toBe(1);expect(gray(e,'p3')).toBe(0);expect(e.state.attackQueues.p3![0]!.remainingMs).toBeCloseTo(1000);
 });
 it('queues every pressure catch-up without merging, spending or shifting cadence',()=>{
  const e=new MatchEngine([humanPair()[0]!],173,5,{},null,true);e.step(COUNTDOWN_MS);e.state.participants[0]!.shieldCount=100;e.state.elapsedMs=300000;e.state.finalPushActive=true;e.step(1);
  expect(e.state.pressureRows).toBe(14);expect(e.state.nextPressureAtMs).toBe(305000);expect(e.state.attackQueues.p1).toHaveLength(14);expect(e.state.participants[0]!.shieldCount).toBe(100);
 });
 it('successful anomaly has a cue before fire and deduplicates across stale snapshots',()=>{
  const e=fixture(),t=new AudioEventTracker();t.sync(e.state);prepareClearPlaytest(e.state.participants[0]!.board,'fire',2);
  advance(e,600);expect(e.state.anomalyCueEvents).toHaveLength(1);expect(e.state.anomalyBurnEvents).toHaveLength(0);
  const old=structuredClone(e.state);expect(t.sync(e.state).filter(e=>e.type==='anomaly-success')).toHaveLength(1);expect(t.sync(e.state).filter(e=>e.type==='anomaly-success')).toHaveLength(0);
  advance(e,800);expect(e.state.anomalyBurnEvents).toHaveLength(1);t.sync(e.state);t.sync(old);expect(t.sync(e.state).filter(e=>e.type==='anomaly-success')).toHaveLength(0);
  const bootstrap=new AudioEventTracker();expect(bootstrap.sync(e.state)).toEqual([]);
 });
});
