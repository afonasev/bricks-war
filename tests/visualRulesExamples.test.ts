import { describe, expect, it } from 'vitest';
import { RULE_EXAMPLES, SCORE_EXAMPLES, RISING_EXAMPLE } from '../src/ui/visualRulesExamples';
import { clearCompletedLines, createBoard, burnBottomRows, addGrayRows } from '../src/simulation/board';
import { isValidAnomaly } from '../src/simulation/anomaly';
import { attackRowsForLines, scoreForLines, nextShieldCharge } from '../src/simulation/match';
import type { Grid } from '../src/domain/types';
const decode=(rows:readonly string[]):Grid=>rows.map(row=>[...row].map(c=>c==='.'?null:c==='#'?'garbage':c==='X'?'T':'O'));
describe('rules illustrations follow actual mechanics',()=>{
 for(const [name,e] of Object.entries(RULE_EXAMPLES)) {
  it(`${name}: piece fits its holes, rests on support, and clears to the drawn state`,()=>{
   const grid=e.before.map(row=>[...row] as string[]);
   for(const [dx,dy] of e.shape) {expect(grid[e.y+dy]?.[e.x+dx]).toBe('.');grid[e.y+dy]![e.x+dx]='X';}
   expect(grid.map(row=>row.join(''))).toEqual(e.locked);
   expect(e.shape.some(([dx,dy])=>e.y+dy+1>=4 || e.before[e.y+dy+1]?.[e.x+dx]!=='.')).toBe(true);
   const result=decode(e.locked); expect(clearCompletedLines(result)).toBe(e.lines);expect(result).toEqual(decode(e.cleared));
  });
 }
 it('anomaly is connected, valid, and burns one more bottom row after one clear',()=>{
  const e=RULE_EXAMPLES.anomaly;
  expect(isValidAnomaly(e.shape.map(([x,y])=>({x,y})))).toBe(true);
  const visited=new Set([0]);for(let n=0;n<e.shape.length;n++) e.shape.forEach(([x,y],i)=>{if(e.shape.some(([a,b],j)=>visited.has(j)&&Math.abs(x-a)+Math.abs(y-b)===1))visited.add(i);});expect(visited.size).toBe(6);
  const board=createBoard('T','O'); board.active=null; board.grid.splice(-4,4,...decode(e.cleared));
  expect(burnBottomRows(board,1)).toEqual(decode(['##########'])); expect(board.grid.slice(-4)).toEqual(decode(e.burned));
 });
 it('each score drawing clears the stated number of rows and earns the stated score',()=>{
  SCORE_EXAMPLES.forEach((rows,i)=>{const grid=decode(rows);expect(clearCompletedLines(grid)).toBe(i+1);expect(scoreForLines(i+1)).toBe([100,300,500,800][i]);expect(rows.join('').split('X').length-1).toBe(4);});
 });
 it('the identical stack rises exactly one row and attacks use the stated conversion',()=>{
  const board=createBoard('T','O'); board.active=null; board.grid.splice(-4,4,...decode(RISING_EXAMPLE.before)); addGrayRows(board,1);expect(board.grid.slice(-4)).toEqual(decode(RISING_EXAMPLE.after));
  expect([2,3,4].map(attackRowsForLines)).toEqual([1,3,4]);
 });
 it('shield storyboard earns on second and subsequent qualifying placements only',()=>{
  for(const survival of [false,true]) {
   let streak=0; const gains=[1,2,3].map(()=>{const result=nextShieldCharge(streak,0,false,1,'classic',survival);streak=result.lineClearStreak;return result.kind;});expect(gains).toEqual([null,'full','full']);
   expect(nextShieldCharge(2,0,false,0,'classic',survival).lineClearStreak).toBe(0);
   expect(nextShieldCharge(2,0,false,1,'anomaly',survival).lineClearStreak).toBe(0);
  }
  expect(nextShieldCharge(1,0,false,2,'classic',false).kind).toBe(null);
  expect(nextShieldCharge(1,0,false,2,'classic',true).kind).toBe('full');
 });
});
