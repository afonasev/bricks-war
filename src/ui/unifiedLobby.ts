import { faceGlyph, refreshFaceGlyphs, type FaceAction } from './inputGlyph';
import { spatialElementIndex, spatialIndex, type GridDirection } from './spatialNavigation';
import { nameKeyboardRows } from './nameKeyboard';
import { normalizePlayerName, isGenericPlayerName } from './playerNamePersistence';
import { playerAccentForSlot } from './hudIdentity';
import { controllerIcon } from './controllerIcon';
import { lobbyText as copy } from '../i18n/lobbyCopy';
import type { AiDifficulty, TileStyleSelection } from '../domain/types';
import { TILE_STYLES } from '../domain/tileStyles';
import { WORKSHOP_THEME_TEXTURES } from '../rendering/workshopSprites';
import logo from '../assets/brand/concept-logo.webp';
import { MAIN_MENU_PREVIEWS } from './mainMenuPreview';
import { text, getLocale } from '../i18n/locale';
import { GamepadProfiles } from './gamepadProfiles';
import { RatingPanels } from './ratingPanel';
import { loadSoloRecords } from './soloRecords';
import { formatDuration } from './format';
import { recordDateMarkup } from './recordDate';
import { ruleCardsForLocale } from './visualRules';
import { isMobilePlayViewport } from './mobileSettings';
import { freeLobbySlot, isLobbyHuman, lobbyNameTaken, ratingBesideRoster, visibleLobbySlots, type CardDraft, type LobbyMode, type LobbySlot } from './lobbyState';
import './unifiedLobby.css';
const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const modeName = (mode: LobbyMode): string => mode === 'survival' ? text('survival') : mode === 'battle' ? text('battle') : text('team');
const levels: AiDifficulty[] = ['easy', 'medium', 'hard', 'expert'];
const levelName = (level: AiDifficulty): string => text(({ easy: 'difficultyEasy', medium: 'difficultyMedium', hard: 'difficultyHard', expert: 'difficultyExpert' } as const)[level]);
const styleName = (style: TileStyleSelection): string => style === 'random' ? text('tileRandom') : text(({ classic: 'tileClassic', 'sea-crystals': 'tileClassic', 'construction-bricks': 'tileBricks', 'pixel-adventure': 'tilePixel', 'stone-fortress': 'tileStone', marmalade: 'tileMarmalade', 'forest-mosaic': 'tileForest' } as const)[style]);

