import type { BotTemplate, NetworkMode, PublicSeat, RoomRules } from './protocol';
import { defaultRoomRules, normalizeRoomRules, type ResolvedRoomRules } from './rules';
import { loadNetworkStyle, saveNetworkStyle } from './stylePreference';
import { isTileStyle } from '../domain/tileStyles';
import type { TileStyleSelection, TeamId } from '../domain/types';
export type NetworkControls = 'keyboard' | 'arrows' | 'touch' | 'gamepad' | 'gamepad-2' | 'gamepad-3' | 'tilt';
export interface PersonalPreferences {name: string; tileStyle: TileStyleSelection; controls: NetworkControls; teamId: TeamId}
export const NETWORK_SETUP_KEY = 'bricks-war:network-setup:v1';
type Store = Pick<Storage,'getItem'|'setItem'>;
const browserStorage = (): Store | null => {try {return typeof window === 'undefined' ? null : window.localStorage;} catch {return null;}};
const record = (value: unknown): Record<string,unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
function read(storage: Store | null): Record<string,unknown> {try {return record(JSON.parse(storage?.getItem(NETWORK_SETUP_KEY) ?? 'null'));} catch {return {};}}
function write(storage: Store | null, patch: Record<string,unknown>): void {try {const previous=read(storage);const next=JSON.stringify({...previous,...patch});if(next!==JSON.stringify(previous))storage?.setItem(NETWORK_SETUP_KEY,next);} catch {/* Current session still works. */}}
export function loadPersonal(fallback: NetworkControls = 'keyboard', storage: Store | null = browserStorage()): PersonalPreferences {
  const r = record(read(storage).personal);
  return {name: typeof r.name === 'string' && r.name.trim().length > 0 && [...r.name.trim()].length<=32 ? r.name : 'Игрок',
    tileStyle: typeof r.tileStyle === 'string' && (r.tileStyle === 'random' || isTileStyle(r.tileStyle)) ? r.tileStyle : loadNetworkStyle(storage),
    controls: ['keyboard','arrows','touch','gamepad','gamepad-2','gamepad-3','tilt'].includes(String(r.controls)) ? r.controls as NetworkControls : fallback,
    teamId: r.teamId === 'team-2' ? 'team-2' : 'team-1'};
}
export function savePersonal(patch: Partial<PersonalPreferences>, storage: Store | null = browserStorage()): void {
  write(storage,{personal:{...loadPersonal('keyboard',storage),...patch}});
  if (patch.tileStyle && patch.tileStyle!==loadNetworkStyle(storage)) saveNetworkStyle(patch.tileStyle,storage);
}
export function loadCreator(storage: Store | null = browserStorage()): {mode: NetworkMode; roomName: string; bots: BotTemplate[]} {
  const r=read(storage); const bots=Array.isArray(r.bots)?r.bots:[];
  return {mode: ['survival','battle','team-battle'].includes(String(r.mode)) ? r.mode as NetworkMode : 'survival',
    roomName: typeof r.roomName === 'string' && r.roomName.trim() && [...r.roomName.trim()].length<=32 ? r.roomName : 'Друзья',
    bots: bots.slice(0,6).flatMap(value=>{const b=record(value);return ['easy','medium','hard','expert'].includes(String(b.difficulty)) && (b.tileStyle==='random'||typeof b.tileStyle==='string'&&isTileStyle(b.tileStyle)) && ['team-1','team-2'].includes(String(b.teamId)) ? [b as unknown as BotTemplate] : [];})};
}
export function loadCreatorRules(mode: NetworkMode, storage: Store | null = browserStorage()): ResolvedRoomRules {
  const r=record(record(read(storage).profiles)[mode]); const defaults=defaultRoomRules(mode);
  // Validate each saved field independently; one corrupted field cannot discard other explicit choices.
  for(const [key,value] of Object.entries(r)) {const candidate=normalizeRoomRules({...defaults,[key]:value,mode});if(candidate)Object.assign(defaults,candidate);}
  return defaults;
}
export function saveCreatorRules(rules: RoomRules, storage: Store | null = browserStorage()): void {
  const normalized=normalizeRoomRules(rules);if(!normalized)return;
  write(storage,{mode:normalized.mode,profiles:{...record(read(storage).profiles),[normalized.mode]:normalized}});
}
export function saveCreatorRoom(roomName: string, storage: Store | null = browserStorage()): void {write(storage,{roomName});}
export function saveCreatorBots(seats: readonly PublicSeat[], storage: Store | null = browserStorage()): void {
  write(storage,{bots:seats.filter(s=>s.kind==='ai'&&s.retained).map(s=>({difficulty:s.difficulty,tileStyle:s.tileStyle,teamId:s.teamId??'team-1'}))});
}
