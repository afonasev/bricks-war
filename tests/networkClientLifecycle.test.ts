import {it,expect,vi} from 'vitest';
import {NetworkMatchSession} from '../src/network/client';
import {RoomService} from '../server/rooms';
import {setNetworkParticipation} from '../src/pwa/participation';
import {PROTOCOL_VERSION,RULES_VERSION} from '../src/network/protocol';
it('spawn clears only piece prediction; held release and repeat timing survive ordinary confirmations',async()=>{
  let now=0;const service=new RoomService(()=>now);const a=await service.create('Room','Host'),b=await service.join(a.roomId,'Other');
  const links=[a,b].map(c=>service.connect(c,PROTOCOL_VERSION,RULES_VERSION));const host=links[0]!;
  for(const l of links){service.command(l.room,l.seat,l.epoch,{type:'ack',revision:l.room.revision,visible:true});service.command(l.room,l.seat,l.epoch,{type:'ready',ready:true});}
  service.command(host.room,host.seat,host.epoch,{type:'start'});
  for(let i=0;i<260;i++){now+=1000/60;for(const seat of host.room.seats)seat.lastHealth=now;service.advance();}
  vi.stubGlobal('document',{hidden:false});vi.stubGlobal('WebSocket',{OPEN:1});
  const session=new NetworkMatchSession(a);const raw=session as unknown as {confirm:(s:unknown)=>void;socket:unknown;lastFrame:number};
  const sent:unknown[]=[];raw.socket={readyState:1,send:(text:string)=>sent.push(JSON.parse(text))};session.onResetInput=vi.fn();
  try{
    raw.confirm(service.snapshot(host.room,host.seat));const resets=vi.mocked(session.onResetInput).mock.calls.length;
    session.controls({left:false,right:true,down:false});raw.lastFrame=123;
    const state=service.snapshot(host.room,host.seat);state.revision++;state.state!.participants[0]!.board.spawnSerial++;
    raw.confirm(state);expect(raw.lastFrame).toBe(123);expect(session.onResetInput).toHaveBeenCalledTimes(resets);
    session.controls({left:false,right:false,down:false});expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({type:'input',sequence:2,held:{right:false,left:false,down:false}});
    const nextEpoch=structuredClone(state);nextEpoch.inputEpoch++;raw.confirm(nextEpoch);expect(session.onResetInput).toHaveBeenCalledTimes(resets+1);
  }finally{setNetworkParticipation(false);vi.unstubAllGlobals();}
});

async function playingSession() {
  let now=0;const service=new RoomService(()=>now);
  const a=await service.create('Recovery','Host'),b=await service.join(a.roomId,'Guest');
  const links=[a,b].map(c=>service.connect(c,PROTOCOL_VERSION,RULES_VERSION));const guest=links[1]!;
  for(const l of links){service.command(l.room,l.seat,l.epoch,{type:'ack',revision:l.room.revision,visible:true});service.command(l.room,l.seat,l.epoch,{type:'ready',ready:true});}
  service.command(links[0]!.room,links[0]!.seat,links[0]!.epoch,{type:'start'});
  for(let i=0;i<260;i++){now+=1000/60;for(const seat of guest.room.seats)seat.lastHealth=now;service.advance();}
  vi.stubGlobal('document',{hidden:false});vi.stubGlobal('WebSocket',{OPEN:1});
  const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
  const session=new NetworkMatchSession(b);
  const raw=session as unknown as {confirm:(s:ReturnType<RoomService['snapshot']>)=>void;socket:unknown;pending:unknown[]};
  const sent:any[]=[];const close=vi.fn();raw.socket={readyState:1,send:(text:string)=>sent.push(JSON.parse(text)),close};
  raw.confirm(service.snapshot(guest.room,guest.seat));
  return {service,guest,session,raw,sent,close,advance:(ms:number)=>{now+=ms;for(const seat of guest.room.seats)seat.lastHealth=now;service.advance();},
    cleanup:()=>{clock.mockRestore();setNetworkParticipation(false);vi.unstubAllGlobals();}};
}