const key = (letter: string, tone = letter.toLowerCase()): string => {
    const action = ({A:'confirm',B:'back',X:'ai',Y:'roster'} as Record<string, FaceAction>)[letter];
    return action ? faceGlyph(action, `lobby-key ${tone}`) : `<kbd class="lobby-key ${tone}">${letter}</kbd>`;
};
export interface LobbyHost {
    mode(): LobbyMode;
    slots: LobbySlot[];
    names: string[];
    styles: TileStyleSelection[];
    profiles: GamepadProfiles;
    ratings: RatingPanels;
    pads(): ReadonlyMap<number, {
        device: string;
        token: number;
        profile: string | null;
    }>;
    connected(slot: number): boolean;
    changeMode(mode: LobbyMode): void;
    commit(slot: number, draft: CardDraft): void;
    remove(slot: number): void;
    start(): void;
    back(): void;
    validate(): void;
    settings(): string;
    rules(): string;
    bindSettings(): void;
}
/** Owns only lobby editing/presentation. Match state and physical device identities stay with the app. */
export class UnifiedLobby {
    readonly editors = new Map<number, CardDraft>();
    private readonly selections = new Map<number, number>();
    private readonly held = new Map<number, string>();
    private readonly deleteSince = new Map<number, number>();
    private readonly removeHold = new Map<number, {slot: number; value: LobbySlot; token: number; since: number; fired: boolean}>();
    private overlay: 'rating' | 'rules' | null = null;
    private rulesTab: 'mode' | 'basics' = 'mode';
    private ruleIndex = 0;
    private modalPadCursor = 0;
    private hintPad: number | undefined;
    private lastWidth = 0;
    private lastHeight = 0;
    constructor(private readonly root: HTMLElement, private readonly host: LobbyHost) {
        root.ownerDocument.addEventListener('keydown', event => {
            if (!this.active()) return;
            this.root.dataset.inputMode = 'keyboard';
            const target = event.target as HTMLElement;
            if (target instanceof HTMLInputElement) {
                if (event.key === 'Enter' && target.dataset.draftName !== undefined) { event.preventDefault(); event.stopImmediatePropagation(); this.beginTyping(Number(target.dataset.draftName)); }
                return;
            }
            if (event.repeat && ['Enter',' '].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
            if (!this.overlay && ['w','ц'].includes(event.key.toLowerCase())) {
                event.preventDefault(); event.stopImmediatePropagation();
                if (!event.repeat && ![...this.editors.values()].some(d => d.owner < 0)) this.joinKeyboard('human-1');
                return;
            }
            if (['Enter',' '].includes(event.key) && target.closest('button') && root.contains(target)) { event.preventDefault(); event.stopImmediatePropagation(); target.closest<HTMLButtonElement>('button')!.click(); return; }
            const direction = ({ArrowUp:'previous',ArrowDown:'next',ArrowLeft:'decrease',ArrowRight:'increase'} as const)[event.key as 'ArrowUp'];
            if (!direction) return;
            const editor = target.closest<HTMLElement>('.is-editing');
            const buttons = this.overlay ? Array.from(this.root.querySelectorAll<HTMLElement>('.lobby-overlay button:not([disabled])')) : editor ? this.editorButtons(Number(editor.dataset.lobbySlot)) : this.padTargets();
            const current = buttons.indexOf(target);
            const rects = buttons.map(button => (!editor && !this.overlay && ['increase','decrease'].includes(direction) ? button.closest<HTMLElement>('.lobby-card') ?? button : button).getBoundingClientRect());
            const next = spatialIndex(rects,current,direction); event.preventDefault(); event.stopImmediatePropagation(); buttons[next]?.focus(); buttons[next]?.scrollIntoView({block:'nearest'});
        }, true);
    }
    active(): boolean { return !!this.root.querySelector('.unified-lobby'); }
    editing(): boolean { return this.editors.size > 0; }
    leave(): void { this.editors.clear(); this.overlay = null; this.removeHold.clear(); this.deleteSince.clear(); }
    private indices(): number[] {
        const h = this.host;
        const indices = new Set([...visibleLobbySlots(h.slots, h.mode(), new Set(this.editors.keys())), ...this.editors.keys()]);
        if (h.mode() === 'team-battle')
            for (let i = 0; i < 4; i++)
                indices.add(i);
        return [...indices].sort((a, b) => a - b);
    }
    render(): void {
        if (!this.active()) {
            this.held.clear();
            for (const pad of Array.from(navigator.getGamepads?.() ?? []))
                if (pad?.connected)
                    this.held.set(pad.index, this.padAction(pad));
        }
        const h = this.host, mode = h.mode(), indices = this.indices();
        const people = h.slots.filter(slot => isLobbyHuman(slot)).length;
        const beside = mode === 'survival' && ratingBesideRoster(innerWidth - 2 * Math.min(64, Math.max(24, innerWidth * .04)), people, Math.max(...indices) + 1) && !isMobilePlayViewport() && innerHeight >= 960;
        this.lastWidth = innerWidth;
        this.lastHeight = innerHeight;
        this.root.innerHTML = `<main class="unified-lobby" data-screen="${mode}" data-mode="${mode}">
      <header class="lobby-heading"><img src="${logo}" alt="Bricks War"><h1>${copy('Лобби')}</h1><span>${copy('Мастерская')}</span></header>
      <section class="lobby-settings" aria-label="${copy('Настройки матча')}">
        <button class="lobby-mode" data-cycle-mode aria-label="${copy('Режим')}: ${escape(modeName(mode))}. ${copy('Следующий режим')}" style="--mode-art:url('${MAIN_MENU_PREVIEWS[mode].image}')"><span>${escape(modeName(mode))}<b>›</b></span></button>
        ${mode === 'survival' ? `<button class="lobby-rating-action" data-open-rating>★ ${copy('Рейтинг')} <b>›</b></button>` : h.settings()}
        <button class="lobby-help" data-open-rules aria-label="${copy('Правила игры')}">?</button>
      </section>
      <div class="lobby-body ${beside ? 'with-rating' : ''}"><section class="lobby-roster" aria-label="${copy('Участники')}"><div class="lobby-cards">${mode === 'team-battle' ? [0,1].map(team => `<div class="lobby-team team-${team}" aria-hidden="true"></div>`).join('') : ''}${indices.map(i => this.card(i)).join('')}</div></section>${beside ? `<aside class="lobby-rating survival-records">${this.rating()}</aside>` : ''}</div>
      <footer class="lobby-footer"><button data-lobby-back>${key('B')} <span data-lobby-back-label>${copy('В меню')}</span></button><div class="lobby-start-group"><p id="setup-error" role="status" aria-live="polite"></p><button id="start-match" class="lobby-start">${copy('Начать игру')} ${key('≡', 'menu')}</button></div></footer>
      <div class="lobby-overlay" ${this.overlay ? '' : 'hidden'}></div>
    </main>`;
        h.bindSettings();
        this.root.querySelector('[data-cycle-mode]')?.addEventListener('click', () => { this.editors.clear(); h.changeMode(mode === 'battle' ? 'team-battle' : mode === 'team-battle' ? 'survival' : 'battle'); });
        this.root.querySelector('[data-lobby-back]')?.addEventListener('click', () => h.back());
        this.root.querySelector('#start-match')?.addEventListener('click', () => h.start());
        this.root.querySelector('[data-open-rating]')?.addEventListener('click', () => this.openOverlay('rating'));
        this.root.querySelector('[data-open-rules]')?.addEventListener('click', () => this.openOverlay('rules'));
        this.bindCards();
        for (const [slot, draft] of this.editors) {
            if (draft.step !== 'style') continue;
            const options = this.root.querySelector<HTMLElement>(`[data-editor-options="${slot}"]`);
            const selected = options?.querySelector<HTMLElement>('[aria-pressed="true"]');
            if (options && selected) options.scrollTop = Math.max(0, selected.offsetTop - options.offsetTop - (options.clientHeight - selected.offsetHeight) / 2);
        }
        const rating = this.root.querySelector<HTMLElement>('.lobby-rating');
        if (rating)
            this.mountRating(rating);
        this.renderOverlay();
        this.refreshHints();
        h.validate();
        for (const [owner, slot] of this.selections)
            this.highlight(owner, slot);
    }
    resize(): void { if (this.active() && (this.lastWidth !== innerWidth || this.lastHeight !== innerHeight))
        this.render(); }
    private piece(style: TileStyleSelection, colorful = false): string {
        const atlas = WORKSHOP_THEME_TEXTURES[style === 'random' ? 'classic' : style].url;
        return `<span class="lobby-piece ${style === 'random' ? 'random-piece' : ''}" aria-hidden="true" style="--atlas:url('${atlas}')">${[0, 1, 2, 4].map((i, n) => `<i style="left:${i % 3 * 33.333}%;top:${Math.floor(i / 3) * 50}%;${colorful ? `background-position:${[0, 100, 0, 50][n]}% ${[0, 0, 50, 50][n]}%` : ''}"></i>`).join('')}${style === 'random' ? '<b>?</b>' : ''}</span>`;
    }
    private card(slot: number): string {
        const h = this.host, value = h.slots[slot]!, draft = this.editors.get(slot);
        const empty = value === 'off' && !draft;
        const bot = value.startsWith('ai-');
        const disconnected = !h.connected(slot);
        const color = slot;
        return `<article class="lobby-card color-${color} ${draft?.typing ? 'is-typing' : ''} ${empty ? 'is-empty' : ''} ${draft ? 'is-editing' : ''} ${disconnected ? 'is-disconnected' : ''}" style="--slot:${slot};--player-name-color:${playerAccentForSlot(slot)}" data-lobby-slot="${slot}" ${empty && h.mode() !== 'survival' ? 'data-empty-bot' : ''} ${!empty && !draft ? `data-edit="${slot}" role="button" tabindex="0"` : ''} aria-label="${copy(!empty && !draft ? 'Настроить участника' : 'Участник')} ${slot + 1}">
      ${draft ? this.editorMarkup(slot, draft) : empty ? `<span class="lobby-plus" aria-hidden="true">+</span><button data-join="${slot}">${key('Y')} ${copy('Присоединиться')}</button>${h.mode() === 'survival' ? '' : `<button data-bot="${slot}" class="lobby-add-bot">${key('X')} ${copy('Добавить бота')}</button>`}` : `
        <div class="lobby-card-mark"><span>${bot ? copy('СОПЕРНИК') : `${copy('ИГРОК')} ${slot + 1}`}</span>${controllerIcon(bot ? 'ai' : isMobilePlayViewport() && value === 'human-1' ? 'mobile-touch' : value, getLocale())}</div>
        <h2>${bot ? `${copy('Бот')} <small>· ${escape(levelName(value.slice(3) as AiDifficulty).toLocaleLowerCase(getLocale()))}</small>` : escape(h.names[slot]!)}</h2>
        <p class="lobby-ready">${disconnected ? '⚠ ' + copy('Геймпад отключён') : '✓ ' + copy('Готов')}</p>
        <div class="lobby-well">${this.piece(h.styles[slot]!)}</div><p class="lobby-style-label">${escape(styleName(h.styles[slot]!))}</p>
        <small class="lobby-card-hint"><span>${key('A')} ${copy('Настроить')}</span><span>${key('X')} ${copy('Удерживать — удалить')}</span></small><button class="lobby-remove" title="${copy('Удерживайте X, чтобы удалить участника')}" data-remove="${slot}" aria-label="${copy('Удалить участника')} ${slot + 1}">×</button>`}
    </article>`;
    }
    private nameTaken(slot: number, name: string): boolean { return lobbyNameTaken(slot, name, this.host.slots, this.host.names, this.editors); }
    private editorMarkup(slot: number, d: CardDraft): string {
        return `<div class="lobby-card-mark"><span>${controllerIcon(d.controller.startsWith('ai-') ? 'ai' : isMobilePlayViewport() && d.controller === 'human-1' ? 'mobile-touch' : d.controller, getLocale())} ${d.controller.startsWith('ai-') ? copy('Бот') : `${copy('Участник')} ${slot + 1}`}</span><button data-cancel="${slot}" aria-label="${copy('Отменить настройку')}">×</button></div><h2 class="lobby-editor-title">${d.step === 'name' ? copy(d.typing ? 'Новое имя' : 'Выберите имя') : d.step === 'difficulty' ? copy('Сложность бота') : copy('Стиль фигур')}</h2><div class="lobby-editor-options" data-editor-options="${slot}">${d.step === 'name' ? d.typing ? this.typingMarkup(d) : `<button data-generic-name>${copy('Игрок')}</button>${d.names.filter(name => !isGenericPlayerName(name) && this.host.profiles.profiles.some(p => p.name === name) && !this.nameTaken(slot, name)).map(name => `<div class="lobby-name-row"><button data-name="${escape(name)}">${escape(name)}</button><button data-delete-name="${escape(name)}" aria-label="${copy('Удалить имя')} ${escape(name)}">×</button></div>`).join('')}<label class="lobby-new-name">${copy('Новое имя')}<input data-draft-name="${slot}" maxlength="20" value="${escape(d.name)}" aria-label="${copy('Новое имя участника')} ${slot + 1}"></label><button data-use-name="${slot}" ${this.nameTaken(slot, d.name) ? 'disabled' : ''}>${copy('Далее →')}</button>` : d.step === 'difficulty' ? levels.map(level => `<button data-level="${level}" aria-pressed="${d.difficulty === level}">${escape(levelName(level))}</button>`).join('') : (['random', ...TILE_STYLES.map(s => s.id)] as TileStyleSelection[]).map(style => `<button class="lobby-style-option" data-style="${style}" aria-pressed="${d.style === style}">${this.piece(style, true)}<span>${escape(styleName(style))}</span></button>`).join('')}</div><small class="lobby-editor-hint">${d.typing ? `<button data-typed-done ${this.nameTaken(slot, d.name) ? 'disabled' : ''}>${key('Y')} ${copy('Применить')}</button><button data-typing-back>${key('B')} ${copy('Отменить ввод')}</button>` : (d.step === 'name' ? key('X') + ' ' + copy('Удерживать — удалить имя') + ' · ' : '') + key('B') + ' ' + copy('Отменить')}</small>`;
    }
    private typingMarkup(d: CardDraft): string {
        return `<input class="lobby-typed-name" data-typing-name maxlength="18" value="${escape(d.name)}" aria-label="${copy('Новое имя')}"><div class="lobby-name-keys">${nameKeyboardRows(getLocale() === 'ru', d.numericKeyboard).map(row => `<div class="lobby-key-row">${row.map(letter => `<button data-letter="${letter}">${letter}</button>`).join('')}</div>`).join('')}<div class="lobby-key-row lobby-key-actions">${getLocale() === 'ru' && !d.numericKeyboard ? '<button data-letter="Ё">Ё</button>' : ''}<button data-keyboard-layout>${d.numericKeyboard ? getLocale() === 'ru' ? 'АБВ' : 'ABC' : '123'}</button><button class="lobby-space" data-letter=" ">${copy('Пробел')}</button><button data-erase aria-label="${copy('Удалить символ')}">⌫</button></div></div>`;
    }
    private beginTyping(slot: number): void {
        const d = this.editors.get(slot)!;
        d.typingOriginal = d.name; d.typingCursor = d.cursor; d.typing = true; d.numericKeyboard = false; d.cursor = 0;
        this.render();
    }
    private cancelTyping(slot: number): void {
        const d = this.editors.get(slot)!; d.typing = false; d.name = d.typingOriginal ?? d.name; d.cursor = d.typingCursor ?? 0; this.render();
    }
    private applyTyping(slot: number): void {
        const d = this.editors.get(slot)!;
        if (this.nameTaken(slot, d.name)) return;
        d.typing = false; this.chooseName(slot, d.name);
    }
    private bindCards(): void {
        this.root.querySelectorAll<HTMLElement>('[data-edit]').forEach(card => {
            card.addEventListener('click', event => { if ((event.target as Element).closest('button,input,select')) return; this.openEditor(Number(card.dataset.edit), -1); });
            card.addEventListener('keydown', event => { if (event.target !== card || !['Enter',' '].includes(event.key)) return; event.preventDefault(); event.stopImmediatePropagation(); this.openEditor(Number(card.dataset.edit), -1); });
        });
        this.root.querySelectorAll<HTMLElement>('[data-empty-bot]').forEach(card => card.addEventListener('click', event => { if ((event.target as Element).closest('button,input,select')) return; this.openEditor(Number(card.dataset.lobbySlot), -1, 'ai-medium'); }));
        this.root.querySelectorAll<HTMLElement>('[data-join]').forEach(b => b.addEventListener('click', () => this.joinPointer(Number(b.dataset.join))));
        this.root.querySelectorAll<HTMLElement>('[data-bot]').forEach(b => b.addEventListener('click', () => this.openEditor(Number(b.dataset.bot), -1, 'ai-medium')));
        this.root.querySelectorAll<HTMLElement>('[data-remove]').forEach(b => b.addEventListener('click', () => { this.host.remove(Number(b.dataset.remove)); }));
        for (const [slot, d] of this.editors) {
            const card = this.root.querySelector<HTMLElement>(`[data-lobby-slot="${slot}"]`)!;
            card.querySelector('[data-cancel]')?.addEventListener('click', () => d.typing ? this.cancelTyping(slot) : this.cancel(slot));
            card.querySelector('[data-draft-name]')?.addEventListener('click', () => this.beginTyping(slot));
            card.querySelector<HTMLInputElement>('[data-typing-name]')?.addEventListener('input', e => { d.name = (e.target as HTMLInputElement).value; card.querySelector<HTMLButtonElement>('[data-typed-done]')!.disabled = this.nameTaken(slot, d.name); });
            card.querySelector('[data-keyboard-layout]')?.addEventListener('click', () => { d.numericKeyboard = !d.numericKeyboard; d.cursor = 0; this.render(); });
            card.querySelector<HTMLInputElement>('[data-draft-name]')?.addEventListener('input', e => { d.name = (e.target as HTMLInputElement).value; const taken = this.nameTaken(slot, d.name); card.querySelector<HTMLButtonElement>('[data-use-name]')!.disabled = taken; (e.target as HTMLInputElement).setAttribute('aria-invalid', String(taken)); });
            card.querySelectorAll<HTMLElement>('[data-name]').forEach(b => b.addEventListener('click', () => this.chooseName(slot, b.dataset.name!)));
            card.querySelectorAll<HTMLElement>('[data-delete-name]').forEach(b => b.addEventListener('click', () => this.deleteName(slot, b.dataset.deleteName!)));
            card.querySelectorAll<HTMLElement>('[data-letter]').forEach(b => b.addEventListener('click', () => { d.name = (d.name + b.dataset.letter).slice(0, 18); this.render(); }));
            card.querySelector('[data-erase]')?.addEventListener('click', () => { d.name = d.name.slice(0, -1); this.render(); });
            card.querySelector('[data-typed-done]')?.addEventListener('click', () => this.applyTyping(slot));
            card.querySelector('[data-typing-back]')?.addEventListener('click', () => this.cancelTyping(slot));
            card.querySelector('[data-generic-name]')?.addEventListener('click', () => this.chooseName(slot, this.genericName(slot)));
            card.querySelector('[data-use-name]')?.addEventListener('click', () => this.chooseName(slot, d.name));
            card.querySelectorAll<HTMLElement>('[data-level]').forEach(b => b.addEventListener('click', () => { d.difficulty = b.dataset.level as AiDifficulty; if (d.isNew) { d.style = 'random'; this.commit(slot); return; } d.step = 'style'; d.cursor = ['random', ...TILE_STYLES.map(s => s.id)].indexOf(d.style); this.render(); }));
            card.querySelectorAll<HTMLElement>('[data-style]').forEach(b => b.addEventListener('click', () => { d.style = b.dataset.style as TileStyleSelection; this.commit(slot); }));
        }
    }
    private joinPointer(slot: number): void {
        if (isMobilePlayViewport()) {
            if (this.host.slots.some(isLobbyHuman)) {
                this.showJoinHint(slot);
                return;
            }
            this.openEditor(slot, -1, 'human-1');
            return;
        }
        const controller = (['human-1', 'human-2'] as LobbySlot[]).find(value => !this.host.slots.includes(value) && ![...this.editors.values()].some(d => d.controller === value));
        if (controller)
            this.openEditor(slot, -1, controller);
        else
            this.showJoinHint(slot);
    }
    private joinKeyboard(controller: LobbySlot): void {
        if (this.host.slots.includes(controller) || [...this.editors.values()].some(d => d.controller === controller)) return;
        const slot = freeLobbySlot(this.host.slots, this.editors);
        if (slot >= 0) this.openEditor(slot, -1, controller);
    }
    private genericName(slot: number): string {
        for (let n = 1; n <= this.host.slots.length + 1; n++) {
            const name = `${copy('Игрок')} ${n}`;
            const occupiedNumber = this.host.slots.some((v,i) => i !== slot && isLobbyHuman(v) && isGenericPlayerName(this.host.names[i]!) && Number(this.host.names[i]!.match(/\d+$/)?.[0]) === n)
                || [...this.editors].some(([i,d]) => i !== slot && d.step === 'style' && isLobbyHuman(d.controller) && isGenericPlayerName(d.name) && Number(d.name.match(/\d+$/)?.[0]) === n);
            if (!occupiedNumber && !this.nameTaken(slot,name)) return name;
        }
        return `${copy('Игрок')} ${slot + 1}`;
    }
    private showJoinHint(slot: number): void {
        const card = this.root.querySelector<HTMLElement>(`[data-lobby-slot="${slot}"]`);
        if (card && !card.querySelector('.lobby-join-hint'))
            card.insertAdjacentHTML('beforeend', `<small class="lobby-join-hint" role="status">${copy('Нажмите Y на новом геймпаде')}</small>`);
    }
    private openEditor(slot: number, owner: number, controller?: LobbySlot): void {
        if (this.editors.has(slot))
            return;
        const h = this.host, value = controller ?? h.slots[slot]!;
        if (value === 'off')
            return;
        // A pad edits only its own bound card. Pointer/keyboard may edit any card.
        if (owner >= 0 && value.startsWith('gamepad-') && value !== `gamepad-${owner}`)
            return;
        if (owner >= 0 && [...this.editors.values()].some(d => d.owner === owner))
            return;
        const isNew = h.slots[slot] === 'off';
        const step = value.startsWith('ai-') ? 'difficulty' : isNew ? 'name' : 'style';
        const cursor = step === 'difficulty' ? levels.indexOf(value.slice(3) as AiDifficulty) : step === 'style' ? ['random', ...TILE_STYLES.map(s => s.id)].indexOf(h.styles[slot]!) : 0;
        this.editors.set(slot, { owner, token: h.pads().get(owner)?.token ?? 0, controller: value, isNew, step, name: isNew && isLobbyHuman(value) && this.nameTaken(slot, h.names[slot]!) ? '' : h.names[slot]!, style: h.styles[slot]!, difficulty: value.startsWith('ai-') ? value.slice(3) as AiDifficulty : 'medium', names: h.profiles.rankedNames(), cursor });
        this.render();
    }
    private chooseName(slot: number, name: string): void { const d = this.editors.get(slot)!; const normalized = normalizePlayerName(name, slot); if (this.nameTaken(slot, normalized)) return; d.name = normalized; d.step = 'style'; d.cursor = ['random', ...TILE_STYLES.map(s => s.id)].indexOf(d.style); this.render(); }
    private deleteName(slot: number, name: string): void {
        this.host.profiles.profiles.filter(p => p.name === name).forEach(p => this.host.profiles.remove(p.id));
        const d = this.editors.get(slot)!;
        d.cursor = 0;
        this.render();
    }
    private commit(slot: number): void {
        const d = this.editors.get(slot);
        if (!d)
            return;
        if (d.owner >= 0 && this.host.pads().get(d.owner)?.token !== d.token)
            return;
        const value = d.controller.startsWith('ai-') ? `ai-${d.difficulty}` as LobbySlot : d.controller;
        if (isLobbyHuman(value) && this.host.slots.some((v, i) => i !== slot && v === value))
            return;
        if (d.isNew && isLobbyHuman(value) && this.nameTaken(slot, d.name)) { d.step = 'name'; d.cursor = 0; this.render(); return; }
        this.editors.delete(slot);
        this.host.commit(slot, { ...d, controller: value });
    }
    private cancel(slot: number): void { this.editors.delete(slot); this.render(); }
    private padAction(pad: Gamepad): string {
        const down = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
        return down(3) ? 'join' : down(1) ? 'back' : down(0) ? 'confirm' : down(9) ? 'start' : down(2) ? 'x' : down(12) || (pad.axes[1] ?? 0) < -.62 ? 'previous' : down(13) || (pad.axes[1] ?? 0) > .62 ? 'next' : down(14) || (pad.axes[0] ?? 0) < -.62 ? 'decrease' : down(15) || (pad.axes[0] ?? 0) > .62 ? 'increase' : '';
    }
    /** Routes each pad independently while the lobby is active. */
    poll(pads: readonly (Gamepad | null)[]): void {
        if (!this.active())
            return;
        let changed = false;
        for (const [slot, d] of this.editors)
            if (d.owner >= 0 && this.host.pads().get(d.owner)?.token !== d.token) {
                this.editors.delete(slot);
                changed = true;
            }
        if (changed)
            this.render();
        for (const pad of pads) {
            if (!pad?.connected)
                continue;
            const action = this.padAction(pad);
            const previous = this.held.get(pad.index);
            this.held.set(pad.index, action);
            const entry = [...this.editors].find(([, d]) => d.owner === pad.index);
            const targets = this.padTargets();
            const cursor = Math.min(this.selections.get(pad.index) ?? 0, targets.length - 1);
            const selected = targets[cursor];
            const card = selected?.closest<HTMLElement>('[data-lobby-slot]');
            const removeSlot = card?.querySelector('[data-remove]') ? Number(card.dataset.lobbySlot) : -1;
            const activeHold = this.removeHold.get(pad.index);
            if (action === 'x' && activeHold && (removeSlot !== activeHold.slot || this.host.slots[removeSlot] !== activeHold.value || (this.host.pads().get(pad.index)?.token ?? 0) !== activeHold.token)) {
                activeHold.fired = true; // roster/device changed: require a fresh press, never retarget a held X.
                this.root.querySelector<HTMLElement>(`[data-lobby-slot="${activeHold.slot}"]`)?.style.removeProperty('--remove-progress');
            }
            if (action === 'x' && (entry || this.overlay)) {
                this.removeHold.set(pad.index, {slot: -1, value: 'off', token: 0, since: performance.now(), fired: true});
            }
            if (action === 'x' && !entry && !this.overlay && removeSlot >= 0) {
                const prior = this.removeHold.get(pad.index);
                // A completed hold stays latched until release, even after the roster reflows.
                if (!prior?.fired) {
                    const value = this.host.slots[removeSlot]!, token = this.host.pads().get(pad.index)?.token ?? 0;
                    const hold = prior && prior.slot === removeSlot && prior.value === value && prior.token === token ? prior : {slot: removeSlot, value, token, since: performance.now(), fired: false};
                    this.removeHold.set(pad.index, hold);
                    card!.style.setProperty('--remove-progress', String(Math.min(1, (performance.now() - hold.since) / 700)));
                    if (performance.now() - hold.since >= 700) {
                        hold.fired = true;
                        this.host.remove(removeSlot);
                    }
                }
            } else if (action !== 'x') {
                const heldSlot = this.removeHold.get(pad.index)?.slot;
                this.removeHold.delete(pad.index);
                if (heldSlot !== undefined) this.root.querySelector<HTMLElement>(`[data-lobby-slot="${heldSlot}"]`)?.style.removeProperty('--remove-progress');
            }

            if (action === 'x' && entry?.[1].step === 'name') {
                const since = this.deleteSince.get(pad.index) ?? performance.now();
                this.deleteSince.set(pad.index, since);
                if (performance.now() - since >= 700) {
                    const b = this.editorButtons(entry[0])[entry[1].cursor];
                    if (b?.dataset.name)
                        this.deleteName(entry[0], b.dataset.name);
                    this.deleteSince.set(pad.index, Infinity);
                }
            }
            else
                this.deleteSince.delete(pad.index);
            if (!action || action === previous)
                continue;
            this.hintPad = pad.index;
            this.refreshHints();
            this.root.dataset.inputMode = 'gamepad';
            if (this.overlay) {
                if (action === 'back') {
                    this.closeOverlay();
                    continue;
                }
                const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.lobby-overlay button')).filter(b => !b.disabled);
                if (['previous', 'next', 'decrease', 'increase'].includes(action)) {
                    this.modalPadCursor = spatialElementIndex(buttons, this.modalPadCursor, action as GridDirection);
                    buttons[this.modalPadCursor]?.focus();
                }
                if (action === 'confirm')
                    buttons[this.modalPadCursor]?.click();
                continue;
            }
            if (entry) {
                const [slot, d] = entry, buttons = this.editorButtons(slot);
                if (action === 'back') {
                    if (d.typing) {
                        this.cancelTyping(slot);
                    }
                    else
                        this.cancel(slot);
                    continue;
                }
                if (d.typing && action === 'join') { this.applyTyping(slot); continue; }
                if (d.typing && action === 'x') continue;
                if (['next', 'previous', 'increase', 'decrease'].includes(action)) {
                    d.cursor = spatialElementIndex(buttons, d.cursor, action as GridDirection);
                    this.highlightEditor(slot);
                }
                if (action === 'confirm') {
                    const button = buttons[d.cursor];
                    if (button instanceof HTMLInputElement) {
                        this.beginTyping(slot);
                    }
                    else
                        button?.click();
                }
                continue;
            }
            if (action === 'join') {
                const existing = this.host.slots.indexOf(`gamepad-${pad.index}`);
                if (existing >= 0) {
                    this.openEditor(existing, pad.index);
                    continue;
                }
                const slot = freeLobbySlot(this.host.slots, this.editors);
                if (slot >= 0)
                    this.openEditor(slot, pad.index, `gamepad-${pad.index}`);
                continue;
            }
            if (action === 'start') {
                this.host.start();
                continue;
            }
            if (action === 'back') {
                if (!this.back(pad.index) && !this.editing())
                    this.host.back();
                continue;
            }
            if ((action === 'increase' || action === 'decrease') && selected instanceof HTMLSelectElement) {
                const next = Math.max(0, Math.min(selected.options.length - 1, selected.selectedIndex + (action === 'increase' ? 1 : -1)));
                selected.selectedIndex = next;
                selected.dispatchEvent(new Event('change', { bubbles: true }));
                continue;
            }
            if (['previous', 'next', 'increase', 'decrease'].includes(action)) {
                const rects = targets.map(target => (['increase', 'decrease'].includes(action) ? target.closest<HTMLElement>('.lobby-card') ?? target : target).getBoundingClientRect());
                const next = spatialIndex(rects, cursor, action as GridDirection);
                this.selections.set(pad.index, next);
                this.highlight(pad.index, next);
            }
            if (action === 'confirm') {
                if (selected?.dataset.edit !== undefined)
                    this.openEditor(Number(selected.dataset.edit), pad.index);
                else if (selected?.dataset.join !== undefined) { /* Unassigned devices join deliberately with Y. */ }
                else if (selected?.dataset.bot !== undefined)
                    this.openEditor(Number(selected.dataset.bot), pad.index, 'ai-medium');
                else if (selected instanceof HTMLSelectElement) {
                    selected.selectedIndex = (selected.selectedIndex + 1) % selected.options.length;
                    selected.dispatchEvent(new Event('change', { bubbles: true }));
                }
                else
                    selected?.click();
            }
            if (action === 'x' && !this.removeHold.get(pad.index)?.fired && removeSlot < 0 && this.host.mode() !== 'survival') {
                const slot = freeLobbySlot(this.host.slots, this.editors);
                if (slot >= 0)
                    this.openEditor(slot, pad.index, 'ai-medium');
            }
        }
        for (const [slot, d] of this.editors)
            if (d.owner >= 0)
                this.highlightEditor(slot);
    }
    private editorButtons(slot: number): HTMLElement[] { return Array.from(this.root.querySelectorAll<HTMLElement>(`[data-editor-options="${slot}"] button:not([data-delete-name]), [data-editor-options="${slot}"] input:not([data-typing-name])`)); }
    private highlightEditor(slot: number): void {
        const d = this.editors.get(slot)!;
        const buttons = this.editorButtons(slot);
        buttons.forEach((button, i) => button.classList.toggle('pad-selected', i === d.cursor));
        const selected = buttons[d.cursor];
        const options = selected?.closest<HTMLElement>('.lobby-editor-options');
        if (selected && options) {
            const item = selected.getBoundingClientRect(), bounds = options.getBoundingClientRect();
            if (item.bottom > bounds.bottom)
                options.scrollTop += item.bottom - bounds.bottom;
            else if (item.top < bounds.top)
                options.scrollTop -= bounds.top - item.top;
        }
    }
    private padTargets(): HTMLElement[] { return Array.from(this.root.querySelectorAll<HTMLElement>('.lobby-settings button, .lobby-settings select, [data-edit], [data-join], [data-bot], [data-lobby-back], #start-match')).filter(e => !(e as HTMLButtonElement).disabled); }
    private highlight(owner: number, cursor: number): void {
        const targets = this.padTargets();
        this.root.querySelectorAll<HTMLElement>(`.pad-${owner}, .pad-${owner}-target`).forEach(e => e.classList.remove(`pad-${owner}`, `pad-${owner}-target`));
        const selected = targets[cursor];
        const card = selected?.closest('.lobby-card');
        (card ?? selected)?.classList.add(`pad-${owner}`);
        selected?.classList.add(`pad-${owner}-target`);
    }
    private rating(): string {
        const names = new Set(this.host.slots.flatMap((slot, i) => isLobbyHuman(slot) ? [this.host.names[i]!.toLocaleLowerCase(getLocale())] : []));
        const rows = loadSoloRecords();
        return `<header class="lobby-rating-heading"><span>★</span><div><h2>${copy('Рейтинг')}</h2><small>${escape(modeName('survival'))}</small></div></header>${rows.length ? `<ol class="lobby-rating-list">${rows.map((row, i) => `<li class="${names.has(row.name.toLocaleLowerCase(getLocale())) ? 'is-own-rating' : ''}"><b class="result-place medal-${i + 1}">${i + 1}</b><span class="record-identity"><strong>${escape(row.name)}</strong>${recordDateMarkup(row.finishedAt, getLocale())}</span><span class="record-metrics"><time>${row.lineScore.toLocaleString(getLocale())}</time><small>◷ ${formatDuration(row.elapsedMs).slice(0, -2)}</small></span></li>`).join('')}</ol>` : `<p class="rating-message">${copy('Первый рекорд впереди.')}<br>${copy('Сыграйте в «Кто больше».')}</p>`}`;
    }
    private mountRating(panel: HTMLElement): void { this.host.ratings.mount(panel, () => this.host.slots.flatMap((s, i) => isLobbyHuman(s) ? [this.host.names[i]!] : []), () => true, () => { }, { local: copy('На устройстве'), global: copy('Общий'), title: copy('Рейтинг') }); }
    private openOverlay(overlay: 'rating' | 'rules'): void { this.overlay = overlay; this.modalPadCursor = 0; this.ruleIndex = 0; this.renderOverlay(); }
    private closeOverlay(): void { const closed = this.overlay; this.overlay = null; this.root.querySelector<HTMLElement>('.lobby-overlay')!.hidden = true; this.root.querySelectorAll<HTMLElement>('.unified-lobby > :not(.lobby-overlay)').forEach(e => e.inert = false); const rating = this.root.querySelector<HTMLElement>('.lobby-rating'); if (rating) {
        rating.innerHTML = this.rating();
        this.mountRating(rating);
    } this.root.querySelector<HTMLButtonElement>(closed === 'rules' ? '[data-open-rules]' : '[data-open-rating]')?.focus(); }
    private refreshHints(): void {
        const pads = Array.from(navigator.getGamepads?.() ?? []);
        const active = pads.find(p => p?.connected && p.index === this.hintPad) ?? pads.find(p => p?.connected);
        refreshFaceGlyphs(this.root, active?.id ?? 'Xbox');
        for (const [slot, draft] of this.editors) {
            const card = this.root.querySelector<HTMLElement>(`[data-lobby-slot="${slot}"]`);
            const owner = pads.find(p => p?.connected && p.index === draft.owner);
            if (card && owner) refreshFaceGlyphs(card, owner.id);
        }
        const draft = [...this.editors.values()].find(d => d.owner < 0) ?? [...this.editors.values()].find(d => d.owner === this.hintPad) ?? [...this.editors.values()][0];
        const back = this.root.querySelector('[data-lobby-back]');
        const backPad = pads.find(p => p?.connected && p.index === draft?.owner);
        if (back && backPad) refreshFaceGlyphs(back, backPad.id);
        const label = this.root.querySelector('[data-lobby-back-label]');
        if (label) label.textContent = copy(draft?.typing ? 'Отменить ввод' : draft ? 'Отменить настройку' : 'В меню');
    }
    back(owner?: number): boolean {
        if (this.overlay) { this.closeOverlay(); return true; }
        const entries = [...this.editors];
        const entry = entries.find(([,d]) => d.owner === (owner ?? this.hintPad)) ?? entries.find(([,d]) => d.owner < 0) ?? (owner === undefined ? entries[0] : undefined);
        if (!entry) return false;
        if (entry[1].typing) this.cancelTyping(entry[0]); else this.cancel(entry[0]);
        return true;
    }
    private renderOverlay(): void {
        const overlay = this.root.querySelector<HTMLElement>('.lobby-overlay')!;
        if (!this.overlay)
            return;
        overlay.hidden = false;
        this.root.querySelectorAll<HTMLElement>('.unified-lobby > :not(.lobby-overlay)').forEach(e => e.inert = true);
        const cards = ruleCardsForLocale(getLocale());
        const chosen = cards;
        const card = chosen[this.ruleIndex % chosen.length]!;
        overlay.innerHTML = `<section class="lobby-dialog ${this.overlay === 'rules' ? 'lobby-rules-dialog' : ''}" role="dialog" aria-modal="true" aria-label="${this.overlay === 'rating' ? copy('Рейтинг') : copy('Правила игры')}"><header><h2>${this.overlay === 'rating' ? copy('Рейтинг') + ' · ' + escape(modeName('survival')) : copy('Правила игры')}</h2><button data-close-overlay aria-label="${copy('Закрыть')}">×</button></header>${this.overlay === 'rating' ? `<div class="lobby-rating">${this.rating()}</div>` : `<nav class="lobby-rules-tabs"><button data-rules-tab="mode" aria-pressed="${this.rulesTab === 'mode'}">${escape(modeName(this.host.mode()))}</button><button data-rules-tab="basics" aria-pressed="${this.rulesTab === 'basics'}">${copy('Основы игры')}</button></nav>${this.rulesTab === 'mode' ? `<div class="lobby-mode-rules">${this.host.rules()}</div>` : `<div class="lobby-rule-content"><figure>${card.art}</figure><div><h3>${escape(card.title)}</h3><p>${escape(card.lead)}</p><ul>${card.notes.map(note => `<li>${escape(getLocale() === 'ru' ? note.replace('Выживание', 'Кто больше') : note)}</li>`).join('')}</ul></div></div><nav class="lobby-rule-pages"><button data-rule-prev aria-label="${copy('Предыдущее правило')}">←</button><span>${this.ruleIndex % chosen.length + 1} / ${chosen.length}</span><button data-rule-next aria-label="${copy('Следующее правило')}">→</button></nav>`}`}<footer><span>${this.overlay === 'rating' ? copy('Очки за собранные ряды') : copy('Собирайте ряды. Берегите место.')}</span><button data-close-overlay>${key('B')} ${copy('В лобби')}</button></footer></section>`;
        this.refreshHints();
        overlay.querySelectorAll('[data-close-overlay]').forEach(b => b.addEventListener('click', () => this.closeOverlay()));
        overlay.querySelectorAll<HTMLElement>('[data-rules-tab]').forEach(b => b.addEventListener('click', () => { this.rulesTab = b.dataset.rulesTab as 'mode' | 'basics'; this.ruleIndex = 0; this.renderOverlay(); }));
        overlay.querySelector('[data-rule-prev]')?.addEventListener('click', () => { this.ruleIndex = (this.ruleIndex - 1 + chosen.length) % chosen.length; this.renderOverlay(); });
        overlay.querySelector('[data-rule-next]')?.addEventListener('click', () => { this.ruleIndex++; this.renderOverlay(); });
        const panel = overlay.querySelector<HTMLElement>('.lobby-rating');
        if (panel)
            this.mountRating(panel);
        overlay.querySelectorAll('button').forEach(button => button.setAttribute('data-ui-focus', ''));
        overlay.querySelector<HTMLButtonElement>('[data-close-overlay]')?.focus();
    }
}
