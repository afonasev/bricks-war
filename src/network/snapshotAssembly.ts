import {MAX_INPUT_BYTES,MAX_SNAPSHOT_BYTES,type ClientSnapshot} from './protocol';
export type CommonSnapshot=Omit<ClientSnapshot,'ownId'|'connectionEpoch'|'inputAck'|'inputEpoch'|'repeatSequence'|'repeatOrdinal'|'inputResult'>;
export interface SnapshotManifest {
  type:'snapshot-manifest';snapshotId:string;revision:number;roomId:string;matchId:string|null;
  ackRequired?:boolean; inputResult?: ClientSnapshot['inputResult'];
  ownId:string;connectionEpoch:number;inputAck:number;inputEpoch:number;
  repeatSequence:number;repeatOrdinal:number;
}
export interface SnapshotPart {type:'snapshot-part';snapshotId:string;part:number;total:number;data:string}
/** One bounded pending publication; never expose a partial board or mismatched acknowledgement. */
export class SnapshotAssembly {
  private pending:{manifest:SnapshotManifest;parts:string[];total:number|null;size:number;count:number}|null=null;
  clear():void {this.pending=null;}
  accept(message:SnapshotManifest|SnapshotPart):ClientSnapshot|null {
    if(new TextEncoder().encode(JSON.stringify(message)).length>MAX_INPUT_BYTES)throw new Error('Wire message bound');
    if(message.type==='snapshot-manifest') {
      if(typeof message.snapshotId!=='string'||message.snapshotId.length>200||typeof message.roomId!=='string'
        ||typeof message.ownId!=='string'||!Number.isSafeInteger(message.revision)||!Number.isSafeInteger(message.connectionEpoch)
        ||!Number.isSafeInteger(message.inputAck)||!Number.isSafeInteger(message.inputEpoch)
        ||!Number.isSafeInteger(message.repeatSequence)||!Number.isSafeInteger(message.repeatOrdinal))throw new Error('Invalid manifest');
      this.pending={manifest:message,parts:[],total:null,size:0,count:0};return null;
    }
    const p=this.pending;
    if(!p||message.snapshotId!==p.manifest.snapshotId)return null;
    if(!Number.isInteger(message.total)||message.total<1||message.total>120||!Number.isInteger(message.part)
      ||message.part<0||message.part>=message.total||typeof message.data!=='string'||message.data.length>3000
      ||!/^[-A-Za-z0-9+/=]*$/.test(message.data))throw new Error('Invalid snapshot part');
    if(p.total!==null&&p.total!==message.total)throw new Error('Part count changed');
    p.total=message.total;if(p.parts[message.part]!==undefined)throw new Error('Duplicate part');
    p.parts[message.part]=message.data;p.size+=message.data.length;p.count++;
    if(p.size>Math.ceil(MAX_SNAPSHOT_BYTES/3)*4)throw new Error('Assembly bound');
    if(p.count!==p.total)return null;
    const binary=atob(p.parts.join(''));if(binary.length>MAX_SNAPSHOT_BYTES)throw new Error('Decoded bound');
    const common=JSON.parse(new TextDecoder().decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))) as CommonSnapshot;
    const m=p.manifest;
    if(common.type!=='snapshot'||common.revision!==m.revision||common.room.id!==m.roomId||common.matchId!==m.matchId)throw new Error('Manifest identity mismatch');
    const snapshot:ClientSnapshot={...common,ownId:m.ownId,connectionEpoch:m.connectionEpoch,inputAck:m.inputAck,inputEpoch:m.inputEpoch,repeatSequence:m.repeatSequence,repeatOrdinal:m.repeatOrdinal,inputResult:m.inputResult};
    if(new TextEncoder().encode(JSON.stringify(snapshot)).length>MAX_SNAPSHOT_BYTES)throw new Error('Combined bound');
    this.clear();return snapshot;
  }
}
