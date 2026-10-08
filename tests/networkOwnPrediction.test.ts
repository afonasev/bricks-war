import {describe, it, expect} from 'vitest';
import {MatchEngine, FIXED_STEP_MS, encodeMatchState} from '../src/simulation/match';
import type {GameAction} from '../src/domain/types';
import {humanPair} from './fixtures';
import {prepareClearPlaytest} from '../src/ui/clearPlaytest';
import {OwnPrediction} from '../src/network/ownPrediction';
import {ScheduledInput} from '../src/network/scheduledInput';
import {PROTOCOL_VERSION,RULES_VERSION,type ClientSnapshot,type InputEnvelope} from '../src/network/protocol';

function engine(){const e=new MatchEngine(humanPair(),123,5,{},null,true,'network');e.step(3000);return e;}
function snapshot(e:MatchEngine,tick:number,ack=0):ClientSnapshot{return {
  type:'snapshot',protocol:PROTOCOL_VERSION,rulesVersion:RULES_VERSION,serviceId:'s',revision:tick,
  room:{id:'r',name:'r',count:2,capacity:8,protected:false,phase:'playing'},rules:{battleDifficulty:'normal',softDrop:'fast'},creatorId:'p1',seats:[],
  ownId:'p1',connectionEpoch:1,inputEpoch:1,inputAck:ack,repeatSequence:0,repeatOrdinal:0,matchId:'m',tick,
  state:encodeMatchState(e.state),prediction:e.predictionCheckpoint(),manualPausedBy:null,events:[]};}
function command(tick:number,spawnSerial:number,actions:GameAction[],sequence=tick):InputEnvelope{return {
  type:'input',matchId:'m',connectionEpoch:1,inputEpoch:1,sequence,targetTick:tick,spawnSerial,actions,
  held:{left:actions.includes('move-left'),right:actions.includes('move-right'),down:actions.includes('soft-drop-on')},rotate:actions.includes('rotate-clockwise')};}

describe('full own lifecycle prediction',()=>{
  it('shares gravity, preparation, lock and successive spawns while freezing every opponent',()=>{
    const authoritative=engine();
    const predicted=MatchEngine.restorePrediction(encodeMatchState(authoritative.state),authoritative.predictionCheckpoint());
    const other=structuredClone(predicted.state.participants[1]);
    let maxSpawn=0;
    for(let tick=1;tick<=1800;tick++){
      const actions:GameAction[]=tick%20===1?['soft-drop-on']:tick%20===0?['soft-drop-off']:tick%40===2?['rotate-clockwise']:[];
      authoritative.step(FIXED_STEP_MS,new Map([['p1',actions]]));predicted.stepOwnPrediction('p1',FIXED_STEP_MS,actions);
      expect(predicted.state.participants[0]).toEqual(authoritative.state.participants[0]);
      expect(predicted.state.participants[1]).toEqual(other);
      expect(predicted.state.phase).toBe('playing');expect(predicted.state.winnerIds).toEqual([]);
      maxSpawn=Math.max(maxSpawn,predicted.state.participants[0]!.board.spawnSerial);
    }
    expect(maxSpawn).toBeGreaterThanOrEqual(4);
  });
  it.each(['normal','fire'] as const)('restores %s clear and burn transactions and spawns identically',kind=>{
    const authoritative=engine();prepareClearPlaytest(authoritative.state.participants[0]!.board,kind,2,0);
    authoritative.step(FIXED_STEP_MS);
    const predicted=MatchEngine.restorePrediction(encodeMatchState(authoritative.state),authoritative.predictionCheckpoint());
    for(let tick=0;tick<150;tick++){
      authoritative.step(FIXED_STEP_MS);predicted.stepOwnPrediction('p1',FIXED_STEP_MS);
      expect(predicted.state.participants[0]).toEqual(authoritative.state.participants[0]);
    }
  });
  it('replays to the same tick across ACK and multiple speculative spawns without snapback',()=>{
    const authoritative=engine(),predictor=new OwnPrediction();
    const pending:InputEnvelope[]=[];let sequence=0;
    predictor.confirm(snapshot(authoritative,0),pending,12);
    let verifiedSpawns=0;
    for(let serverTick=1;serverTick<=1000;serverTick++){
      const own=predictor.engine!.state.participants[0]!;
      const actions:GameAction[]=serverTick%20===1?['soft-drop-on']:serverTick%20===0?['soft-drop-off']:serverTick%90===2?['rotate-clockwise']:[];
      if(actions.length)pending.push(command(predictor.tick+1,own.board.spawnSerial,actions,++sequence));
      predictor.advanceTo(predictor.tick+1,pending);
      const due=pending.filter(i=>i.targetTick===serverTick);
      authoritative.step(FIXED_STEP_MS,new Map([['p1',due.flatMap(i=>i.actions)]]));
      if(serverTick%3===0){
        const before=structuredClone(predictor.engine!.state.participants[0]!.board);
        const ack=Math.max(0,...pending.filter(i=>i.targetTick<=serverTick).map(i=>i.sequence));
        pending.splice(0,pending.findIndex(i=>i.targetTick>serverTick)<0?pending.length:pending.findIndex(i=>i.targetTick>serverTick));
        predictor.confirm(snapshot(authoritative,serverTick,ack),pending,predictor.tick);
        expect(predictor.engine!.state.participants[0]!.board).toEqual(before);
        verifiedSpawns=Math.max(verifiedSpawns,before.spawnSerial);
        expect(predictor.present(authoritative.state).participants[1]).toBe(authoritative.state.participants[1]);
      }
    }
    expect(verifiedSpawns).toBeGreaterThanOrEqual(3);
  });
  it('caps replay work even when a remote tick request is unbounded',()=>{
    const predictor=new OwnPrediction(),a=engine();predictor.confirm(snapshot(a,0),[],1e9);
    expect(predictor.tick).toBe(120);
    expect(predictor.engine!.state.elapsedMs).toBeCloseTo(2000);
  });
});

