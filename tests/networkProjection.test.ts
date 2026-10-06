import {it,expect} from 'vitest';
import {projectedState} from '../src/network/client';
import {MatchEngine} from '../src/simulation/match';
it('eighth seat stays the main field; top-three includes eliminated scorers and keeps canonical ties/palettes',()=>{
  const engine=new MatchEngine(Array.from({length:8},(_,i)=>({id:`seat-${i}`,label:`Human ${i}`,controller:'mobile-touch' as const,tileStyle:'classic' as const})),17,5,{conflictEnabled:false,matchVariant:'free-for-all'},null,true,'network');
  const state=engine.state;state.participants[4]!.score=900;state.participants[1]!.score=400;state.participants[2]!.score=400;state.participants[3]!.score=300;
  engine.eliminate('seat-4');const before=structuredClone(state);
  const first=projectedState(state,'seat-7');expect(first.participants.map(p=>p.config.id)).toEqual(['seat-7','seat-4','seat-1','seat-2']);
  expect(first.participants.map(p=>p.config.controllerLabel)).toEqual(['7','4','1','2']);expect(first.participants[1]!.board.alive).toBe(false);
  expect(state).toEqual(before);state.participants[6]!.score=600;
  expect(projectedState(state,'seat-7').participants.map(p=>p.config.id)).toEqual(['seat-7','seat-4','seat-6','seat-1']);expect(state.participants).toHaveLength(8);
});
