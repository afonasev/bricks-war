import type {GameAction} from '../domain/types';
/** Presentation actions only. Acknowledged transitions and completed repeat ordinals cannot replay twice. */
export class PredictionJournal {
  entries:{action:GameAction;sequence:number;repeatOrdinal:number|null;at:number}[]=[];
  record(actions:readonly GameAction[],sequence:number,firstOrdinal:number|null,at:number):void {
    let ordinal=firstOrdinal;
    for(const action of actions){
      if(action!=='move-left'&&action!=='move-right'&&action!=='rotate-clockwise')continue;
      this.entries.push({action,sequence,repeatOrdinal:ordinal,at});
      if(ordinal!==null)ordinal++;
    }
  }
  reconcile(ack:number,holdSequence:number,completedRepeats:number):GameAction[] {
    this.entries=this.entries.filter(e=>e.repeatOrdinal===null?e.sequence>ack:
      e.sequence>holdSequence||(e.sequence===holdSequence&&e.repeatOrdinal>completedRepeats));
    return this.entries.map(e=>e.action);
  }
  exceeded(now:number):boolean{return this.entries.length>64||!!this.entries[0]&&now-this.entries[0].at>300;}
  reset():void {this.entries=[];}
}
