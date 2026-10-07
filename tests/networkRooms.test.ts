import { describe, expect, it } from 'vitest';
import { RoomService, RoomError } from '../server/rooms';
import { PROTOCOL_VERSION, RULES_VERSION, RETURN_WINDOW_MS, type Credential, type InputEnvelope } from '../src/network/protocol';
function fixture() {
  let now=0;const service=new RoomService(()=>now);
  const connect=(c:Credential)=>{const link=service.connect(c,PROTOCOL_VERSION,RULES_VERSION);service.command(link.room,link.seat,link.epoch,{type:'ack',revision:link.room.revision,visible:true});return link;};
  const advance=(ms:number)=>{for(let n=0;n<ms;n+=10){now+=Math.min(10,ms-n);for(const r of service.rooms.values())for(const s of r.seats)if(s.connected&&!s.absence)s.lastHealth=now;service.advance();}};
  const jump=(ms:number)=>{now+=ms;};
  const room=async(count=3,password='')=>{
    const credentials=[await service.create('Public room','Creator',password)];
    for(let i=1;i<count;i++)credentials.push(await service.join(credentials[0]!.roomId,`Player ${i}`,password));
    const links=credentials.map(connect);
    for(const l of links)service.command(l.room,l.seat,l.epoch,{type:'ready',ready:true});
    return {credentials,links,room:links[0]!.room};
  };
  const start=(l:ReturnType<typeof connect>)=>service.command(l.room,l.seat,l.epoch,{type:'start'});
  return {service,connect,advance,jump,room,start};
}
describe('authoritative room lifecycle',()=>{
  it('creates and joins with random styles until the player selects their own',async()=>{
    const f=fixture();const host=await f.service.create('Styles','Host');const guest=await f.service.join(host.roomId,'Guest');
    const a=f.connect(host);const b=f.connect(guest);
    expect(a.room.seats.map(s=>s.tileStyle)).toEqual(['random','random']);
    f.service.command(b.room,b.seat,b.epoch,{type:'profile',name:'Guest',tileStyle:'stone-fortress'});
    expect(a.room.seats.map(s=>s.tileStyle)).toEqual(['random','stone-fortress']);
  });
  it('public protected discovery hides secrets, wrong password never allocates, cap and single-seat start reject',async()=>{
    const f=fixture();const c=await f.service.create('Visible','Host','secret');
    expect(f.service.list().rooms[0]).toMatchObject({name:'Visible',count:1,protected:true});
    await expect(f.service.join(c.roomId,'Intruder','wrong')).rejects.toThrow('Неверный пароль');
    expect(f.service.get(c.roomId).seats).toHaveLength(1);
    const link=f.connect(c);f.service.command(link.room,link.seat,link.epoch,{type:'ready',ready:true});
    expect(()=>f.start(link)).toThrow();
    for(let i=1;i<8;i++)await f.service.join(c.roomId,`Human ${i}`,'secret');
    await expect(f.service.join(c.roomId,'Ninth','secret')).rejects.toThrow();
    const publicData=JSON.stringify(f.service.snapshot(link.room,link.seat));
    expect(publicData).not.toContain(c.token);expect(publicData).not.toContain('verifier');expect(publicData).not.toContain('secret');
  });
  it.each([2,4,8])('starts exactly %i human boards with reset readiness and preserved score-ranked results',async(count)=>{
    const f=fixture();const group=await f.room(count);const host=group.links[0]!;
    f.service.command(host.room,host.seat,host.epoch,{type:'rules',rules:{battleDifficulty:'family',softDrop:'fast'}});
    expect(group.room.seats.every(s=>!s.ready)).toBe(true);expect(()=>f.start(host)).toThrow();
    for(const l of group.links)f.service.command(l.room,l.seat,l.epoch,{type:'ready',ready:true});
    expect(()=>f.start(group.links[1]!)).toThrow();f.start(host);f.advance(4000);
    expect(group.room.engine!.state.participants).toHaveLength(count);
    await expect(f.service.join(group.room.id,'Late')).rejects.toThrow();
    group.room.engine!.state.participants[0]!.score=500;
    for(const p of group.room.engine!.state.participants)group.room.engine!.eliminate(p.config.id);
    f.service.advance();
    expect(group.room.engine!.state.phase).toBe('results');expect(group.room.engine!.state.participants[0]!.placement).toBe(1);
    expect(group.room.events.filter(e=>e.kind==='results')).toHaveLength(1);f.service.advance();
    expect(group.room.events.filter(e=>e.kind==='results')).toHaveLength(1);
    const matchId=group.room.matchId;f.service.command(host.room,host.seat,host.epoch,{type:'lobby'});
    for(const l of group.links)f.service.command(l.room,l.seat,l.epoch,{type:'ready',ready:true});f.start(host);
    expect(group.room.matchId).not.toBe(matchId);
  });
  it('manual pauser ownership, hidden blockers and independent exact deadlines never conflate',async()=>{
    const f=fixture();const g=await f.room();f.start(g.links[0]!);f.advance(4200);
    const a=g.links[1]!,b=g.links[2]!,host=g.links[0]!;
    f.service.command(a.room,a.seat,a.epoch,{type:'pause'});
    f.service.command(b.room,b.seat,b.epoch,{type:'pause'});expect(g.room.manualPausedBy).toBe(a.seat.id);
    expect(()=>f.service.command(b.room,b.seat,b.epoch,{type:'resume'})).toThrow();
    f.service.disconnect(a.room,a.seat,a.epoch);const deadline=a.seat.absence!.deadline;
    f.advance(5000);f.service.disconnect(b.room,b.seat,b.epoch);
    f.service.disconnect(a.room,a.seat,a.epoch);expect(a.seat.absence!.deadline).toBe(deadline);
    f.service.command(host.room,host.seat,host.epoch,{type:'resume'});expect(g.room.engine!.state.phase).toBe('paused');
    const elapsed=g.room.engine!.state.elapsedMs;
    f.advance(24990);expect(a.seat.retained).toBe(true);expect(g.room.engine!.state.elapsedMs).toBe(elapsed);
    f.advance(10);expect(a.seat.retained).toBe(false);expect(b.seat.retained).toBe(true);expect(g.room.engine!.state.phase).toBe('paused');
    f.advance(5000);expect(b.seat.retained).toBe(false);expect(g.room.engine!.state.phase).toBe('playing');
  });
  it('acknowledged visible return preserves exact field, resets epochs, old socket revoked, repeated absence gets fresh deadline',async()=>{
    const f=fixture();const g=await f.room(2);f.start(g.links[0]!);f.advance(4100);
    const old=g.links[1]!;const board=structuredClone(g.room.engine!.state.participants[1]!.board);
    f.service.disconnect(old.room,old.seat,old.epoch);const epoch=g.room.inputEpoch;f.advance(20000);
    const fresh=f.service.connect(g.credentials[1]!,PROTOCOL_VERSION,RULES_VERSION);
    expect(g.room.engine!.state.phase).toBe('paused');
    expect(()=>f.service.command(old.room,old.seat,old.epoch,{type:'pause'})).toThrow();
    f.service.command(fresh.room,fresh.seat,fresh.epoch,{type:'ack',revision:fresh.room.revision,visible:true});
    expect(g.room.engine!.state.participants[1]!.board).toEqual(board);expect(g.room.inputEpoch).toBeGreaterThan(epoch);
    expect(g.room.engine!.state.phase).toBe('playing');
    f.service.disconnect(fresh.room,fresh.seat,fresh.epoch);
    expect(fresh.seat.absence!.deadline).toBe(24100+RETURN_WINDOW_MS);
  });
  it('opening a socket before deadline without state acknowledgement loses at exact boundary',async()=>{
    const f=fixture();const g=await f.room(2);f.start(g.links[0]!);const a=g.links[1]!;
    f.service.disconnect(a.room,a.seat,a.epoch);f.advance(29999);
    const returning=f.service.connect(g.credentials[1]!,PROTOCOL_VERSION,RULES_VERSION);f.jump(1);
    expect(()=>f.service.command(returning.room,returning.seat,returning.epoch,{type:'ack',revision:returning.room.revision,visible:true})).toThrow();
    expect(a.seat.retained).toBe(false);
  });
  it('eliminated observers never freeze; eliminated creator reserves rights thirty seconds independently',async()=>{
    const f=fixture();const g=await f.room();f.start(g.links[0]!);f.advance(4000);
    const host=g.links[0]!,observer=g.links[2]!;
    g.room.engine!.eliminate(observer.seat.id);f.service.disconnect(observer.room,observer.seat,observer.epoch);
    expect(g.room.engine!.state.phase).toBe('playing');expect(observer.seat.absence!.blocksGameplay).toBe(false);
    g.room.engine!.eliminate(host.seat.id);f.service.disconnect(host.room,host.seat,host.epoch);
    expect(g.room.creatorId).toBe(host.seat.id);expect(g.room.engine!.state.phase).toBe('playing');
    expect(()=>f.service.command(g.links[1]!.room,g.links[1]!.seat,g.links[1]!.epoch,{type:'exclude',participantId:host.seat.id})).toThrow();
    f.advance(29999);expect(g.room.creatorId).toBe(host.seat.id);f.advance(1);expect(g.room.creatorId).toBe(g.links[1]!.seat.id);
    expect(g.room.engine!.state.phase).toBe('playing');
  });
  it('creator timeout transfers in join order while another blocker/manual pause persists, early exclusion cannot clear manual',async()=>{
    const f=fixture();const g=await f.room();f.start(g.links[0]!);f.advance(3500);
    f.service.command(g.room,g.links[0]!.seat,g.links[0]!.epoch,{type:'pause'});
    f.service.disconnect(g.room,g.links[0]!.seat,g.links[0]!.epoch);f.advance(5000);
    f.service.disconnect(g.room,g.links[2]!.seat,g.links[2]!.epoch);f.advance(25000);
    const next=g.links[1]!;expect(g.room.creatorId).toBe(next.seat.id);expect(g.room.engine!.state.phase).toBe('paused');
    f.service.command(g.room,next.seat,next.epoch,{type:'exclude',participantId:g.links[2]!.seat.id});
    expect(g.room.engine!.state.phase).toBe('paused');f.service.command(g.room,next.seat,next.epoch,{type:'resume'});
    expect(g.room.engine!.state.phase).toBe('playing');
  });
  it('repeated hidden observer heartbeats preserve surviving input epochs and simulation time',async()=>{
    const f=fixture();const g=await f.room();f.start(g.links[0]!);f.advance(4200);
    const survivor=g.links[1]!,observer=g.links[2]!;
    g.room.engine!.eliminate(observer.seat.id);const epoch=survivor.seat.inputEpoch;
    const elapsed=g.room.engine!.state.elapsedMs;
    for(let n=0;n<20;n++){
      f.service.command(g.room,observer.seat,observer.epoch,{type:'heartbeat',visible:false});f.advance(100);
      expect(survivor.seat.inputEpoch).toBe(epoch);
    }
    expect(g.room.engine!.state.elapsedMs-elapsed).toBeCloseTo(2000,4);
    expect(g.room.engine!.state.phase).toBe('playing');
    expect(()=>f.service.command(g.room,observer.seat,observer.epoch,{type:'input',matchId:g.room.matchId!,connectionEpoch:observer.epoch,inputEpoch:observer.seat.inputEpoch,targetTick:g.room.tick+1,spawnSerial:g.room.engine!.state.participants[0]!.board.spawnSerial,actions:['move-left'],sequence:1,held:{left:true,right:false,down:false},rotate:false})).toThrow();
  });
  it.each(['expiry','exclusion'])('an already eliminated observer cannot emit another elimination on %s',async(method)=>{
    const f=fixture();const g=await f.room();f.start(g.links[0]!);f.advance(4200);const observer=g.links[2]!;
    g.room.engine!.eliminate(observer.seat.id);g.room.events.push({id:'already-eliminated',kind:'elimination',participantId:observer.seat.id});
    f.service.disconnect(g.room,observer.seat,observer.epoch);
    if(method==='expiry')f.advance(30000);else f.service.command(g.room,g.links[0]!.seat,g.links[0]!.epoch,{type:'exclude',participantId:observer.seat.id});
    expect(g.room.events.filter(e=>e.kind==='elimination'&&e.participantId===observer.seat.id)).toHaveLength(1);expect(observer.seat.retained).toBe(false);
  });
  it('all disconnects expire, terminate once, retain result ten minutes and remove empty waiting rooms',async()=>{
    const f=fixture();const g=await f.room(8);f.start(g.links[0]!);
    for(const l of g.links)f.service.disconnect(g.room,l.seat,l.epoch);f.advance(30000);
    expect(g.room.engine!.state.phase).toBe('results');expect(g.room.creatorId).toBeNull();
    expect(g.room.events.filter(e=>e.kind==='results')).toHaveLength(1);f.advance(600000);expect(f.service.rooms.size).toBe(0);
    await f.service.create('Unused','Never connects');f.advance(30000);expect(f.service.rooms.size).toBe(0);
  });
  it('silent failures detect at six seconds and start thirty seconds at detection',async()=>{
    const f=fixture();const g=await f.room(2);f.start(g.links[0]!);f.jump(6000);f.service.advance();
    expect(g.room.seats.every(s=>s.absence?.deadline===36000)).toBe(true);expect(g.room.engine!.state.phase).toBe('paused');
  });
  it('strict input sequence/epochs reject spoofed/stale commands; duplicate input acts once and flood bounds queue',async()=>{
    const f=fixture();const g=await f.room(2);f.start(g.links[0]!);f.advance(4500);
    const l=g.links[0]!;const input:InputEnvelope={type:'input',matchId:g.room.matchId!,connectionEpoch:l.epoch,inputEpoch:l.seat.inputEpoch,
      targetTick:g.room.tick+1,spawnSerial:g.room.engine!.state.participants[0]!.board.spawnSerial,actions:['move-left'],sequence:1,held:{left:true,right:false,down:false},rotate:false};
    f.service.command(g.room,l.seat,l.epoch,input);f.service.command(g.room,l.seat,l.epoch,input);expect(l.seat.queue).toHaveLength(1);
    expect(()=>f.service.command(g.room,l.seat,l.epoch,{...input,sequence:2,matchId:'old'})).toThrow();
    expect(()=>f.service.command(g.room,l.seat,l.epoch,{...input,sequence:2,inputEpoch:0})).toThrow();
    for(let seq=2;seq<=64;seq++)f.service.command(g.room,l.seat,l.epoch,{...input,sequence:seq,actions:[]});
    expect(()=>f.service.command(g.room,l.seat,l.epoch,{...input,sequence:65})).toThrow(RoomError);
    expect(l.seat.queue).toHaveLength(64);
    f.service.command(g.room,l.seat,l.epoch,{type:'pause'});expect(l.seat.queue).toHaveLength(0);expect(l.seat.input.held.down).toBe(false);
  });
  it('does not apply a newly arrived short tap to simulation debt from before its arrival',async()=>{
    const f=fixture();const g=await f.room(2);f.start(g.links[0]!);f.advance(4500);
    const link=g.links[0]!,board=g.room.engine!.state.participants[0]!.board;
    const x=board.active!.x;
    f.jump(1000); // A delayed callback has one second of older simulation debt.
    const input:InputEnvelope={type:'input',matchId:g.room.matchId!,connectionEpoch:link.epoch,inputEpoch:link.seat.inputEpoch,
      targetTick:g.room.tick+1,spawnSerial:g.room.engine!.state.participants[0]!.board.spawnSerial,actions:['move-left'],sequence:1,held:{left:true,right:false,down:false},rotate:false};
    f.service.command(g.room,link.seat,link.epoch,input);f.service.advance();
    f.jump(10);f.service.advance(); // Only 10 ms of actual hold; never a DAS repeat.
    expect(board.active!.x).toBe(x-1);
    f.service.command(g.room,link.seat,link.epoch,{...input,sequence:2,held:{left:false,right:false,down:false},actions:[]});
    for(let n=0;n<20;n++)f.service.advance();
    f.advance(20);
    expect(link.seat.ack).toBe(2);
    expect(board.active!.x).toBe(x-1);
  });
  it('compatibility, overload and pagination are enforced',async()=>{
    const f=fixture();const c=await f.service.create('Lobby','Host');
    expect(()=>f.service.connect(c,PROTOCOL_VERSION+1,RULES_VERSION)).toThrow();expect(()=>f.service.list(0,51)).toThrow();
    const tiny=new RoomService(()=>0,1);await tiny.create('A','A');await expect(tiny.create('B','B')).rejects.toThrow();
    tiny.draining=true;await expect(tiny.create('C','C')).rejects.toThrow();
  });
});

