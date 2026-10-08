import {describe,it,expect} from 'vitest';
import {RoomService} from '../server/rooms';
import {PROTOCOL_VERSION,RULES_VERSION,type Credential} from '../src/network/protocol';
import {defaultRoomRules,normalizeRoomRules} from '../src/network/rules';
import {MatchEngine,COUNTDOWN_MS,FIXED_STEP_MS,LOCK_DELAY_MS} from '../src/simulation/match';
import {conflictTargetIds,participantTeamId} from '../src/simulation/competition';
import {projectedState} from '../src/network/client';
import {activePiece} from '../src/simulation/tetrominoes';
import {BOARD_HEIGHT} from '../src/domain/types';
import type {ParticipantConfig} from '../src/domain/types';
const configs=(count:number):ParticipantConfig[]=>Array.from({length:count},(_,i)=>({id:`p${i}`,label:`Player ${i}`,controller:i<2?'mobile-touch':'ai',...(i>=2?{difficulty:'expert' as const}:{}),teamId:i%2?'team-2':'team-1'}));
function fixture(){const service=new RoomService(()=>0);const connect=(c:Credential)=>{const l=service.connect(c,PROTOCOL_VERSION,RULES_VERSION);service.command(l.room,l.seat,l.epoch,{type:'ack',revision:l.room.revision,visible:true});return l;};return {service,connect};}
describe('network Battle and explicit Teams',()=>{
  it.each(['battle','team-battle'] as const)('publishes immediate timed %s results with no queued impact in any seat projection',mode=>{
    const engine=new MatchEngine(configs(8),77,5,{...defaultRoomRules(mode),battleTimeMode:'timed'},null,false,'network');engine.step(COUNTDOWN_MS);
    engine.state.participants[0]!.score=500;
    for(const p of engine.state.participants){p.shieldCount=2;engine.enqueueBoardAttack(p.config.id,3,'pressure');engine.enqueueBoardAttack(p.config.id,4,'conflict','p0');}
    engine.state.elapsedMs=engine.state.durationMs-1;engine.state.remainingMs=1;
    engine.step(1);const restored=MatchEngine.restore(JSON.parse(JSON.stringify(engine.checkpoint())));
    for(const p of engine.state.participants){const view=projectedState(restored.state,p.config.id);expect(view.phase).toBe('results');expect(view.remainingMs).toBe(0);expect(view.attackQueues).toEqual({});expect(view.pendingConflict).toBeNull();expect(view.participants[0]!.shieldCount).toBe(2);expect(view.winnerIds).toContain('p0');}
    const frozen=engine.checkpoint();engine.step(5000);expect(engine.checkpoint()).toEqual(frozen);
  });
  it.each([4,6,8])('preserves interleaved %i-player teams through checkpoints, projection, attacks and victory',count=>{
    const engine=new MatchEngine(configs(count),77,5,defaultRoomRules('team-battle'),null,false,'network');engine.step(COUNTDOWN_MS);
    const competition=engine.state.participants.map((p,i)=>({id:p.config.id,score:p.score,alive:p.board.alive,teamId:participantTeamId(p.config,i)!}));
    expect(conflictTargetIds('p0',competition,'teams','all-opponents')).toEqual(configs(count).filter(c=>c.teamId==='team-2').map(c=>c.id));
    const restored=MatchEngine.restore(engine.checkpoint());expect(restored.checkpoint()).toEqual(engine.checkpoint());
    const projected=projectedState(restored.state,`p${count-1}`);expect(projected.participants[0]?.config.teamId).toBe('team-2');
    for(const c of configs(count).filter(c=>c.teamId==='team-1'))restored.eliminate(c.id);
    expect(restored.state.winnerIds).toEqual(configs(count).filter(c=>c.teamId==='team-2').map(c=>c.id));
    expect(restored.state.participants.filter(p=>p.config.teamId==='team-2').every(p=>p.placement===1)).toBe(true);
  });
  it('sends an actual eight-seat team clear to all four opponents and no allies',()=>{
    const engine=new MatchEngine(configs(8),77,5,defaultRoomRules('team-battle'),null,false,'network');engine.step(COUNTDOWN_MS);
    const attacker=engine.state.participants[0]!;attacker.board.preparationRemainingMs=0;
    attacker.board.grid.forEach(row=>row.fill(null));
    for(let y=BOARD_HEIGHT-4;y<BOARD_HEIGHT;y++){attacker.board.grid[y]!.fill('J');attacker.board.grid[y]![4]=null;}
    attacker.board.active=activePiece('I',1,2,BOARD_HEIGHT-4);attacker.board.gravityElapsedMs=0;attacker.board.lockElapsedMs=LOCK_DELAY_MS-FIXED_STEP_MS;
    engine.step(FIXED_STEP_MS);
    for(let n=0;n<6&&engine.state.clearPresentations.length;n++)engine.step(engine.state.globalEventHold?.remainingMs??engine.state.clearPresentations[0]!.remainingMs);
    expect(engine.state.pendingConflict?.incomingRows).toEqual({p1:4,p3:4,p5:4,p7:4});
    expect(MatchEngine.restore(engine.checkpoint()).state.pendingConflict).toEqual(engine.state.pendingConflict);
  });
  it('rejects unequal or missing network teams without changing local 2x2 validation',()=>{
    const wrong=configs(6);wrong[0]!.teamId='team-2';expect(()=>new MatchEngine(wrong,1,5,defaultRoomRules('team-battle'),null,false,'network')).toThrow('равные');
    const absent=configs(4).map(({teamId,...c})=>c);expect(()=>new MatchEngine(absent,1,5,defaultRoomRules('team-battle'),null,false,'network')).toThrow();
    expect(()=>new MatchEngine(configs(6),1,5,{matchVariant:'teams'})).toThrow();
  });
  it.each([2,8])('runs %i-seat Battle with attacks, numeric time and lower-score last survivor',count=>{
    const engine=new MatchEngine(configs(count),12,2,defaultRoomRules('battle'),null,false,'network');engine.step(COUNTDOWN_MS);
    expect(engine.state.isSurvival).toBe(false);expect(engine.options.conflictEnabled).toBe(true);engine.state.participants[0]!.score=999;
    for(const p of engine.state.participants.slice(0,-1))engine.eliminate(p.config.id);
    expect(engine.state.winnerIds).toEqual([`p${count-1}`]);expect(engine.state.participants.at(-1)!.placement).toBe(1);
    const timed=new MatchEngine(configs(count),12,2,{...defaultRoomRules('battle'),battleTimeMode:'timed'},null,false,'network');expect(timed.state.durationMs).toBe(120000);
  });
  it('normalizes whitelist and preserves explicit settings, forbids invalid values',()=>{
    expect(normalizeRoomRules({...defaultRoomRules('battle'),conflictEnabled:false,battleTimeMode:'timed',durationMinutes:7,evil:123})).toMatchObject({conflictEnabled:false,battleTimeMode:'timed',durationMinutes:7});
    expect(normalizeRoomRules({...defaultRoomRules('battle'),durationMinutes:99})).toBeNull();
    expect(normalizeRoomRules({...defaultRoomRules('survival'),conflictEnabled:true,matchVariant:'teams'})).toMatchObject({conflictEnabled:false,matchVariant:'free-for-all'});
  });
  it('atomically creates mixed team setup, enforces authority/readiness and reconnect snapshot',async()=>{
    const f=fixture();const host=await f.service.create('Teams','Host','',{rules:defaultRoomRules('team-battle'),profile:{teamId:'team-2',tileStyle:'classic'},bots:[{teamId:'team-1',difficulty:'expert',tileStyle:'random'},{teamId:'team-2',difficulty:'hard',tileStyle:'classic'}]});
    const guest=await f.service.join(host.roomId,'Guest','',{teamId:'team-1'});const a=f.connect(host),b=f.connect(guest);
    expect(a.room.seats.filter(s=>s.kind==='human').every(s=>!s.ready)).toBe(true);
    expect(()=>f.service.command(b.room,b.seat,b.epoch,{type:'rules',rules:defaultRoomRules('battle')})).toThrow();
    for(const l of [a,b])f.service.command(l.room,l.seat,l.epoch,{type:'ready',ready:true});
    f.service.command(b.room,b.seat,b.epoch,{type:'team',teamId:'team-2'});expect(a.seat.ready).toBe(false);
    for(const l of [a,b])f.service.command(l.room,l.seat,l.epoch,{type:'ready',ready:true});expect(()=>f.service.command(a.room,a.seat,a.epoch,{type:'start'})).toThrow('равные');
    f.service.command(b.room,b.seat,b.epoch,{type:'team',teamId:'team-1'});for(const l of [a,b])f.service.command(l.room,l.seat,l.epoch,{type:'ready',ready:true});
    f.service.command(a.room,a.seat,a.epoch,{type:'start'});expect(a.room.engine!.options.matchVariant).toBe('teams');
    const checkpoint=a.room.engine!.checkpoint();f.service.disconnect(b.room,b.seat,b.epoch);const returned=f.connect(guest);
    const snapshot=f.service.snapshot(returned.room,returned.seat);expect(snapshot.rules.mode).toBe('team-battle');expect(snapshot.seats.find(s=>s.id===guest.participantId)).toMatchObject({teamId:'team-1',ready:false});
    expect(a.room.engine!.state.participants.map(p=>p.config.teamId)).toEqual(checkpoint.state.participants.map(p=>p.config.teamId));
  });
  it('requires two live ready humans even with six Battle bots',async()=>{
    const f=fixture();const c=await f.service.create('Battle','Host','',{rules:defaultRoomRules('battle'),bots:Array.from({length:6},()=>({difficulty:'expert',teamId:'team-1',tileStyle:'random'}))});const a=f.connect(c);f.service.command(a.room,a.seat,a.epoch,{type:'ready',ready:true});expect(()=>f.service.command(a.room,a.seat,a.epoch,{type:'start'})).toThrow('два');
    await expect(f.service.create('Bad','Host','',{bots:[{difficulty:'bogus'}] as never})).rejects.toThrow();
  });
});
