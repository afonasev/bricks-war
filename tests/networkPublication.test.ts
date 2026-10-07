import {it,expect} from 'vitest';
import {RoomService} from '../server/rooms';
import {SnapshotPublisher} from '../server/publication';
import {SnapshotAssembly,type SnapshotManifest,type SnapshotPart} from '../src/network/snapshotAssembly';
import {PROTOCOL_VERSION,RULES_VERSION} from '../src/network/protocol';
it('shared publication reconstructs every seat identically and refreshes frozen countdowns without changing engine revision',async()=>{
  let now=0;const service=new RoomService(()=>now);const credentials=[await service.create('Room','Host')];
  for(let i=1;i<8;i++)credentials.push(await service.join(credentials[0]!.roomId,`Player ${i}`));
  const links=credentials.map(c=>service.connect(c,PROTOCOL_VERSION,RULES_VERSION));
  for(const l of links)service.command(l.room,l.seat,l.epoch,{type:'ack',revision:l.room.revision,visible:true});
  for(const l of links)service.command(l.room,l.seat,l.epoch,{type:'ready',ready:true});
  const room=links[0]!.room;const publisher=new SnapshotPublisher();
  const check=()=>{
    const publication=publisher.prepare(service,room);
    for(const seat of room.seats){
      const assembly=new SnapshotAssembly();expect(assembly.accept(JSON.parse(publisher.manifest(publication,seat)))).toBeNull();
      let result=null;for(const frame of publication.frames){expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(4096);result=assembly.accept(JSON.parse(frame));}
      expect(result).toEqual(service.snapshot(room,seat));
    }
    return publication;
  };
  check();service.command(room,links[0]!.seat,links[0]!.epoch,{type:'start'});check();
  service.disconnect(room,links[4]!.seat,links[4]!.epoch);const revision=room.revision;const first=check();now+=1000;const second=check();
  expect(room.revision).toBe(revision);expect(second.snapshotId).not.toBe(first.snapshotId);
  for(const p of room.engine!.state.participants)room.engine!.eliminate(p.config.id);service.advance();check();
});
it('partial, mismatched, duplicate and superseded assemblies never commit partial state',async()=>{
  const service=new RoomService(()=>0);const credential=await service.create('Room','Host');const {room,seat}=service.authenticate(credential);
  const publisher=new SnapshotPublisher();const one=publisher.prepare(service,room),two=publisher.prepare(service,room);const a=new SnapshotAssembly();
  const manifest=JSON.parse(publisher.manifest(one,seat)) as SnapshotManifest;
  a.accept(manifest);const part=JSON.parse(one.frames[0]!) as SnapshotPart;
  if(one.frames.length>1){expect(a.accept(part)).toBeNull();expect(()=>a.accept(part)).toThrow();}
  a.clear();a.accept(JSON.parse(publisher.manifest(two,seat)));expect(a.accept(part)).toBeNull();
  a.clear();a.accept({...manifest,roomId:'foreign'});expect(()=>{for(const f of one.frames)a.accept(JSON.parse(f));}).toThrow('Manifest identity');
  a.clear();a.accept(manifest);expect(()=>a.accept({...part,total:121})).toThrow();
  expect(()=>a.accept({...part,data:'a'.repeat(4096)})).toThrow();
});

it('publishes an eight-board shared burn within snapshot limits and preserves its identity',async()=>{
  const service=new RoomService(()=>0);const credentials=[await service.create('Burn','Host')];
  for(let i=1;i<8;i++)credentials.push(await service.join(credentials[0]!.roomId,`Player ${i}`));
  const links=credentials.map(c=>service.connect(c,PROTOCOL_VERSION,RULES_VERSION));
  const room=links[0]!.room;
  const {MatchEngine}=await import('../src/simulation/match');
  const engine=new MatchEngine(credentials.map((_,i)=>({id:`p${i}`,label:`Player ${i}`,controller:'mobile-touch' as const})),92,5,{},null,false,'network');
  engine.step(3000);engine.state.participants[0]!.placedPieces=engine.options.piecesPerLevel;engine.step(1);engine.step(400);
  room.engine=engine;room.revision++;
  const publisher=new SnapshotPublisher();const pub=publisher.prepare(service,room);
  expect(pub.commonBytes).toBeLessThan(256*1024-512);
  for(const link of links){
    const assembly=new SnapshotAssembly();assembly.accept(JSON.parse(publisher.manifest(pub,link.seat)));
    let snapshot:ReturnType<SnapshotAssembly['accept']>=null;
    for(const frame of pub.frames)snapshot=assembly.accept(JSON.parse(frame))??snapshot;
    expect(snapshot?.state?.anomalyTransition).toEqual(engine.state.anomalyTransition);
    expect(snapshot?.state?.anomalyTransition?.remainingMs).toBe(600);
    expect(snapshot?.state?.participants).toHaveLength(8);
  }
});
