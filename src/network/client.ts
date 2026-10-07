import type { GameAction, MatchState, PauseReason } from '../domain/types';
import type { MatchSession } from '../sessions/matchSession';
import { decodeMatchState, FIXED_STEP_MS } from '../simulation/match';
import {OwnPrediction} from './ownPrediction';
import { HeldInput } from './heldInput';
import { EMPTY_HELD, HEARTBEAT_MS, HEALTH_TIMEOUT_MS, MAX_PENDING_INPUTS, MAX_INPUT_LEAD_TICKS, PREDICTION_TIMEOUT_MS, PROTOCOL_VERSION, RULES_VERSION,
  type ClientCommand, type ClientSnapshot, type Credential, type HeldControls, type InputEnvelope } from './protocol';
import { SnapshotAssembly } from './snapshotAssembly';
import { retainNetworkParticipation,setNetworkParticipation } from '../pwa/participation';
const STORAGE_KEY = 'bricks-network-seat-v1';
export function loadCredential(): Credential | null {
  try {
    const c = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return c && typeof c.roomId === 'string' && typeof c.participantId === 'string' && typeof c.token === 'string' ? c : null;
  } catch {return null;}
}
export function storeCredential(credential: Credential | null): boolean {
  try {if (credential) localStorage.setItem(STORAGE_KEY,JSON.stringify(credential)); else localStorage.removeItem(STORAGE_KEY); return true;} catch {return false;}
}
export async function networkRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/network/${path}`, {method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: body ? {'Content-Type':'application/json'} : {}, ...(body ? {body:JSON.stringify(body)} : {})});
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error ?? 'Сервис недоступен.'),{code:payload.code});
  return payload as T;
}
export function projectedState(state: MatchState, ownId: string): MatchState {
  const own = state.participants.find(p => p.config.id === ownId);
  const others = state.participants.filter(p => p.config.id !== ownId).map((p,index) => ({p,index}))
    .sort((a,b) => b.p.score-a.p.score || a.index-b.index).slice(0,3).map(({p})=>p);
  return {...state, participants: [...(own ? [own] : []), ...others].map(p=>({...p,config:{...p.config,controllerLabel:String(state.participants.indexOf(p))}}))};
}
export class NetworkMatchSession implements MatchSession {
  readonly kind = 'network';
  snapshot: ClientSnapshot | null = null;
  status = 'Подключение…';
  onChange: () => void = () => {};
  onResetInput: () => void = () => {};
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private snapshotWatchdog: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private sequence = 0;
  private pending: {input: InputEnvelope; at: number}[] = [];
  private predicted: MatchState | null = null;
  private repeat = new HeldInput();
  private prediction = new OwnPrediction();
  private snapshotAt = performance.now();
  private leadTicks = 12;
  private pingAt: number | null = null;
  private held = {...EMPTY_HELD};
  private assembly = new SnapshotAssembly();
  private seenEvents = new Set<string>();
  private recoverySequence: number | null = null;
  constructor(readonly credential: Credential) {}
  connect(): void {
    if (this.closed || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    const url = new URL('/network/socket',location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url); this.socket = socket; this.status = 'Подключение…'; this.onChange();
    let publication: {id:string;ackRequired:boolean}|null=null;
    socket.onopen = () => {if(this.socket===socket){this.armSnapshotWatchdog();this.send({type:'hello', credential:this.credential, protocol:PROTOCOL_VERSION,rulesVersion:RULES_VERSION,snapshotAcks:true});}};
    socket.onmessage = event => {
      if(this.socket!==socket)return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'snapshot-part' || data.type === 'snapshot-manifest') {
          if(data.type==='snapshot-manifest')publication={id:data.snapshotId,ackRequired:data.ackRequired===true};
          const snapshot=this.assembly.accept(data);
          if(snapshot){this.confirm(snapshot);if(publication?.ackRequired)this.send({type:'snapshot-ack',snapshotId:publication.id});publication=null;}
          return;
        }
        if (data.type === 'pong' && data.nonce === this.pingAt) {
          this.leadTicks = Math.min(MAX_INPUT_LEAD_TICKS - 4, Math.max(12, Math.ceil((performance.now() - data.nonce + 50) / FIXED_STEP_MS)));
          this.pingAt = null; return;
        }
        if (data.type === 'ended' || data.type === 'replaced') {
          this.dispose(); this.status = data.message;
          if(data.type==='ended'&&loadCredential()?.participantId===this.credential.participantId)storeCredential(null);
          setNetworkParticipation(false);this.reset();this.onChange();return;
        }
        if (data.type === 'error') {
          this.status=data.message;
          if(['auth','ended','version'].includes(data.code)) {
            this.dispose();this.reset();
            if(data.code!=='version'){
              if(loadCredential()?.participantId===this.credential.participantId)storeCredential(null);
              setNetworkParticipation(false);
            }
          }
          this.onChange();
        }
      } catch {this.status='Восстановление состояния…'; socket.close();}
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      if(this.snapshotWatchdog)clearTimeout(this.snapshotWatchdog);
      this.assembly.clear();
      this.socket = null; this.reset();
      if (!this.closed) {this.status = 'Связь потеряна · переподключение…'; this.onChange(); this.retry=setTimeout(()=>this.connect(),1000);}
    };
    if (!this.heartbeat) {
      this.heartbeat = setInterval(()=>{this.send({type:'heartbeat',visible:!document.hidden});this.pingAt=performance.now();this.send({type:'ping',nonce:this.pingAt});},HEARTBEAT_MS);
      document.addEventListener('visibilitychange',this.visibility);
    }
    this.armSnapshotWatchdog();
  }
  private armSnapshotWatchdog():void {
    if(!this.heartbeat)return;
    if(this.snapshotWatchdog)clearTimeout(this.snapshotWatchdog);
    const socket=this.socket;
    this.snapshotWatchdog=setTimeout(()=>{if(!this.closed&&this.socket===socket&&socket?.readyState===WebSocket.OPEN)socket.close();},HEALTH_TIMEOUT_MS);
  }
  private confirm(snapshot: ClientSnapshot): void {
    this.armSnapshotWatchdog();
    if (this.snapshot && snapshot.revision < this.snapshot.revision) return;
    const old = this.snapshot;
    const reset = !old || old.inputEpoch !== snapshot.inputEpoch || old.connectionEpoch !== snapshot.connectionEpoch
      || old.matchId !== snapshot.matchId || snapshot.state?.phase !== 'playing';
    this.snapshot = snapshot;
    if (reset) {
      const epochChanged=!old || old.inputEpoch!==snapshot.inputEpoch || old.connectionEpoch!==snapshot.connectionEpoch || old.matchId!==snapshot.matchId;
      const sequence=this.sequence;this.reset();if(!epochChanged)this.sequence=sequence;
    }
    this.sequence = Math.max(this.sequence,snapshot.inputAck);
    this.pending=this.pending.filter(p=>p.input.sequence>snapshot.inputAck);
    if(this.recoverySequence!==null&&snapshot.inputAck>=this.recoverySequence)this.recoverySequence=null;
    this.predicted = snapshot.state ? decodeMatchState(snapshot.state) : null;
    const frozen = !!(snapshot.state?.anomalyTransition || snapshot.state?.globalEventHold);
    if (frozen) {this.repeat.reset();this.held={...EMPTY_HELD};this.onResetInput();}
    const target = frozen ? snapshot.tick : reset ? snapshot.tick + this.leadTicks : Math.max(this.prediction.tick, snapshot.tick);
    this.snapshotAt = performance.now();
    this.prediction.confirm(snapshot, frozen ? [] : this.pending.map(p => p.input), target);
    for (const event of snapshot.events) this.seenEvents.add(event.id);
    if (this.seenEvents.size>128) this.seenEvents=new Set(snapshot.events.map(e=>e.id));
    const own = snapshot.seats.find(s=>s.id===snapshot.ownId);
    if (!own?.connected && !document.hidden && own?.retained) this.send({type:'ack', revision:snapshot.revision,visible:true});
    this.status = own?.connected ? (this.recoverySequence===null?'Подключено':'Задержка связи · восстановление…') : 'Восстановление состояния…';
    setNetworkParticipation(!!snapshot.state && snapshot.state.phase !== 'results' && !!own?.retained);
    this.onChange();
  }
  get state(): MatchState {
    if (!this.predicted) throw new Error('No network match');
    return projectedState(this.prediction.present(this.predicted),this.credential.participantId);
  }
  get active(): boolean {return !this.closed;}
  acceptsGameplayInput(): boolean {
    const s=this.snapshot;
    return !document.hidden && this.socket?.readyState===WebSocket.OPEN && this.status==='Подключено'
      && s?.state?.phase==='playing' && !s.state.globalEventHold && !s.state.anomalyTransition
      && !!s.seats.find(p=>p.id===s.ownId)?.connected
      && !!s.state.participants.find(p=>p.config.id===s.ownId)?.board.alive;
  }
  controls(held: HeldControls, rotate=false): void {
    if (!this.acceptsGameplayInput() || !this.snapshot?.matchId) return;
    this.step();
    if (!this.acceptsGameplayInput()) return;
    if (!rotate && held.left===this.held.left && held.right===this.held.right && held.down===this.held.down) return;
    if (this.exhausted()) {this.recoverPrediction();return;}
    this.held={...held};
    this.repeat.update(held,rotate,this.sequence+1);
    this.queueActions(this.repeat.step(FIXED_STEP_MS), rotate);
  }
  private exhausted(): boolean {
    return this.pending.length >= MAX_PENDING_INPUTS - 1
      || !!this.pending[0] && performance.now() - this.pending[0].at > PREDICTION_TIMEOUT_MS
      || !!this.snapshot && this.prediction.tick >= this.snapshot.tick + MAX_INPUT_LEAD_TICKS - 1
      || performance.now() - this.snapshotAt > PREDICTION_TIMEOUT_MS;
  }
  private queueActions(actions: GameAction[], rotate=false): void {
    const snapshot=this.snapshot;
    const board=this.prediction.engine?.state.participants.find(p=>p.config.id===this.credential.participantId)?.board;
    if (!snapshot?.matchId || !board) return;
    const targetTick = this.prediction.tick + 1;
    const input: InputEnvelope={type:'input',matchId:snapshot.matchId,connectionEpoch:snapshot.connectionEpoch,
      inputEpoch:snapshot.inputEpoch,sequence:++this.sequence,held:{...this.held},rotate,
      targetTick,spawnSerial:board.spawnSerial,actions};
    this.pending.push({input,at:performance.now()});this.send(input);
    this.prediction.advanceTo(targetTick, this.pending.map(p=>p.input));
  }
  step(): void {
    const now=performance.now();
    if (!this.acceptsGameplayInput() || !this.snapshot) return;
    if (this.exhausted()) {this.recoverPrediction();return;}
    const target = this.snapshot.tick + this.leadTicks + Math.floor((now-this.snapshotAt)/FIXED_STEP_MS);
    const end = Math.min(target,this.prediction.tick+2,this.snapshot.tick+MAX_INPUT_LEAD_TICKS-1);
    while(this.prediction.tick < end) {
      const actions=this.repeat.step(FIXED_STEP_MS);
      if(actions.length)this.queueActions(actions);
      else this.prediction.advanceTo(this.prediction.tick+1,this.pending.map(p=>p.input));
      if(this.exhausted()) {this.recoverPrediction();break;}
    }
  }

  private recoverPrediction(): void {
    if(this.recoverySequence!==null||!this.snapshot?.matchId)return;
    const input:InputEnvelope={type:'input',matchId:this.snapshot.matchId,connectionEpoch:this.snapshot.connectionEpoch,
      inputEpoch:this.snapshot.inputEpoch,sequence:++this.sequence,held:{...EMPTY_HELD},rotate:false,
      targetTick:Math.max(this.snapshot.tick+1,(this.pending.at(-1)?.input.targetTick??0)+1),
      spawnSerial:this.prediction.engine?.state.participants.find(p=>p.config.id===this.credential.participantId)?.board.spawnSerial??0,
      actions:['soft-drop-off']};
    this.recoverySequence=input.sequence;this.status='Задержка связи · восстановление…';
    this.held={...EMPTY_HELD};this.repeat.reset();
    this.pending.push({input,at:performance.now()});this.send(input);this.onResetInput();this.onChange();
  }
  private reset(): void {this.pending=[];this.sequence=0;this.recoverySequence=null;this.repeat.reset();this.prediction.reset();this.held={...EMPTY_HELD};this.onResetInput();}
  send(command: ClientCommand): void {if(this.socket?.readyState===WebSocket.OPEN) this.socket.send(JSON.stringify(command));}
  toggleManualPause(): boolean {
    if (!this.snapshot?.state || !this.active) return false;
    this.send({type:this.snapshot.manualPausedBy ? 'resume' : 'pause'}); return true;
  }
  pause(reason: PauseReason='manual'): void {this.send(reason==='hidden'?{type:'heartbeat',visible:false}:{type:'pause'});}
  resume(reason: PauseReason='manual'): void {this.send(reason==='hidden'?{type:'heartbeat',visible:true}:{type:'resume'});}
  private visibility=()=>{this.reset();{this.send({type:'heartbeat',visible:!document.hidden});this.pingAt=performance.now();this.send({type:'ping',nonce:this.pingAt});};};
  dispose(leave=false): void {
    if (leave) {this.send({type:'leave'});storeCredential(null);setNetworkParticipation(false);}
    else retainNetworkParticipation();
    this.closed=true;if(this.heartbeat)clearInterval(this.heartbeat);if(this.retry)clearTimeout(this.retry);if(this.snapshotWatchdog)clearTimeout(this.snapshotWatchdog);
    document.removeEventListener('visibilitychange',this.visibility);this.socket?.close();this.socket=null;
  }
}
