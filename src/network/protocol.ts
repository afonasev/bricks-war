import type { AiDifficulty, BattleDifficulty, SoftDropPreset, TileStyleSelection, MatchOptionSelections, TeamId } from '../domain/types';
import type { EncodedMatchState } from '../simulation/match';
export const PROTOCOL_VERSION = 2;
export const RULES_VERSION = 'network-modes-6';
export const RETURN_WINDOW_MS = 30_000;
export const HEARTBEAT_MS = 2_000;
export const HEALTH_TIMEOUT_MS = 6_000;
export const MAX_INPUT_BYTES = 4096;
export const MAX_SNAPSHOT_BYTES = 256 * 1024;
export const MAX_PENDING_INPUTS = 64;
export type NetworkMode = 'survival' | 'battle' | 'team-battle';
export interface RoomRules extends Partial<MatchOptionSelections> { mode?: NetworkMode; durationMinutes?: number; battleDifficulty: BattleDifficulty; softDrop: SoftDropPreset }
export interface SeatPreferences { tileStyle?: TileStyleSelection; teamId?: TeamId }
export interface BotTemplate { difficulty: AiDifficulty; tileStyle: TileStyleSelection; teamId: TeamId }
export interface CreateSetup { rules?: RoomRules; profile?: SeatPreferences; bots?: BotTemplate[] }
export interface Credential { roomId: string; participantId: string; token: string }
export interface HeldControls { left: boolean; right: boolean; down: boolean }
export interface InputEnvelope {
  type: 'input'; matchId: string; connectionEpoch: number; inputEpoch: number; sequence: number;
  held: HeldControls; rotate: boolean;
}
export type ClientCommand = InputEnvelope
  | { type: 'hello'; credential: Credential; protocol: number; rulesVersion: string; snapshotAcks?: boolean }
  | { type: 'snapshot-ack'; snapshotId: string }
  | { type: 'ack'; revision: number; visible: boolean }
  | { type: 'heartbeat'; visible: boolean }
  | { type: 'ready'; ready: boolean }
  | { type: 'profile'; name: string; tileStyle: TileStyleSelection }
  | { type: 'team'; teamId: TeamId }
  | { type: 'rules'; rules: RoomRules }
  | { type: 'start' | 'pause' | 'resume' | 'leave' | 'lobby' }
  | { type: 'exclude'; participantId: string }
  | { type: 'ai-add' }
  | { type: 'ai-update'; participantId: string; tileStyle: TileStyleSelection; difficulty: AiDifficulty; teamId?: TeamId }
  | { type: 'ai-remove'; participantId: string };
export interface PublicSeat {
  kind: 'human' | 'ai'; difficulty: AiDifficulty | null;
  id: string; name: string; tileStyle: TileStyleSelection; teamId?: TeamId; seatOrder: number; ready: boolean;
  connected: boolean; retained: boolean; absence: {episodeId: number; remainingMs: number; blocksGameplay: boolean} | null;
}
export interface LobbySummary {
  id: string; name: string; mode?: NetworkMode; count: number; capacity: 8; protected: boolean;
  phase: 'waiting' | 'countdown' | 'playing' | 'paused' | 'results';
}
export interface ClientSnapshot {
  type: 'snapshot'; protocol: typeof PROTOCOL_VERSION; rulesVersion: string; serviceId: string; revision: number;
  room: LobbySummary; rules: RoomRules; creatorId: string | null; seats: PublicSeat[];
  ownId: string; connectionEpoch: number; inputEpoch: number; inputAck: number;
  repeatSequence: number; repeatOrdinal: number;
  matchId: string | null; tick: number; state: EncodedMatchState | null;
  manualPausedBy: string | null; events: RoomEvent[];
}
export interface RoomEvent { id: string; kind: 'start' | 'pause' | 'resume' | 'absence' | 'return' | 'elimination' | 'results' | 'creator'; participantId?: string }
export type ServerMessage = ClientSnapshot | {type: 'error'; code: string; message: string} | {type: 'ended'|'replaced'; message: string};
export const EMPTY_HELD: HeldControls = { left: false, right: false, down: false };
export function validHeld(value: unknown): value is HeldControls {
  if (!value || typeof value !== 'object') return false;
  const held = value as Record<string, unknown>;
  return typeof held.left === 'boolean' && typeof held.right === 'boolean' && typeof held.down === 'boolean';
}
