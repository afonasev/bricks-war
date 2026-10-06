import {it,expect} from 'vitest';
import {HeldInput} from '../src/network/heldInput';
import {PredictionJournal} from '../src/network/predictionJournal';
it('50ms confirmations preserve initial delay and repeat ordinals without duplicate presentation',()=>{
  const repeat=new HeldInput(),journal=new PredictionJournal();
  repeat.update({left:true,right:false,down:false},false,1);journal.record(repeat.step(0),1,null,0);
  expect(journal.reconcile(1,1,0)).toEqual([]);
  const times:number[]=[];
  for(let now=10;now<=250;now+=10){const ordinal=repeat.completedRepeats+1;const actions=repeat.step(10);if(actions.length)times.push(now);journal.record(actions,1,ordinal,now);if(now%50===0)journal.reconcile(1,1,0);}
  expect(times).toEqual([140,190,230]);
  expect(journal.reconcile(1,1,1)).toEqual(['move-left','move-left']);
  expect(journal.reconcile(1,1,2)).toEqual(['move-left']);expect(journal.reconcile(1,1,3)).toEqual([]);
  repeat.acknowledge(1,5);expect(repeat.completedRepeats).toBe(5);expect(repeat.step(0)).toEqual([]);
  repeat.update({left:false,right:true,down:false},true,2);journal.record(repeat.step(0),2,null,260);
  expect(journal.reconcile(1,1,5)).toEqual(['move-right','rotate-clockwise']);
  expect(journal.reconcile(2,2,0)).toEqual([]);
  repeat.update({left:false,right:false,down:false},false,3);expect(repeat.holdSequence).toBe(3);expect(repeat.step(500)).toEqual([]);
});
it('journal bounds outstanding repeats, never includes drop actions, and resets every lifecycle generation',()=>{
  const journal=new PredictionJournal();journal.record(['soft-drop-on','move-left'],1,1,0);
  expect(journal.entries).toHaveLength(1);expect(journal.exceeded(301)).toBe(true);
  expect(journal.reconcile(3,3,0)).toEqual([]);
  for(let n=0;n<65;n++)journal.record(['rotate-clockwise'],n,null,10);
  expect(journal.exceeded(10)).toBe(true);journal.reset();expect(journal.entries).toEqual([]);
  const repeat=new HeldInput();repeat.update({left:true,right:false,down:true},true,99);repeat.step(200);repeat.reset();
  expect(repeat.holdSequence).toBe(0);expect(repeat.completedRepeats).toBe(0);expect(repeat.step(1000)).toEqual([]);
});
