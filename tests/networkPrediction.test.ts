import {it,expect} from 'vitest';
import {HeldInput} from '../src/network/heldInput';
it('held actions preserve DAS and ARR timing with no duplicate initial movement',()=>{
  const repeat=new HeldInput();repeat.update({left:true,right:false,down:false},false,1);
  expect(repeat.step(0)).toEqual(['move-left']);const times:number[]=[];
  for(let now=10;now<=250;now+=10)if(repeat.step(10).length)times.push(now);
  expect(times).toEqual([140,190,230]);
  repeat.update({left:false,right:true,down:false},true,2);expect(repeat.step(0)).toEqual(['move-right','rotate-clockwise']);
  repeat.update({left:false,right:false,down:false},false,3);expect(repeat.step(500)).toEqual([]);
});
it('drop transitions are explicit and lifecycle reset clears every held action',()=>{
  const repeat=new HeldInput();repeat.update({left:false,right:false,down:true},false,1);expect(repeat.step(0)).toEqual(['soft-drop-on']);
  repeat.update({left:false,right:false,down:false},false,2);expect(repeat.step(0)).toEqual(['soft-drop-off']);
  repeat.update({left:true,right:false,down:true},true,3);repeat.step(200);repeat.reset();
  expect(repeat.holdSequence).toBe(0);expect(repeat.completedRepeats).toBe(0);expect(repeat.step(1000)).toEqual([]);
});
