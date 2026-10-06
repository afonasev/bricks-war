import {describe,it,expect} from 'vitest';
import {RoomService} from '../server/rooms';
import {PROTOCOL_VERSION,RULES_VERSION,type Credential} from '../src/network/protocol';
import {AiController} from '../src/controllers/ai';
import {MatchEngine,FIXED_STEP_MS,validateNetworkSurvivalParticipants} from '../src/simulation/match';
import {projectedState} from '../src/network/client';
import type {AiDifficulty} from '../src/domain/types';
function fixture(){
  let now=0;const service=new RoomService(()=>now);
  const connect=(c:Credential)=>{const l=service.connect(c,PROTOCOL_VERSION,RULES_VERSION);service.command(l.room,l.seat,l.epoch,{type:'ack',revision:l.room.revision,visible:true});return l;};
  const create=async(humans=2,bots=1,password='')=>{
    const credentials=[await service.create('Mixed','Host',password)];const host=connect(credentials[0]!);
    for(let i=0;i<bots;i++)service.command(host.room,host.seat,host.epoch,{type:'ai-add'});
    for(let i=1;i<humans;i++)credentials.push(await service.join(host.room.id,`Human ${i}`,password));
    const links=[host,...credentials.slice(1).map(connect)];
    const ready=()=>{for(const l of links)service.command(l.room,l.seat,l.epoch,{type:'ready',ready:true});};
    ready();return {host,links,credentials,room:host.room,ready};
  };
  const advance=(ms:number)=>{for(let t=0;t<ms;t+=10){now+=Math.min(10,ms-t);for(const r of service.rooms.values())for(const s of r.seats)if(s.kind==='human'&&s.connected&&!s.absence)s.lastHealth=now;service.advance();}};
  return {service,connect,create,advance};
}
describe('network AI roster and authority',()=>{
  it('requires another human and caps AI at six while reserving the second human seat',async()=>{
    const f=fixture();const g=await f.create(1,6);
    expect(()=>f.service.command(g.room,g.host.seat,g.host.epoch,{type:'start'})).toThrow('два');
    expect(()=>f.service.command(g.room,g.host.seat,g.host.epoch,{type:'ai-add'})).toThrow('шесть');
    const c=await f.service.join(g.room.id,'Second human');const second=f.connect(c);
    f.service.command(second.room,second.seat,second.epoch,{type:'ready',ready:true});
    expect(()=>f.service.command(g.room,g.host.seat,g.host.epoch,{type:'start'})).toThrow();
    f.service.command(g.room,g.host.seat,g.host.epoch,{type:'ready',ready:true});
    f.service.command(g.room,g.host.seat,g.host.epoch,{type:'start'});
    expect(g.room.engine!.state.participants).toHaveLength(8);
    expect(g.room.aiControllers.size).toBe(6);
    await expect(f.service.join(g.room.id,'Ninth')).rejects.toThrow();
  });
  it('validates bot settings atomically and resets only human readiness',async()=>{
    const f=fixture();const g=await f.create();const bot=g.room.seats.find(s=>s.kind==='ai')!;
    expect(bot).toMatchObject({name:'Средний',tileStyle:'random'});
    expect(()=>f.service.command(g.room,g.links[1]!.seat,g.links[1]!.epoch,{type:'ai-update',participantId:bot.id,tileStyle:'random',difficulty:'expert'})).toThrow('создатель');
    expect(()=>f.service.command(g.room,g.host.seat,g.host.epoch,{type:'ai-update',participantId:bot.id,tileStyle:'invalid' as never,difficulty:'expert'})).toThrow();
    f.service.command(g.room,g.host.seat,g.host.epoch,{type:'ai-update',participantId:bot.id,tileStyle:'stone-fortress',difficulty:'expert'});
    expect(bot).toMatchObject({ready:true,name:'Эксперт',difficulty:'expert',tileStyle:'stone-fortress',token:null,absence:null});
    expect(g.room.seats.filter(s=>s.kind==='human').every(s=>!s.ready)).toBe(true);
    expect(()=>f.service.authenticate({roomId:g.room.id,participantId:bot.id,token:''})).toThrow();
    expect(()=>f.service.command(g.room,bot,0,{type:'ready',ready:true})).toThrow();
    f.service.command(g.room,g.host.seat,g.host.epoch,{type:'ai-remove',participantId:bot.id});expect(g.room.seats).toHaveLength(2);
  });
  it('rechecks capacity after asynchronous password validation races with AI addition',async()=>{
    const f=fixture();const g=await f.create(2,5,'password');
    const joining=f.service.join(g.room.id,'Third','password');
    f.service.command(g.room,g.host.seat,g.host.epoch,{type:'ai-add'});
    await expect(joining).rejects.toThrow();expect(g.room.seats.filter(s=>s.retained)).toHaveLength(8);
  });
  it.each(['easy','medium','hard','expert'] as AiDifficulty[])('executes %s AI on server without a client connection',async(difficulty)=>{
    const f=fixture();const g=await f.create();const bot=g.room.seats.find(s=>s.kind==='ai')!;
    const names:Record<AiDifficulty,string>={easy:'Лёгкий',medium:'Средний',hard:'Сложный',expert:'Эксперт'};
    f.service.command(g.room,g.host.seat,g.host.epoch,{type:'ai-update',participantId:bot.id,tileStyle:'random',difficulty});expect(bot.name).toBe(names[difficulty]);g.ready();
    f.service.command(g.room,g.host.seat,g.host.epoch,{type:'start'});
    expect(()=>f.service.command(g.room,g.host.seat,g.host.epoch,{type:'ai-remove',participantId:bot.id})).toThrow();
    f.advance(6000);expect(g.room.aiActionCount).toBeGreaterThan(0);expect(bot.absence).toBeNull();
    const state=f.service.snapshot(g.room,g.host.seat).state!;
    expect(state.participants.find(p=>p.config.id===bot.id)!.config).toMatchObject({controller:'ai',difficulty});
    expect(f.service.snapshot(g.room,g.host.seat).seats.find(s=>s.id===bot.id)).toMatchObject({kind:'ai',difficulty,ready:true,connected:true,absence:null});
  });
  it('freezes AI and elapsed time on pause and reconnect keeps the same controllers',async()=>{
    const f=fixture();const g=await f.create();f.service.command(g.room,g.host.seat,g.host.epoch,{type:'start'});f.advance(5000);
    const controllers=g.room.aiControllers;const before=structuredClone(g.room.engine!.state);const decisions=g.room.aiActionCount;
    f.service.command(g.room,g.host.seat,g.host.epoch,{type:'pause'});f.advance(7000);
    expect(g.room.engine!.state.elapsedMs).toBe(before.elapsedMs);expect(g.room.aiActionCount).toBe(decisions);
    f.service.command(g.room,g.host.seat,g.host.epoch,{type:'resume'});
    const bot=g.room.engine!.state.participants.find(p=>p.config.controller==='ai')!;
    bot.board.maneuverRemainingMs=600;bot.board.maneuverSpentMs=400;bot.board.maneuverCancelled=true;
    const guest=g.links[1]!;f.service.disconnect(g.room,guest.seat,guest.epoch);f.advance(7000);
    expect(g.room.engine!.state.elapsedMs).toBe(before.elapsedMs);expect(g.room.aiActionCount).toBe(decisions);
    f.connect(g.credentials[1]!);expect(g.room.aiControllers).toBe(controllers);
    expect(bot.board).toMatchObject({maneuverRemainingMs:600,maneuverSpentMs:400,maneuverCancelled:true});f.advance(2000);
    expect(g.room.engine!.state.elapsedMs).toBeGreaterThan(before.elapsedMs);
  });
  it('never elects the earlier bot, and closes after all human rights expire',async()=>{
    const f=fixture();const g=await f.create();f.service.command(g.room,g.host.seat,g.host.epoch,{type:'start'});f.advance(4000);
    f.service.command(g.room,g.host.seat,g.host.epoch,{type:'leave'});
    expect(g.room.creatorId).toBe(g.links[1]!.seat.id);expect(g.room.engine!.state.phase).toBe('playing');
    const guest=g.links[1]!;f.service.disconnect(g.room,guest.seat,guest.epoch);f.advance(29990);expect(f.service.rooms.has(g.room.id)).toBe(true);
    f.advance(10);expect(f.service.rooms.has(g.room.id)).toBe(false);
    expect(g.room.seats.find(s=>s.kind==='ai')!.retained).toBe(true);
  });
  it('keeps AI results/top-three and configurations, but uses fresh controllers on repeat',async()=>{
    const f=fixture();const g=await f.create();f.service.command(g.room,g.host.seat,g.host.epoch,{type:'start'});f.advance(4000);
    const previous=g.room.aiControllers;const matchId=g.room.matchId;const bot=g.room.seats.find(s=>s.kind==='ai')!;
    g.room.engine!.state.participants.find(p=>p.config.id===bot.id)!.score=1000;
    for(const p of g.room.engine!.state.participants)g.room.engine!.eliminate(p.config.id);f.service.advance();
    expect(projectedState(g.room.engine!.state,g.host.seat.id).participants[1]!.config.id).toBe(bot.id);
    expect(g.room.engine!.state.participants.find(p=>p.config.id===bot.id)!.placement).toBe(1);
    f.service.command(g.room,g.host.seat,g.host.epoch,{type:'lobby'});expect(g.room.seats.find(s=>s.id===bot.id)).toBe(bot);
    expect(g.room.aiControllers.size).toBe(0);g.ready();f.service.command(g.room,g.host.seat,g.host.epoch,{type:'start'});
    expect(g.room.matchId).not.toBe(matchId);expect(g.room.aiControllers).not.toBe(previous);
  });
});
it('network mixed validation and checkpoint replay preserve seeded AI decisions',()=>{
  const configs=[{id:'h1',label:'H1',controller:'mobile-touch' as const},{id:'h2',label:'H2',controller:'mobile-touch' as const},{id:'bot',label:'Bot',controller:'ai' as const,difficulty:'expert' as const}];
  expect(validateNetworkSurvivalParticipants(configs)).toEqual([]);
  expect(validateNetworkSurvivalParticipants(configs.slice(1))).not.toEqual([]);
  expect(validateNetworkSurvivalParticipants([configs[2]!])).not.toEqual([]);
  const a=new MatchEngine(configs,9,5,{},null,true,'network');
  const bot=a.state.participants[2]!;bot.board.maneuverRemainingMs=600;bot.board.maneuverSpentMs=400;bot.board.maneuverCancelled=true;
  const checkpoint=a.checkpoint();expect(checkpoint.version).toBe(3);
  const b=MatchEngine.restore(checkpoint);
  expect(b.state.participants[2]).toMatchObject({config:{id:'bot',label:'Bot',controller:'ai',difficulty:'expert'},board:{maneuverRemainingMs:600,maneuverSpentMs:400,maneuverCancelled:true}});
  const left=new AiController(9,'bot','expert',false),right=new AiController(9,'bot','expert',false);
  let count=0;
  for(let i=0;i<400;i++){
    const actions=a.acceptsGameplayInput()?left.actions(a.state.participants[2]!.board,a.state.elapsedMs):[];
    const other=b.acceptsGameplayInput()?right.actions(b.state.participants[2]!.board,b.state.elapsedMs):[];
    expect(other).toEqual(actions);count+=actions.length;
    a.step(FIXED_STEP_MS,new Map([['bot',actions]]));b.step(FIXED_STEP_MS,new Map([['bot',other]]));
  }
  expect(count).toBeGreaterThan(0);expect(a.checkpoint()).toEqual(b.checkpoint());
});
