import { describe, it, expect } from 'vitest';
import { lobbyNameTaken, freshBattleSetup, visibleLobbySlots, freeLobbySlot, lobbyAdmission, ratingBesideRoster, LobbyRosterMemory, type LobbySlot, type CardDraft } from '../src/ui/lobbyState';
import { GamepadProfiles } from '../src/ui/gamepadProfiles';
import type { TileStyleSelection } from '../src/domain/types';
describe('unified lobby run draft', () => {
    it('starts until victory, normal, attacks all independent of persisted setup', () => {
        expect(freshBattleSetup()).toMatchObject({ durationMinutes: 3, options: { battleTimeMode: 'until-victory', battleDifficulty: 'normal', conflictEnabled: true, conflictTargeting: 'all-opponents', matchVariant: 'free-for-all' } });
        expect(freshBattleSetup(true).options.matchVariant).toBe('teams');
        const setup = freshBattleSetup();
        setup.options.conflictEnabled = false;
        expect(freshBattleSetup().options.conflictEnabled).toBe(true);
    });
    it('shows the next join card without counting it as a participant in sidebar admission', () => {
        expect(visibleLobbySlots(['human-1', 'off', 'off', 'off'], 'survival')).toEqual([0, 1]);
        expect(visibleLobbySlots(['human-1', 'off', 'off', 'off'], 'survival', new Set([1]))).toEqual([0, 2]);
        expect(visibleLobbySlots(['human-1', 'ai-expert', 'off', 'off'], 'survival')).toEqual([0, 2]);
        expect(ratingBesideRoster(1360, 1, 2)).toBe(true);
        expect(ratingBesideRoster(1360, 2, 3)).toBe(false);
        expect(ratingBesideRoster(1800, 2, 3)).toBe(true);
        expect(ratingBesideRoster(1360, 3, 4)).toBe(false);
        expect(ratingBesideRoster(900, 1, 2)).toBe(false);
    });
    it('reserves different slots for simultaneous joins and respects four slots', () => {
        const slots: LobbySlot[] = ['human-1', 'off', 'off', 'off'];
        const reserved = new Map<number, CardDraft>();
        const draft = { owner: 0, token: 1, controller: 'gamepad-0', isNew: true, step: 'name', name: 'Аня', style: 'random', difficulty: 'medium', names: [], cursor: 0 } as CardDraft;
        reserved.set(freeLobbySlot(slots, reserved), draft);
        expect(freeLobbySlot(slots, reserved)).toBe(2);
        reserved.set(2, { ...draft, owner: 1 });
        reserved.set(3, { ...draft, owner: 2 });
        expect(freeLobbySlot(slots, reserved)).toBe(-1);
        reserved.delete(1);
        expect(freeLobbySlot(slots, reserved)).toBe(1);
    });
    it('keeps the complete battle bots and restores human edits across survival with separate join space', () => {
        const memory = new LobbyRosterMemory(), slots: LobbySlot[] = ['human-1', 'ai-expert', 'ai-easy', 'ai-hard'], names = ['Анна', 'b', 'c', 'd'], styles: TileStyleSelection[] = ['classic', 'forest-mosaic', 'marmalade', 'stone-fortress'];
        memory.switch('battle', 'survival', slots, names, styles);
        expect(slots).toEqual(['human-1', 'off', 'off', 'off']);
        slots[1] = 'gamepad-0';
        names[0] = 'Новое имя';
        styles[0] = 'construction-bricks';
        memory.switch('survival', 'team-battle', slots, names, styles);
        expect(slots).toEqual(['human-1', 'ai-expert', 'ai-easy', 'ai-hard']);
        expect(styles).toEqual(['construction-bricks', 'forest-mosaic', 'marmalade', 'stone-fortress']);
        expect(names[0]).toBe('Новое имя');
        memory.switch('team-battle', 'survival', slots, names, styles);
        expect(slots).toEqual(['human-1', 'gamepad-0', 'off', 'off']);
    });
    it('requires opponents, fixed 2x2 teams, completed drafts and connected devices', () => {
        expect(lobbyAdmission('battle', ['human-1', 'off', 'off', 'off'], false, false)).toBe('Добавьте хотя бы одного соперника');
        expect(lobbyAdmission('survival', ['human-1', 'off', 'off', 'off'], false, false)).toBe('');
        expect(lobbyAdmission('team-battle', ['human-1', 'ai-easy', 'off', 'off'], false, false)).toBe('Добавьте соперника в другую команду');
        expect(lobbyAdmission('team-battle', ['human-1', 'off', 'ai-easy', 'off'], false, false)).toContain('по два');
        expect(lobbyAdmission('team-battle', ['human-1', 'ai-easy', 'ai-hard', 'ai-expert'], false, false)).toBe('');
        expect(lobbyAdmission('battle', ['human-1', 'ai-easy', 'off', 'off'], true, false)).toContain('Завершите');
        expect(lobbyAdmission('battle', ['human-1', 'gamepad-0', 'off', 'off'], false, true)).toContain('Подключите');
    });
    it('persists usage totals and leaves an opened name order frozen', () => {
        const values = new Map<string, string>();
        const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
        const profiles = new GamepadProfiles(storage);
        profiles.rememberName('Аня');
        profiles.rememberName('Борис');
        const frozen = profiles.rankedNames();
        profiles.useName('Борис');
        profiles.useName('Борис');
        profiles.useName('Аня');
        expect(frozen).toEqual(['Аня', 'Борис']);
        expect(new GamepadProfiles(storage).rankedNames()).toEqual(['Борис', 'Аня']);
        profiles.profiles.filter(p => p.name === 'Борис').forEach(p => profiles.remove(p.id));
        expect(new GamepadProfiles(storage).rankedNames()).toEqual(['Аня']);
    });
});

describe('unique local human names', () => {
    it('excludes occupied humans and selected drafts with the same persisted identity, but releases cancelled drafts', () => {
        const slots: LobbySlot[] = ['human-1','ai-hard','off','off'];
        const names = ['Саша','Лена','Гоша','Миша'];
        const drafts = new Map<number, CardDraft>();
        expect(lobbyNameTaken(2,'  САША ',slots,names,drafts)).toBe(true);
        expect(lobbyNameTaken(0,'Саша',slots,names,drafts)).toBe(false);
        expect(lobbyNameTaken(2,'Лена',slots,names,drafts)).toBe(false);
        drafts.set(3,{owner:0,token:1,controller:'gamepad-0',isNew:true,step:'name',name:'Гоша',style:'random',difficulty:'medium',names:[],cursor:0});
        expect(lobbyNameTaken(2,'Гоша',slots,names,drafts)).toBe(false);
        drafts.get(3)!.step='style';
        expect(lobbyNameTaken(2,'гоша',slots,names,drafts)).toBe(true);
        drafts.clear();
        expect(lobbyNameTaken(2,'Гоша',slots,names,drafts)).toBe(false);
        names[0]='123456789012345678';
        expect(lobbyNameTaken(2,'12345678901234567899',slots,names,drafts)).toBe(true);
    });
});
