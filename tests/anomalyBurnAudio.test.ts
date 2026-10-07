import { describe, expect, it, vi } from 'vitest';
import { GameAudio } from '../src/audio/GameAudio';
import { MatchEngine } from '../src/simulation/match';

function fixture() {
  const engine = new MatchEngine([
    {id:'p1',label:'One',controller:'human-1'},
    {id:'p2',label:'Two',controller:'human-2'},
  ],4217,2);
  engine.state.phase = 'playing';
  const sources: {buffer:unknown;connect:ReturnType<typeof vi.fn>;start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;onended:(()=>void)|null}[] = [];
  const gains: {gain:{value:number;cancelScheduledValues:ReturnType<typeof vi.fn>;setValueAtTime:ReturnType<typeof vi.fn>;linearRampToValueAtTime:ReturnType<typeof vi.fn>};connect:ReturnType<typeof vi.fn>}[]=[];
  const panners: {pan:{value:number};connect:ReturnType<typeof vi.fn>}[]=[];
  const context={currentTime:10,createBufferSource:()=>{const s={buffer:null as unknown,connect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null as (()=>void)|null};sources.push(s);return s;},
    createGain:()=>{const g={gain:{value:0,cancelScheduledValues:vi.fn(),setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn()},connect:vi.fn()};gains.push(g);return g;},
    createStereoPanner:()=>{const p={pan:{value:0},connect:vi.fn()};panners.push(p);return p;}};
  const audio=new GameAudio();
  const buffer={duration:1.72};const destination={};
  Object.assign(audio,{context,clearFireBuffer:buffer,sfxBus:destination});
  // Isolate continuous fire from already-covered one-shot events and music.
  vi.spyOn(audio as unknown as {playEvent:()=>void},'playEvent').mockImplementation(()=>{});
  const burn=(serial=1,remainingMs=1000)=>{engine.state.anomalyTransition={serial,phase:'burning',remainingMs,durationMs:1000,levels:[1],targets:engine.state.participants.map(p=>({participantId:p.config.id,piece:p.board.active!}))};};
  return {audio,engine,sources,gains,panners,buffer,destination,burn};
}

describe('airborne burn audio',()=>{
  it('uses the actual row-fire buffer, gain and Effects bus once for multiple boards',()=>{
    const f=fixture();f.engine.state.anomalyBurnEvents=[{participantId:'p1',serial:1,pulseMs:1000,rows:[Array(10).fill('J')]}];
    f.audio.sync(f.engine.state);
    const row=f.sources[0]!;
    f.burn();f.audio.sync(f.engine.state);f.audio.sync(f.engine.state);
    expect(f.sources).toHaveLength(2);
    expect(f.sources[1]!.buffer).toBe(row.buffer);
    expect(f.gains[1]!.gain.value).toBe(f.gains[0]!.gain.value);
    expect(f.panners[1]!.pan.value).toBe(0);
    expect(f.panners[1]!.connect).toHaveBeenCalledWith(f.destination);
  });

  it('deduplicates authoritative snapshots and stops at spawn',()=>{
    const f=fixture();f.burn();f.audio.syncNetworkAnomalies(f.engine.state,true);
    f.audio.syncNetworkAnomalies(f.engine.state);f.audio.syncNetworkAnomalies(f.engine.state);
    expect(f.sources).toHaveLength(1);
    f.engine.state.anomalyTransition=null;f.audio.syncNetworkAnomalies(f.engine.state);
    expect(f.sources[0]!.stop).toHaveBeenCalledOnce();
  });

  it('silences pause and resumes at progress rather than restarting the fire',()=>{
    const f=fixture();f.burn(1,650);f.audio.syncNetworkAnomalies(f.engine.state,true);
    expect(f.sources[0]!.start).toHaveBeenCalledWith(10.008,.35);
    f.engine.state.phase='paused';f.audio.syncNetworkAnomalies(f.engine.state);
    expect(f.sources[0]!.stop).toHaveBeenCalledOnce();
    f.engine.state.phase='playing';f.audio.syncNetworkAnomalies(f.engine.state);
    expect(f.sources).toHaveLength(2);
    expect(f.sources[1]!.start).toHaveBeenCalledWith(10.008,.35);
    f.engine.state.phase='results';f.audio.syncNetworkAnomalies(f.engine.state);
    expect(f.sources[1]!.stop).toHaveBeenCalledOnce();
  });

  it('starts no fire during clearing or for an empty target list',()=>{
    const f=fixture();f.burn();f.engine.state.anomalyTransition!.phase='clearing';f.audio.syncNetworkAnomalies(f.engine.state,true);
    f.engine.state.anomalyTransition!.phase='burning';f.engine.state.anomalyTransition!.targets=[];f.audio.syncNetworkAnomalies(f.engine.state);
    expect(f.sources).toHaveLength(0);
  });
});
