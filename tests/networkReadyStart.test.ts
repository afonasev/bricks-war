import {describe, expect, it} from 'vitest';
import {FIXED_STEP_MS} from '../src/simulation/match';
import {RoomService} from '../server/rooms';
import {PROTOCOL_VERSION, RULES_VERSION, ARENA_PREPARATION_TIMEOUT_MS} from '../src/network/protocol';

async function pendingRoom() {
  let now=0; const service=new RoomService(()=>now);
  const credentials=[await service.create('Ready','Host')];
  for(let i=1;i<3;i++)credentials.push(await service.join(credentials[0]!.roomId,`Guest ${i}`));
  const links=credentials.map(c=>service.connect(c,PROTOCOL_VERSION,RULES_VERSION));
  for(const l of links){service.command(l.room,l.seat,l.epoch,{type:'ack',revision:l.room.revision,visible:true});service.command(l.room,l.seat,l.epoch,{type:'ready',ready:true});}
  const host=links[0]!,room=host.room;
  service.command(room,host.seat,host.epoch,{type:'start'});
  const prepared=(i:number,matchId=room.matchId!)=>{const l=links[i]!;service.command(room,l.seat,l.epoch,{type:'arena-prepared',matchId});};
  const advance=(ms:number)=>{for(let n=0;n<ms;n+=10){now+=Math.min(10,ms-n);for(const s of room.seats)if(s.connected)s.lastHealth=now;service.advance();}};
  return {service,links,room,credentials,prepared,advance};
}

describe('shared one-second ready start',()=>{
  it('waits for every rendered arena without charging loading time, then starts once',async()=>{
    const f=await pendingRoom(),engine=f.room.engine!;
    const initial=structuredClone(engine.state.participants);
    f.prepared(0);f.advance(2_000);f.prepared(1);f.advance(2_000);
    expect(engine.state.countdownMs).toBe(1_000);expect(engine.state.elapsedMs).toBe(0);
    expect(engine.state.participants).toEqual(initial);expect(f.room.tick).toBe(0);
    expect(f.service.snapshot(f.room,f.links[0]!.seat).preparing).toEqual([f.links[2]!.seat.id]);
    expect(()=>f.prepared(2,'stale-match')).toThrow();expect(f.room.preparing.size).toBe(1);
    f.prepared(2);f.advance(500);const remaining=engine.state.countdownMs;
    f.prepared(2);expect(engine.state.countdownMs).toBe(remaining);
    f.advance(490);expect(engine.state.phase).toBe('countdown');
    f.advance(30);expect(engine.state.phase).toBe('playing');
  });
  it('preserves manual pause and connection recovery while arenas prepare',async()=>{
    const f=await pendingRoom(),host=f.links[0]!,guest=f.links[2]!;
    f.prepared(0);f.prepared(1);f.service.command(f.room,host.seat,host.epoch,{type:'pause'});
    f.advance(2_000);f.prepared(2);expect(f.room.engine!.state.phase).toBe('paused');
    f.service.disconnect(f.room,guest.seat,guest.epoch);
    f.service.command(f.room,host.seat,host.epoch,{type:'resume'});f.advance(1_000);
    expect(f.room.engine!.state.countdownMs).toBe(1_000);expect(f.room.engine!.state.phase).toBe('paused');
    const returned=f.service.connect(f.credentials[2]!,PROTOCOL_VERSION,RULES_VERSION);
    f.service.command(f.room,returned.seat,returned.epoch,{type:'ack',revision:f.room.revision,visible:true});
    f.advance(500);expect(f.room.engine!.state.countdownMs).toBeGreaterThan(450);
    expect(f.room.engine!.state.countdownMs).toBeLessThanOrEqual(500 + FIXED_STEP_MS + 1e-8);
    f.advance(520);expect(f.room.engine!.state.phase).toBe('playing');
  });
  it('removes only a timed-out unprepared participant instead of blocking forever',async()=>{
    const f=await pendingRoom();f.prepared(0);f.prepared(1);
    f.advance(ARENA_PREPARATION_TIMEOUT_MS-10);expect(f.links[2]!.seat.retained).toBe(true);
    f.advance(10);expect(f.links[2]!.seat.retained).toBe(false);
    expect(f.links.slice(0,2).every(l=>l.seat.retained)).toBe(true);expect(f.room.preparing.size).toBe(0);
    f.advance(1_020);expect(f.room.engine!.state.phase).toBe('playing');
  });
  it('does not shorten an absence return window when preparation times out',async()=>{
    const f=await pendingRoom();f.prepared(0);f.prepared(1);f.advance(25_000);
    const guest=f.links[2]!;f.service.disconnect(f.room,guest.seat,guest.epoch);
    f.advance(10_000);expect(guest.seat.retained).toBe(true);expect(guest.seat.absence!.deadline).toBe(55_000);
    const returned=f.service.connect(f.credentials[2]!,PROTOCOL_VERSION,RULES_VERSION);
    f.service.command(f.room,returned.seat,returned.epoch,{type:'ack',revision:f.room.revision,visible:true});
    f.advance(1_000);expect(guest.seat.retained).toBe(true);expect(f.room.engine!.state.countdownMs).toBe(1_000);
    f.service.command(f.room,returned.seat,returned.epoch,{type:'arena-prepared',matchId:f.room.matchId!});
    f.advance(1_020);expect(f.room.engine!.state.phase).toBe('playing');
  });
  it('rejects clients from the former start contract at connection',async()=>{
    const f=await pendingRoom();
    expect(()=>f.service.connect(f.credentials[0]!,PROTOCOL_VERSION,'bottom-anomaly-protection-v1')).toThrow('несовместимы');
  });
});
