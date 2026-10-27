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
import { LobbyYGesture, nextLobbyPosition, ownsLobby, type LobbyMenuOwner } from './lobbyInput';
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
    move(from: number, to: number): void;
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
    private lastWidth = 0;
    private lastHeight = 0;
    private menuOwner: LobbyMenuOwner = { kind: 'pointer' };
    private actingPad: number | null = null;
    private readonly yGesture = new LobbyYGesture();
    private returnSlot: number | null = null;
    enter(index: number | null): void {
        const live = index === null ? null : this.host.pads().get(index);
        this.menuOwner = index !== null && live ? { kind: 'gamepad', index, token: live.token } : { kind: 'pointer' };
        this.selections.clear(); this.yGesture.clear();
        for (const pad of Array.from(navigator.getGamepads?.() ?? [])) if (pad?.connected && pad.buttons[3]?.pressed)
            this.yGesture.update(pad.index, this.host.pads().get(pad.index)?.token ?? 0, true, false, performance.now());
    }
    private isMenuPad(index: number): boolean { return ownsLobby(this.menuOwner, index, this.host.pads().get(index)?.token ?? -1); }
    private padClick(index: number, target: HTMLElement | undefined | null): void {
        this.actingPad = index;
        try { target?.click(); } finally { this.actingPad = null; }
    }
    private pointerAllowed(target: HTMLElement): boolean {
        if (this.overlay) return this.menuOwner.kind === 'pointer';
        const card = target.closest<HTMLElement>('[data-lobby-slot]');
        const slot = Number(card?.dataset.lobbySlot);
        const draft = this.editors.get(slot);
        if (draft) return draft.owner < 0;
        if (this.menuOwner.kind === 'pointer') return !card || !this.host.slots[slot]?.startsWith('gamepad-') || !!target.closest('[data-remove]');
        return !!target.closest('[data-join]') || !!card && ['human-1','human-2'].includes(this.host.slots[slot]!);
    }
    constructor(private readonly root: HTMLElement, private readonly host: LobbyHost) {
        const guard = (event: Event) => {
            if (!this.active() || this.actingPad !== null) return;
            const target = event.target as HTMLElement;
            if (!this.pointerAllowed(target)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
            if (event.type === 'pointerdown') this.root.dataset.inputMode = 'pointer';
        };
        root.addEventListener('pointerdown', guard, true);
        root.addEventListener('click', guard, true);
        root.ownerDocument.addEventListener('keydown', event => {
            if (!this.active()) return;
            const target = event.target as HTMLElement;
            const ownEntry = [...this.editors].find(([,d]) => d.owner < 0);
            if (this.overlay && this.menuOwner.kind !== 'pointer') { event.preventDefault(); event.stopImmediatePropagation(); return; }
            // Admission is available to the keyboard guest as well as the shared-menu owner.
            if (!(target instanceof HTMLInputElement) && !this.overlay && ['w','ц'].includes(event.key.toLowerCase())) {
                event.preventDefault(); event.stopImmediatePropagation();
                if (!event.repeat && !ownEntry) this.joinKeyboard('human-1');
                return;
            }
            if (this.menuOwner.kind !== 'pointer' && !ownEntry && !this.pointerAllowed(target)) {
                event.preventDefault(); event.stopImmediatePropagation(); return;
            }
            this.root.dataset.inputMode = 'keyboard';
            if (target instanceof HTMLInputElement) {
                if (event.key === 'Enter') {
                    event.preventDefault(); event.stopImmediatePropagation();
                    if (ownEntry?.[1].typing) this.applyTyping(ownEntry[0]);
                } else if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.back(-1); }
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopImmediatePropagation();
                if (!this.back(-1) && this.menuOwner.kind === 'pointer') this.host.back();
                return;
            }
            const editorSlot = ownEntry?.[0];
            const editor = editorSlot === undefined ? null : this.editors.get(editorSlot);
            const direction = ({ArrowUp:'previous',ArrowDown:'next',ArrowLeft:'decrease',ArrowRight:'increase'} as const)[event.key as 'ArrowUp'];
            if (direction && editor && !editor.typing && editor.step === 'name') {
                event.preventDefault(); event.stopImmediatePropagation();
                this.turnWheel(editorSlot!, ['previous','decrease'].includes(direction) ? -1 : 1); return;
            }
            if (['Enter',' '].includes(event.key)) {
                event.preventDefault(); event.stopImmediatePropagation();
                if (event.repeat) return;
                if (editor?.step === 'name' && !editor.typing) this.root.querySelector<HTMLElement>(`[data-lobby-slot="${editorSlot}"] [data-wheel-center]`)?.click();
                else target.closest<HTMLElement>('button,[data-edit]')?.click();
                return;
            }
            if (!direction && event.key !== 'Tab') return;
            const buttons = this.overlay ? Array.from(this.root.querySelectorAll<HTMLElement>('.lobby-overlay button:not([disabled])')) : editorSlot !== undefined ? this.editorButtons(editorSlot) : this.padTargets().filter(e => this.pointerAllowed(e));
            if (!buttons.length) return;
            const current = buttons.indexOf(target);
            const next = event.key === 'Tab' ? (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length : spatialIndex(buttons.map(b => b.getBoundingClientRect()),current,direction!);
            event.preventDefault(); event.stopImmediatePropagation(); buttons[next]?.focus();
        }, true);
    }
    active(): boolean { return !!this.root.querySelector('.unified-lobby'); }
    editing(): boolean { return this.editors.size > 0; }
    leave(): void { this.editors.clear(); this.overlay = null; this.removeHold.clear(); this.deleteSince.clear(); this.yGesture.clear(); }
    private indices(): number[] {
        const h = this.host;
        const indices = new Set([...visibleLobbySlots(h.slots, h.mode(), new Set(this.editors.keys())), ...this.editors.keys()]);
        if (h.mode() === 'team-battle')
            for (let i = 0; i < 4; i++)
                indices.add(i);
        return [...indices].sort((a, b) => a - b);
    }
    render(): void {
        const active = this.root.ownerDocument.activeElement as HTMLElement | null;
        const focusSlot = active?.closest<HTMLElement>('[data-lobby-slot]')?.dataset.lobbySlot;
        const focusAttrs = ['data-style','data-name','data-generic-name','data-create-name','data-wheel-center','data-typing-name','data-level','data-edit','data-lobby-back','data-cycle-mode'];
        const focusAttr = focusAttrs.find(a => active?.hasAttribute(a));
        const focusSelector = active?.id ? `#${CSS.escape(active.id)}` : focusAttr ? `${focusSlot === undefined ? '' : `[data-lobby-slot="${focusSlot}"] `}[${focusAttr}="${CSS.escape(active!.getAttribute(focusAttr)!)}"]` : null;
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
        this.root.innerHTML = `<main class="unified-lobby" data-screen="${mode}" data-mode="${mode}" data-menu-owner="${this.menuOwner.kind === 'pointer' ? 'pointer' : `gamepad-${this.menuOwner.index}`}">
      <header class="lobby-heading"><img src="${logo}" alt="Bricks War"><h1>${copy('Лобби')}</h1><span>${copy('Мастерская')}</span></header>
      <section class="lobby-settings" aria-label="${copy('Настройки матча')}">
        <button class="lobby-mode" data-cycle-mode aria-label="${copy('Режим')}: ${escape(modeName(mode))}. ${copy('Следующий режим')}" style="--mode-art:url('${MAIN_MENU_PREVIEWS[mode].image}')"><span>${escape(modeName(mode))}<b>›</b></span></button>
        ${mode === 'survival' ? `<button class="lobby-rating-action" data-open-rating>★ ${copy('Рейтинг')} <b>›</b></button>` : h.settings()}
        <button class="lobby-help" data-open-rules aria-label="${copy('Правила игры')}">?</button>
      </section>
      <div class="lobby-body ${beside ? 'with-rating' : ''}"><section class="lobby-roster" aria-label="${copy('Участники')}"><div class="lobby-cards">${mode === 'team-battle' ? [0,1].map(team => `<div class="lobby-team team-${team}" aria-hidden="true"></div>`).join('') : ''}${indices.map(i => this.card(i)).join('')}</div></section>${beside ? `<aside class="lobby-rating survival-records">${this.rating()}</aside>` : ''}</div>
      <footer class="lobby-footer"><button data-lobby-back>${key('B')} <span data-lobby-back-label>${copy('В меню')}</span></button><span class="lobby-confirm-hint">${key('A')} ${copy('Выбрать')}</span><div class="lobby-start-group"><p id="setup-error" role="status" aria-live="polite"></p><button id="start-match" class="lobby-start">${copy('Начать игру')} ${key('≡', 'menu')}</button></div></footer>
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
            const selected = options?.querySelector<HTMLElement>('[data-default-choice="true"]');
            if (options && selected) options.scrollTop = Math.max(0, selected.offsetTop - options.offsetTop - (options.clientHeight - selected.offsetHeight) / 2);
        }
        const rating = this.root.querySelector<HTMLElement>('.lobby-rating');
        if (rating)
            this.mountRating(rating);
        this.renderOverlay();
        this.refreshHints();
        h.validate();
        if (!this.overlay) {
            const own = [...this.editors].find(([,d]) => d.owner < 0);
            const restore = focusSelector ? this.root.querySelector<HTMLElement>(focusSelector) : null;
            if (own) {
                const scope = this.root.querySelector<HTMLElement>(`[data-lobby-slot="${own[0]}"]`)!;
                const target = own[1].typing ? scope.querySelector<HTMLElement>('[data-typing-name]') : restore && scope.contains(restore) ? restore : (scope.querySelector<HTMLElement>('[data-wheel-center]') ?? scope.querySelector<HTMLElement>('[data-default-choice="true"]') ?? this.editorButtons(own[0])[0]);
                target?.focus({preventScroll:true});
            } else if (restore) restore.focus({preventScroll:true});
            else if (this.returnSlot !== null) this.root.querySelector<HTMLElement>(`[data-edit="${this.returnSlot}"]`)?.focus({preventScroll:true});
            else if (this.menuOwner.kind === 'pointer') this.root.querySelector<HTMLElement>('[data-cycle-mode]')?.focus({preventScroll:true});
        }
        this.returnSlot = null;
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
      ${draft ? this.editorMarkup(slot, draft) : empty ? `${h.mode() === 'survival' ? '<span class="lobby-plus" aria-hidden="true">+</span>' : `<button data-bot="${slot}" class="lobby-add-bot"><span class="lobby-plus" aria-hidden="true">+</span><span class="lobby-bot-label">${key('X')} ${copy('Добавить бота')}</span></button>`}<button data-join="${slot}">${key('Y')} ${copy('Присоединиться')}</button>` : `
        <div class="lobby-card-mark"><span>${bot ? copy('СОПЕРНИК') : `${copy('ИГРОК')} ${slot + 1}`}</span>${controllerIcon(bot ? 'ai' : isMobilePlayViewport() && value === 'human-1' ? 'mobile-touch' : value, getLocale())}</div>
        <h2>${bot ? `${copy('Бот')} <small>· ${escape(levelName(value.slice(3) as AiDifficulty).toLocaleLowerCase(getLocale()))}</small>` : escape(h.names[slot]!)}</h2>
        <p class="lobby-ready">${disconnected ? '⚠ ' + copy('Геймпад отключён') : '✓ ' + copy('Готов')}</p>
        <div class="lobby-well">${this.piece(h.styles[slot]!)}</div><p class="lobby-style-label">${escape(styleName(h.styles[slot]!))}</p>
        <button class="lobby-remove" title="${copy('Удерживайте X, чтобы удалить участника')}" data-remove="${slot}" aria-label="${copy('Удалить участника')} ${slot + 1}">×</button>`}
    </article>`;
    }
    private nameTaken(slot: number, name: string): boolean { return lobbyNameTaken(slot, name, this.host.slots, this.host.names, this.editors); }
    private nameOptions(slot: number, d: CardDraft): {label: string; kind: string; value: string}[] {
        return [{label: copy('Создать новое'),kind:'create',value:''},{label:copy('Гость'),kind:'guest',value:''}, ...d.names.filter(name => !isGenericPlayerName(name) && this.host.profiles.profiles.some(p => p.name === name) && !this.nameTaken(slot,name)).map(name => ({label:name,kind:'name',value:name}))];
    }
    private wheelArrow(direction: 'up' | 'down'): string {
        return `<button data-wheel-${direction} aria-label="${copy(direction === 'up' ? 'Предыдущее' : 'Следующее')}"><svg class="lobby-wheel-chevron" viewBox="0 0 12 8" aria-hidden="true" focusable="false"><path d="${direction === 'up' ? 'M2 6 L6 2 L10 6' : 'M2 2 L6 6 L10 2'}"/></svg></button>`;
    }
    private wheelMarkup(slot: number, d: CardDraft): string {
        const options = this.nameOptions(slot,d); d.cursor = (d.cursor + options.length) % options.length;
        return `<div class="lobby-wheel lobby-name-wheel">${this.wheelArrow('up')}${[-2,-1,0,1,2].map(offset => {
            const index = (d.cursor+offset+options.length)%options.length, item=options[index]!;
            // Small histories show empty neighbour tracks rather than duplicate action buttons.
            if (Math.abs(offset) && (options.length < 5 && (d.cursor+offset < 0 || d.cursor+offset >= options.length))) return '<span class="lobby-wheel-empty" aria-hidden="true"></span>';
            return `<button class="lobby-wheel-option ${offset === 0 ? 'is-current' : ''} ${item.kind === 'create' ? 'is-create' : ''}" ${offset === 0 ? 'data-wheel-center' : ''} data-wheel-index="${index}" ${item.kind === 'guest' ? 'data-generic-name' : item.kind === 'create' ? 'data-create-name' : `data-name="${escape(item.value)}"`}>${item.kind === 'create' ? '＋ ' : ''}${escape(item.label)}</button>`;
        }).join('')}${this.wheelArrow('down')}</div>`;
    }
    private styleMarkup(d: CardDraft): string {
        const styles = ['random', ...TILE_STYLES.map(s => s.id)] as TileStyleSelection[];
        if (d.owner < 0) return `<div class="lobby-theme-list">${styles.map(style=>`<button class="lobby-style-option" data-style="${style}" data-default-choice="${d.style===style}">${this.piece(style,true)}<span>${escape(styleName(style))}</span></button>`).join('')}</div>`;
        d.cursor=(d.cursor+styles.length)%styles.length;
        const style=styles[d.cursor]!;
        return `<div class="lobby-wheel lobby-theme-wheel">${this.wheelArrow('up')}<button data-wheel-center data-style="${style}" class="lobby-theme-current" aria-label="${escape(styleName(style))}"><span class="lobby-well">${this.piece(style,true)}</span><strong>${escape(styleName(style))}</strong></button><small>${d.cursor+1} / ${styles.length}</small>${this.wheelArrow('down')}</div>`;
    }
    private turnWheel(slot: number, delta: number): void {
        const d=this.editors.get(slot); if (!d) return;
        const count=d.step==='name'?this.nameOptions(slot,d).length:1+TILE_STYLES.length;
        d.cursor=(d.cursor+delta+count)%count;
        this.render();
        this.root.querySelector(`[data-lobby-slot="${slot}"] .lobby-wheel`)?.animate([{opacity:.4,transform:`translateY(${delta*6}px)`},{opacity:1,transform:'translateY(0)'}],{duration:140});
    }
    private editorMarkup(slot: number, d: CardDraft): string {
        return `<div class="lobby-card-mark"><span>${controllerIcon(d.controller.startsWith('ai-') ? 'ai' : isMobilePlayViewport() && d.controller === 'human-1' ? 'mobile-touch' : d.controller, getLocale())} ${d.controller.startsWith('ai-') ? copy('Бот') : `${copy('Участник')} ${slot + 1}`}</span>${d.step === 'name' && !d.typing && this.nameOptions(slot,d)[d.cursor]?.kind === 'name' ? `<button data-delete-name="${escape(this.nameOptions(slot,d)[d.cursor]!.value)}" aria-label="${copy('Удалить имя')} ${escape(this.nameOptions(slot,d)[d.cursor]!.value)}">⌫</button>` : ''}<button data-cancel="${slot}" aria-label="${copy('Отменить настройку')}">×</button></div><h2 class="lobby-editor-title">${d.step === 'name' ? copy(d.typing ? 'Новое имя' : 'Выберите имя') : d.step === 'difficulty' ? copy('Сложность бота') : copy('Стиль фигур')}</h2><div class="lobby-editor-options" data-editor-options="${slot}">${d.step === 'name' ? d.typing ? this.typingMarkup(d) : this.wheelMarkup(slot,d) : d.step === 'difficulty' ? levels.map(level => `<button data-level="${level}" data-default-choice="${d.difficulty === level}">${escape(levelName(level))}</button>`).join('') : this.styleMarkup(d)}</div>${d.typing ? `<div class="lobby-editor-hint"><button data-typed-done ${this.nameTaken(slot,d.name)?'disabled':''}>${key('Y')} ${copy('Применить')}</button><button data-typing-back>${key('B')} ${copy('Отменить ввод')}</button></div>` : ''}`;
    }
    private typingMarkup(d: CardDraft): string {
        if (d.owner < 0) return `<label class="lobby-physical-name">${copy('Новое имя')}<input class="lobby-typed-name" data-typing-name maxlength="18" value="${escape(d.name)}" aria-label="${copy('Новое имя')}"></label>`;
        return `<input class="lobby-typed-name" data-typing-name maxlength="18" value="${escape(d.name)}" aria-label="${copy('Новое имя')}"><div class="lobby-name-keys">${nameKeyboardRows(getLocale() === 'ru', d.numericKeyboard).map(row => `<div class="lobby-key-row">${row.map(letter => `<button data-letter="${letter}">${letter}</button>`).join('')}</div>`).join('')}<div class="lobby-key-row lobby-key-actions">${getLocale() === 'ru' && !d.numericKeyboard ? '<button data-letter="Ё">Ё</button>' : ''}<button data-keyboard-layout>${d.numericKeyboard ? getLocale() === 'ru' ? 'АБВ' : 'ABC' : '123'}</button><button class="lobby-space" data-letter=" ">${copy('Пробел')}</button><button data-erase aria-label="${copy('Удалить символ')}">⌫</button></div></div>`;
    }
    private beginTyping(slot: number): void {
        const d = this.editors.get(slot)!;
        d.typingOriginal = d.name; d.typingCursor = d.cursor; d.typing = true; d.numericKeyboard = false; d.cursor = 0; d.name = isGenericPlayerName(d.name) ? '' : d.name;
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
        this.root.querySelectorAll<HTMLElement>('[data-join]').forEach(b => b.addEventListener('click', () => this.joinPointer(Number(b.dataset.join))));
        this.root.querySelectorAll<HTMLElement>('[data-bot]').forEach(b => b.addEventListener('click', () => this.openEditor(Number(b.dataset.bot), -1, 'ai-medium')));
        this.root.querySelectorAll<HTMLElement>('[data-remove]').forEach(b => b.addEventListener('click', () => { this.host.remove(Number(b.dataset.remove)); }));
        for (const [slot, d] of this.editors) {
            const card = this.root.querySelector<HTMLElement>(`[data-lobby-slot="${slot}"]`)!;
            card.querySelector('[data-cancel]')?.addEventListener('click', () => d.typing ? this.cancelTyping(slot) : this.cancel(slot));
            card.querySelector<HTMLInputElement>('[data-typing-name]')?.addEventListener('input', e => { d.name = (e.target as HTMLInputElement).value; card.querySelector<HTMLButtonElement>('[data-typed-done]')!.disabled = this.nameTaken(slot, d.name); });
            card.querySelector('[data-keyboard-layout]')?.addEventListener('click', () => { d.numericKeyboard = !d.numericKeyboard; d.cursor = 0; this.render(); });
            card.querySelectorAll<HTMLElement>('[data-name]').forEach(b => b.addEventListener('click', () => this.chooseName(slot, b.dataset.name!)));
            card.querySelectorAll<HTMLElement>('[data-delete-name]').forEach(b => b.addEventListener('click', () => this.deleteName(slot, b.dataset.deleteName!)));
            card.querySelectorAll<HTMLElement>('[data-letter]').forEach(b => b.addEventListener('click', () => { d.name = (d.name + b.dataset.letter).slice(0, 18); this.render(); }));
            card.querySelector('[data-erase]')?.addEventListener('click', () => { d.name = d.name.slice(0, -1); this.render(); });
            card.querySelector('[data-typed-done]')?.addEventListener('click', () => this.applyTyping(slot));
            card.querySelector('[data-typing-back]')?.addEventListener('click', () => this.cancelTyping(slot));
            card.querySelectorAll<HTMLElement>('[data-generic-name]').forEach(b=>b.addEventListener('click',()=>this.chooseName(slot,this.genericName(slot))));
            card.querySelectorAll<HTMLElement>('[data-create-name]').forEach(b=>b.addEventListener('click',()=>this.beginTyping(slot)));
            card.querySelector('[data-wheel-up]')?.addEventListener('click',()=>this.turnWheel(slot,-1));
            card.querySelector('[data-wheel-down]')?.addEventListener('click',()=>this.turnWheel(slot,1));
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
        // Pointer/keyboard authorization is checked at dispatch; pads can only edit their own human.
        if (owner >= 0 && value.startsWith('gamepad-') && value !== `gamepad-${owner}`)
            return;
        if (owner >= 0 && [...this.editors.values()].some(d => d.owner === owner))
            return;
        const isNew = h.slots[slot] === 'off';
        const step = value.startsWith('ai-') ? 'difficulty' : isNew ? 'name' : 'style';
        const cursor = step === 'difficulty' ? levels.indexOf(value.slice(3) as AiDifficulty) : step === 'style' ? ['random', ...TILE_STYLES.map(s => s.id)].indexOf(h.styles[slot]!) : 1;
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
        this.returnSlot=slot;
        this.host.commit(slot, { ...d, controller: value });
    }
    private cancel(slot: number): void { this.editors.delete(slot); this.returnSlot=slot; this.render(); }
    private padAction(pad: Gamepad): string {
        const down = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
        return down(3) ? 'join' : down(1) ? 'back' : down(0) ? 'confirm' : down(9) ? 'start' : down(2) ? 'x' : down(12) || (pad.axes[1] ?? 0) < -.62 ? 'previous' : down(13) || (pad.axes[1] ?? 0) > .62 ? 'next' : down(14) || (pad.axes[0] ?? 0) < -.62 ? 'decrease' : down(15) || (pad.axes[0] ?? 0) > .62 ? 'increase' : '';
    }
    /** Routes each pad independently while the lobby is active. */
    poll(pads: readonly (Gamepad | null)[]): void {
        if (!this.active()) return;
        this.yGesture.retain(this.host.pads());
        let changed=false;
        for (const [slot,d] of this.editors) if(d.owner>=0 && this.host.pads().get(d.owner)?.token!==d.token){this.editors.delete(slot);changed=true;}
        if(changed)this.render();
        for(const pad of pads){
            if(!pad?.connected)continue;
            const live=this.host.pads().get(pad.index); if(!live)continue;
            let entry=[...this.editors].find(([,d])=>d.owner===pad.index);
            const ownSlot=this.host.slots.indexOf(`gamepad-${pad.index}`);
            const gesture=this.yGesture.update(pad.index,live.token,!!pad.buttons[3]?.pressed,ownSlot>=0||!!entry,performance.now());
            if(!this.overlay){
                if(gesture==='join'&&!entry){const slot=freeLobbySlot(this.host.slots,this.editors);if(slot>=0)this.openEditor(slot,pad.index,`gamepad-${pad.index}`);}
                if(gesture==='edit'&&!entry&&ownSlot>=0)this.openEditor(ownSlot,pad.index);
                if(gesture==='move'&&!entry&&ownSlot>=0){const next=nextLobbyPosition(this.host.slots,ownSlot,new Set(this.editors.keys()));if(next!==ownSlot)this.host.move(ownSlot,next);}
                if(gesture==='join'&&entry?.[1].typing)this.applyTyping(entry[0]);
            }
            // Y inside a typing editor applies immediately; outside it the short/hold gesture owns Y.
            const action=this.padAction(pad),previous=this.held.get(pad.index);
            this.held.set(pad.index,action);
            entry=[...this.editors].find(([,d])=>d.owner===pad.index);
            if(entry?.[1].typing && action==='join' && previous!=='join')this.applyTyping(entry[0]);
            if(this.overlay){
                if(pad.buttons[2]?.pressed)this.removeHold.set(pad.index,{slot:-1,value:'off',token:live.token,since:performance.now(),fired:true});
                if(!this.isMenuPad(pad.index)||!action||action===previous)continue;
                if(action==='back'){this.closeOverlay();continue;}
                const buttons=Array.from(this.root.querySelectorAll<HTMLElement>('.lobby-overlay button:not([disabled])'));
                if(['previous','next','decrease','increase'].includes(action)){this.modalPadCursor=spatialElementIndex(buttons,this.modalPadCursor,action as GridDirection);buttons[this.modalPadCursor]?.focus();}
                if(action==='confirm')this.padClick(pad.index,buttons[this.modalPadCursor]);
                continue;
            }
            if(entry){
                if(pad.buttons[2]?.pressed)this.removeHold.set(pad.index,{slot:-1,value:'off',token:live.token,since:performance.now(),fired:true});
                if(action) this.root.dataset.inputMode='gamepad';
                const [slot,d]=entry;
                if(action==='x'&&d.step==='name'&&!d.typing){
                    const since=this.deleteSince.get(pad.index)??performance.now();this.deleteSince.set(pad.index,since);
                    if(performance.now()-since>=700){const item=this.nameOptions(slot,d)[d.cursor];if(item?.kind==='name')this.deleteName(slot,item.value);this.deleteSince.set(pad.index,Infinity);}
                }else this.deleteSince.delete(pad.index);
                if(!action||action===previous||action==='join')continue;
                if(action==='back'){if(d.typing)this.cancelTyping(slot);else this.cancel(slot);continue;}
                const buttons=this.editorButtons(slot);
                if(['previous','next','decrease','increase'].includes(action)){
                    if(!d.typing&&(d.step==='name'||d.step==='style'))this.turnWheel(slot,['previous','decrease'].includes(action)?-1:1);
                    else{d.cursor=spatialElementIndex(buttons,d.cursor,action as GridDirection);this.highlightEditor(slot);}
                }
                if(action==='confirm')this.padClick(pad.index,!d.typing&&(d.step==='name'||d.step==='style')?this.root.querySelector<HTMLElement>(`[data-lobby-slot="${slot}"] [data-wheel-center]`):buttons[d.cursor]);
                continue;
            }
            if(!this.isMenuPad(pad.index))continue;
            const targets=this.padTargets(),cursor=Math.min(this.selections.get(pad.index)??0,targets.length-1),selected=targets[cursor];
            const card=selected?.closest<HTMLElement>('[data-lobby-slot]'),slot=card?.querySelector('[data-remove]')?Number(card.dataset.lobbySlot):-1;
            if(action==='x'&&slot>=0){
                const old=this.removeHold.get(pad.index),value=this.host.slots[slot]!;
                const hold=old??{slot,value,token:live.token,since:performance.now(),fired:false};this.removeHold.set(pad.index,hold);
                if(hold.slot!==slot||hold.value!==value||hold.token!==live.token)hold.fired=true;
                if(!hold.fired){card!.style.setProperty('--remove-progress',String(Math.min(1,(performance.now()-hold.since)/700)));if(performance.now()-hold.since>=700){hold.fired=true;this.host.remove(slot);}}
            }else if(!pad.buttons[2]?.pressed){const heldSlot=this.removeHold.get(pad.index)?.slot;this.removeHold.delete(pad.index);if(heldSlot!==undefined)this.root.querySelector<HTMLElement>(`[data-lobby-slot="${heldSlot}"]`)?.style.removeProperty('--remove-progress');}
            if(!action||action===previous||action==='join')continue;
            this.root.dataset.inputMode='gamepad';
            if(action==='start'){this.host.start();continue;}
            if(action==='back'){if(!this.back(pad.index))this.host.back();continue;}
            if(['previous','next','increase','decrease'].includes(action)){const rects=targets.map(t=>(['increase','decrease'].includes(action)?t.closest<HTMLElement>('.lobby-card')??t:t).getBoundingClientRect());const next=spatialIndex(rects,cursor,action as GridDirection);this.selections.set(pad.index,next);this.highlight(pad.index,next);}
            if(action==='confirm'){
                if(selected?.dataset.edit!==undefined)this.openEditor(Number(selected.dataset.edit),pad.index);
                else if(selected?.dataset.bot!==undefined)this.openEditor(Number(selected.dataset.bot),pad.index,'ai-medium');
                else if(selected?.dataset.join===undefined)this.padClick(pad.index,selected);
            }
            if(action==='x'&&!this.removeHold.get(pad.index)?.fired&&slot<0&&this.host.mode()!=='survival'){const free=freeLobbySlot(this.host.slots,this.editors);if(free>=0)this.openEditor(free,pad.index,'ai-medium');}
        }
        for(const [slot,d]of this.editors)if(d.owner>=0)this.highlightEditor(slot);
        this.refreshHints();
    }
    private editorButtons(slot: number): HTMLElement[] { return Array.from(this.root.querySelectorAll<HTMLElement>(`[data-editor-options="${slot}"] button:not([data-delete-name]), [data-editor-options="${slot}"] input:not([data-typing-name])`)); }
    private highlightEditor(slot: number): void {
        const d = this.editors.get(slot)!;
        // An editor replaces this device's shared cursor; other devices keep theirs.
        this.root.querySelectorAll<HTMLElement>(`.pad-${d.owner}, .pad-${d.owner}-target`).forEach(e => e.classList.remove(`pad-${d.owner}`, `pad-${d.owner}-target`));
        const buttons = this.editorButtons(slot);
        if (!d.typing && (d.step === 'name' || d.step === 'style')) { this.root.querySelector(`[data-lobby-slot="${slot}"] [data-wheel-center]`)?.classList.add('pad-selected'); return; }
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
    private padTargets(): HTMLElement[] { return Array.from(this.root.querySelectorAll<HTMLElement>('.lobby-settings button, .lobby-settings select, [data-edit], [data-join], [data-bot], [data-lobby-back], #start-match')).filter(e => !(e as HTMLButtonElement).disabled && e.getClientRects().length > 0); }
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
        const active = pads.find(p => p?.connected && p.index === (this.menuOwner.kind === 'gamepad' ? this.menuOwner.index : -1));
        this.root.querySelector('.unified-lobby')?.setAttribute('data-owner-hints',this.menuOwner.kind==='gamepad'?'gamepad':'pointer');
        refreshFaceGlyphs(this.root, active?.id ?? 'Xbox');
        for (const [slot, draft] of this.editors) {
            const card = this.root.querySelector<HTMLElement>(`[data-lobby-slot="${slot}"]`);
            const owner = pads.find(p => p?.connected && p.index === draft.owner);
            if (card && owner) refreshFaceGlyphs(card, owner.id);
        }
        const draft = [...this.editors.values()].find(d => d.owner === (this.menuOwner.kind==='pointer'?-1:this.menuOwner.index));
        const back = this.root.querySelector('[data-lobby-back]');
        const backPad = pads.find(p => p?.connected && p.index === draft?.owner);
        if (back && backPad) refreshFaceGlyphs(back, backPad.id);
        const label = this.root.querySelector('[data-lobby-back-label]');
        if (label) label.textContent = copy(draft?.typing ? 'Отменить ввод' : draft ? 'Отменить настройку' : 'В меню');
    }
    back(owner = this.menuOwner.kind==='gamepad'?this.menuOwner.index:-1): boolean {
        if(this.overlay){if(owner<0?this.menuOwner.kind==='pointer':this.isMenuPad(owner))this.closeOverlay();return true;}
        const entry=[...this.editors].find(([,d])=>d.owner===owner);
        if(!entry)return false;
        if(entry[1].typing)this.cancelTyping(entry[0]);else this.cancel(entry[0]);
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
