import { describe, expect, it } from 'vitest';
import { loadNetworkStyle, saveNetworkStyle, NETWORK_STYLE_KEY } from '../src/network/stylePreference';

describe('network player style preference',()=>{
  it('defaults to random for absent, invalid and unavailable storage',()=>{
    for(const value of [null,'unknown','"classic"','random'])expect(loadNetworkStyle({getItem:()=>value})).toBe('random');
    expect(loadNetworkStyle(null)).toBe('random');
    expect(loadNetworkStyle({getItem:()=>{throw new Error('blocked');}})).toBe('random');
  });
  it('remembers an explicit choice and allows returning to random',()=>{
    const values=new Map<string,string>();
    const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
    saveNetworkStyle('stone-fortress',storage);expect(loadNetworkStyle(storage)).toBe('stone-fortress');
    saveNetworkStyle('unknown',storage);expect(loadNetworkStyle(storage)).toBe('stone-fortress');
    saveNetworkStyle('random',storage);expect(loadNetworkStyle(storage)).toBe('random');expect(values.get(NETWORK_STYLE_KEY)).toBe('random');
    expect(()=>saveNetworkStyle('classic',{setItem:()=>{throw new Error('blocked');}})).not.toThrow();
  });
});
