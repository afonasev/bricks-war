import {ScheduledInput, pieceActions} from '../src/network/scheduledInput';
import { roomRules, normalizeRoomRules, defaultRoomRules, balancedNetworkTeams } from '../src/network/rules';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { MatchEngine, encodeMatchState, FIXED_STEP_MS } from '../src/simulation/match';
import { isTileStyle } from '../src/domain/tileStyles';
import { AiController } from '../src/controllers/ai';
import { HeldInput } from '../src/network/heldInput';
import { PROTOCOL_VERSION, RULES_VERSION, RETURN_WINDOW_MS, HEALTH_TIMEOUT_MS, MAX_PENDING_INPUTS,
  validHeld, type ClientCommand, type ClientSnapshot, type Credential, type InputEnvelope,
  type LobbySummary, type RoomEvent, type RoomRules, type CreateSetup, type BotTemplate, type SeatPreferences } from '../src/network/protocol';
import type { CommonSnapshot } from '../src/network/snapshotAssembly';
import type { AiDifficulty, GameAction, TileStyleSelection, TeamId } from '../src/domain/types';
const aiNames: Record<AiDifficulty, string> = {easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный', expert: 'Эксперт'};
const passwordHash = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => scrypt(password, salt, 32, (error, result) => error ? reject(error) : resolve(result)));
const credentialHash = (token: string): string => createHash('sha256').update(token).digest('hex');
const TERMINAL_RETENTION_MS = 600_000;
export class RoomError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function requireCondition(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new RoomError(code, message);
}
function name(value: unknown): string {
  requireCondition(typeof value === 'string' && value.trim().length > 0 && [...value.trim()].length <= 32,
    'name', 'Имя должно содержать от 1 до 32 символов.');
  return value.trim();
}
function validProfile(value: SeatPreferences): boolean {
  return !!value && (value.tileStyle === undefined || value.tileStyle === 'random' || isTileStyle(value.tileStyle)) && (value.teamId === undefined || ['team-1','team-2'].includes(value.teamId));
}
export interface Seat {
  kind: 'human' | 'ai'; difficulty: AiDifficulty | null;
  id: string; token: string | null; name: string; tileStyle: TileStyleSelection; teamId: TeamId; seatOrder: number;
  ready: boolean; connected: boolean; retained: boolean; connectionEpoch: number; inputEpoch: number;
  lastHealth: number; absence: { episodeId: number; deadline: number; blocksGameplay: boolean } | null;
  episode: number; awaitingRevision: number | null; scheduled: ScheduledInput; inputResult?: ClientSnapshot['inputResult']; input: HeldInput; inputAt:number; queue: (InputEnvelope & {receivedAt:number})[]; received: number; ack: number;
}
export interface Room {
  id: string; name: string; password: {salt: string; verifier: Buffer} | null;
  aiControllers: Map<string, AiController>; aiActionCount: number;
  seats: Seat[]; creatorId: string | null; rules: RoomRules; engine: MatchEngine | null;
  matchId: string | null; tick: number; revision: number; inputEpoch: number;
  manualPausedBy: string | null; events: RoomEvent[]; eventSerial: number;
  lastAt: number; accumulator: number; terminalAt: number | null; nextSeatOrder: number;
}
export class RoomService {
  readonly rooms = new Map<string, Room>();
  readonly serviceId = randomUUID();
  draining = false;
  constructor(readonly now: () => number = () => performance.now(), readonly maxRooms = 100) {}
  async create(roomName: unknown, playerName: unknown, password: unknown = '', setup: CreateSetup = {}): Promise<Credential> {
    requireCondition(!this.draining && this.rooms.size < this.maxRooms, 'capacity', 'Сервис заполнен. Попробуйте позже.');
    requireCondition(typeof password === 'string' && password.length <= 64, 'password', 'Пароль: до 64 символов.');
    const rules = normalizeRoomRules(setup.rules ?? defaultRoomRules());
    requireCondition(rules && validProfile(setup.profile ?? {}) && (setup.bots === undefined || Array.isArray(setup.bots) && setup.bots.length <= 6 && setup.bots.every(b=>b && b.tileStyle !== undefined && ['team-1','team-2'].includes(b.teamId) && validProfile(b) && ['easy','medium','hard','expert'].includes(b.difficulty))), 'rules', 'Некорректные настройки комнаты.');
    const room: Room = { id: randomUUID(), name: name(roomName), password: null, seats: [], creatorId: null, aiControllers: new Map(), aiActionCount: 0,
      rules, engine: null, matchId: null, tick: 0, revision: 0,
      inputEpoch: 1, manualPausedBy: null, events: [], eventSerial: 0, lastAt: this.now(), accumulator: 0,
      terminalAt: null, nextSeatOrder: 0 };
    if (password) {
      const salt = randomBytes(16).toString('hex');
      room.password = {salt, verifier: await passwordHash(password, salt)};
    }
    requireCondition(!this.draining && this.rooms.size < this.maxRooms, 'capacity', 'Сервис заполнен.');
    const credential = this.addSeat(room, playerName, setup.profile);
    room.creatorId = credential.participantId;
    for (const bot of setup.bots ?? []) room.seats.push(this.botSeat(room, bot));
    this.rooms.set(room.id, room);
    return credential;
  }
  async join(roomId: string, playerName: unknown, password: unknown = '', profile: SeatPreferences = {}): Promise<Credential> {
    const room = this.get(roomId); this.expire(room);
    requireCondition(!room.engine && room.seats.filter(s => s.retained).length < 8, 'join', 'Лобби заполнено или матч уже начался.');
    if (room.password) {
      requireCondition(typeof password === 'string' && password.length <= 64, 'password', 'Неверный пароль.');
      requireCondition(timingSafeEqual(await passwordHash(password, room.password.salt), room.password.verifier), 'password', 'Неверный пароль.');
    }
    this.expire(room);
    requireCondition(this.rooms.has(room.id) && !room.engine && room.seats.filter(s => s.retained).length < 8, 'join', 'Лобби заполнено или матч начался.');
    return this.addSeat(room, playerName, profile);
  }
  private addSeat(room: Room, playerName: unknown, profile: SeatPreferences = {}): Credential {
    requireCondition(validProfile(profile), 'profile', 'Некорректный профиль.');
    const token = randomBytes(32).toString('base64url');
    const seat: Seat = {kind: 'human', difficulty: null, id: randomUUID(), token: credentialHash(token), name: name(playerName), tileStyle: profile.tileStyle ?? 'random', teamId: profile.teamId ?? (room.seats.filter(s=>s.retained&&s.teamId==='team-1').length <= room.seats.filter(s=>s.retained&&s.teamId==='team-2').length ? 'team-1' : 'team-2'),
      seatOrder: room.nextSeatOrder++, ready: false, connected: false, retained: true, connectionEpoch: 0, inputEpoch: 1,
      lastHealth: this.now(), absence: null, episode: 0, awaitingRevision: null, scheduled: new ScheduledInput(), input: new HeldInput(), inputAt:this.now(), queue: [], received: 0, ack: 0};
    // An allocation which never opens a control connection also expires.
    seat.absence = {episodeId: ++seat.episode, deadline: this.now() + RETURN_WINDOW_MS, blocksGameplay: false};
    if(!room.engine)room.seats=room.seats.filter(s=>s.retained);
    room.seats.push(seat); this.resetReady(room); this.changed(room);
    return {roomId: room.id, participantId: seat.id, token};
  }
  list(offset = 0, limit = 50): {rooms: LobbySummary[]; next: number | null; serviceId: string} {
    this.advance();
    requireCondition(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 50,
      'pagination', 'Неверная страница.');
    const rooms = [...this.rooms.values()].map(r => this.summary(r));
    return {rooms: rooms.slice(offset, offset + limit), next: offset + limit < rooms.length ? offset + limit : null, serviceId: this.serviceId};
  }
  get(id: string): Room {
    const room = this.rooms.get(id);
    requireCondition(room, 'ended', 'Сессия завершена или сервис перезапущен.'); return room;
  }
  authenticate(credential: Credential): {room: Room; seat: Seat} {
    requireCondition(credential && typeof credential.roomId === 'string' && typeof credential.participantId === 'string'
      && typeof credential.token === 'string', 'auth', 'Не удалось подтвердить место.');
    const room = this.get(credential.roomId); this.expire(room);
    const seat = room.seats.find(s => s.id === credential.participantId);
    requireCondition(seat && seat.kind === 'human' && seat.retained && seat.token === credentialHash(credential.token), 'auth', 'Место исключено или срок возврата истёк.');
    return {room, seat};
  }
  connect(credential: Credential, protocol: number, rulesVersion: string): {room: Room; seat: Seat; epoch: number} {
    requireCondition(protocol === PROTOCOL_VERSION && rulesVersion === RULES_VERSION, 'version', 'Версии игры несовместимы. Обновите игру после завершения участия.');
    const {room, seat} = this.authenticate(credential);
    if(seat.connected)this.absent(room,seat);
    seat.connected = false; seat.connectionEpoch++; seat.lastHealth = this.now();
    this.resetInputs(room,seat); this.changed(room);
    seat.awaitingRevision = room.revision;
    return {room, seat, epoch: seat.connectionEpoch};
  }
  disconnect(room: Room, seat: Seat, epoch: number): void {
    if (seat.connectionEpoch !== epoch || !seat.retained) return;
    seat.connected = false; seat.awaitingRevision = null; this.absent(room, seat);
  }
  private absent(room: Room, seat: Seat): void {
    seat.connected = false; seat.ready = false;
    if (seat.absence) {this.syncPause(room);return;}
    if (!seat.absence) {
      const alive = room.engine?.state.participants.find(p => p.config.id === seat.id)?.board.alive ?? false;
      seat.absence = {episodeId: ++seat.episode, deadline: this.now() + RETURN_WINDOW_MS, blocksGameplay: alive};
      this.event(room, 'absence', seat.id);
    }
    this.resetInputs(room,seat.absence?.blocksGameplay?undefined:seat); this.syncPause(room); this.changed(room);
  }
  command(room: Room, seat: Seat, epoch: number, command: ClientCommand): void {
    this.expire(room);
    requireCondition(this.rooms.has(room.id) && seat.kind === 'human' && seat.retained && seat.connectionEpoch === epoch, 'epoch', 'Управляющее соединение заменено.');
    if (command.type === 'ack') {
      if(seat.connected && seat.awaitingRevision===null && command.visible===true)return;
      requireCondition(typeof command.revision === 'number' && command.visible === true && seat.awaitingRevision !== null
        && command.revision >= seat.awaitingRevision && command.revision <= room.revision, 'ack', 'Сначала восстановите текущее состояние.');
      seat.connected = true; seat.lastHealth = this.now(); seat.awaitingRevision = null;
      if (seat.absence) {seat.absence = null; this.event(room, 'return', seat.id);}
      this.chooseCreator(room); this.syncPause(room); this.changed(room); return;
    }
    if (command.type === 'heartbeat') {
      requireCondition(typeof command.visible === 'boolean', 'message', 'Некорректный heartbeat.');
      seat.lastHealth = this.now();
      if (!command.visible) this.absent(room, seat);
      else if (!seat.connected && seat.awaitingRevision === null) {this.changed(room); seat.awaitingRevision = room.revision;}
      return;
    }
    requireCondition(seat.connected && seat.awaitingRevision === null, 'restore', 'Ожидается возврат в матч.');
    if (command.type === 'leave') {this.remove(room, seat); this.syncPause(room); this.changed(room); return;}
    if (command.type === 'input') {
      requireCondition(room.engine?.acceptsGameplayInput() && room.engine.state.participants.find(p=>p.config.id===seat.id)?.board.alive && room.matchId === command.matchId
        && command.connectionEpoch === epoch && command.inputEpoch === seat.inputEpoch, 'input-epoch', 'Ввод устарел; дождитесь состояния.');
      requireCondition(Number.isSafeInteger(command.sequence) && command.sequence > 0 && validHeld(command.held)
        && typeof command.rotate === 'boolean', 'input', 'Некорректный ввод.');
      if (command.sequence <= seat.received) return;
      requireCondition(command.sequence === seat.received + 1 && seat.queue.length < MAX_PENDING_INPUTS, 'resync', 'Очередь ввода заполнена; восстановите состояние.');
      requireCondition(seat.scheduled.accept(command, room.tick), 'resync', 'Некорректный такт или действия ввода.');
      seat.received = command.sequence; seat.queue.push({...structuredClone(command),receivedAt:this.now()}); return;
    }
    if (command.type === 'pause') {
      requireCondition(room.engine && room.engine.state.phase !== 'results', 'phase', 'Матч не идёт.');
      if (!room.manualPausedBy) {room.manualPausedBy = seat.id; this.event(room, 'pause', seat.id); this.resetInputs(room);}
      this.syncPause(room); this.changed(room); return;
    }
    if (command.type === 'resume') {
      requireCondition(room.manualPausedBy && (room.manualPausedBy === seat.id || room.creatorId === seat.id), 'permission', 'Продолжить могут поставивший паузу и создатель.');
      room.manualPausedBy = null; this.event(room, 'resume', seat.id); this.resetInputs(room); this.syncPause(room); this.changed(room); return;
    }
    if (command.type === 'exclude') {
      requireCondition(room.creatorId === seat.id, 'permission', 'Только создатель исключает отсутствующего.');
      const target = room.seats.find(s => s.id === command.participantId);
      requireCondition(target && target.id !== room.creatorId && target.retained && target.absence, 'exclude', 'Этот участник не может быть исключён.');
      this.remove(room, target); this.syncPause(room); this.changed(room); return;
    }
    if (command.type === 'lobby') {
      requireCondition(room.engine?.state.phase === 'results', 'phase', 'Сначала завершите матч.');
      room.engine = null; room.aiControllers.clear(); room.aiActionCount = 0; room.matchId = null; room.terminalAt = null; room.manualPausedBy = null;
      room.seats = room.seats.filter(s => s.retained); this.resetReady(room); this.resetInputs(room); this.changed(room); return;
    }
    requireCondition(!room.engine, 'phase', 'Настройки доступны до старта.');
    if (command.type === 'ai-add' || command.type === 'ai-update' || command.type === 'ai-remove') {
      requireCondition(room.creatorId === seat.id, 'permission', 'ИИ настраивает только создатель.');
      if (command.type === 'ai-add') {
        const retained = room.seats.filter(s => s.retained);
        requireCondition(retained.length < 8 && retained.filter(s => s.kind === 'ai').length < 6,
          'capacity', 'Максимум шесть ИИ и восемь участников. Нужно место для двух людей.');
        room.seats = retained;
        room.seats.push(this.botSeat(room, {difficulty:'medium', tileStyle:'random', teamId: room.seats.filter(s=>s.teamId==='team-1').length <= room.seats.filter(s=>s.teamId==='team-2').length ? 'team-1' : 'team-2'}));
      } else {
        const target = room.seats.find(s => s.id === command.participantId && s.kind === 'ai' && s.retained);
        requireCondition(target, 'ai', 'Этот ИИ отсутствует в лобби.');
        if (command.type === 'ai-remove') room.seats = room.seats.filter(s => s !== target);
        else {
          requireCondition(command.tileStyle === 'random' || isTileStyle(command.tileStyle), 'style', 'Неизвестный вид фигур.');
          requireCondition(['easy', 'medium', 'hard', 'expert'].includes(command.difficulty), 'difficulty', 'Неизвестная сложность ИИ.');
          requireCondition(command.teamId === undefined || ['team-1','team-2'].includes(command.teamId), 'team', 'Неизвестная команда.');
          if (command.teamId) target.teamId = command.teamId;
          target.name = aiNames[command.difficulty]; target.tileStyle = command.tileStyle; target.difficulty = command.difficulty;
        }
      }
      this.resetReady(room);
    } else if (command.type === 'ready') {
      requireCondition(typeof command.ready === 'boolean', 'message', 'Некорректная готовность.'); if(seat.ready===command.ready)return;seat.ready = command.ready;
    } else if (command.type === 'team') {
      requireCondition(['team-1','team-2'].includes(command.teamId), 'team', 'Неизвестная команда.');
      seat.teamId = command.teamId; this.resetReady(room);
    } else if (command.type === 'profile') {
      requireCondition(command.tileStyle === 'random' || isTileStyle(command.tileStyle), 'style', 'Неизвестный вид фигур.');
      seat.name = name(command.name); seat.tileStyle = command.tileStyle; this.resetReady(room);
    } else if (command.type === 'rules') {
      const rules = normalizeRoomRules(command.rules);
      requireCondition(room.creatorId === seat.id && rules, 'permission', 'Правила меняет создатель; настройки должны быть корректны.');
      room.rules = rules; this.resetReady(room);
    } else if (command.type === 'start') {
      const retained = room.seats.filter(s => s.retained);
      requireCondition(room.creatorId === seat.id && retained.length <= 8
        && retained.filter(s => s.kind === 'human').length >= 2
        && retained.filter(s => s.kind === 'ai').length <= 6
        && retained.filter(s => s.kind === 'human').every(s => s.connected && s.ready && !s.absence),
        'start', 'Нужны минимум два подключённых готовых человека; всего до восьми участников.');
      const rules = roomRules(room.rules);
      requireCondition(rules.mode !== 'team-battle' || balancedNetworkTeams(retained), 'teams', 'Нужны равные команды 2×2, 3×3 или 4×4.');
      const seed = randomBytes(4).readUInt32LE();
      room.engine = new MatchEngine(retained.map(s => ({id: s.id, label: s.name, controller: s.kind === 'ai' ? 'ai' : 'mobile-touch', tileStyle: s.tileStyle, ...(rules.mode === 'team-battle' ? {teamId:s.teamId} : {}), ...(s.kind === 'ai' ? {difficulty: s.difficulty!} : {})})),
        seed, rules.durationMinutes, rules, null, rules.mode === 'survival', 'network');
      room.aiControllers = new Map(retained.filter(s => s.kind === 'ai').map(s => [s.id, new AiController(seed, s.id, s.difficulty!, rules.conflictEnabled)]));
      room.aiActionCount = 0;
      room.matchId = randomUUID(); room.tick = 0; room.lastAt = this.now(); room.accumulator = 0;
      this.resetInputs(room); this.event(room, 'start');
    } else throw new RoomError('message', 'Неизвестная команда.');
    this.changed(room);
  }
  private botSeat(room: Room, template: BotTemplate): Seat {
    return {kind:'ai', difficulty:template.difficulty, id:randomUUID(), token:null, name:aiNames[template.difficulty], tileStyle:template.tileStyle, teamId:template.teamId,
      seatOrder:room.nextSeatOrder++, ready:true, connected:true, retained:true, connectionEpoch:0, inputEpoch:0, lastHealth:0, absence:null, episode:0, awaitingRevision:null,
      scheduled:new ScheduledInput(), input:new HeldInput(), inputAt:this.now(), queue:[], received:0, ack:0};
  }
  private resetReady(room: Room): void { for (const seat of room.seats) seat.ready = seat.kind === 'ai'; }
  private resetInputs(room: Room, target?:Seat): void {
    room.inputEpoch++;
    for (const seat of (target ? [target] : room.seats).filter(s => s.kind === 'human')) {seat.inputEpoch++;seat.input.reset(); seat.scheduled = new ScheduledInput(); seat.inputResult = undefined; seat.inputAt=this.now(); seat.queue = []; seat.received = 0; seat.ack = 0;}
    for (const p of (room.engine?.state.participants ?? []).filter(p=>!target||p.config.id===target.id)) {p.board.softDrop = false; p.board.softDropElapsedMs = 0;}
  }
  private event(room: Room, kind: RoomEvent['kind'], participantId?: string): void {
    room.events.push({id: `${room.matchId ?? room.id}:${++room.eventSerial}`, kind, ...(participantId ? {participantId} : {})});
    if (room.events.length > 64) room.events.shift();
  }
  private changed(room: Room): void {room.revision++;}
  private remove(room: Room, seat: Seat): void {
    if (!seat.retained) return;
    const playing=room.engine?.state.participants.find(p=>p.config.id===seat.id)?.board.alive;
    room.engine?.eliminate(seat.id); seat.retained = false; seat.connected = false; seat.absence = null; seat.awaitingRevision = null;
    if(playing)this.event(room, 'elimination', seat.id); this.resetInputs(room,playing?undefined:seat); this.resetReady(room);
    if (room.creatorId === seat.id) room.creatorId = null;
    this.chooseCreator(room); this.terminal(room);
  }
  private chooseCreator(room: Room): void {
    if (room.creatorId) return;
    room.creatorId = room.seats.filter(s => s.kind === 'human' && s.retained && s.connected && !s.absence).sort((a,b) => a.seatOrder-b.seatOrder)[0]?.id ?? null;
    if (room.creatorId) this.event(room, 'creator', room.creatorId);
  }
  private syncPause(room: Room): void {
    const engine = room.engine;
    if (!engine || engine.state.phase === 'results') return;
    const before=engine.state.phase;
    if (room.manualPausedBy) engine.pause('manual'); else engine.resume('manual');
    if (room.seats.some(s => s.retained && s.absence?.blocksGameplay)) engine.pause('hidden'); else engine.resume('hidden');
    if(before!==engine.state.phase) {
      this.resetInputs(room);
      // Never catch up frozen wall time on resume. Unrelated observer health does not discard time.
      room.lastAt=this.now();room.accumulator=0;
    }
  }
  private terminal(room: Room): void {
    if (room.engine?.state.phase === 'results' && room.terminalAt === null) {
      room.terminalAt = this.now(); room.manualPausedBy = null;
      room.engine.state.pauseReasons = []; this.resetInputs(room); this.event(room, 'results'); this.changed(room);
    }
  }
  private expire(room: Room): void {
    const now = this.now();
    const due = room.seats.filter(s => s.kind === 'human' && s.retained && s.absence && now >= s.absence.deadline);
    // Resolve every due seat before succession and pause decisions.
    for (const s of due) {
      const alive=room.engine?.state.participants.find(p=>p.config.id===s.id)?.board.alive;
      room.engine?.eliminate(s.id); s.retained = false; s.connected = false; s.absence = null; s.awaitingRevision = null;
      if (room.creatorId === s.id) room.creatorId = null;
      if(alive)this.event(room, 'elimination', s.id);
    }
    if (due.length) {for(const seat of due)this.resetInputs(room,seat); this.resetReady(room); this.chooseCreator(room); this.syncPause(room); this.changed(room);}
    this.terminal(room);
  }
  advance(): void {
    const now = this.now();
    for (const room of this.rooms.values()) {
      for (const s of room.seats) if (s.kind === 'human' && s.retained && !s.absence && now - s.lastHealth >= HEALTH_TIMEOUT_MS) this.absent(room, s);
      this.expire(room);
      if ((!room.seats.some(s => s.kind === 'human' && s.retained) && (!room.engine || room.seats.some(s => s.kind === 'ai'))) || (room.terminalAt !== null && now-room.terminalAt >= TERMINAL_RETENTION_MS)) {
        this.rooms.delete(room.id); continue;
      }
      const elapsed = Math.max(0, now - room.lastAt); room.lastAt = now;
      if (!room.engine || room.engine.state.phase === 'paused' || room.engine.state.phase === 'results') {room.accumulator = 0; continue;}
      room.accumulator += elapsed;
      // Bound per-callback work while retaining debt; do not skip authoritative simulation ticks.
      let steps = 0;
      while (room.accumulator >= FIXED_STEP_MS && steps++ < 8) {
        const actions = new Map<string, GameAction[]>();
        for (const s of room.seats) {
          if (s.kind !== 'human' || !s.retained || !s.connected) continue;
          const inputActions:GameAction[]=[];
          const board = room.engine.state.participants.find(p => p.config.id === s.id)!.board;
          while (s.queue[0] && s.queue[0].targetTick <= room.tick + 1) {
            const input = s.queue.shift()!;
            inputActions.push(...pieceActions(input, board.spawnSerial));
            s.input.update(input.held, false, input.sequence); s.input.step(0);
            s.ack = input.sequence;
            s.inputResult = {sequence: input.sequence, appliedTick: room.tick + 1,
              lateCount: (s.inputResult?.lateCount ?? 0) + Number(input.targetTick < room.tick + 1),
              mismatchCount: (s.inputResult?.mismatchCount ?? 0) + Number(input.spawnSerial !== board.spawnSerial),
              disposition: input.spawnSerial !== board.spawnSerial ? 'piece-mismatch' : input.targetTick < room.tick + 1 ? 'late' : 'applied'};
          }
          actions.set(s.id,inputActions);
        }
        const alive = room.engine.state.participants.filter(p => p.board.alive).map(p => p.config.id);
        const acceptedBefore=room.engine.acceptsGameplayInput();
        if (acceptedBefore) for (const participant of room.engine.state.participants) {
          const controller = room.aiControllers.get(participant.config.id);
          if (!controller) continue;
          const decisions = controller.actions(participant.board, room.engine.state.elapsedMs);
          actions.set(participant.config.id, decisions); room.aiActionCount += decisions.length;
        }
        room.engine.step(FIXED_STEP_MS, actions);
        if(acceptedBefore!==room.engine.acceptsGameplayInput())this.resetInputs(room); room.tick++; room.accumulator -= FIXED_STEP_MS;
        for (const id of alive) if (!room.engine.state.participants.find(p => p.config.id === id)!.board.alive) this.event(room, 'elimination', id);
        this.terminal(room);
      }
      this.changed(room);
    }
  }
  summary(room: Room): LobbySummary {
    return {id: room.id, name: room.name, mode: roomRules(room.rules).mode, count: room.seats.filter(s => s.retained).length, capacity: 8,
      protected: !!room.password, phase: room.engine?.state.phase ?? 'waiting'};
  }
  snapshot(room: Room, seat: Seat): ClientSnapshot {
    return {...this.commonSnapshot(room),ownId:seat.id,connectionEpoch:seat.connectionEpoch,inputAck:seat.ack,inputEpoch:seat.inputEpoch,repeatSequence:seat.input.holdSequence,repeatOrdinal:seat.input.completedRepeats,inputResult:seat.inputResult};
  }
  commonSnapshot(room: Room, sampledAt=this.now(), includeState=true): CommonSnapshot {
    return {type: 'snapshot', protocol: PROTOCOL_VERSION, rulesVersion: RULES_VERSION, serviceId: this.serviceId,
      revision: room.revision, room: this.summary(room), rules: {...room.rules}, creatorId: room.creatorId,
      seats: room.seats.map(s => ({kind: s.kind, difficulty: s.difficulty, id: s.id, name: s.name, tileStyle: s.tileStyle, teamId: s.teamId, seatOrder: s.seatOrder,
        ready: s.ready, connected: s.connected, retained: s.retained,
        absence: s.absence ? {episodeId: s.absence.episodeId, remainingMs: Math.max(0,s.absence.deadline-sampledAt), blocksGameplay: s.absence.blocksGameplay} : null})),

      prediction: room.engine?.predictionCheckpoint() ?? null,
      matchId: room.matchId, tick: room.tick, state: includeState && room.engine ? encodeMatchState(room.engine.state) : null,
      manualPausedBy: room.manualPausedBy, events: room.events.map(e => ({...e}))};
  }
}