it('scheduled actions wait for their tick, ACK after execution, and mismatched release never stalls',async()=>{
  const f=fixture(),g=await f.room(2);f.start(g.links[0]!);f.advance(4500);
  const l=g.links[0]!,board=g.room.engine!.state.participants[0]!.board;
  const tick=g.room.tick,x=board.active!.x;
  const input:InputEnvelope={type:'input',matchId:g.room.matchId!,connectionEpoch:l.epoch,inputEpoch:l.seat.inputEpoch,
    sequence:1,targetTick:tick+10,spawnSerial:board.spawnSerial,held:{left:true,right:false,down:true},rotate:false,actions:['move-left','soft-drop-on']};
  f.service.command(g.room,l.seat,l.epoch,input);f.advance(100);
  expect(l.seat.ack).toBe(0);expect(board.active!.x).toBe(x);
  f.advance(70);expect(l.seat.ack).toBe(1);expect(board.active!.x).toBe(x-1);
  expect(l.seat.inputResult).toEqual({sequence:1,appliedTick:tick+10,disposition:'applied',lateCount:0,mismatchCount:0});
  f.service.command(g.room,l.seat,l.epoch,{...input,sequence:2,targetTick:g.room.tick+1,spawnSerial:board.spawnSerial+9,
    held:{left:false,right:false,down:false},rotate:true,actions:['rotate-clockwise','soft-drop-off']});
  const rotation=board.active!.rotation;f.advance(20);
  expect(l.seat.ack).toBe(2);expect(l.seat.inputResult?.disposition).toBe('piece-mismatch');
  expect(board.active!.rotation).toBe(rotation);expect(board.softDrop).toBe(false);expect(l.seat.queue).toHaveLength(0);
});

