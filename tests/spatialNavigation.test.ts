import { describe,it,expect } from 'vitest';
import { spatialIndex } from '../src/ui/spatialNavigation';
import { nameKeyboardRows } from '../src/ui/nameKeyboard';
const box=(x:number,y:number,width=30,height=30)=>({left:x,top:y,right:x+width,bottom:y+height});
describe('screen-direction navigation',()=>{
    it('moves vertically by column and horizontally by row, never snaking or wrapping',()=>{
        const grid=[box(0,0),box(40,0),box(80,0),box(0,40),box(40,40),box(80,40)];
        expect(spatialIndex(grid,4,'previous')).toBe(1);
        expect(spatialIndex(grid,1,'next')).toBe(4);
        expect(spatialIndex(grid,1,'increase')).toBe(2);
        expect(spatialIndex(grid,1,'decrease')).toBe(0);
        expect(spatialIndex(grid,2,'increase')).toBe(2);
        expect(spatialIndex(grid,3,'decrease')).toBe(3);
        expect(spatialIndex(grid,1,'previous')).toBe(1);
        expect(spatialIndex(grid,4,'next')).toBe(4);
    });
    it('uses staggered visible rows and ignores collapsed candidates',()=>{
        const keys=[box(0,0),box(40,0),box(80,0),box(20,40),box(60,40),box(40,20,0,0)];
        expect(spatialIndex(keys,4,'previous')).toBe(1);
        expect(spatialIndex(keys,1,'next')).toBe(3);
        expect(spatialIndex(keys,-1,'next')).toBe(0);
        expect(spatialIndex([],0,'next')).toBe(-1);
    });
    it('provides familiar Russian and Latin rows plus a separate numeric layout',()=>{
        expect(nameKeyboardRows(true).map(r=>r.join(''))).toEqual(['ЙЦУКЕНГШЩЗХЪ','ФЫВАПРОЛДЖЭ','ЯЧСМИТЬБЮ']);
        expect(nameKeyboardRows(false)[0]!.join('')).toBe('QWERTYUIOP');
        expect(nameKeyboardRows(true,true)[0]!.join('')).toBe('1234567890');
    });
});
