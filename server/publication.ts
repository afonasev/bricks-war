import type {Room,Seat,RoomService} from './rooms';
import {MAX_INPUT_BYTES,MAX_SNAPSHOT_BYTES} from '../src/network/protocol';
import type {SnapshotManifest} from '../src/network/snapshotAssembly';
export interface Publication {snapshotId:string;revision:number;roomId:string;matchId:string|null;frames:string[];wireBytes:number;commonBytes:number}
/** Serialization and chunk strings are shared by all eight recipients. Cache contains immutable bytes only. */
export class SnapshotPublisher {
  private states=new WeakMap<Room,{revision:number;json:string}>();
  private serial=0;
  prepare(service:RoomService,room:Room):Publication {
    let cached=this.states.get(room);
    if(!cached||cached.revision!==room.revision) {
      const state=room.engine?.state;
      const json=state?JSON.stringify({...state,durationMs:Number.isFinite(state.durationMs)?state.durationMs:null,
        remainingMs:Number.isFinite(state.remainingMs)?state.remainingMs:null}):'null';
      cached={revision:room.revision,json};this.states.set(room,cached);
    }
    // Remaining return time is sampled on every publication, even if the frozen engine revision is unchanged.
    const common=service.commonSnapshot(room,service.now(),false);
    const metadata=JSON.stringify({...common,state:undefined});
    const json=metadata.slice(0,-1)+',"state":'+cached.json+'}';
    const commonBytes=Buffer.byteLength(json);
    if(commonBytes+512>MAX_SNAPSHOT_BYTES)throw new Error('Snapshot bound');
    const snapshotId=`${service.serviceId}:${room.id}:${++this.serial}`;
    const encoded=Buffer.from(json).toString('base64');const total=Math.ceil(encoded.length/3000);
    if(total>120)throw new Error('Part bound');
    const frames=Array.from({length:total},(_,part)=>JSON.stringify({type:'snapshot-part',snapshotId,part,total,data:encoded.slice(part*3000,(part+1)*3000)}));
    if(frames.some(f=>Buffer.byteLength(f)>MAX_INPUT_BYTES))throw new Error('Wire message bound');
    return {snapshotId,revision:room.revision,roomId:room.id,matchId:room.matchId,frames,
      wireBytes:frames.reduce((n,f)=>n+Buffer.byteLength(f),0),commonBytes};
  }
  manifest(publication:Publication,seat:Seat,ackRequired=false):string {
    const manifest:SnapshotManifest={type:'snapshot-manifest',snapshotId:publication.snapshotId,revision:publication.revision,
      roomId:publication.roomId,matchId:publication.matchId,ownId:seat.id,connectionEpoch:seat.connectionEpoch,inputAck:seat.ack,inputEpoch:seat.inputEpoch,repeatSequence:seat.input.holdSequence,repeatOrdinal:seat.input.completedRepeats,...(ackRequired?{ackRequired:true}:{})};
    return JSON.stringify(manifest);
  }
}