it('acknowledges a neutral delayed beyond the movement age bound and resumes the next sequence',async()=>{
  const f=fixture(),g=await f.room(2);f.start(g.links[0]!);f.advance(4500);
  const l=g.links[0]!;
  const input:InputEnvelope={type:'input',matchId:g.room.matchId!,connectionEpoch:l.epoch,inputEpoch:l.seat.inputEpoch,
    sequence:1,targetTick:g.room.tick+1,spawnSerial:g.room.engine!.state.participants[0]!.board.spawnSerial,
    held:{left:false,right:false,down:true},rotate:false,actions:['soft-drop-on']};
  f.service.command(g.room,l.seat,l.epoch,input);f.advance(2500);
  f.service.command(g.room,l.seat,l.epoch,{...input,sequence:2,targetTick:input.targetTick+1,
    held:{left:false,right:false,down:false},actions:['soft-drop-off']});f.advance(20);
  expect(l.seat.ack).toBe(2);expect(g.room.engine!.state.participants[0]!.board.softDrop).toBe(false);
  const board=g.room.engine!.state.participants[0]!.board;
  f.service.command(g.room,l.seat,l.epoch,{...input,sequence:3,targetTick:g.room.tick+1,spawnSerial:board.spawnSerial,
    held:{left:true,right:false,down:false},actions:['move-left']});f.advance(20);
  expect(l.seat.ack).toBe(3);expect(l.seat.queue).toHaveLength(0);
});