it('late input confirmation releases held input once on the same socket and resumes monotonic input',async()=>{
  const f=await playingSession();
  try {
    f.session.controls({left:true,right:false,down:true});
    f.service.command(f.guest.room,f.guest.seat,f.guest.epoch,f.sent[0]);
    f.advance(350);f.session.step();
    expect(f.sent).toHaveLength(2);expect(f.sent[1]).toMatchObject({type:'input',sequence:2,held:{left:false,right:false,down:false}});
    expect(f.close).not.toHaveBeenCalled();expect(f.session.acceptsGameplayInput()).toBe(false);
    for(let i=0;i<10;i++)f.session.step();expect(f.sent).toHaveLength(2);
    f.raw.confirm(f.service.snapshot(f.guest.room,f.guest.seat));expect(f.session.acceptsGameplayInput()).toBe(false);
    f.service.command(f.guest.room,f.guest.seat,f.guest.epoch,f.sent[1]);f.advance(20);
    f.raw.confirm(f.service.snapshot(f.guest.room,f.guest.seat));expect(f.session.acceptsGameplayInput()).toBe(true);
    expect(f.guest.seat.input.held).toEqual({left:false,right:false,down:false});expect(f.guest.seat.absence).toBeNull();
    f.session.controls({left:false,right:true,down:false});expect(f.sent[2].sequence).toBe(3);
    f.service.command(f.guest.room,f.guest.seat,f.guest.epoch,f.sent[2]);expect(f.close).not.toHaveBeenCalled();
  }finally{f.cleanup();}
});

it('pending bound reserves its final slot for neutral release instead of disconnecting',async()=>{
  const f=await playingSession();
  try {
    for(let i=0;i<64;i++)f.session.controls({left:i%2===0,right:i%2!==0,down:false});
    expect(f.sent).toHaveLength(64);expect(f.raw.pending).toHaveLength(64);
    expect(f.sent.at(-1)).toMatchObject({sequence:64,held:{left:false,right:false,down:false}});
    for(const input of f.sent)f.service.command(f.guest.room,f.guest.seat,f.guest.epoch,input);
    expect(f.guest.seat.queue).toHaveLength(64);expect(f.close).not.toHaveBeenCalled();
  }finally{f.cleanup();}
});

it('complete-snapshot timeout closes a silent downstream even while upstream heartbeats succeed',()=>{
  vi.useFakeTimers();
  const clock=vi.spyOn(performance,'now').mockImplementation(()=>Date.now());
  const close=vi.fn(),send=vi.fn();
  class Socket {static OPEN=1;static CONNECTING=0;readyState=1;close=close;send=send;}
  vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('location',{href:'http://localhost/',protocol:'http:'});
  vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});
  const session=new NetworkMatchSession({roomId:'r',participantId:'p',token:'t'});
  try {session.connect();vi.advanceTimersByTime(4000);expect(send).toHaveBeenCalledTimes(2);expect(close).not.toHaveBeenCalled();vi.advanceTimersByTime(2000);expect(close).toHaveBeenCalledOnce();}
  finally{session.dispose();clock.mockRestore();vi.unstubAllGlobals();vi.useRealTimers();}
});

it('snapshot between heartbeat ticks resets the exact six-second downstream deadline',async()=>{
  const service=new RoomService(()=>0);const credential=await service.create('Watchdog','Guest');
  const link=service.connect(credential,PROTOCOL_VERSION,RULES_VERSION);service.command(link.room,link.seat,link.epoch,{type:'ack',revision:link.room.revision,visible:true});
  vi.useFakeTimers();const close=vi.fn();
  class Socket {static OPEN=1;static CONNECTING=0;readyState=1;close=close;send=vi.fn();}
  vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('location',{href:'http://localhost/',protocol:'http:'});
  vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});
  const session=new NetworkMatchSession(credential);
  try {
    session.connect();vi.advanceTimersByTime(1900);
    (session as unknown as {confirm:(s:unknown)=>void}).confirm(service.snapshot(link.room,link.seat));
    vi.advanceTimersByTime(5999);expect(close).not.toHaveBeenCalled();vi.advanceTimersByTime(1);expect(close).toHaveBeenCalledOnce();
  }finally{session.dispose();setNetworkParticipation(false);vi.unstubAllGlobals();vi.useRealTimers();}
});

it('does not replay pending prediction or held controls over an authoritative arrival freeze',async()=>{
  const f=await playingSession();
  try {
    f.session.controls({left:true,right:false,down:true});
    const snapshot=f.service.snapshot(f.guest.room,f.guest.seat);
    const state=snapshot.state!;const participant=state.participants.find(p=>p.config.id===snapshot.ownId)!;
    const pose=structuredClone(participant.board.active!);
    state.anomalyTransition={serial:1,phase:'burning',remainingMs:500,durationMs:1000,levels:[1],targets:[{participantId:snapshot.ownId,piece:pose}]};
    f.raw.confirm(snapshot);
    expect(f.session.acceptsGameplayInput()).toBe(false);
    expect(f.session.state.participants[0]!.board.active).toEqual(pose);
    const sent=f.sent.length;f.session.controls({left:false,right:true,down:false});f.session.step();
    expect(f.sent).toHaveLength(sent);
    f.raw.confirm(snapshot);expect(f.session.state.participants[0]!.board.active).toEqual(pose);
  } finally {f.cleanup();}
});