it('scheduled cadence rejects manufactured repeats, future ticks and wrong-direction actions',()=>{
  const validator=new ScheduledInput();
  const first=command(10,1,['move-left'],1);expect(validator.accept(first,0)).toBe(true);
  expect(validator.accept({...first,sequence:2,targetTick:11},0)).toBe(false);
  expect(validator.accept({...first,sequence:2,targetTick:19},0)).toBe(true);
  expect(validator.accept({...first,sequence:3,targetTick:100},0)).toBe(false);
  expect(validator.accept({...first,sequence:3,targetTick:22,actions:['move-right']},0)).toBe(false);
});

it('ancient hold onset cannot accumulate cadence credit and same-tick repeat bursts are rejected',()=>{
  const validator=new ScheduledInput();
  expect(validator.accept(command(0,1,['move-left'],1),10000)).toBe(false);
  expect(validator.accept(command(9900,1,['move-left'],1),10000)).toBe(true);
  expect(validator.accept(command(10001,1,['move-left'],2),10000)).toBe(true);
  expect(validator.accept(command(10001,1,['move-left'],3),10000)).toBe(false);
});

 it('reconciled geometry invalidates rendering even with the same simulation mutation count',()=>{
  const a=engine(),predictor=new OwnPrediction();predictor.confirm(snapshot(a,0),[],0);
  const first=predictor.present(a.state).participants[0]!.board.staticRenderRevision;
  a.state.participants[0]!.board.grid[21]![0]='I';
  predictor.confirm(snapshot(a,0),[],0);
  const second=predictor.present(a.state).participants[0]!.board.staticRenderRevision;
  expect(second).not.toBe(first);
  predictor.confirm(snapshot(a,0),[],0);
  expect(predictor.present(a.state).participants[0]!.board.staticRenderRevision).toBe(second);
  expect(a.state.participants[0]!.board.staticRenderRevision).toBeGreaterThanOrEqual(0);
});

it('an ancient neutral can release input but cannot carry movement, rotation or future scheduling',()=>{
  const validator=new ScheduledInput();
  expect(validator.accept(command(10,1,['soft-drop-on'],1),10)).toBe(true);
  const release=command(11,1,['soft-drop-off'],2);
  expect(validator.accept({...release,actions:['soft-drop-off','move-left']},10000)).toBe(false);
  expect(validator.accept({...release,actions:['soft-drop-off','rotate-clockwise'],rotate:true},10000)).toBe(false);
  expect(validator.accept({...release,targetTick:10061},10000)).toBe(false);
  expect(validator.accept({...release,targetTick:-1},10000)).toBe(false);
  expect(validator.accept(release,10000)).toBe(true);
  expect(validator.accept(command(12,1,['move-left'],3),10000)).toBe(false);
  expect(validator.accept(command(10001,1,['move-left'],3),10000)).toBe(true);
});

describe('shield phase prediction composition', () => {
  it('replays residual insertion and pairs the own shield phase with the own predicted grid', () => {
    const authority = engine();
    authority.state.participants[0]!.shieldCount = 1;
    authority.state.participants[0]!.shieldReady = true;
    authority.state.pendingConflict = {serial:1,remainingWarningMs:1,senders:[],incomingRows:{p1:4}};
    authority.step(2);
    const predictor = new OwnPrediction();
    predictor.confirm(snapshot(authority,0),[],0);
    const opponent = structuredClone(predictor.engine!.state.participants[1]);
    for (let tick=1;tick<=72;tick++) {
      authority.step(FIXED_STEP_MS);
      predictor.advanceTo(tick,[]);
      expect(predictor.engine!.state.participants[0]).toEqual(authority.state.participants[0]);
      expect(predictor.engine!.state.shieldPresentations).toEqual(authority.state.shieldPresentations);
      expect(predictor.engine!.state.participants[1]).toEqual(opponent);
      const presented = predictor.present(authority.state);
      expect(presented.shieldPresentations).toEqual(predictor.engine!.state.shieldPresentations);
    }
    expect(authority.state.participants[0]!.board.grid.filter(row=>row.includes('garbage'))).toHaveLength(3);
  });
});
