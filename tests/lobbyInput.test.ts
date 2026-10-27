import {describe,it,expect} from 'vitest';
import {LobbyYGesture,LOBBY_Y_HOLD_MS,nextLobbyPosition,ownsLobby} from '../src/ui/lobbyInput';
describe('owned lobby gestures and positions',()=>{
 it('binds menu authority to connection identity rather than reused pad index',()=>{
  expect(ownsLobby({kind:'pointer'},0,1)).toBe(false);
  expect(ownsLobby({kind:'gamepad',index:1,token:4},1,4)).toBe(true);
  expect(ownsLobby({kind:'gamepad',index:1,token:4},1,5)).toBe(false);
  expect(ownsLobby({kind:'gamepad',index:1,token:4},0,4)).toBe(false);
 });
 it('moves past humans and drafts, exchanges with bots, wraps and stops when full',()=>{
  expect(nextLobbyPosition(['gamepad-0','human-1','ai-expert','off'],0,new Set())).toBe(2);
  expect(nextLobbyPosition(['gamepad-0','human-1','ai-expert','off'],0,new Set([2]))).toBe(3);
  expect(nextLobbyPosition(['off','human-1','ai-expert','gamepad-0'],3,new Set())).toBe(0);
  expect(nextLobbyPosition(['gamepad-0','human-1','human-2','gamepad-1'],0,new Set())).toBe(0);
 });
 it('one short press moves only on release; a hold edits exactly once and never moves',()=>{
  const y=new LobbyYGesture();
  expect(y.update(0,1,true,true,10)).toBe(null);
  expect(y.update(0,1,false,true,100)).toBe('move');
  expect(y.update(0,1,false,true,110)).toBe(null);
  expect(y.update(0,1,true,true,200)).toBe(null);
  expect(y.update(0,1,true,true,200+LOBBY_Y_HOLD_MS-1)).toBe(null);
  expect(y.update(0,1,true,true,200+LOBBY_Y_HOLD_MS)).toBe('edit');
  expect(y.update(0,1,true,true,2000)).toBe(null);
  expect(y.update(0,1,false,true,2100)).toBe(null);
  y.update(0,1,true,true,3000);
  expect(y.update(0,1,false,true,4000)).toBe('edit'); // delayed frame must not turn a hold into a move
 });
 it('admission cannot carry into movement/edit, and a reconnect cancels old gestures',()=>{
  const y=new LobbyYGesture();
  expect(y.update(0,1,true,false,0)).toBe('join');
  expect(y.update(0,1,true,true,1000)).toBe(null);
  expect(y.update(0,1,false,true,1100)).toBe(null);
  y.update(0,1,true,true,2000);y.retain(new Map([[0,{token:2}]]));
  expect(y.update(0,2,false,true,3000)).toBe(null);
 });
});
