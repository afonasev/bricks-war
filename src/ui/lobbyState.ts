import { normalizePlayerName } from './playerNamePersistence';
import type { AiDifficulty, GamepadController, MatchOptionSelections, TileStyleSelection } from '../domain/types';
import { DEFAULT_MATCH_OPTION_SELECTIONS } from '../simulation/matchOptions';
import type { SlotSelection } from './slotPersistence';
export type LobbyMode = 'battle' | 'team-battle' | 'survival';
export type LobbySlot = SlotSelection | GamepadController;
export const isLobbyHuman = (slot: LobbySlot): boolean => slot === 'human-1' || slot === 'human-2' || slot.startsWith('gamepad-');
/** Selected draft names reserve identity before the participant commits. */
export function lobbyNameTaken(slot: number, name: string, slots: readonly LobbySlot[], names: readonly string[], drafts: ReadonlyMap<number, CardDraft>): boolean {
    const key = (value: string, index: number) => normalizePlayerName(value, index).normalize('NFC').toLowerCase();
    const candidate = key(name, slot);
    return slots.some((value, index) => index !== slot && isLobbyHuman(value) && key(names[index]!, index) === candidate)
        || [...drafts].some(([index, draft]) => index !== slot && isLobbyHuman(draft.controller) && draft.step === 'style' && key(draft.name, index) === candidate);
}
export function freshBattleSetup(teams = false): {
    options: MatchOptionSelections;
    durationMinutes: number;
} {
    return { options: { ...DEFAULT_MATCH_OPTION_SELECTIONS, battleTimeMode: 'until-victory', matchVariant: teams ? 'teams' : 'free-for-all' }, durationMinutes: 3 };
}
/** Hidden bots retain their physical slot/team, style and difficulty. */
export function visibleLobbySlots(slots: readonly LobbySlot[], mode: LobbyMode, reserved: ReadonlySet<number> = new Set()): number[] {
    const occupied = slots.flatMap((slot, i) => slot !== 'off' && (mode !== 'survival' || isLobbyHuman(slot)) ? [i] : []);
    const empty = slots.findIndex((slot, i) => slot === 'off' && !reserved.has(i));
    return [...occupied, ...(empty < 0 ? [] : [empty])];
}
export interface CardDraft {
    owner: number;
    token: number;
    controller: LobbySlot;
    isNew: boolean;
    step: 'name' | 'difficulty' | 'style';
    name: string;
    style: TileStyleSelection;
    difficulty: AiDifficulty;
    names: readonly string[];
    cursor: number;
    typing?: boolean;
    typingOriginal?: string;
    typingCursor?: number;
    numericKeyboard?: boolean;
}
/** Reserves physical slots before either controller commits. Never displaces a hidden bot. */
export function freeLobbySlot(slots: readonly LobbySlot[], reserved: ReadonlyMap<number, CardDraft>): number {
    return slots.findIndex((slot, i) => slot === 'off' && !reserved.has(i));
}
export function lobbyAdmission(mode: LobbyMode, slots: readonly LobbySlot[], editing: boolean, disconnected: boolean): string {
    if (editing)
        return 'Завершите настройку участников';
    if (disconnected)
        return 'Подключите геймпад или удалите его карточку';
    const active = slots.flatMap((slot, i) => slot !== 'off' && (mode !== 'survival' || isLobbyHuman(slot)) ? [i] : []);
    if (mode === 'survival')
        return active.length ? '' : 'Добавьте игрока';
    if (active.length < 2)
        return 'Добавьте хотя бы одного соперника';
    if (mode === 'team-battle') {
        if (!active.some(i => i < 2) || !active.some(i => i >= 2))
            return 'Добавьте соперника в другую команду';
        if (active.length !== 4)
            return 'Для командного боя нужны две команды по два участника';
    }
    return '';
}
export function ratingBesideRoster(width: number, participants: number, cards: number): boolean {
    const track = Math.min(335, (width - 16 - 3 * 22) / 4);
    const occupiedRight = cards * track + Math.max(0, cards - 1) * 22 + 16;
    return participants <= 2 && width >= 1040 && width - occupiedRight >= 458;
}
interface RosterSnapshot {
    slots: LobbySlot[];
    names: string[];
    styles: TileStyleSelection[];
}
/** Battle/team share fixed team positions. Survival owns human-only positions so hidden bots never consume join space. */
export class LobbyRosterMemory {
    private battle: RosterSnapshot | null = null;
    private survival: RosterSnapshot | null = null;
    switch(from: LobbyMode, to: LobbyMode, slots: LobbySlot[], names: string[], styles: TileStyleSelection[]): void {
        if ((from === 'survival') === (to === 'survival'))
            return;
        const current: RosterSnapshot = { slots: [...slots], names: [...names], styles: [...styles] };
        if (from === 'survival')
            this.survival = current;
        else
            this.battle = current;
        const target = to === 'survival' ? this.survival ?? { slots: slots.map(slot => isLobbyHuman(slot) ? slot : 'off'), names: [...names], styles: [...styles] } : this.battle!;
        // Existing humans carry their edits across modes; mode-specific additional humans keep their own positions.
        target.slots.forEach((controller, i) => { if (!isLobbyHuman(controller))
            return; const source = current.slots.indexOf(controller); if (source >= 0) {
            target.names[i] = current.names[source]!;
            target.styles[i] = current.styles[source]!;
        } });
        slots.splice(0, slots.length, ...target.slots);
        names.splice(0, names.length, ...target.names);
        styles.splice(0, styles.length, ...target.styles);
    }
}
