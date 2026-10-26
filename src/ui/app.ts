import { lobbyText } from '../i18n/lobbyCopy';
import { UnifiedLobby } from './unifiedLobby';
import { freshBattleSetup, lobbyAdmission, LobbyRosterMemory, type CardDraft } from './lobbyState';
import { suspendOtherDialogs } from './modalSemantics';
import { localizedTuningMessage } from './localizedTuningMessage';
import { LAB_SCALAR_COPY_KEYS, LAB_AI_COPY_KEYS, LAB_BATTLE_COPY_KEYS, LAB_TILT_COPY_KEYS, LAB_MESSAGE_COPY_KEYS } from '../i18n/labCatalogs';
import { localValidationMessage } from './localValidation';
import type { MessageKey } from '../i18n/catalogs';
import type { FooterActionKey } from './gamepadFooterHints';
import { html as tr, text as localeText, setLocale, getLocale, translate as localeTranslate, LOCALES, type Locale } from '../i18n/locale';
import { languageSettingsMarkup } from '../i18n/selector';
import { WORKSHOP_THEME_TEXTURES } from '../rendering/workshopSprites';
import { footerResetButtonMarkup, gamepadFaceLabels, gamepadFooterAction, gamepadFooterHintsMarkup, showGamepadFooterHints } from './gamepadFooterHints';
import { MatchLoading } from './matchLoading';
import { prepareAnomalyArrivalPlaytest } from './anomalyArrivalPlaytest';
import { rulesScreenMarkup, bindRulesScreen } from './visualRules';
import './visualRules.css';
import { desktop, installerDownload, type DisplayPreferences } from '../platform/desktop';
import { shieldInventoryMarkup, shieldInventoryKey } from './shieldInventory';
import { configureDesktopStage } from './desktopStage';
import { configureDesktopLabPages } from './desktopLabPages';
import { nextPiecePreviewMarkup } from './nextPiecePreview';
import { NetworkApp } from '../network/app';
import { LocalMatchSession } from '../sessions/matchSession';
import * as Phaser from 'phaser/dist/phaser.esm.js';
import conceptLogoUrl from '../assets/brand/concept-logo.webp';
import './brandLogo.css';
import { gamepadControlsArtworkMarkup } from './localizedControlsArtwork';
import { MAIN_MENU_PREVIEWS, mainMenuPreviewMarkup, type MainMenuDestination } from './mainMenuPreview';
import './mainMenuPreview.css';
import './menuFocus.css';
import { menuGlyph } from './menuGlyph';
import { GameAudio } from '../audio/GameAudio';
import { MUSIC_DIRECTIONS, type AudioPreviewCategory, type MusicDirectionId } from '../audio/audioDirections';
import { isSfxPresetId, SFX_PACK_OPTIONS } from '../audio/sfxPresets';
import { AiController } from '../controllers/ai';
import { HumanInputRouter } from '../controllers/input';
import { connectedGamepads, type ConnectedGamepad, type GamepadControls } from '../controllers/gamepads';
import { MOBILE_TOUCH_BUTTON_ZONE_FRACTION, mobileTouchActionAt, type MobileTouchAction } from '../controllers/mobileTouchZones';
import type {
  AiDifficulty,
  BattleDifficulty,
  GamepadController,
  MatchOptionSelections,
  MatchState,
  ParticipantConfig,
  TileStyleSelection,
} from '../domain/types';
import { isGamepadController } from '../domain/types';
import {
  cloneGameTuning,
  DEFAULT_GAME_TUNING,
  MESSAGE_TEMPLATE_KEYS,
  releaseTuningSaveEnabled,
  type GameTuning,
} from '../domain/gameTuning';
import { DEFAULT_TILE_STYLE_SELECTION } from '../domain/tileStyles';
import { PlayScene } from '../rendering/PlayScene';
import { localArenaDecoration, type ArenaLayout } from '../rendering/arenaLayout';
import { DEFAULT_DURATION_MINUTES, FINAL_PUSH_PULSE_MS, LEVEL_UP_PULSE_MS, MatchEngine, validateDurationMinutes, validateMatchOptions, validateParticipants, validateSurvivalParticipants } from '../simulation/match';
import { scoreLeaderIds, teamIdForSlot, teamLeaderIds, teamScores } from '../simulation/competition';
import { formatClock, formatDuration, formatPieces, matchClockPresentation } from './format';
import {
  formatParticipantEventMarkup,
  globalMatchEvent,
  matchEventIconMarkup,
  matchEventPlaqueMarkup,
  participantMatchEvent,
} from './matchEventPresentation';
import { controllerIcon } from './controllerIcon';
import { hudIdentityForParticipant, playerAccentForSlot } from './hudIdentity';
import {
  loadPlayerNames,
  normalizePlayerName,
  isGenericPlayerName,
  savePlayerNames,
} from './playerNamePersistence';
import { startsMutedForPlaytest } from './playtestParams';
import { GamepadProfiles, gamepadDescription } from './gamepadProfiles';
import { type SlotSelection } from './slotPersistence';
import { releaseMetadataMarkup } from './releaseMetadata';
import { webReleaseHistory, type ReleaseHistoryRow } from './releaseHistory';
import { loadGameTuning, resetGameTuning, saveGameTuning } from './gameTuningPersistence';
import { PlayerEventRegionLatch } from './playerEventPlacement';
import { participantLevelUpNoticeKey } from './hudInvalidation';
import { saveSurvivalRecords } from './soloRecords';
import { RatingPanels } from './ratingPanel';
import { recordDateMarkup } from './recordDate';
import { MenuFocusController } from './menuNavigation';
import { enhanceMenuSelects } from './menuSelect';
import { ScreenRouter, type AppScreen } from './screenRouter';
import { DEFAULT_RELEASE_SETTINGS, loadReleaseSettings, saveReleaseSettings } from './releaseSettings';
import { isMobilePlayViewport } from './mobileSettings';
import { clientUpdate } from '../pwa/clientUpdate';
import { nativeUpdatePresentation, updatePresentation } from '../pwa/updatePresentation';
import { dismissIosInstallHint, shouldShowIosInstallHint } from './pwaInstall';
import { fromEntries } from '../runtime/compat';
import { prepareClearPlaytest } from './clearPlaytest';

type SlotValue = SlotSelection | GamepadController;
type ScalarTuningKey = Exclude<keyof GameTuning, 'ai' | 'messages' | 'mobileTilt' | 'battleDifficulties'>;

interface TuningField {
  key: ScalarTuningKey;
  label: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

const TUNING_GROUPS: ReadonlyArray<{ title: string; description: string; fields: readonly TuningField[] }> = [
  {
    title: 'Движение фигур',
    description: 'Тайминги падения, бокового движения и фиксации. Меньше миллисекунд — быстрее.',
    fields: [
      { key: 'minimumGravityMs', label: 'Предельное падение', hint: 'Самый быстрый допустимый шаг после всех ускорений.', unit: 'мс', min: 25, max: 500, step: 5 },
      { key: 'softDropIntervalMs', label: 'Ускорение вниз', hint: 'Шаг падения при удержании S или стрелки вниз.', unit: 'мс', min: 25, max: 400, step: 5 },
      { key: 'horizontalRepeatDelayMs', label: 'Задержка бокового повтора', hint: 'Сколько ждать после первого шага вбок перед автоповтором.', unit: 'мс', min: 0, max: 500, step: 5 },
      { key: 'horizontalRepeatIntervalMs', label: 'Скорость движения вбок', hint: 'Интервал между повторными шагами влево или вправо при удержании.', unit: 'мс', min: 10, max: 200, step: 5 },
      { key: 'lockDelayMs', label: 'Задержка фиксации', hint: 'Время на сдвиг или поворот после касания поверхности.', unit: 'мс', min: 100, max: 1500, step: 25 },
      { key: 'maxLockResets', label: 'Сбросы фиксации', hint: 'Сколько движений на поверхности могут заново запустить задержку фиксации.', unit: 'раз', min: 0, max: 50, step: 1 },
      { key: 'spawnPreparationMs', label: 'Подготовка фигуры', hint: 'Время на первый сдвиг или поворот после появления фигуры.', unit: 'мс', min: 0, max: 2000, step: 25 },
      { key: 'spawnRotationExtensionMs', label: 'Продление поворотом', hint: 'Сколько добавляет каждая попытка поворота в подготовке.', unit: 'мс', min: 0, max: 1000, step: 25 },
      { key: 'spawnPreparationMaxMs', label: 'Лимит подготовки', hint: 'Максимальное общее время подготовки одной фигуры.', unit: 'мс', min: 0, max: 3000, step: 25 },
    ],
  },
  {
    title: 'Ритм матча',
    description: 'Уровни, аномалии и финальные серые ряды.',
    fields: [
      { key: 'pressurePhasePercent', label: 'Финальная фаза', hint: 'Какую долю конца матча занимает подъём серых рядов.', unit: '%', min: 5, max: 100, step: 1 },
      { key: 'pressureIntervalMs', label: 'Интервал серых рядов', hint: 'Как часто в финальной фазе снизу появляется новый серый ряд.', unit: 'мс', min: 1000, max: 30000, step: 500 },
      { key: 'conflictWarningMs', label: 'Пауза после сигнала атаки', hint: 'Время от сигнала «Аномальная атака» до появления серых рядов.', unit: 'мс', min: 0, max: 5000, step: 50 },
    ],
  },
];

function labUnit(unit: string): string {
  const key = ({'мс':'labUnitMs','раз':'labUnitTimes','шт':'labUnitPieces'} as const)[unit as 'мс'|'раз'|'шт'];
  return key ? localeText(key) : unit;
}
function labHint(key: MessageKey): string { return localeTranslate(getLocale(), key, {level:'{level}',senders:'{senders}',rows:'{rows}'}); }
function localizedGamepadName(index: number): string { return localeText('gamepadIndex', { index:index+1 }); }
const TEMPO_MESSAGE_KEYS = {
  family:{label:'tempoFamily',hint:'tempoFamilyHint'},normal:{label:'tempoNormal',hint:'tempoNormalHint'},sport:{label:'tempoSport',hint:'tempoSportHint'},
} as const;
function localizedBattleDifficultyCopy(value: BattleDifficulty): {label:string;hint:string} {
  return {label:localeText(TEMPO_MESSAGE_KEYS[value].label),hint:localeText(TEMPO_MESSAGE_KEYS[value].hint)};
}

function isGamepadSlot(value: SlotValue): value is GamepadController {
  return value.startsWith('gamepad-');
}

function isManualSlot(value: SlotValue): value is Exclude<SlotValue, 'off' | `ai-${AiDifficulty}`> {
  return value === 'human-1' || value === 'human-2' || isGamepadSlot(value);
}

function isLocalPlaytestFlag(name: string): boolean {
  const local = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  return local && new URLSearchParams(window.location.search).has(name);
}

function localPlaytestNumber(name: string): number | null {
  if (!isLocalPlaytestFlag(name)) return null;
  const value = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isFinite(value) ? value : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character] ?? character));
}

interface ReleaseFooterOptions {
  ai?: FooterActionKey;
  confirm?: FooterActionKey;
  back?: FooterActionKey;
  start?: FooterActionKey;
  roster?: FooterActionKey;
  reset?: FooterActionKey;
  metadata?: boolean;
}

function settingsActionIcon(kind: 'rules' | 'controls' | 'lab'): string {
  const paths = {
    rules: '<path d="M4 5h6l2 2 2-2h6v15h-6l-2 2-2-2H4z"/><path d="M12 7v15M7 9h2m-2 4h2m6-4h2m-2 4h2"/>',
    controls: '<path d="M7 7h10c3 0 5 10 3 11-2 1-4-3-5-3H9c-1 0-3 4-5 3C2 17 4 7 7 7Z"/><path d="M7 9v5m-2-2.5h4m7-2h.01m2 3h.01"/>',
    lab: '<path d="M9 3h6m-5 0v7L4 20c-.5 1 .5 2 2 2h12c1.5 0 2.5-1 2-2l-6-10V3M7 16h10"/><path d="M10 18h.01m4 1h.01"/>',
  };
  return `<span class="settings-action-icon settings-action-icon-${kind}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths[kind]}</svg></span>`;
}

function releaseFooterMarkup({ confirm, back, start, roster, reset, ai, metadata = false }: ReleaseFooterOptions): string {
  const showGamepadActions = showGamepadFooterHints();
  const confirmHint = gamepadFooterAction(confirm, 'confirm');
  const backHint = gamepadFooterAction(back, 'back');
  const rosterHint = gamepadFooterAction(roster, 'roster');
  const aiHint = gamepadFooterAction(ai, 'ai');
  const resetHint = reset ? footerResetButtonMarkup() : '';
  return `<footer class="release-footer main-menu-footer release-guidance-footer">
    <div class="release-footer-inner${start ? ' release-footer-start-layout' : ''}">
      ${start ? `${showGamepadActions ? `<div class="release-footer-side release-footer-before-start">${confirmHint}${backHint}</div>` : ''}<button class="primary-button footer-start" id="start-match" type="button">${showGamepadActions ? '<kbd aria-hidden="true">Start</kbd>' : ''}<span>${tr(start)}</span></button>${showGamepadActions ? `<div class="release-footer-side release-footer-after-start">${aiHint}${rosterHint}</div>` : ''}` : `<div class="release-footer-actions">${confirmHint}${backHint}${rosterHint}${resetHint}</div>`}
    </div>
    ${reset ? '<output data-preferences-status role="status"></output>' : ''}
    ${metadata ? releaseMetadataMarkup() : ''}
  </footer>`;
}

export class BricksWarApp {
  private readonly ratings = new RatingPanels();
  private game: Phaser.Game | null = null;
  private matchLoading: MatchLoading | null = null;
  private network: NetworkApp | null = null;
  private lobbyEntered = false;
  private enteringLobbyPad: number | null = null;
  private readonly slots: SlotValue[] = ['human-1', 'off', 'off', 'off'];
  private readonly playerNames = loadPlayerNames();
  private readonly slotTileStyles: TileStyleSelection[] = ['random','random','random','random'];
  private readonly battleSetups = { battle: freshBattleSetup(), 'team-battle': freshBattleSetup(true) };
  private readonly survivalOptions: MatchOptionSelections = { ...freshBattleSetup().options, conflictEnabled: false, matchVariant: 'free-for-all' };
  private get durationMinutes(): number { return this.selectedMode === 'survival' ? DEFAULT_DURATION_MINUTES : this.battleSetups[this.selectedMode].durationMinutes; }
  private set durationMinutes(minutes: number) { if (this.selectedMode !== 'survival') this.battleSetups[this.selectedMode].durationMinutes = minutes; }
  private selectedMode: 'survival' | 'battle' | 'team-battle' = 'battle';
  private get pacing(): MatchOptionSelections { return this.selectedMode === 'survival' ? this.survivalOptions : this.battleSetups[this.selectedMode].options; }
  private tuning = cloneGameTuning();
  private lastHudKey = '';
  private lastActiveYKey = '';
  private lastChromeKey = '';
  private readonly playerEventRegions = new PlayerEventRegionLatch();
  private latestHudState: MatchState | null = null;
  private latestArenaLayout: ArenaLayout | null = null;
  private countdownReady = false;
  private resumePausedMatch: (() => void) | null = null;
  private mobileInputCleanup: (() => void) | null = null;
  private playerNameResizeObserver: ResizeObserver | null = null;
  private playerNameFitFrame: number | null = null;
  private readonly pendingPlayerNameFits = new Set<HTMLInputElement | HTMLTextAreaElement>();
  private readonly releaseSettings = loadReleaseSettings();
  private readonly startupMuted = startsMutedForPlaytest();
  private readonly audio = new GameAudio(this.startupMuted, {
    master: this.releaseSettings.master,
    music: this.releaseSettings.music,
    effects: this.releaseSettings.effects,
    sfxPreset: this.releaseSettings.sfxPreset,
  }, this.startupMuted);
  private readonly router = new ScreenRouter();
  private readonly menuFocus: MenuFocusController;
  private readonly gamepadProfiles = new GamepadProfiles();
  private readonly lobby: UnifiedLobby;
  private readonly lobbyRosters = new LobbyRosterMemory();
  private readonly slotPadTokens = new Map<number, number>();
  private readonly slotProfiles: Array<string | null> = [null, null, null, null];
  private readonly liveGamepads = new Map<number, { device: string; token: number; profile: string | null }>();
  private connectionToken = 0;
  private readonly onGamepadConnectionChange = (event: GamepadEvent): void => {
    if (event.type === 'gamepaddisconnected') {
      this.forgetLiveGamepad(event.gamepad.index);
      this.menuFocus.disconnectGamepad(event.gamepad.index);
    }
    this.syncLiveGamepads(Array.from(navigator.getGamepads?.() ?? []));
    if (!this.game) this.renderCurrentScreen();
  };
  private readonly onFullscreenChange = (): void => {
    const label = document.fullscreenElement ? tr('on') : tr('off');
    const settingsState = this.root.querySelector<HTMLElement>('#toggle-fullscreen b');
    const pauseState = this.root.querySelector<HTMLElement>('#pause-toggle-fullscreen b');
    if (settingsState) settingsState.textContent = label;
    if (pauseState) pauseState.textContent = label;
  };

  constructor(private readonly root: HTMLElement) {
    this.gamepadProfiles.importSlotNames(this.playerNames);
    this.lobby = new UnifiedLobby(root, {
      mode: () => this.selectedMode, slots: this.slots, names: this.playerNames, styles: this.slotTileStyles,
      profiles: this.gamepadProfiles, ratings: this.ratings, pads: () => this.liveGamepads, connected: slot => !isGamepadSlot(this.slots[slot]!) || !!this.gamepadFor(this.slots[slot] as GamepadController),
      changeMode: mode => this.navigate(mode, 'main-menu'),
      commit: (slot, draft) => this.commitLobbyCard(slot, draft),
      remove: slot => this.setSlot(slot, 'off'),
      start: () => this.startMatch(), back: () => this.navigateBack(), validate: () => { this.showValidation(); },
      settings: () => this.modeSettingsMarkup(), rules: () => this.selectedMode === 'survival'
        ? `<ul>${(['ruleNoAttacks','rulePressure','ruleAnomalies','ruleShields','ruleIndependent'] as const).map(k => `<li>${tr(k)}</li>`).join('')}</ul>`
        : this.modeRulesMarkup(this.selectedMode), bindSettings: () => {
        this.bindModeSettings();
      },
    });
    this.audio.setDirections(this.releaseSettings.musicDirection, this.releaseSettings.sfxDirection);
    this.menuFocus = new MenuFocusController(root, {
      onBack: () => this.navigateBack(),
      onInputMode: (mode) => { this.root.dataset.inputMode = mode; this.refreshPadHints(); },
      onSelectionChange: (selected) => this.updateMainMenuShowcase(selected),
      onGamepadConfirm: (gamepadIndex, selected) => this.handleGamepadConfirm(gamepadIndex, selected),
      onGamepadsSnapshot: (pads) => { this.syncLiveGamepads(pads); this.lobby.poll(pads); },
      onGamepadStart: () => this.startSetupFromGamepad(),
      acceptsGamepad: () => !this.lobby.active(),
    });
  }

  private readonly updateDesktopLayout = (): void => {
    this.root.dataset.layout = isMobilePlayViewport() ? 'mobile' : 'desktop';
    configureDesktopStage(this.root);
    this.lobby?.resize();
    // Viewport-sized overlays must stay outside the scaled desktop composition.
    const modalBackdrop = this.root.querySelector('[data-ai-choice], [data-release-history]')?.parentElement;
    if (modalBackdrop) this.root.append(modalBackdrop);
    configureDesktopLabPages(this.root, () => this.menuFocus.activate(this.router.current()));
  };

  start(): void {
    this.ratings.start();
    this.updateDesktopLayout();
    window.addEventListener('resize', () => {
      this.updateDesktopLayout();
      this.updateClientUpdateButton();
      const playHint = this.root.querySelector<HTMLElement>('.main-menu-screen [data-play-entry] .mode-copy small');
      if (playHint) playHint.textContent = localeText('playHint');
    });
    this.tuning = loadGameTuning() ?? cloneGameTuning(DEFAULT_GAME_TUNING);
    window.addEventListener('gamepadconnected', this.onGamepadConnectionChange);
    window.addEventListener('gamepaddisconnected', this.onGamepadConnectionChange);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.body.classList.toggle('calm-effects', this.releaseSettings.calmEffects);
    clientUpdate.setMenuGuard(() => this.router.current() === 'main-menu' && !this.game && !this.network);
    clientUpdate.subscribe(() => this.updateClientUpdateButton());
    this.renderMainMenu();
  }

  private desktopDisplay: DisplayPreferences = { width: 1280, height: 720, fullscreen: false };
  private downloadUrl = '';

  private updateClientUpdateButton(): void {
    const button = this.root.querySelector<HTMLButtonElement>('.client-update-button');
    const status = this.root.querySelector<HTMLElement>('.client-update-status');
    const announcement = this.root.querySelector<HTMLElement>('.client-update-announcement');
    if (!button) return;
    const state = clientUpdate.snapshot();
    if (desktop && state.currentVersion) { const info = this.root.querySelector('.release-build-info'); if (info) info.textContent = localeText('buildIdentity', {game:state.currentVersion}); }
    const presentation = updatePresentation(state);
    if (desktop) {
      const native = nativeUpdatePresentation(state);
      const history = this.root.querySelector<HTMLButtonElement>('.desktop-release-history');
      if (history) {
        history.hidden = !native.visible;
        history.querySelector('strong')!.textContent = native.heading;
      }
      button.hidden = !native.visible;
      button.disabled = native.disabled;
      button.querySelector('strong')!.textContent = native.label;
      const hint = button.querySelector('small')!;
      hint.textContent = native.hint; hint.hidden = !native.hint;
      button.setAttribute('aria-label', [native.label, native.hint].filter(Boolean).join('. '));
      this.menuFocus.reconcileItems();
      return;
    }
    button.hidden = !presentation.visible;
    const download = this.root.querySelector<HTMLButtonElement>('.desktop-download');
    if (download) { download.hidden = state.available || !this.downloadUrl || isMobilePlayViewport(); }
    if (announcement) { announcement.hidden = !state.available; announcement.textContent = presentation.announcement; }
    button.disabled = presentation.disabled;
    button.textContent = presentation.label;
    if (status) { status.textContent = presentation.status;
      status.hidden = !presentation.visible || !status.textContent; }
    this.menuFocus.reconcileItems();
  }

  private rulesCleanup: (() => void) | null = null;

  private renderCurrentScreen(): void {
    this.rulesCleanup?.();
    this.rulesCleanup = null;
    const screen = this.router.current();
    if (!['survival', 'battle', 'team-battle'].includes(screen)) this.disconnectPlayerNameResizeObserver();
    if (screen === 'network') return;
    if (screen === 'main-menu') this.renderMainMenu();
    else if (screen === 'laboratory') this.renderDebugTuning();
    else if (screen === 'survival' || screen === 'battle' || screen === 'team-battle') this.renderSetup();
    else if (screen === 'settings') this.renderSettings();
    else if (screen === 'controls') this.renderControls();
    else if (screen === 'rules') this.renderRules();
  }

  private readonly menuScroll = new Map<string, number[]>();
  private refreshPadHints(): void {
    if (this.lobby.active()) return;
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected && p.index === this.menuFocus.activeGamepadIndex());
    const family = gamepadFaceLabels(pad?.id ?? 'Xbox');
    for (const [selector,index] of [['.input-confirm',0],['.input-back',1],['.input-ai',2],['.input-roster',3]] as const) this.root.querySelectorAll(selector).forEach(item => { item.textContent = family[index]!; });
  }

  private rememberFocus(): void {
    this.menuScroll.set(this.router.current(), Array.from(this.root.querySelectorAll<HTMLElement>('.settings-list, .release-panel, .profile-choice-actions, .controls-reference')).map(el => el.scrollTop));
    this.router.rememberSelection(this.router.current(), this.menuFocus.selectedIndex());
  }

  private activateMenuFocus(screen: AppScreen): void {
    this.updateDesktopLayout();
    if (!this.lobby.active()) enhanceMenuSelects(this.root);
    this.root.querySelectorAll<HTMLElement>('button:not(.menu-select-option), input, textarea, select:not([hidden])').forEach((element) => {
      if (!element.closest('.menu-select-pages') && !element.hasAttribute('data-ui-focus')) element.setAttribute('data-ui-focus', '');
    });
    this.root.querySelectorAll<HTMLElement>('.settings-list, .release-panel, .profile-choice-actions, .controls-reference').forEach((el,index) => { el.scrollTop = this.menuScroll.get(screen)?.[index] ?? 0; });
    this.refreshPadHints();
    this.menuFocus.activate(screen, this.router.selectionFor(screen, this.root.querySelectorAll('[data-ui-focus]:not([disabled])').length));
  }

  private navigate(screen: AppScreen, parent?: AppScreen): void {
    this.rememberFocus();
    if (screen === 'survival' || screen === 'battle' || screen === 'team-battle') {
      if (!this.lobbyEntered) {
        this.slots[0] = this.enteringLobbyPad !== null ? `gamepad-${this.enteringLobbyPad}` : isMobilePlayViewport() ? 'human-1' : 'human-2';
        if (this.enteringLobbyPad !== null) { const live = this.liveGamepads.get(this.enteringLobbyPad); if (live) this.slotPadTokens.set(this.enteringLobbyPad,live.token); }
        this.lobbyEntered = true; this.enteringLobbyPad = null;
      }
      this.lobbyRosters.switch(this.selectedMode, screen, this.slots, this.playerNames, this.slotTileStyles);
      this.selectedMode = screen;
    }
    this.router.open(screen, parent);
    clientUpdate.refresh();
    this.renderCurrentScreen();
  }

  private navigateBack(): void {
    if (this.lobby.active()) { if (this.lobby.back()) return; this.lobby.leave(); }
    const historyClose = this.root.querySelector<HTMLButtonElement>('[data-history-back]'); if (historyClose) { historyClose.click(); return; }
    const displayCancel = this.root.querySelector<HTMLButtonElement>('[data-display-no]');
    if (displayCancel) { displayCancel.click(); return; }
    if (this.matchLoading) {
      this.destroyGame();
      this.router.back();
      this.renderCurrentScreen();
      return;
    }
    if (this.game) {
      if (this.router.current() === 'settings') {
        this.audio.playUiFeedback('back');
        this.showPauseSettings(false);
        return;
      }
      if (this.router.current() === 'pause') {
        this.audio.playUiFeedback('back');
        this.resumePausedMatch?.();
        return;
      }
      if (this.router.current() === 'results') {
        if (!this.menuFocus.resultsInputReady()) return;
        this.audio.playUiFeedback('back');
        this.destroyGame();
        this.router.open('main-menu');
        this.renderMainMenu();
      }
      return;
    }
    this.rememberFocus();
    if (this.router.back()) {
      this.audio.playUiFeedback('back');
      this.renderCurrentScreen();
    }
  }

  private renderMainMenu(): void {
    this.network?.destroy(); this.network = null;
    void clientUpdate.setActivity(true);
    this.disconnectPlayerNameResizeObserver();
    this.destroyGame();
    this.countdownReady = false;
    this.audio.enterMenu();
    const mobile = isMobilePlayViewport();
    const installHint = shouldShowIosInstallHint() || isLocalPlaytestFlag('pwa-install-hint')
      ? `<aside class="pwa-install-hint" role="status"><span aria-hidden="true">⇧</span><p>${tr('pwaInstallBeforeShare')}<b>${tr('pwaShareAction')}</b>${tr('pwaInstallBetweenActions')}<b>${tr('pwaAddToHomeScreen')}</b>${tr('pwaInstallAfterActions')}</p><button type="button" data-dismiss-pwa-hint aria-label="${tr('pwaInstallDismissAria')}">×</button></aside>`
      : '';
    this.root.innerHTML = `
      <main class="release-screen premium-surface main-menu-screen workshop-menu" data-screen="main-menu">
        <div class="menu-block menu-block-one" aria-hidden="true"></div>
        <div class="menu-block menu-block-two" aria-hidden="true"></div>
        <div class="menu-block menu-block-three" aria-hidden="true"></div>
        <section class="main-menu-layout">
          <div class="main-menu-primary">
            <header class="release-brand main-menu-brand">
              <div class="main-menu-brand-row"><h1 class="concept-brand-heading"><img class="concept-brand-logo" src="${conceptLogoUrl}" alt="BRICKS WAR" /></h1><div class="client-update-slot">${desktop ? `<button class="desktop-release-history" type="button" hidden><strong></strong><small>${tr('viewChanges')}</small></button><button class="client-update-button" type="button" hidden><strong></strong><small hidden></small></button>` : `<p class="client-update-announcement" hidden>${tr('updateAnnouncement')}</p><button class="client-update-button" type="button" hidden>${tr('updateAction')}</button><p class="client-update-status" role="status" hidden></p>`}<button type="button" class="desktop-download" data-ui-focus hidden aria-label="${tr('downloadGameAria')}" title="${tr('downloadGame')}"><span aria-hidden="true">⇩</span><span>${tr('downloadGame')}</span></button></div></div>
              ${installHint}
            </header>
            <nav class="mode-menu" aria-label="${tr('menu')}">
              <button class="mode-choice mode-play" type="button" data-play-entry data-destination="${this.selectedMode}">
                <span class="mode-icon" aria-hidden="true">${menuGlyph('play')}</span>
                <span class="mode-copy"><strong>${tr('play')}</strong><small>${tr('playHint')}</small></span>
                <span class="mode-forward" aria-hidden="true">›</span>
              </button>
              <button class="mode-choice mode-network" type="button" data-network-entry><span class="mode-icon" aria-hidden="true">${menuGlyph('network')}</span><span class="mode-copy"><strong>${tr('network')}</strong><small>${tr('networkHint')}</small></span><span class="mode-forward" aria-hidden="true">›</span></button>
              <button class="mode-choice mode-settings" type="button" data-destination="settings">
                <span class="mode-icon" aria-hidden="true">${menuGlyph('settings')}</span>
                <span class="mode-copy"><strong>${tr('settings')}</strong><small>${tr('settingsHint')}</small></span>
                <span class="mode-forward" aria-hidden="true">›</span>
              </button>
              ${desktop ? `<button class="mode-choice mode-exit" id="desktop-exit" type="button"><span class="mode-icon" aria-hidden="true">${menuGlyph('exit')}</span><span class="mode-copy"><strong>${tr('exit')}</strong><small>${tr('exitHint')}</small></span><span class="mode-forward" aria-hidden="true">›</span></button>` : ''}
            </nav>
          </div>
          <aside id="menu-showcase" class="menu-showcase showcase-play" data-preview="play" aria-label="${MAIN_MENU_PREVIEWS.play.label}">
            <div id="showcase-content" class="showcase-content" aria-hidden="true">${mainMenuPreviewMarkup('play')}</div>
          </aside>
        </section>
        ${releaseFooterMarkup({ confirm: mobile ? 'open' : 'select', metadata: true })}
      </main>
    `;
    this.root.querySelectorAll<HTMLButtonElement>('[data-destination]').forEach((button) => {
      button.addEventListener('click', () => {
        this.audio.playUiSelect();
        this.navigate(button.dataset.destination as AppScreen);
      });
    });
    this.root.querySelector<HTMLButtonElement>('[data-dismiss-pwa-hint]')?.addEventListener('click', () => {
      dismissIosInstallHint();
      this.root.querySelector('.pwa-install-hint')?.remove();
    });
    this.root.querySelector('[data-network-entry]')?.addEventListener('click', () => {
      this.menuFocus.suspend(); this.router.open('network'); this.destroyGame();
      desktop?.setSafeMenu(false);
      this.network = new NetworkApp(this.root, () => {this.router.open('main-menu'); this.renderMainMenu();}, this.audio, onClose => this.openNetworkPreferences(onClose));
    });
    this.root.querySelector('.client-update-button')?.addEventListener('click', () => {
      if (desktop && nativeUpdatePresentation(clientUpdate.snapshot()).cancel) clientUpdate.cancelDownload();
      else if (clientUpdate.snapshot().available) clientUpdate.apply();
      else if (!desktop) void clientUpdate.check(true);
    });
    this.root.querySelector('.desktop-release-history')?.addEventListener('click', event => { void this.showReleaseHistory(event.currentTarget as HTMLButtonElement); });
    this.root.querySelector('#desktop-exit')?.addEventListener('click', () => { clientUpdate.refresh(); void desktop?.exit(); });
    this.root.querySelector('.desktop-download')?.addEventListener('click', () => {
      if (!this.downloadUrl) return;
      const download = document.createElement('a');
      download.href = this.downloadUrl;
      download.download = '';
      download.click();
    });
    void installerDownload().then(file => { this.downloadUrl = file?.url ?? ''; this.updateClientUpdateButton(); });
    if (desktop) void desktop.display().then(value => { this.desktopDisplay = value; });
    this.updateClientUpdateButton();
    this.bindMenuAudioUnlock();
    this.activateMenuFocus('main-menu');
  }

  private updateMainMenuShowcase(selected: HTMLElement | null): void {
    if (this.router.current() !== 'main-menu') return;
    const destination = (selected?.id === 'desktop-exit' ? 'exit' : selected?.hasAttribute('data-network-entry') ? 'network' : selected?.hasAttribute('data-play-entry') ? 'play' : selected?.dataset.destination) as MainMenuDestination | undefined;
    if (!destination || !(destination in MAIN_MENU_PREVIEWS)) return;
    const showcase = this.root.querySelector<HTMLElement>('#menu-showcase');
    const content = this.root.querySelector<HTMLElement>('#showcase-content');
    if (!showcase || !content || showcase.dataset.preview === destination) return;
    showcase.dataset.preview = destination;
    showcase.classList.remove('showcase-play', 'showcase-survival', 'showcase-battle', 'showcase-team-battle', 'showcase-network', 'showcase-settings', 'showcase-exit');
    showcase.classList.add(`showcase-${destination}`);
    showcase.setAttribute('aria-label', MAIN_MENU_PREVIEWS[destination].label);
    content.innerHTML = mainMenuPreviewMarkup(destination);
    content.classList.remove('showcase-refresh');
    void content.offsetWidth;
    content.classList.add('showcase-refresh');
  }

  private renderSettings(): void {
    this.destroyGame();
    this.audio.enterMenu();
    const mobile = isMobilePlayViewport();
    this.root.innerHTML = `
      <main class="release-screen premium-surface settings-screen workshop-menu" data-screen="settings">
        <header class="release-heading"><button class="screen-back" id="settings-back" type="button">← ${tr('back')}</button><img class="settings-brand" src="${conceptLogoUrl}" alt="Bricks War" /><div><h1>${tr('settings')}</h1></div></header>
        <section class="settings-list" aria-label="${tr('settingsAria')}"><div class="settings-columns settings-left-column">
          <section class="release-panel settings-section settings-audio-section"><header><span class="settings-icon" aria-hidden="true">♪</span><div><p class="eyebrow">${tr('sound')}</p><h2>${tr('soundTitle')}</h2></div></header>${this.setupAudioMarkup()}</section>
          ${isLocalPlaytestFlag('audio-prototypes') ? this.audioPrototypeGalleryMarkup() : ''}
          ${this.stickPreferencesMarkup(true)}</div><div class="settings-columns settings-right-column"><section class="release-panel settings-section settings-display-section"><header><span class="settings-icon settings-icon-screen" aria-hidden="true">▣</span><div><p class="eyebrow">${tr('screen')}</p><h2>${tr('display')}</h2></div></header>
            ${desktop ? `<label class="settings-action"><span><strong>${tr('resolution')}</strong><small>${tr('resolutionHint')}</small></span><select id="desktop-resolution" data-menu-select-layout="dropdown"><option value="auto" ${this.desktopDisplay.auto ? 'selected' : ''}>${tr('resolutionAuto')}</option>${(this.desktopDisplay.resolutions ?? [[960,540],[1280,720],[1440,900],[1600,900],[1920,1080],[2560,1440],[3840,2160]]).map(([w,h]) => `<option value="${w}x${h}" ${!this.desktopDisplay.auto && w === this.desktopDisplay.width && h === this.desktopDisplay.height ? 'selected' : ''}>${w} × ${h}</option>`).join('')}</select></label><label class="settings-action"><span><strong>${tr('windowMode')}</strong><small>${tr('windowHint')}</small></span><select id="desktop-window-mode"><option value="windowed" ${!this.desktopDisplay.fullscreen ? 'selected' : ''}>${tr('windowed')}</option><option value="fullscreen" ${this.desktopDisplay.fullscreen ? 'selected' : ''}>${tr('fullscreen')}</option></select></label><output id="desktop-display-status" class="settings-status" role="status"></output>` : ''}
            ${mobile || desktop ? '' : `<button class="settings-action" id="toggle-fullscreen" type="button"><span><strong>${tr('fullscreen')}</strong></span><b>${document.fullscreenElement ? tr('on') : tr('off')}</b></button><output id="fullscreen-status" class="settings-status" role="status"></output>`}
            <label class="settings-action"><span><strong>${tr('calm')}</strong><small>${tr('calmHint')}</small></span><input id="calm-effects" type="checkbox" ${this.releaseSettings.calmEffects ? 'checked' : ''} /></label>
            ${this.displayPreferencesMarkup()}
          </section>
          ${languageSettingsMarkup()}</div>
        </section>
        <div class="settings-utility"><nav class="settings-links" aria-label="${tr('helpAria')}">
          <button class="release-panel settings-action settings-navigation" id="open-rules" type="button">${settingsActionIcon('rules')}<span><strong>${tr('rules')}</strong><small>${tr('rulesHint')}</small></span><b>›</b></button>

          <button class="release-panel settings-action settings-navigation" id="open-release-history" type="button"><span><strong>${tr('releaseHistory')}</strong></span></button>
          ${footerResetButtonMarkup('footer-reset settings-action settings-navigation')}
          <button class="release-panel settings-action settings-navigation" id="open-settings-lab" type="button">${settingsActionIcon('lab')}<span><strong>${tr('lab')}</strong><small>${tr('labHint')}</small></span><b>›</b></button>

          </nav>
          <output data-preferences-status role="status"></output>
        </div>
        ${releaseFooterMarkup({ confirm: 'select', back: 'back' })}
      </main>
    `;
    this.root.querySelector('#settings-back')?.addEventListener('click', () => this.navigateBack());
    this.root.querySelector('#open-rules')?.addEventListener('click', () => this.navigate('rules'));
    this.root.querySelector('#open-controls')?.addEventListener('click', () => this.navigate('controls'));
    this.root.querySelector('#open-settings-lab')?.addEventListener('click', () => this.navigate('laboratory'));
    this.root.querySelector('#open-release-history')?.addEventListener('click', event => { void this.showReleaseHistory(event.currentTarget as HTMLButtonElement); });
    this.bindAudioPrototypeGallery();
    const applyDesktopDisplay = () => {
      if (!desktop) return;
      const resolution = this.root.querySelector<HTMLSelectElement>('#desktop-resolution')?.value ?? '1280x720';
      const [width = 1280, height = 720] = resolution.split('x').map(Number);
      const fullscreen = this.root.querySelector<HTMLSelectElement>('#desktop-window-mode')?.value === 'fullscreen';
      void this.previewDisplay({ width, height, fullscreen, auto: resolution === 'auto' })
        .catch(() => { const status = this.root.querySelector('#desktop-display-status'); if (status) status.textContent = localeText('displayFailed'); });
    };
    this.root.querySelector('#desktop-resolution')?.addEventListener('change', applyDesktopDisplay);
    this.root.querySelector('#desktop-window-mode')?.addEventListener('change', applyDesktopDisplay);
    this.root.querySelector('#toggle-fullscreen')?.addEventListener('click', () => {
      const operation = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      void operation.then(() => this.renderSettings()).catch(() => {
        const status = this.root.querySelector<HTMLOutputElement>('#fullscreen-status');
        if (status) status.textContent = localeText('fullscreenFailed');
      });
    });
    this.root.querySelector<HTMLInputElement>('#calm-effects')?.addEventListener('change', (event) => {
      this.releaseSettings.calmEffects = (event.currentTarget as HTMLInputElement).checked;
      document.body.classList.toggle('calm-effects', this.releaseSettings.calmEffects);
      this.persistPreferences();
    });
    this.bindMenuAudioUnlock();
    this.bindAudioToggle();
    this.bindVolumeControl();
    this.bindPreferenceExtras();
    this.bindLanguageSelector();
    this.activateMenuFocus('settings');
  }

  private renderRules(): void {
    this.destroyGame();
    this.audio.enterMenu();
    this.root.innerHTML = rulesScreenMarkup();
    this.rulesCleanup = bindRulesScreen(this.root.querySelector<HTMLElement>('[data-screen="rules"]')!, () => this.navigateBack());
    this.activateMenuFocus('rules');
  }

  private renderControls(): void {
    this.destroyGame();
    if (isMobilePlayViewport()) {
      this.audio.enterMenu();
      this.root.innerHTML = `
        <main class="release-screen premium-surface phone-controls-screen" data-screen="controls" data-phone-controls-help>
          <header class="release-heading phone-controls-heading">
            <button class="screen-back" id="controls-back" type="button">← ${tr('back')}</button>
            <div><p class="eyebrow">${tr('phoneControlsEyebrow')}</p><h1>${tr('phoneControlsTitle')}</h1></div>
          </header>
          <p class="phone-controls-intro">${tr('phoneControlsIntro')}</p>
          <div class="phone-controls-content">
            <figure class="phone-controls-figure">
              <div class="phone-controls-diagram" role="img" aria-label="${tr('phoneControlsDiagram')}" data-bottom-zone-fraction="${MOBILE_TOUCH_BUTTON_ZONE_FRACTION}">
                <div class="phone-controls-rotate-area"><span aria-hidden="true">↻</span><strong>${tr('phoneControlsRotate')}</strong><small>${tr('phoneControlsRotateArea')}</small></div>
                <div class="phone-controls-directions" aria-hidden="true">
                  <div class="phone-controls-direction"><b>←</b><span>${tr('phoneControlsLeft')}</span></div>
                  <div class="phone-controls-direction"><b>↓</b><span>${tr('phoneControlsDown')}</span></div>
                  <div class="phone-controls-direction"><b>→</b><span>${tr('phoneControlsRight')}</span></div>
                </div>
              </div>
              <figcaption class="phone-controls-hold-hint">${tr('phoneControlsHold')}</figcaption>
            </figure>
            <aside class="phone-controls-pause"><span aria-hidden="true">Ⅱ</span><div><h2>${tr('phoneControlsPauseTitle')}</h2><p>${tr('phoneControlsPauseHint')}</p></div></aside>
          </div>
          ${releaseFooterMarkup({})}
        </main>
      `;
      this.root.querySelector('#controls-back')?.addEventListener('click', () => this.navigateBack());
      this.activateMenuFocus('controls');
      return;
    }
    const keyboardReferenceCard = (title: string, layout: 'wasd' | 'arrows', keys: readonly string[]) => {
      const mappings = [
        { key: keys[0]!, action: 'rotate', label: localeText('controlsRotate'), x: 280, y: 106, d: 'M280 106 L280 68', labelX: 280, labelY: 49 },
        { key: keys[1]!, action: 'left', label: localeText('controlsLeft'), x: 195, y: 190, d: 'M195 190 L145 190', labelX: 88, labelY: 197 },
        { key: keys[3]!, action: 'right', label: localeText('controlsRight'), x: 365, y: 190, d: 'M365 190 L415 190', labelX: 474, labelY: 197 },
        { key: keys[2]!, action: 'drop', label: localeText('controlsDrop'), x: 280, y: 216, d: 'M280 216 L280 244', labelX: 280, labelY: 266 },
      ] as const;
      const marker = (action: string, color: string) => `<marker id="keyboard-${layout}-${action}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="${color}" /></marker>`;
      const color = { rotate: '#8b57c7', left: '#39a7f4', right: '#39a7f4', drop: '#ff8b45' } as const;
      const accessibleActions = mappings.map(({ key, action, label }) => `<li class="action-${action}" data-help-action="${action}"><kbd>${key}</kbd> — ${escapeHtml(label)}</li>`).join('');
      const keycaps = keys.map((key) => `<kbd data-key="${key}" aria-label="${key}">${key}</kbd>`).join('');
      const connectors = mappings.map(({ key, action, x, y, d }) => `<circle class="keyboard-help-anchor action-${action}" data-key="${key}" cx="${x}" cy="${y}" r="4" /><path class="keyboard-help-line action-${action}" data-key="${key}" data-action="${action}" d="${d}" marker-end="url(#keyboard-${layout}-${action})" />`).join('');
      const labels = mappings.map(({ action, label, labelX, labelY }) => `<text class="keyboard-help-label action-${action}" data-action-label="${action}" x="${labelX}" y="${labelY}">${escapeHtml(label)}</text>`).join('');
      return `
        <article class="release-panel keyboard-reference-card" data-keyboard-card="${layout}">
          <h2 id="keyboard-${layout}-title">${title}</h2>
          <div class="keyboard-help-diagram" data-keyboard-diagram="${layout}" role="group" aria-labelledby="keyboard-${layout}-title">
            <div class="keyboard-help-stage">
              <svg class="keyboard-help-connections" viewBox="0 0 560 282" aria-hidden="true" focusable="false">
                <defs>${marker('rotate', color.rotate)}${marker('left', color.left)}${marker('right', color.right)}${marker('drop', color.drop)}</defs>
                ${connectors}${labels}
              </svg>
              <div class="keyboard-cluster keyboard-help-keys ${layout}" data-keyboard-keys role="group" aria-label="${tr('controlsKeysAria', { keys: keys.join(', ') })}">${keycaps}</div>
            </div>
            <ul class="key-actions keyboard-help-accessibility" aria-label="${tr('controlsActionsAria', { title })}">${accessibleActions}</ul>
          </div>
        </article>`;
    };
    this.root.innerHTML = `
      <main class="release-screen premium-surface controls-screen" data-screen="controls">
        <header class="release-heading"><button class="screen-back" id="controls-back" type="button">← ${tr('settings')}</button><div><p class="eyebrow">${tr('controlsFixedScheme')}</p><h1>${tr('controls')}</h1></div></header>
        <div class="controls-reference">
          <section class="gamepad-reference" aria-label="${tr('controlsGamepadDiagram')}">
            ${gamepadControlsArtworkMarkup()}
            <p class="controls-family-note">${tr('controlsFamilyNote')}</p>
          </section>
          <section class="keyboard-reference">
            ${keyboardReferenceCard(localeText('controlsKeyboard', { index: 1 }), 'wasd', ['W', 'A', 'S', 'D'])}
            ${keyboardReferenceCard(localeText('controlsKeyboard', { index: 2 }), 'arrows', ['↑', '←', '↓', '→'])}
          </section>
        </div>
        ${releaseFooterMarkup({ back: 'back' })}
      </main>
    `;
    this.root.querySelector('#controls-back')?.addEventListener('click', () => this.navigateBack());
    this.activateMenuFocus('controls');
  }

  private renderSetup(): void {
    this.disconnectPlayerNameResizeObserver();
    this.destroyGame();
    this.countdownReady = false;
    this.audio.enterMenu();
    this.lobby.render();
    this.bindMenuAudioUnlock();
    this.activateMenuFocus(this.router.current());
  }

  private commitLobbyCard(slot: number, draft: CardDraft): void {
    this.slots[slot] = draft.controller;
    this.slotTileStyles[slot] = draft.style;
    if (isManualSlot(draft.controller)) {
      this.playerNames[slot] = normalizePlayerName(draft.name, slot);
      this.gamepadProfiles.useName(this.playerNames[slot]!);
      if (isGamepadSlot(draft.controller)) {
        const live = this.liveGamepads.get(Number(draft.controller.slice(8)));
        if (live) {
          if (isGenericPlayerName(this.playerNames[slot]!)) { this.slotPadTokens.set(Number(draft.controller.slice(8)), live.token); live.profile = null; this.slotProfiles[slot] = null; }
          else {
          const profile = this.gamepadProfiles.profiles.find(item => item.id === live.profile) ?? this.gamepadProfiles.create(live.device, this.playerNames[slot]!);
          this.gamepadProfiles.rename(profile.id, this.playerNames[slot]!);
          this.slotPadTokens.set(Number(draft.controller.slice(8)), live.token);
          live.profile = profile.id;
          this.slotProfiles[slot] = profile.id;
          }
        }
      }
      savePlayerNames(this.playerNames);
    }
    this.audio.playUiSelect();
    this.renderSetup();
  }

  private disconnectPlayerNameResizeObserver(): void {
    this.playerNameResizeObserver?.disconnect();
    this.playerNameResizeObserver = null;
    if (this.playerNameFitFrame !== null) cancelAnimationFrame(this.playerNameFitFrame);
    this.playerNameFitFrame = null;
    this.pendingPlayerNameFits.clear();
  }

  private startSetupFromGamepad(): void {
    if (this.root.querySelector('[role="dialog"], [data-virtual-keyboard], [aria-expanded="true"]')) return;
    const screen = this.router.current();
    if (screen !== 'survival' && screen !== 'battle' && screen !== 'team-battle') return;
    const button = this.root.querySelector<HTMLButtonElement>('#start-match');
    if (!button || button.disabled) return;
    button.click();
  }

  private modeSettingsMarkup(): string {
    const teams = this.selectedMode === 'team-battle';
    const attackMode = this.pacing.conflictEnabled ? this.pacing.conflictTargeting : 'off';
    const duration = this.pacing.battleTimeMode === 'until-victory' ? 'until-victory' : String(this.durationMinutes);
    // Reserve every localized value in one overlapping, hidden grid cell so
    // changing a setting cannot resize its button or shift neighbouring labels.
    const control = (id: string, label: string, value: string, text: string, choices: readonly string[]) => `<label><small>${escapeHtml(label)}</small><button type="button" class="lobby-cycle" id="${id}" data-value="${value}" aria-label="${escapeHtml(label)}: ${escapeHtml(text)}"><span class="lobby-cycle-size" aria-hidden="true">${[...new Set(choices)].map(choice => `<span><span>${escapeHtml(choice)}</span><b>›</b></span>`).join('')}</span><span class="lobby-cycle-current"><span>${escapeHtml(text)}</span><b aria-hidden="true">›</b></span></button></label>`;
    const durationLabels = [tr('untilVictory'), ...Array.from({length:9}, (_, i) => tr('durationMinutes', {count:i+2}))];
    const attackLabels = [tr('attacksOff'), tr('attacksLeader'), tr('attacksAll'), tr('attacksOtherTeam')];
    const difficultyLabels = (['family','normal','sport'] as const).map(value => localizedBattleDifficultyCopy(value).label);
    return `<section class="mode-settings" aria-label="${tr('modeSettingsAria')}">
      ${control('match-duration', tr('durationLabel'), duration, duration === 'until-victory' ? tr('untilVictory') : tr('durationMinutes', {count: this.durationMinutes}), durationLabels)}
      ${control('attack-mode', tr('attacksLabel'), attackMode, attackMode === 'off' ? tr('attacksOff') : attackMode === 'hunt-leader' ? tr('attacksLeader') : teams ? tr('attacksOtherTeam') : tr('attacksAll'), attackLabels)}
      ${control('battle-difficulty', tr('difficultyLabel'), this.pacing.battleDifficulty, localizedBattleDifficultyCopy(this.pacing.battleDifficulty).label, difficultyLabels)}
    </section>`;
  }

  private modeRulesMarkup(mode: 'battle' | 'team-battle'): string {
    const victoryRule = this.pacing.battleTimeMode === 'until-victory'
      ? (mode === 'team-battle' ? localeText('ruleTeamLast') : localeText('ruleSoloLast'))
      : (mode === 'team-battle' ? localeText('ruleTeamScore') : localeText('ruleTimedScore'));
    const rules = mode === 'team-battle'
      ? [{ icon: '2×2', text: localeText('teamHint') }, { icon: '⇄', text: localeText('ruleAttackTeam') }, { icon: '⬡', text: localeText('ruleShields') }, { icon: '✦', text: localeText('ruleAnomalies') }, { icon: '♛', text: victoryRule }]
      : [{ icon: '◉', text: localeText('ruleEachForSelf') }, { icon: '⇄', text: localeText('ruleAttackOpponents') }, { icon: '⬡', text: localeText('ruleShields') }, { icon: '✦', text: localeText('ruleAnomalies') }, { icon: '♛', text: victoryRule }];
    return `<section class="release-panel mode-rules mode-rules-${mode}"><p class="eyebrow">${tr('howToPlayMark')}</p><h2>${tr('modeRulesTitle')}</h2><ul>${rules.map(({ icon, text }) => `<li><b>${icon}</b><span>${escapeHtml(text)}</span></li>`).join('')}</ul><div class="mode-rules-board" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div></section>`;
  }

  private bindModeSettings(): void {
    this.root.querySelector('#match-duration')?.addEventListener('click', () => {
      const next = this.pacing.battleTimeMode === 'until-victory' ? 2 : this.durationMinutes + 1;
      this.pacing.battleTimeMode = next > 10 ? 'until-victory' : 'timed';
      if (next <= 10) this.durationMinutes = next;
      this.renderSetup();
    });
    this.root.querySelector('#attack-mode')?.addEventListener('click', () => {
      const values = this.selectedMode === 'team-battle' ? ['off', 'all-opponents'] : ['off', 'hunt-leader', 'all-opponents'];
      const current = this.pacing.conflictEnabled ? this.pacing.conflictTargeting : 'off';
      const value = values[(values.indexOf(current) + 1) % values.length];
      this.pacing.conflictEnabled = value !== 'off';
      this.pacing.conflictTargeting = value === 'hunt-leader' ? 'hunt-leader' : 'all-opponents';
      this.renderSetup();
    });
    this.root.querySelector('#battle-difficulty')?.addEventListener('click', () => {
      const values = ['family', 'normal', 'sport'] as const;
      this.pacing.battleDifficulty = values[(values.indexOf(this.pacing.battleDifficulty) + 1) % values.length]!;
      this.renderSetup();
    });
  }

  private setSlot(index: number, value: SlotValue): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.slots.length) return;
    if (isManualSlot(value) && this.slots.some((slot, other) => other !== index && slot === value)) return;
    if (isGamepadSlot(value)) {
      const live = this.liveGamepads.get(Number(value.slice(8)));
      if (!live) return;
      const profile = live.profile ? this.gamepadProfiles.profiles.find((item) => item.id === live.profile) : null;
      const selected = profile ?? this.gamepadProfiles.create(live.device, this.playerNameForSlot(index));
      live.profile = selected.id;
      this.slotProfiles[index] = selected.id;
      this.gamepadProfiles.rename(selected.id, this.playerNameForSlot(index));
    } else this.slotProfiles[index] = null;
    this.slots[index] = value;

    this.audio.playUiSelect();
    this.renderSetup();
  }

  private handleGamepadConfirm(gamepadIndex: number, selected: HTMLElement | null): boolean {
    if (this.router.current() === 'main-menu' && selected?.matches('[data-destination="survival"], [data-destination="battle"], [data-destination="team-battle"]')) {
      this.enteringLobbyPad = gamepadIndex;
      selected.click();
      return true;
    }
    return false;
  }

  private forgetLiveGamepad(index: number): boolean {
    const removed = this.liveGamepads.delete(index);
    const controller = `gamepad-${index}`;
    this.slots.forEach((slot, position) => {
      if (slot === controller) this.slotProfiles[position] = null;
    });
    return removed;
  }

  private syncLiveGamepads(pads: readonly (Gamepad | null)[]): void {
    const connected = pads.filter((pad): pad is Gamepad => !!pad?.connected);
    let changed = false;
    for (const [index, live] of this.liveGamepads) {
      const pad = connected.find((item) => item.index === index);
      if (!pad || gamepadDescription(pad) !== live.device) changed = this.forgetLiveGamepad(index) || changed;
    }
    for (const pad of connected) {
      if (!this.liveGamepads.has(pad.index)) {
        this.liveGamepads.set(pad.index, { device: gamepadDescription(pad), token: ++this.connectionToken, profile: null });
        changed = true;
      }
    }
    if (changed && !this.game && ['survival', 'battle', 'team-battle'].includes(this.router.current())) this.renderSetup();
  }

  private renderDebugTuning(): void {
    this.destroyGame();
    window.scrollTo({ top: 0 });
    if (!releaseTuningSaveEnabled()) {
      this.root.innerHTML = `
        <main class="release-screen premium-surface settings-screen" data-screen="laboratory">
          <header class="release-heading"><button class="screen-back" id="close-debug-lab" type="button">${tr('labBack')}</button><div><p class="eyebrow">${tr('labPublicEyebrow')}</p><h1>${tr('labUnavailableTitle')}</h1></div></header>
          <section class="release-panel laboratory-unavailable"><h2>${tr('labPublicHeading')}</h2><p>${tr('labPublicDescription')}</p></section>
          <footer class="menu-metadata-footer">${gamepadFooterHintsMarkup()}</footer>
        </main>`;
      this.root.querySelector('#close-debug-lab')?.addEventListener('click', () => this.navigateBack());
      this.activateMenuFocus('laboratory');
      return;
    }
    this.root.innerHTML = `
      <main class="release-screen premium-surface debug-lab-screen" data-screen="laboratory">
        <header class="debug-lab-header release-heading">
          <button id="close-debug-lab" class="screen-back" type="button">${tr('labBack')}</button>
          <div><p class="eyebrow">${tr('labLocalEyebrow')}</p><h1>${tr('labTitle')}</h1></div>
          <p>${tr('labDescription')}</p>
          <div class="debug-lab-actions">
            <button id="reset-debug-tuning" type="button">${tr('labReset')}</button>
            <button id="save-debug-tuning" class="debug-save-button" type="button">${tr('labSave')}</button>
            ${releaseTuningSaveEnabled() ? `<button id="save-release-tuning" class="debug-release-save-button" type="button">${tr('labSaveRelease')}</button>` : ''}
            <output id="debug-save-status" role="status">${tr('labDeviceOnly')}</output>
          </div>
        </header>
        <div class="debug-lab-content">
          ${TUNING_GROUPS.map((group, index) => `
            <section class="debug-group">
              <div class="debug-group-heading"><h2>${tr(index === 0 ? 'labMovementTitle' : 'labMatchRhythmTitle')}</h2><p>${tr(index === 0 ? 'labMovementDescription' : 'labMatchRhythmDescription')}</p></div>
              <div class="debug-fields">${group.fields.map((field) => this.debugScalarFieldMarkup(field)).join('')}</div>
            </section>
          `).join('')}
          <section class="debug-group">
            <div class="debug-group-heading"><h2>${tr('labBattleTitle')}</h2><p>${tr('labBattleDescription')}</p></div>
            <div class="debug-ai-grid">${(['family', 'normal', 'sport'] as const).map((difficulty) => this.debugBattleDifficultyCardMarkup(difficulty)).join('')}</div>
          </section>
          <section class="debug-group">
            <div class="debug-group-heading"><h2>${tr('labAiTitle')}</h2><p>${tr('labAiDescription')}</p></div>
            <div class="debug-ai-grid">
              ${(['easy', 'medium', 'hard', 'expert'] as const).map((difficulty) => this.debugAiCardMarkup(difficulty)).join('')}
            </div>
          </section>
          <section class="debug-group"><div class="debug-group-heading"><h2>${tr('labTiltTitle')}</h2><p>${tr('labTiltDescription')}</p></div><div class="debug-fields">${this.mobileTiltFieldsMarkup()}</div></section>
          <section class="debug-group">
            <div class="debug-group-heading"><h2>${tr('labMessagesTitle')}</h2><p>${tr('labMessagesDescription', { level:'{level}', senders:'{senders}', rows:'{rows}' })}</p></div>
            <div class="debug-fields debug-message-fields">${MESSAGE_TEMPLATE_KEYS.map((key) => this.debugMessageFieldMarkup(key)).join('')}</div>
          </section>
        </div>
        <footer class="menu-metadata-footer">${gamepadFooterHintsMarkup()}</footer>
      </main>
    `;
    this.bindDebugTuning();
  }

  private debugScalarFieldMarkup(field: TuningField): string {
    const value = this.tuning[field.key];
    const copy = LAB_SCALAR_COPY_KEYS[field.key];
    return `
      <label class="debug-field">
        <span><b>${tr(copy.label)}</b><small>${escapeHtml(labHint(copy.hint))}</small></span>
        <span class="debug-number"><input type="number" value="${value}" min="${field.min}" max="${field.max}" step="${field.step}" data-tuning-key="${field.key}" aria-label="${tr(copy.label)}" /><i>${escapeHtml(labUnit(field.unit))}</i></span>
      </label>
    `;
  }

  private debugBattleDifficultyCardMarkup(difficulty: BattleDifficulty): string {
    const profile = this.tuning.battleDifficulties[difficulty];
    const field = (key: keyof typeof profile, value: number, unit: string, min: number, max: number, step: number): string => `<label class="debug-field is-compact"><span><b>${tr(LAB_BATTLE_COPY_KEYS[key].label)}</b><small>${escapeHtml(labHint(LAB_BATTLE_COPY_KEYS[key].hint))}</small></span><span class="debug-number"><input type="number" value="${value}" min="${min}" max="${max}" step="${step}" data-battle-difficulty="${difficulty}" data-battle-key="${key}" aria-label="${escapeHtml(localizedBattleDifficultyCopy(difficulty).label)}: ${tr(LAB_BATTLE_COPY_KEYS[key].label)}" /><i>${escapeHtml(labUnit(unit))}</i></span></label>`;
    return `<article class="debug-ai-card"><h3>${escapeHtml(localizedBattleDifficultyCopy(difficulty).label)}</h3>${field('startingGravityMs', profile.startingGravityMs, 'мс', 100, 2000, 10)}${field('accelerationPercent', profile.accelerationPercent, '%', 0, 30, .25)}${field('piecesPerLevel', profile.piecesPerLevel, 'шт', 1, 50, 1)}</article>`;
  }

  private debugAiCardMarkup(difficulty: AiDifficulty): string {
    const labels = { easy:'labAiEasy', medium:'labAiMedium', hard:'labAiHard', expert:'labAiExpert' } as const;
    const profile = this.tuning.ai[difficulty];
    const field = (key: keyof typeof profile, value: number, unit: string, min: number, max: number, step: number): string => `
      <label class="debug-field is-compact">
        <span><b>${tr(LAB_AI_COPY_KEYS[key].label)}</b><small>${escapeHtml(labHint(LAB_AI_COPY_KEYS[key].hint))}</small></span>
        <span class="debug-number"><input type="number" value="${value}" min="${min}" max="${max}" step="${step}" data-ai-difficulty="${difficulty}" data-ai-key="${key}" aria-label="${tr(labels[difficulty])}: ${tr(LAB_AI_COPY_KEYS[key].label)}" /><i>${escapeHtml(labUnit(unit))}</i></span>
      </label>`;
    return `
      <article class="debug-ai-card">
        <h3>${tr(labels[difficulty])}</h3>
        ${field('reactionMs', profile.reactionMs, 'мс', 20, 1000, 5)}
        ${field('dropTapIntervalMs', profile.dropTapIntervalMs ?? 0, 'мс', 0, 1500, 5)}
        ${field('errorChance', profile.errorChance * 100, '%', 0, 100, 1)}
        ${field('conflictIntentChance', profile.conflictIntentChance * 100, '%', 0, 100, 1)}
      </article>
    `;
  }

  private debugMessageFieldMarkup(key: keyof GameTuning['messages']): string {
    const copy = LAB_MESSAGE_COPY_KEYS[key];
    const label = localeText(copy.label), hint = labHint(copy.hint);
    return `<label class="debug-field is-compact"><span><b>${escapeHtml(label)}</b><small>${escapeHtml(hint)}</small></span><textarea data-message-key="${key}" aria-label="${escapeHtml(label)}" rows="2">${escapeHtml(localizedTuningMessage(key, this.tuning.messages[key], getLocale()))}</textarea></label>`;
  }

  private mobileTiltFieldsMarkup(): string {
    const fields: Array<[keyof GameTuning['mobileTilt'], number, number, number]> = [
      ['horizontalThreshold', 5, 45, 1], ['rotateThreshold', 5, 45, 1], ['dropThreshold', 5, 45, 1], ['deadZone', 0, 20, 1], ['smoothing', 0.05, 1, 0.05], ['rotateRearmMs', 0, 1000, 10],
    ];
    return fields.map(([key, min, max, step]) => `<label class="debug-field"><span><b>${tr(LAB_TILT_COPY_KEYS[key].label)}</b><small>${escapeHtml(labHint(LAB_TILT_COPY_KEYS[key].hint))}</small></span><span class="debug-number"><input type="number" data-mobile-tilt="${key}" value="${this.tuning.mobileTilt[key]}" min="${min}" max="${max}" step="${step}" aria-label="${tr(LAB_TILT_COPY_KEYS[key].label)}" /><i>${key === 'smoothing' ? '' : key === 'rotateRearmMs' ? tr('labUnitMs') : '°'}</i></span></label>`).join('');
  }

  private bindDebugTuning(): void {
    this.root.querySelector('#close-debug-lab')?.addEventListener('click', () => this.navigateBack());
    this.root.querySelector<HTMLButtonElement>('#save-debug-tuning')?.addEventListener('click', () => {
      void this.saveDebugTuning();
    });
    this.root.querySelector<HTMLButtonElement>('#save-release-tuning')?.addEventListener('click', () => {
      void this.saveReleaseTuning();
    });
    this.root.querySelector('#reset-debug-tuning')?.addEventListener('click', () => {
      this.audio.playUiSelect();
      const status = this.root.querySelector<HTMLOutputElement>('#debug-save-status');
      if (!resetGameTuning()) {
        if (status) status.textContent = status.value = localeText('labResetFailed');
        return;
      }
      this.tuning = cloneGameTuning(DEFAULT_GAME_TUNING);
      this.renderDebugTuning();
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-tuning-key]').forEach((input) => {
      const commit = (finalize: boolean): void => {
        const key = input.dataset.tuningKey as ScalarTuningKey;
        if (input.value.trim() === '') {
          if (finalize) input.value = String(this.tuning[key]);
          return;
        }
        const raw = Number(input.value);
        if (!Number.isFinite(raw)) return;
        if (!finalize && (raw < Number(input.min) || raw > Number(input.max))) return;
        const value = finalize ? Math.min(Number(input.max), Math.max(Number(input.min), raw)) : raw;
        if (finalize) input.value = String(value);
        this.tuning[key] = value;
      };
      input.addEventListener('input', () => commit(false));
      input.addEventListener('change', () => commit(true));
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-ai-key]').forEach((input) => {
      const commit = (finalize: boolean): void => {
        const difficulty = input.dataset.aiDifficulty as AiDifficulty;
        const key = input.dataset.aiKey as keyof GameTuning['ai'][AiDifficulty];
        const profile = this.tuning.ai[difficulty];
        if (input.value.trim() === '') {
          if (finalize) {
            const stored = profile[key];
            input.value = String(key === 'errorChance' || key === 'conflictIntentChance' ? (stored ?? 0) * 100 : stored ?? 0);
          }
          return;
        }
        const raw = Number(input.value);
        if (!Number.isFinite(raw)) return;
        if (!finalize && (raw < Number(input.min) || raw > Number(input.max))) return;
        const value = finalize ? Math.min(Number(input.max), Math.max(Number(input.min), raw)) : raw;
        if (finalize) input.value = String(value);
        if (key === 'dropTapIntervalMs') profile[key] = value <= 0 ? null : value;
        else if (key === 'errorChance' || key === 'conflictIntentChance') profile[key] = value / 100;
        else profile[key] = value;
      };
      input.addEventListener('input', () => commit(false));
      input.addEventListener('change', () => commit(true));
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-battle-key]').forEach((input) => {
      const commit = (finalize: boolean): void => {
        const difficulty = input.dataset.battleDifficulty as BattleDifficulty;
        const key = input.dataset.battleKey as keyof GameTuning['battleDifficulties'][BattleDifficulty];
        if (input.value.trim() === '') { if (finalize) input.value = String(this.tuning.battleDifficulties[difficulty][key]); return; }
        const raw = Number(input.value); if (!Number.isFinite(raw)) return;
        if (!finalize && (raw < Number(input.min) || raw > Number(input.max))) return;
        const value = finalize ? Math.min(Number(input.max), Math.max(Number(input.min), raw)) : raw;
        if (finalize) input.value = String(value);
        this.tuning.battleDifficulties[difficulty][key] = value;
      };
      input.addEventListener('input', () => commit(false)); input.addEventListener('change', () => commit(true));
    });
    this.root.querySelectorAll<HTMLTextAreaElement>('[data-message-key]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.messageKey as keyof GameTuning['messages'];
        this.tuning.messages[key] = input.value;
      });
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-mobile-tilt]').forEach((input) => input.addEventListener('change', () => {
      const key = input.dataset.mobileTilt as keyof GameTuning['mobileTilt']; const value = Math.min(Number(input.max), Math.max(Number(input.min), Number(input.value)));
      if (Number.isFinite(value)) { this.tuning.mobileTilt[key] = value; input.value = String(value); }
    }));
    this.activateMenuFocus('laboratory');
  }

  private saveDebugTuning(): void {
    const button = this.root.querySelector<HTMLButtonElement>('#save-debug-tuning');
    const status = this.root.querySelector<HTMLOutputElement>('#debug-save-status');
    if (!button || !status) return;
    button.disabled = true;
    const saved = saveGameTuning(this.tuning);
    status.value = localeText(saved ? 'labSavedLocal' : 'labSaveFailed');
    status.textContent = status.value;
    button.disabled = false;
  }

  private async saveReleaseTuning(): Promise<void> {
    const button = this.root.querySelector<HTMLButtonElement>('#save-release-tuning');
    const status = this.root.querySelector<HTMLOutputElement>('#debug-save-status');
    if (!button || !status || !releaseTuningSaveEnabled()) return;
    button.disabled = true;
    status.value = localeText('labSavingRelease');
    status.textContent = status.value;
    try {
      const response = await fetch('/__debug/game-tuning', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.tuning),
      });
      const result = await response.json() as { ok?: boolean; file?: string; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? localeText('labReleaseSaveFailed'));
      status.value = localeText('labSavedRelease', { file: result.file ?? 'config/game-tuning.json' });
      status.textContent = status.value;
    } catch (error) {
      status.value = error instanceof Error ? localeText('labSaveError', { error:error.message }) : localeText('labReleaseSaveFailed');
      status.textContent = status.value;
    } finally {
      button.disabled = false;
    }
  }

  private gamepadFor(controller: GamepadController): ConnectedGamepad | null {
    const index = Number(controller.slice(8));
    if (this.liveGamepads.get(index)?.token !== this.slotPadTokens.get(index)) return null;
    return connectedGamepads().find((gamepad) => gamepad.controller === controller) ?? null;
  }

  private gamepadAvailabilityErrors(configs: readonly ParticipantConfig[] = this.configs()): Array<{ message: string }> {
    return configs.some((config) => isGamepadController(config.controller) && !this.gamepadFor(config.controller))
      ? [{ message: localeText('gamepadUnavailable') }]
      : [];
  }

  private configs(): ParticipantConfig[] {
    return this.slots.flatMap((value, index): ParticipantConfig[] => {
      if (value === 'off' || (this.selectedMode === 'survival' && !isManualSlot(value))) return [];
      const teamId = this.selectedMode === 'team-battle' ? teamIdForSlot(index) ?? undefined : undefined;
      if (isManualSlot(value)) {
        const gamepad = isGamepadSlot(value) ? this.gamepadFor(value) : null;
        return [{ id: `player-${index + 1}`, label: this.playerNameForSlot(index),
          controller: isMobilePlayViewport() && value === 'human-1' ? 'mobile-touch' : value,
          controllerLabel: gamepad?.label, tileStyle: this.slotTileStyles[index] ?? DEFAULT_TILE_STYLE_SELECTION, teamId }];
      }
      return [{ id: `player-${index + 1}`, label: 'ИИ', controller: 'ai', difficulty: value.slice(3) as AiDifficulty,
        tileStyle: this.slotTileStyles[index] ?? DEFAULT_TILE_STYLE_SELECTION, teamId }];
    });
  }

  private playerNameForSlot(index: number): string {
    return this.playerNames[index] ?? `Игрок ${index + 1}`;
  }

  private showValidation(): boolean {
    const configs = this.configs();
    const admission = lobbyAdmission(this.selectedMode, this.slots, this.lobby.editing(), this.gamepadAvailabilityErrors(configs).length > 0);
    const errors = [
      ...(admission ? [{ message: admission }] : []),
      ...(this.selectedMode === 'survival' ? validateSurvivalParticipants(configs) : validateParticipants(configs)),
      ...this.gamepadAvailabilityErrors(configs),
      ...validateDurationMinutes(this.durationMinutes),
      ...validateMatchOptions(configs, this.pacing),
    ];
    const output = this.root.querySelector<HTMLElement>('#setup-error');
    const button = this.root.querySelector<HTMLButtonElement>('#start-match');
    if (output) output.textContent = errors[0] ? lobbyText(localValidationMessage(errors[0].message, getLocale())) : '';
    if (button) button.disabled = errors.length > 0;
    return errors.length === 0;
  }

  private startMatch(): void {
    if (this.matchLoading || !this.showValidation() || this.root.querySelector('.lobby-overlay:not([hidden])')) return;
    const loading = new MatchLoading(this.root, () => this.destroyGame(), () => this.navigateBack());
    this.matchLoading = loading;
    // Keep Web Audio unlock inside the initiating user gesture.
    this.audio.unlock();
    this.menuFocus.suspend();
    this.router.open('arena', this.router.current());
    void this.prepareMatch(loading).catch(error => {
      if (this.matchLoading !== loading) return;
      this.destroyGame();
      window.dispatchEvent(new ErrorEvent('error', { error, message: String(error) }));
    });
  }

  private async prepareMatch(loading: MatchLoading): Promise<void> {
    await clientUpdate.setActivity(false);
    if (!await loading.painted() || this.matchLoading !== loading) return;
    this.disconnectPlayerNameResizeObserver();
    this.countdownReady = false;
    this.playerEventRegions.clear();
    this.audio.startGame();
    desktop?.setSafeMenu(false);
    this.menuFocus.suspend();
    const configs = this.configs();
    const mobileMatch = configs[0]?.controller === 'mobile-touch';
    const seed = isLocalPlaytestFlag('playtest-anomaly-arrival') ? 4217
      : isLocalPlaytestFlag('playtest-shield-impact') ? 173 : this.createSeed();
    const activeTuning = this.tuning;
    const engine = new MatchEngine(configs, seed, this.durationMinutes, this.pacing, activeTuning, this.selectedMode === 'survival');
    if (isLocalPlaytestFlag('playtest-anomaly-arrival')) prepareAnomalyArrivalPlaytest(engine, localPlaytestNumber('playtest-arrival-bottom') ?? undefined);
    if (isLocalPlaytestFlag('playtest-clear')) {
      const match = /^((?:normal|fire))-([1-4])$/.exec(new URLSearchParams(window.location.search).get('playtest-clear') ?? '');
      const participant = engine.state.participants[0];
      if (match && participant) prepareClearPlaytest(participant.board, match[1] as 'normal' | 'fire', Number(match[2]), 1_400);
    }
    if (isLocalPlaytestFlag('playtest-anomaly')) {
      for (const participant of engine.state.participants) participant.placedPieces = 9;
    }
    const playtestConflictRows = localPlaytestNumber('playtest-conflict');
    const playtestScore = localPlaytestNumber('playtest-score');
    const playtestCleanup = isLocalPlaytestFlag('playtest-cleanup');
    const playtestShield = isLocalPlaytestFlag('playtest-shield');
    const playtestShieldImpact = localPlaytestNumber('playtest-shield-impact');
    const playtestLevelUp = isLocalPlaytestFlag('playtest-level-up');
    const playtestSurvivalLevelUp = isLocalPlaytestFlag('playtest-survival-level-up');
    const playtestFinalPush = isLocalPlaytestFlag('playtest-final-push');
    const playtestGlobalCombined = isLocalPlaytestFlag('playtest-global-combined');
    const playtestCalmEffects = isLocalPlaytestFlag('playtest-calm-effects');
    const playtestImpact = isLocalPlaytestFlag('playtest-impact');
    const playtestDefense = isLocalPlaytestFlag('playtest-defense');
    const playtestShieldBlock = isLocalPlaytestFlag('playtest-shield-block');
    const playtestShieldHalf = isLocalPlaytestFlag('playtest-shield-half');
    const playtestShieldFull = isLocalPlaytestFlag('playtest-shield-full');
    const playtestMessageLower = isLocalPlaytestFlag('playtest-message-lower');
    const playtestAnomalyBurn = isLocalPlaytestFlag('playtest-anomaly-burn');
    if (playtestCalmEffects) document.body.classList.add('calm-effects');
    const input = new HumanInputRouter(
      activeTuning?.horizontalRepeatDelayMs,
      activeTuning?.horizontalRepeatIntervalMs,
    );
    const initialClock = matchClockPresentation(
      !Number.isFinite(engine.state.durationMs),
      engine.state.elapsedMs,
      engine.state.remainingMs,
      getLocale(),
    );
    input.configure(configs);
    const aiControllers = new Map<string, AiController>();
    for (const config of configs) {
      if (config.controller === 'ai' && config.difficulty && !isLocalPlaytestFlag('playtest-anomaly-arrival') && !isLocalPlaytestFlag('playtest-board-events')) {
        aiControllers.set(config.id, new AiController(seed, config.id, config.difficulty, engine.state.options.conflictEnabled, activeTuning ?? undefined));
      }
    }

    this.root.innerHTML = `
      <main class="arena-screen premium-surface${mobileMatch ? ' mobile-solo-arena' : ''}" data-battle-difficulty="${engine.state.options.battleDifficulty}" data-soft-drop="${engine.state.options.softDrop}" data-pressure="${engine.state.options.pressure}" data-conflict="${engine.state.options.conflictEnabled ? 'on' : 'off'}" data-debug-tuning="${activeTuning ? 'on' : 'off'}" data-tile-styles="${engine.state.participants.map((participant) => participant.resolvedTileStyle).join(',')}" data-pressure-start-ms="${engine.state.pressureStartMs}" data-gravity-interval-ms="${engine.state.gravityIntervalMs}" data-soft-drop-interval-ms="${engine.state.options.softDropIntervalMs}">
        ${mobileMatch ? '' : `<div class="arena-backdrop" aria-hidden="true"><div class="arena-foliage"></div></div><div id="round-timer" class="round-timer" aria-label="${initialClock.ariaLabel}"><span id="match-clock" class="round-timer-value">${formatClock(initialClock.milliseconds)}</span></div>`}
        <div class="game-stage" id="game-stage">
          <div id="game-canvas" class="game-canvas"></div>
          <div id="hud-grid" class="hud-grid" aria-live="polite"></div>
          <div id="arena-event-layer" class="arena-event-layer" aria-live="assertive"><div id="arena-event-notice" class="match-event-plaque arena-event-notice" hidden></div></div>
          <div id="countdown" class="countdown" aria-label="${tr('countdownAria')}" hidden>3</div>
          <div id="pause-overlay" class="pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title" hidden>
            <section id="pause-menu-panel" class="pause-panel">
              <span id="pause-title">${tr('pausedTitle')}</span>
              <small id="pause-copy" hidden></small>
              <button id="continue-match" class="pause-continue" type="button">${tr('journeyContinue')}</button>
              <div id="manual-pause-actions" class="pause-actions" hidden><button id="restart-match" type="button">${tr('journeyRestart')}</button><button id="pause-settings" type="button">${tr('settings')}</button><button id="return-to-menu" type="button">${tr('menu')}</button></div>
            </section>
            <section id="pause-settings-panel" class="pause-panel pause-settings-panel" hidden>
              <span>${tr('settings')}</span>
              ${this.setupAudioMarkup()}
              ${mobileMatch ? '' : `<button class="settings-action" id="pause-toggle-fullscreen" type="button"><span><strong>${tr('fullscreen')}</strong></span><b>${document.fullscreenElement ? tr('on') : tr('off')}</b></button>`}
              <label class="settings-action"><span><strong>${tr('calm')}</strong><small>${tr('calmHint')}</small></span><input id="pause-calm-effects" type="checkbox" ${this.releaseSettings.calmEffects ? 'checked' : ''} /></label>
              <output id="pause-settings-status" class="settings-status" role="status"></output>
              <button id="pause-settings-back" type="button">← ${tr('backPause')}</button>
            </section>
          </div>
          <div id="viewport-warning" class="viewport-warning">${tr('viewportWarning')}</div>
          ${mobileMatch ? `<div class="mobile-match-actions"><button id="manual-pause" class="mobile-match-action" type="button" aria-label="${tr('pauseMatchAria')}" aria-pressed="false"><span aria-hidden="true">Ⅱ</span></button><output id="mobile-match-timer" class="mobile-match-timer" aria-label="${initialClock.ariaLabel}">${formatClock(initialClock.milliseconds)}</output></div>` : ''}
          ${mobileMatch ? this.mobileGameControlsMarkup() : ''}
        </div>
        <div id="results-layer"></div>
      </main>
    `;

    const scene = new PlayScene({
      engine: new LocalMatchSession(engine),
      input,
      aiControllers,
      isPresentationReady: () => this.matchLoading === null,
      onReady: () => {
        void loading.ready().then(ready => {
          if (!ready || this.matchLoading !== loading) return;
          this.matchLoading = null;
          this.countdownReady = true;
          this.lastHudKey = '';
          this.updateHud(engine.state);
        });
      },
      onState: (state) => this.updateHud(state),
      onLayout: (layout) => this.updateArenaLayout(layout),
      onFinished: (state) => this.showResults(state),
      mobileSolo: mobileMatch,
      mobileTiltControls: false,
      captureShieldAtMs: playtestShieldImpact !== null ? localPlaytestNumber('playtest-shield-capture') ?? undefined : undefined,
      captureAnomalyBurnAtMs: isLocalPlaytestFlag('playtest-anomaly-arrival')
        ? localPlaytestNumber('playtest-arrival-capture') ?? undefined : undefined,
    });
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game-canvas',
      backgroundColor: '#071b4a',
      transparent: true,
      antialias: this.releaseSettings.antialias,
      fps: {limit:this.releaseSettings.fpsLimit},
      render: { pixelArt: false, roundPixels: true },
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
      },
      scene,
      audio: { noAudio: true },
    });
    const toggleManualPause = (): void => {
      if (!engine.toggleManualPause()) return;
      input.setEnabled(engine.acceptsGameplayInput());
      this.lastHudKey = '';
      this.updateHud(engine.state);
    };
    this.resumePausedMatch = toggleManualPause;
    this.root.querySelector('#manual-pause')?.addEventListener('click', toggleManualPause);
    this.root.querySelector('#continue-match')?.addEventListener('click', toggleManualPause);
    this.root.querySelector('#restart-match')?.addEventListener('click', () => { this.destroyGame(); this.startMatch(); });
    this.root.querySelector('#pause-settings')?.addEventListener('click', () => this.showPauseSettings(true));
    this.root.querySelector('#pause-settings-back')?.addEventListener('click', () => this.navigateBack());
    this.root.querySelector('#pause-toggle-fullscreen')?.addEventListener('click', () => {
      const operation = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      void operation.then(() => {
        const state = this.root.querySelector<HTMLElement>('#pause-toggle-fullscreen b');
        if (state) state.textContent = document.fullscreenElement ? tr('on') : tr('off');
      }).catch(() => {
        const status = this.root.querySelector<HTMLOutputElement>('#pause-settings-status');
        if (status) status.textContent = localeText('fullscreenFailed');
      });
    });
    this.root.querySelector<HTMLInputElement>('#pause-calm-effects')?.addEventListener('change', (event) => {
      this.releaseSettings.calmEffects = (event.currentTarget as HTMLInputElement).checked;
      document.body.classList.toggle('calm-effects', this.releaseSettings.calmEffects);
      this.persistPreferences();
    });
    const returnToMenu = (): void => { this.destroyGame(); this.router.open('main-menu'); this.renderMainMenu(); };
    this.root.querySelector('#return-to-menu')?.addEventListener('click', returnToMenu);
    this.bindAudioToggle();
    this.bindVolumeControl();
    if (mobileMatch) this.bindMobileMatchInput(input);
    if (isLocalPlaytestFlag('playtest-board-events') || isLocalPlaytestFlag('playtest-performance')) {
      Object.assign(window, {__boardEffectsQA: {engine, scene, prepareClearPlaytest, audio: this.audio}});
    }
    this.updateHud(engine.state);
    if ((playtestConflictRows && [1, 3, 4].includes(playtestConflictRows)) || playtestCleanup || playtestShield || playtestShieldImpact !== null || playtestLevelUp || playtestSurvivalLevelUp || playtestFinalPush || playtestGlobalCombined || playtestImpact || playtestDefense || playtestShieldBlock || playtestShieldHalf || playtestShieldFull || playtestMessageLower || playtestAnomalyBurn || playtestScore !== null) {
      window.setTimeout(() => {
        if (playtestScore !== null) {
          for (const participant of engine.state.participants) participant.score = playtestScore;
        }
        if (playtestConflictRows && [1, 3, 4].includes(playtestConflictRows)) {
          const timedWarning = isLocalPlaytestFlag('playtest-conflict-timed');
          const [sender, ...recipients] = timedWarning
            ? [engine.state.participants[engine.state.participants.length - 1]!, engine.state.participants[0]!]
            : engine.state.participants;
          if (sender && recipients.length > 0) {
            if (playtestMessageLower) {
              for (const recipient of recipients) {
                recipient.board.grid.slice(-7).forEach((row) => row.fill('garbage'));
                recipient.board.staticRenderRevision += 1;
              }
            }
            engine.state.pendingConflict = {
              serial: 1,
              remainingWarningMs: isLocalPlaytestFlag('playtest-conflict-timed') ? activeTuning.conflictWarningMs : 12_000,
              senders: [{
                participantId: sender.config.id,
                rows: playtestConflictRows,
                recipientIds: recipients.map((participant) => participant.config.id),
              }],
              incomingRows: fromEntries(recipients.map((participant) => [participant.config.id, playtestConflictRows])),
            };
          }
        }
        if (playtestShieldImpact !== null && [1, 2, 3].includes(playtestShieldImpact)) {
          engine.step(engine.state.countdownMs);
          engine.state.roundStartPulseMs = 0;
          const recipient = engine.state.participants[0]!;
          recipient.shieldCount = playtestShieldImpact;
          recipient.shieldReady = true;
          // A real engine attack over a recognizable low stack for visual review.
          const colors = ['J', 'L', 'O', 'S', 'T'] as const;
          recipient.board.grid.slice(-3).forEach((row, r) => row.forEach((_cell, x) => {
            if (x !== 4 && x < 8 - r) row[x] = colors[(x + r) % colors.length]!;
          }));
          recipient.board.staticRenderRevision += 1;
          if (isLocalPlaytestFlag('playtest-shield-pressure')) engine.state.nextPressureAtMs = engine.state.elapsedMs + 1;
          else engine.state.pendingConflict = { serial: 1, remainingWarningMs: 1,
            incomingRows: { [recipient.config.id]: localPlaytestNumber('playtest-shield-rows') ?? 4 }, senders: [] };
          engine.step(2);
          for (const event of engine.state.shieldInventoryEvents) event.pulseMs = 12_000;
          if (engine.state.conflictImpactEvent) engine.state.conflictImpactEvent.pulseMs = 12_000;
        }
        if (playtestCleanup) {
          const participant = engine.state.participants[0];
          if (participant) {
            engine.state.cleanupSerial = 1;
            engine.state.cleanupEvents = [{ serial: 1, participantId: participant.config.id, rows: 3, pulseMs: 12_000 }];
          }
        }
        if (playtestAnomalyBurn) {
          const participant = engine.state.participants[0];
          if (participant) {
            participant.board.grid.at(-2)?.fill('J');
            participant.board.grid.at(-1)?.fill('garbage');
            participant.board.staticRenderRevision += 1;
            const rows = participant.board.grid.slice(-2).map((row) => [...row]);
            engine.state.anomalyBurnSerial = 1;
            engine.state.anomalyBurnEvents = [{ serial: 1, participantId: participant.config.id, rows, pulseMs: 12_000 }];
          }
        }
        if (playtestShield) {
          const participant = engine.state.participants[0];
          if (participant) {
            participant.shieldCount = 1;
            participant.shieldReady = true;
            engine.state.clearStreakEvents = [{ serial: 1, participantId: participant.config.id, multiplier: 3, pulseMs: 12_000 }];
          }
        }
        if (playtestShieldHalf || playtestShieldFull) {
          const participant = engine.state.participants[0];
          if (participant) {
            const kind = 'full' as const;
            participant.shieldCharge = 0;
            if (kind === 'full') {
              participant.shieldCount = 1;
              participant.shieldReady = true;
            }
            engine.state.shieldInventorySerial = 1;
            engine.state.shieldInventoryEvents = [{serial:1, participantId:participant.config.id, kind:'gain', reason:'clear', firstSlot:0, count:1, pulseMs:12_000}];
            engine.state.shieldChargeSerial = 1;
            engine.state.shieldChargeEvents = [{ serial: 1, participantId: participant.config.id, kind, pulseMs: 12_000 }];
          }
        }
        if (playtestLevelUp || playtestGlobalCombined) {
          engine.state.levelUpEvent = { serial: 1, level: 1, anomalyId: 'playtest-anomaly', pulseMs: LEVEL_UP_PULSE_MS };
          engine.state.globalEventHold = { kind: playtestGlobalCombined ? 'final-push' : 'level-up', level: 1, durationMs: playtestGlobalCombined ? FINAL_PUSH_PULSE_MS : LEVEL_UP_PULSE_MS, remainingMs: playtestGlobalCombined ? FINAL_PUSH_PULSE_MS : LEVEL_UP_PULSE_MS };
        }
        if (playtestSurvivalLevelUp && engine.state.isSurvival) {
          const participant = engine.state.participants[0];
          if (participant) participant.levelUpEvent = { serial: 1, level: 1, anomalyId: 'playtest-anomaly', pulseMs: 12_000 };
        }
        if (playtestFinalPush || playtestGlobalCombined) {
          engine.state.finalPushSerial = 1;
          engine.state.finalPushPulseMs = FINAL_PUSH_PULSE_MS;
          engine.state.globalEventHold = { kind: 'final-push', level: playtestGlobalCombined ? 1 : undefined, durationMs: FINAL_PUSH_PULSE_MS, remainingMs: FINAL_PUSH_PULSE_MS };
        }
        if (playtestImpact || playtestDefense || playtestShieldBlock) {
          const [sender, recipient] = engine.state.participants;
          if (sender && recipient) {
            engine.state.conflictImpactEvent = {
              serial: 1,
              incomingRows: playtestImpact ? { [recipient.config.id]: 1 } : {},
              maxRows: playtestImpact ? 1 : 0,
              pulseMs: 12_000,
              defendedRecipientIds: playtestDefense ? [recipient.config.id] : [],
              shieldedRecipientIds: playtestShieldBlock ? [recipient.config.id] : [],
              senders: [{ participantId: sender.config.id, rows: 1, recipientIds: [recipient.config.id] }],
            };
          }
        }
      }, playtestLevelUp || playtestFinalPush || playtestGlobalCombined ? 3_200 : 120);
    }
  }

  private bindMobileMatchInput(input: HumanInputRouter): void {
    this.mobileInputCleanup?.();
    const touch: GamepadControls = { left: false, right: false, down: false, rotate: false };
    const heldPointers = new Map<number, MobileTouchAction>();
    const sync = (): void => input.updateVirtual('mobile-touch', touch);
    const refreshTouch = (): void => {
      touch.left = [...heldPointers.values()].includes('left');
      touch.right = [...heldPointers.values()].includes('right');
      touch.down = [...heldPointers.values()].includes('down');
    };
    const zones = this.root.querySelector<HTMLElement>('[data-mobile-touch-zones]');
    const release = (pointerId: number): void => {
      if (!heldPointers.delete(pointerId)) return;
      refreshTouch(); sync();
    };
    zones?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const bounds = zones.getBoundingClientRect();
      const action = mobileTouchActionAt(event.clientX - bounds.left, event.clientY - bounds.top, bounds.width, bounds.height);
      zones.setPointerCapture?.(event.pointerId);
      if (action === 'rotate') { touch.rotate = true; sync(); touch.rotate = false; sync(); return; }
      heldPointers.set(event.pointerId, action); refreshTouch(); sync();
    });
    zones?.addEventListener('pointerup', (event) => release(event.pointerId));
    zones?.addEventListener('pointercancel', (event) => release(event.pointerId));
    zones?.addEventListener('lostpointercapture', (event) => release(event.pointerId));
    this.mobileInputCleanup = () => { heldPointers.clear(); input.updateVirtual('mobile-touch', null); };
  }

  private mobileGameControlsMarkup(): string {
    return `<div class="mobile-touch-zones" data-mobile-touch-zones aria-label="${tr('mobileTouchAria')}"><span class="mobile-touch-zone mobile-touch-zone-left" aria-hidden="true">←</span><span class="mobile-touch-zone mobile-touch-zone-down" aria-hidden="true">↓</span><span class="mobile-touch-zone mobile-touch-zone-right" aria-hidden="true">→</span></div>`;
  }

  private updateArenaLayout(layout: ArenaLayout): void {
    this.latestArenaLayout = layout;
    const hud = this.root.querySelector<HTMLElement>('#hud-grid');
    if (!hud) return;
    const arena = hud.closest<HTMLElement>('.arena-screen:not(.mobile-solo-arena)');
    arena?.style.setProperty('--clock-board-height', `${layout.cardHeight}px`);
    arena?.style.setProperty('--clock-board-rows', String(layout.rows));
    arena?.style.setProperty('--clock-grid-insets', `${8 + (layout.rows - 1) * (layout.gap ?? 4)}px`);
    hud.style.setProperty('--arena-card-gap', `${layout.gap ?? 4}px`);
    hud.style.setProperty('--hud-scale', String((layout.headerHeight ?? 52) / 52));
    hud.style.setProperty('--solo-hud-scale', String((layout.headerHeight ?? 80) / 80));
    hud.style.setProperty('--arena-header-height', `${layout.headerHeight ?? 52}px`);
    if (arena && !arena.classList.contains('network-arena') && layout.participantCards) {
      const decoration = localArenaDecoration(hud.clientWidth, layout.participantCards);
      arena.style.setProperty('--arena-free-side', `${decoration.sideWidth}px`);
      arena.style.setProperty('--arena-art-width', `${decoration.artWidth}px`);
      arena.classList.toggle('has-workshop-corners', decoration.visible);
      arena.classList.toggle('has-compact-arena-clock', decoration.compactClock);
    }
    hud.dataset.layout = layout.mode;
    hud.dataset.cellSize = String(layout.cellSize);
    hud.style.setProperty('--arena-columns', String(layout.columns));
    hud.style.setProperty('--arena-rows', String(layout.rows));
    hud.style.setProperty('--arena-card-width', `${layout.cardWidth}px`);
    hud.style.setProperty('--arena-card-height', `${layout.cardHeight}px`);
    if (layout.participantCards && this.latestHudState) {
      this.lastHudKey = '';
      this.updateHud(this.latestHudState);
    }
  }

  private updateHud(state: MatchState): void {
    this.latestHudState = state;
    if (this.countdownReady || state.phase !== 'countdown') this.audio.sync(state);
    if (!this.matchLoading) this.audio.syncMusic(state, `local:${state.seed}`, state.seed);
    if (isLocalPlaytestFlag('playtest-anomaly-arrival')) {
      const stage = this.root.querySelector<HTMLElement>('#game-stage');
      if (stage) {
        stage.dataset.seed = String(state.seed);
        stage.dataset.arrivalPhase = state.anomalyTransition?.phase ?? '';
        stage.dataset.arrivalRemainingMs = String(state.anomalyTransition?.remainingMs ?? 0);
        stage.dataset.arrivalSerial = String(state.anomalyArrivalSerial);
        stage.dataset.arrivalTargets = state.anomalyTransition?.targets.map(t => t.participantId).join(',') ?? '';
      }
    }
    if (isLocalPlaytestFlag('playtest-clear')) {
      const stage = this.root.querySelector<HTMLElement>('#game-stage');
      if (stage) {
        stage.dataset.burnRemainingMs = String(state.anomalyBurnEvents[0]?.pulseMs ?? 0);
        stage.dataset.clearPhase = state.clearPresentations[0]?.phase ?? '';
        stage.dataset.clearRemainingMs = String(state.clearPresentations[0]?.remainingMs ?? 0);
      }
    }
    const pauseKey = state.pauseReasons.join(',');
    const impactActive = (state.conflictImpactEvent?.pulseMs ?? 0) > 0;
    const cardConflictKey = `${state.pendingConflict?.serial ?? 0}:${state.pendingConflict?.senders.map((sender) => `${sender.participantId}:${sender.rows}`).join(',') ?? ''}:${Object.entries(state.pendingConflict?.incomingRows ?? {}).map(([id, rows]) => `${id}:${rows}`).join(',')}:${state.conflictImpactEvent?.serial ?? 0}:${impactActive}:${Object.entries(state.conflictImpactEvent?.incomingRows ?? {}).map(([id, rows]) => `${id}:${rows}`).join(',')}:${state.conflictImpactEvent?.defendedRecipientIds?.join(',') ?? ''}:${state.conflictImpactEvent?.shieldedRecipientIds?.join(',') ?? ''}:${state.cleanupSerial}:${state.cleanupEvents.map((event) => `${event.participantId}:${event.rows}`).join(',')}:${state.anomalyBurnSerial}:${state.anomalyBurnEvents.map((event) => `${event.participantId}:${event.rows.length}`).join(',')}:${state.shieldChargeEvents.map((event) => `${event.serial}:${event.participantId}:${event.kind}`).join(',')}`;
    const transitionKey = shieldInventoryKey(state) + ':' + state.shieldPresentations.map(e => `${e.serial}:${Math.ceil(e.remainingMs / 50)}:${e.deferredImpacts.map(i => i.rows).join(',')}`).join('|');
    const hudKey = `${getLocale()}:${cardConflictKey}:${transitionKey}:${state.participants.map((participant) => `${participant.board.alive}:${participant.placement}:${participant.score}:${participant.placedPieces}:${participant.shieldCount}:${participant.shieldCharge}:${participant.shieldReady}:${participant.lineClearStreak}:${participantLevelUpNoticeKey(participant.levelUpEvent)}:${participant.board.active?.definition.source ?? '-'}:${participant.board.nextPiece.id}`).join('|')}`;
    const hud = this.root.querySelector<HTMLElement>('#hud-grid');
    const mobileSoloMatch = this.root.querySelector('.mobile-solo-arena') !== null;
    if (hud && hudKey !== this.lastHudKey) {
      this.lastHudKey = hudKey;
      hud.dataset.count = String(state.participants.length);
      const competition = state.participants.map((participant, index) => ({ id: participant.config.id, score: participant.score, alive: participant.board.alive, teamId: teamIdForSlot(index) ?? undefined }));
      const leaderIds = state.options.matchVariant === 'teams'
        ? new Set(state.participants.filter((_participant, index) => teamLeaderIds(competition).includes(teamIdForSlot(index) ?? 'team-1')).map((participant) => participant.config.id))
        : new Set(scoreLeaderIds(competition));
      hud.innerHTML = state.participants.map((participant, index) => {
        const senderRows = Math.max(0, ...(state.pendingConflict?.senders.filter((sender) => sender.participantId === participant.config.id).map((sender) => sender.rows) ?? []));
        const incomingRows = state.pendingConflict?.incomingRows[participant.config.id] ?? 0;
        const impactRows = impactActive ? state.conflictImpactEvent?.incomingRows[participant.config.id] ?? 0 : 0;
        const senders = (state.pendingConflict?.senders ?? state.conflictImpactEvent?.senders ?? []).filter((sender) => sender.recipientIds.includes(participant.config.id));
        const senderParticipants = senders.map((sender) => state.participants.find((candidate) => candidate.config.id === sender.participantId)).filter((candidate) => candidate !== undefined);
        const senderNames = senderParticipants.map((sender) => this.participantDisplayName(sender.config));
        const senderAccent = senderParticipants.length
          ? playerAccentForSlot(state.participants.indexOf(senderParticipants[0]!))
          : playerAccentForSlot(index);
        const defended = impactActive && (state.conflictImpactEvent?.defendedRecipientIds?.includes(participant.config.id) ?? false);
        const shieldBlocked = impactActive && (state.conflictImpactEvent?.shieldedRecipientIds?.includes(participant.config.id) ?? false);
        const cleanupRows = state.cleanupEvents.find((event) => event.participantId === participant.config.id)?.rows ?? 0;
        const reflecting = state.shieldPresentations.some((event) => event.participantId === participant.config.id && event.remainingMs > 0);
        const participantEvent = reflecting ? null : participantMatchEvent(state, participant.config.id, this.tuning.messages, senderNames, getLocale());
        const noticeEventKey = participantEvent
          ? `${participantEvent.kind}:${participant.levelUpEvent?.serial ?? 0}:${state.anomalyBurnSerial}:${state.shieldChargeSerial}:${state.cleanupSerial}:${state.pendingConflict?.serial ?? state.conflictImpactEvent?.serial ?? 0}:${participant.config.id}`
          : null;
        const noticeRegion = noticeEventKey
          ? this.playerEventRegions.resolve(participant.config.id, noticeEventKey, participant.board.grid, participant.board.active)
          : null;
        if (!noticeEventKey) this.playerEventRegions.release(participant.config.id);
        const identity = hudIdentityForParticipant(index, state.options.matchVariant, getLocale());
        const shieldInventory = shieldInventoryMarkup(participant, state, getLocale());
        const compactMobileAi = isMobilePlayViewport() && participant.config.controller === 'ai';
        const mobilePlayer = mobileSoloMatch && index === 0;
        const mobileCard = this.latestArenaLayout?.participantCards?.[index];
        const mobileStyle = mobileCard ? `--mobile-x:${mobileCard.x}px;--mobile-y:${mobileCard.y}px;--mobile-width:${mobileCard.cardWidth}px;--mobile-height:${mobileCard.cardHeight}px;` : '';
        const identityLabel = participant.config.controller === 'ai' ? (compactMobileAi ? this.aiRoleLabel(participant.config) : `${this.participantDisplayName(participant.config)} · ${this.aiRoleLabel(participant.config)}`) : this.participantDisplayName(participant.config);
        const identityMarkup = `<div class="hud-identity">${controllerIcon(participant.config.controller, getLocale())}<strong class="${leaderIds.has(participant.config.id) ? 'is-leader' : ''}">${escapeHtml(identityLabel)}</strong>${identity.teamLabel ? `<i class="hud-team">${identity.teamLabel}</i>` : ''}</div>`;
        const statsMarkup = `<div class="hud-stats"><b>${tr('pointsCount', { count: participant.score.toLocaleString(getLocale()) })}</b><span>${formatPieces(participant.placedPieces, getLocale())}</span></div>`;
        const mobilePlayerMarkup = mobilePlayer
          ? `<div class="mobile-player-summary">${identityMarkup}${statsMarkup}</div>${shieldInventory}${nextPiecePreviewMarkup(participant.board.nextPiece, getLocale())}`
          : mobileSoloMatch ? `${identityMarkup}${statsMarkup}${shieldInventory}${compactMobileAi ? '' : nextPiecePreviewMarkup(participant.board.nextPiece, getLocale())}`
          : `<div class="desktop-field-heading">${identityMarkup}${statsMarkup}${shieldInventory}${nextPiecePreviewMarkup(participant.board.nextPiece, getLocale())}</div>`;
        return `
        <article class="hud-card ${mobileSoloMatch && index === 0 ? 'mobile-player-card' : ''} ${compactMobileAi ? 'mobile-ai-card' : ''} hud-palette-${identity.palette} ${participant.board.alive ? '' : 'is-out'} ${participant.board.active?.definition.source === 'anomaly' ? 'has-active-anomaly' : ''} ${senderRows ? 'is-conflict-sender' : ''} ${incomingRows ? 'is-conflict-target' : ''} ${impactRows ? 'is-conflict-impact' : ''} ${defended || shieldBlocked ? 'is-conflict-defense' : ''} ${cleanupRows ? 'is-cleaning' : ''} ${participant.shieldReady ? 'has-shield' : ''} ${participantEvent ? 'has-player-event' : ''}" style="--preview-atlas:url('${WORKSHOP_THEME_TEXTURES[participant.resolvedTileStyle].url}');--player-name-color:${playerAccentForSlot(index)};--sender-color:${senderAccent};${mobileStyle}" data-team="${identity.teamLabel ? identity.palette : ''}" data-tile-style="${participant.resolvedTileStyle}" data-next-piece="${participant.board.nextPiece.id}" data-active-y="${participant.board.active?.y ?? ''}" data-attack-rows="${senderRows}" data-incoming-rows="${incomingRows || impactRows}" data-event-kind="${participantEvent?.kind ?? ''}" data-shield-remaining-ms="${state.shieldPresentations.find(e => e.participantId === participant.config.id)?.remainingMs ?? 0}" data-shield-debt="${state.shieldPresentations.filter(e => e.participantId === participant.config.id).reduce((n,e) => n + e.deferredImpacts.reduce((m,i) => m + i.rows, 0), 0)}" data-gray-rows="${participant.board.grid.filter(row => row.some(cell => cell === 'garbage')).length}">
          <div class="wood-panel-shell" aria-hidden="true"></div><div class="wood-panel-foot" aria-hidden="true"></div>
          ${mobilePlayerMarkup}

          ${participantEvent ? `<span class="player-event-symbol" data-kind="${participantEvent.kind}" data-accent="${participantEvent.accent}" style="--event-duration:${participantEvent.lifetimeMs}ms" aria-hidden="true">${matchEventIconMarkup(participantEvent.icon)}</span><div class="match-event-plaque player-event-notice is-${noticeRegion}" data-kind="${participantEvent.kind}" data-accent="${participantEvent.accent}" style="--event-duration:${participantEvent.lifetimeMs}ms" role="status" aria-label="${escapeHtml([participantEvent.title, participantEvent.detail].filter(Boolean).join('. '))}">${matchEventPlaqueMarkup(participantEvent, participantEvent.template && participantEvent.values ? formatParticipantEventMarkup(participantEvent.template, participantEvent.values) : escapeHtml(participantEvent.title))}</div>` : ''}
          ${participant.board.alive ? '' : `<b class="out-label">${tr('eliminated').toLocaleUpperCase(getLocale())}</b>`}
        </article>
      `; }).join('');
    }
    const activeYKey = state.participants.map((participant) => participant.board.active?.y ?? '').join(',');
    if (hud && activeYKey !== this.lastActiveYKey) {
      this.lastActiveYKey = activeYKey;
      hud.querySelectorAll<HTMLElement>('.hud-card').forEach((card, index) => {
        card.dataset.activeY = String(state.participants[index]?.board.active?.y ?? '');
      });
    }
    const pendingMax = Math.max(0, ...(state.pendingConflict?.senders.map((sender) => sender.rows) ?? []));
    const impactMax = (state.conflictImpactEvent?.pulseMs ?? 0) > 0 ? state.conflictImpactEvent?.maxRows ?? 0 : 0;
    const globalEvent = globalMatchEvent(state, this.tuning.messages, getLocale());
    const chromeKey = `${getLocale()}:${state.phase}:${pauseKey}:${this.countdownReady}:${Math.ceil(state.countdownMs / 1000)}:${Math.ceil((Number.isFinite(state.durationMs) ? state.remainingMs : state.elapsedMs) / 1000)}:${state.gravityLevel}:${state.elapsedMs >= state.pressureStartMs}:${Math.ceil(Math.max(0, state.nextPressureAtMs - state.elapsedMs) / 1000)}:${globalEvent?.kind ?? ''}:${state.globalEventHold?.level ?? 0}:${pendingMax}:${impactMax}`;
    if (chromeKey === this.lastChromeKey) return;
    this.lastChromeKey = chromeKey;
    const countdown = this.root.querySelector<HTMLElement>('#countdown');
    if (countdown) {
      countdown.hidden = state.phase !== 'countdown' || !this.countdownReady;
      countdown.textContent = String(Math.max(1, Math.ceil(state.countdownMs / 1000)));
    }
    const pause = this.root.querySelector<HTMLElement>('#pause-overlay');
    const manuallyPaused = state.pauseReasons.includes('manual');
    const hiddenPaused = state.pauseReasons.includes('hidden');
    if (pause) pause.hidden = state.phase !== 'paused';
    const pauseTitle = this.root.querySelector<HTMLElement>('#pause-title');
    if (pauseTitle) pauseTitle.textContent = localeText(manuallyPaused ? 'pausedTitle' : 'suspendedTitle');
    const pauseCopy = this.root.querySelector<HTMLElement>('#pause-copy');
    const mobileMatch = this.root.querySelector('.mobile-solo-arena') !== null;
    this.root.querySelector<HTMLElement>('.arena-screen')?.classList.toggle('is-mobile-pause-open', mobileMatch && state.phase === 'paused');
    if (pauseCopy) {
      pauseCopy.hidden = manuallyPaused && !hiddenPaused;
      pauseCopy.textContent = manuallyPaused
        ? hiddenPaused ? localeText('pauseHiddenManual') : ''
        : localeText('pauseHiddenAuto');
    }
    const continueButton = this.root.querySelector<HTMLButtonElement>('#continue-match');
    if (continueButton) continueButton.hidden = !manuallyPaused;
    const pauseActions = this.root.querySelector<HTMLElement>('#manual-pause-actions');
    if (pauseActions) pauseActions.hidden = !manuallyPaused;
    if (manuallyPaused && this.router.current() === 'arena') {
      this.router.open('pause', 'arena');
      this.activateMenuFocus('pause');
    } else if (!manuallyPaused && (this.router.current() === 'pause' || this.router.current() === 'settings')) {
      this.router.open('arena');
      this.menuFocus.suspend();
    }
    const pauseButton = this.root.querySelector<HTMLButtonElement>('#manual-pause');
    if (pauseButton) {
      pauseButton.disabled = state.phase === 'results';
      pauseButton.setAttribute('aria-pressed', String(manuallyPaused));
      pauseButton.setAttribute('aria-label', localeText(manuallyPaused ? 'resumeMatchAria' : 'pauseMatchAria'));
      pauseButton.classList.toggle('is-paused', manuallyPaused);
      const icon = pauseButton.querySelector('span');
      const label = pauseButton.querySelector('b');
      if (pauseButton.classList.contains('mobile-match-action')) pauseButton.querySelector('span')!.textContent = manuallyPaused ? '▶' : 'Ⅱ';
      if (icon) icon.textContent = manuallyPaused ? '▶' : 'Ⅱ';
      if (label) label.textContent = localeText(manuallyPaused ? 'journeyContinue' : 'pauseShort').toLocaleUpperCase(getLocale());
    }
    const eventNotice = this.root.querySelector<HTMLElement>('#arena-event-notice');
    if (eventNotice) {
      eventNotice.hidden = !globalEvent;
      eventNotice.parentElement?.classList.toggle('is-active', Boolean(globalEvent));
      if (globalEvent) {
        eventNotice.dataset.event = `${state.finalPushSerial}:${state.levelUpEvent?.serial ?? 0}:${globalEvent.kind}`;
        eventNotice.dataset.kind = globalEvent.kind;
        eventNotice.dataset.accent = globalEvent.accent;
        eventNotice.style.setProperty('--event-duration', `${globalEvent.lifetimeMs}ms`);
        eventNotice.setAttribute('aria-label', [globalEvent.title, globalEvent.detail].filter(Boolean).join('. '));
        eventNotice.innerHTML = matchEventPlaqueMarkup(globalEvent);
      } else {
        eventNotice.removeAttribute('aria-label');
        eventNotice.innerHTML = '';
      }
    }
    const status = this.root.querySelector<HTMLElement>('#match-status');
    if (status) {
      status.hidden = state.isSurvival && state.phase === 'playing';
      status.textContent = state.phase === 'playing' ? localeText('levelShort', { level: state.gravityLevel + 1 }) : localeText(state.phase === 'countdown' ? 'preparingShort' : state.phase === 'paused' ? 'pauseShort' : 'finishShort');
    }
    const roundTimer = this.root.querySelector<HTMLElement>('#round-timer');
    const mobileMatchTimer = this.root.querySelector<HTMLElement>('#mobile-match-timer');
    const clockPresentation = matchClockPresentation(!Number.isFinite(state.durationMs), state.elapsedMs, state.remainingMs, getLocale());
    if (roundTimer) {
      const clock = roundTimer.querySelector<HTMLElement>('#match-clock');
      const clockLabel = roundTimer.querySelector<HTMLElement>('small');
      if (clock) clock.textContent = formatClock(clockPresentation.milliseconds);
      if (clockLabel) clockLabel.textContent = clockPresentation.label;
      roundTimer.setAttribute('aria-label', clockPresentation.ariaLabel);
      const isFinalPhase = state.elapsedMs >= state.pressureStartMs;
      roundTimer.classList.toggle('is-final', isFinalPhase);
    }
    if (mobileMatchTimer) {
      mobileMatchTimer.textContent = formatClock(clockPresentation.milliseconds);
      mobileMatchTimer.setAttribute('aria-label', clockPresentation.ariaLabel);
      mobileMatchTimer.classList.toggle('is-final', state.elapsedMs >= state.pressureStartMs);
    }
    const pressure = this.root.querySelector<HTMLElement>('#pressure-status');
    if (pressure) {
      const inPressure = state.elapsedMs >= state.pressureStartMs && state.phase === 'playing';
      pressure.textContent = inPressure
        ? localeText('pressureNext', { time: formatClock(Math.max(0, state.nextPressureAtMs - state.elapsedMs)) })
        : localeText('autoPauseTab');
      pressure.classList.toggle('is-pressure', inPressure);
    }
  }

  private showResults(state: MatchState): void {
    const layer = this.root.querySelector<HTMLElement>('#results-layer');
    if (!layer) return;
    this.router.open('results', 'main-menu');
    const ordered = [...state.participants].sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99));
    const survival = state.isSurvival;
    const soloSurvival = survival && state.participants.length === 1;
    const simultaneous = state.endReason === 'simultaneous-elimination';
    const teamBattle = state.options.matchVariant === 'teams';
    const resultTitle = simultaneous ? localeText('resultsSimultaneous')
      : teamBattle && state.options.battleTimeMode === 'until-victory' ? localeText('resultsLastTeam')
      : localeText('resultsLastSurvivor');
    const finishedAt = Date.now();
    const survivalResult = survival ? saveSurvivalRecords(state.participants.map((participant) => ({
      name: participant.config.label,
      elapsedMs: participant.survivalMs,
      lineScore: participant.score,
      finishedAt,
      placedPieces: participant.placedPieces,
    }))) : null;
    if (survival) {
      this.ratings.outbox.enqueue(state.participants.map(participant => ({ name: participant.config.label,
        lineScore: participant.score, elapsedMs: Math.round(participant.survivalMs), finishedAt })));
      void this.ratings.outbox.flush().catch(() => undefined);
    }
    const currentRecordIds = new Set(survivalResult?.rankedIds ?? []);
    const teamSummary = state.options.matchVariant === 'teams'
      ? teamScores(state.participants.map((participant, index) => ({ id: participant.config.id, score: participant.score, alive: participant.board.alive, teamId: teamIdForSlot(index) ?? undefined })))
      : [];
    layer.innerHTML = `
      <section class="results-panel ${survival ? 'survival-results-panel' : ''}" aria-labelledby="results-title">
        ${survival ? '' : `<p class="eyebrow">${state.endReason === 'timeout' ? tr('resultsTimeout').toLocaleUpperCase(getLocale()) : escapeHtml(resultTitle.toLocaleUpperCase(getLocale()))}</p>`}
        <h2 id="results-title">${survival ? tr('resultsTitle') : state.endReason === 'timeout' ? tr('resultsTimeout') : escapeHtml(resultTitle)}</h2>
        ${simultaneous ? `<p class="survival-result-copy">${tr('resultsSimultaneousHint')}</p>` : ''}
        ${survival ? `<div class="survival-results-columns"><section class="survival-current-results ${soloSurvival ? 'is-solo' : ''}" aria-labelledby="match-results-heading"><h3 id="match-results-heading">${tr('currentMatch')}</h3><ol class="results-list survival-match-results">${ordered.map((participant) => `<li class="${soloSurvival ? '' : `place-${participant.placement}`}" style="--player-name-color:${playerAccentForSlot(state.participants.indexOf(participant))}">${soloSurvival ? '' : `<span class="result-place">#${participant.placement}</span>`}<span><strong>${!soloSurvival && state.winnerIds.includes(participant.config.id) ? '♛ ' : ''}${escapeHtml(this.participantDisplayName(participant.config))}</strong><small class="result-controller">${controllerIcon(participant.config.controller, getLocale())}${escapeHtml(this.controllerLabel(participant.config))} · ${formatDuration(participant.survivalMs)}</small></span><time>${participant.score.toLocaleString(getLocale())}</time></li>`).join('')}</ol></section><section class="survival-local-records" aria-labelledby="local-records-heading"><h3 id="local-records-heading">${tr('recordsTitle')}</h3><ol class="results-list survival-record-list">${survivalResult?.records.map((record) => `<li class="${currentRecordIds.has(record.id) ? 'is-current-record' : ''}"><span class="result-place">#${1 + survivalResult.records.filter((other) => other.lineScore > record.lineScore).length}</span><span class="record-identity"><strong>${escapeHtml(record.name)}</strong></span><span class="record-metrics"><time>${record.lineScore.toLocaleString(getLocale())}</time><span class="record-secondary">${recordDateMarkup(record.finishedAt, getLocale())}<small class="record-duration" aria-label="${tr('survivalTimeAria', { time: formatDuration(record.elapsedMs).slice(0, -2) })}">◷ ${formatDuration(record.elapsedMs).slice(0, -2)}</small></span></span></li>`).join('')}</ol></section></div>` : ''}
        ${teamSummary.length ? `<div class="team-results">${teamSummary.map((team) => {
          const members = state.participants.filter((_participant, index) => teamIdForSlot(index) === team.teamId);
          const winner = members.some((participant) => state.winnerIds.includes(participant.config.id));
          return `<p class="${winner ? 'is-winner' : ''}">${winner ? '♛ ' : ''}${team.teamId === 'team-1' ? tr('teamSun') : tr('teamSky')} · ${(simultaneous ? team.score * 2 : team.score).toLocaleString(getLocale())}<small>${members.map((participant) => { const memberIndex = state.participants.indexOf(participant); return `<span style="--player-name-color:${playerAccentForSlot(memberIndex)}">${escapeHtml(this.participantDisplayName(participant.config))}</span>: ${participant.score.toLocaleString(getLocale())}${participant.board.alive || simultaneous ? '' : ' ×½'}`; }).join(' · ')}</small></p>`;
        }).join('')}</div>` : ''}
        ${survival ? '' : `<ol class="results-list">
          ${ordered.map((participant) => `
            <li class="place-${participant.placement} ${participant.board.alive ? '' : 'is-eliminated'}" style="--player-name-color:${playerAccentForSlot(state.participants.indexOf(participant))}">
              <span class="result-place">#${participant.placement}</span>
              <span><strong>${state.winnerIds.includes(participant.config.id) ? '♛ ' : ''}${escapeHtml(this.participantDisplayName(participant.config))}${participant.board.alive ? '' : ` (${tr('eliminated')})`}</strong><small class="result-controller">${controllerIcon(participant.config.controller, getLocale())}${escapeHtml(this.controllerLabel(participant.config))} · ${formatPieces(participant.placedPieces, getLocale())} · ${formatDuration(participant.survivalMs)}</small></span>
              <time>${participant.score.toLocaleString(getLocale())}</time>
            </li>
          `).join('')}
        </ol>`}
        <div class="results-actions" style="visibility:hidden" aria-hidden="true"><button disabled id="play-again" class="primary-button" type="button"><span>${tr('replay')}</span><b>↻</b></button><button disabled id="results-main-menu" type="button">${tr('menu')}</button></div>
      </section>
    `;
    const ratingPanel = layer.querySelector<HTMLElement>('.survival-local-records');
    if (ratingPanel) this.ratings.mount(ratingPanel, () => state.participants.map(p => p.config.label), () => this.menuFocus.resultsInputReady());
    layer.querySelector('#play-again')?.addEventListener('click', () => {
      if (!this.menuFocus.resultsInputReady()) return;
      this.audio.playUiSelect();
      this.destroyGame();
      this.startMatch();
    });
    layer.querySelector('#results-main-menu')?.addEventListener('click', () => {
      if (!this.menuFocus.resultsInputReady()) return;
      this.audio.playUiSelect();
      this.destroyGame();
      this.router.open('main-menu');
      this.renderMainMenu();
    });
    this.menuFocus.protectResults(() => {
      const actions = layer.querySelector<HTMLElement>('.results-actions');
      if (!actions) return;
      actions.style.visibility = '';
      actions.removeAttribute('aria-hidden');
      actions.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; });
    });
    this.activateMenuFocus('results');
  }

  private async showReleaseHistory(launcher: HTMLButtonElement): Promise<void> {
    if (this.root.querySelector('[data-release-history]')) return;
    const screen = this.router.current();
    const request = new AbortController();
    const backdrop = document.createElement('div'); backdrop.className = 'profile-choice-backdrop';
    backdrop.innerHTML = `<section class="release-panel release-history" data-release-history role="dialog" aria-modal="true" aria-labelledby="release-history-title"><h2 id="release-history-title">${tr('releaseHistory')}</h2><p role="status">${tr('historyLoading')}</p><div class="release-history-list" data-history-scroll data-ui-focus tabindex="0" role="region" aria-labelledby="release-history-title"></div><button type="button" data-history-back data-ui-focus>${tr('historyClose')}</button><footer class="preferences-guidance-footer">${gamepadFooterHintsMarkup()}</footer></section>`;
    const close = () => {
      request.abort(); backdrop.remove(); this.activateMenuFocus(screen);
      const items = Array.from(this.root.querySelectorAll<HTMLElement>(`[data-screen="${screen}"] [data-ui-focus]:not([disabled])`))
        .filter(item => item.getClientRects().length > 0 && !item.hidden && !item.closest('[hidden]'));
      this.menuFocus.activate(screen, Math.max(0, items.indexOf(launcher)));
      if (items.includes(launcher)) launcher.focus({ preventScroll: true });
    };
    backdrop.querySelector('[data-history-back]')?.addEventListener('click', close);
    this.root.append(backdrop); this.activateMenuFocus(screen);
    try {
      const rows: ReleaseHistoryRow[] = desktop ? await desktop.history(getLocale()) : await webReleaseHistory(getLocale(),request.signal);
      if (!backdrop.isConnected) return;
      const list = backdrop.querySelector('.release-history-list')!;
      backdrop.querySelector('[role="status"]')!.textContent = rows.length ? '' : localeText('historyNotesUnavailable');
      for (const row of rows.filter(row => row.component !== 'shell')) {
        const article = document.createElement('article'); const heading = document.createElement('h3');
        const version = row.version;
        heading.textContent = `${version}${row.installed ? ' · ' + localeText('historyInstalled') : ''}${row.date ? ' · ' + new Date(row.date).toLocaleDateString(getLocale()) : ''}`;
        const notes = document.createElement('pre'); notes.textContent = row.notesUnavailable === 'installed' ? localeText('historyInstalledUnavailable') : row.notesUnavailable === 'release' ? localeText('historyNotesUnavailable') : row.text; article.append(heading,notes);
        if (row.fallback) { const fallback = document.createElement('p'); fallback.textContent = localeText('historyFallback'); article.append(fallback); }
        list.append(article);
      }
    } catch { if (backdrop.isConnected) backdrop.querySelector('[role="status"]')!.textContent = localeText('historyUnavailable'); }
  }

  private async previewDisplay(value: import('../platform/desktop').DisplayPreferences): Promise<void> {
    if (!desktop || this.root.querySelector('[data-display-confirm]')) return;
    this.desktopDisplay = await desktop.setDisplay(value);
    const backdrop = document.createElement('div'); backdrop.className = 'profile-choice-backdrop';
    backdrop.innerHTML = `<section class="release-panel profile-choice" data-display-confirm role="dialog" aria-modal="true" aria-labelledby="display-confirm-title"><h2 id="display-confirm-title">${tr('keepDisplay')}</h2><p>${tr('keepDisplayHint')}</p><button data-display-yes type="button" data-ui-focus>${tr('keep')}</button><button data-display-no type="button" data-ui-focus>${tr('revert')}</button></section>`;
    this.root.append(backdrop);
    const restoreDialogs = suspendOtherDialogs(this.root, backdrop.querySelector<HTMLElement>('[data-display-confirm]')!);
    let finished = false;
    const finish = async (confirm: boolean) => {
      if (finished) return; finished = true; window.clearTimeout(timer);
      this.desktopDisplay = await desktop!.confirmDisplay(confirm); backdrop.remove(); restoreDialogs();
      this.refreshPreferenceScreen();
      this.network?.activateNavigation();

    };
    const timer = window.setTimeout(() => { void finish(false); }, 15000);
    backdrop.querySelector('[data-display-yes]')?.addEventListener('click', () => { void finish(true); });
    backdrop.querySelector('[data-display-no]')?.addEventListener('click', () => { void finish(false); });
    if(this.network)this.network.activateNavigation();else this.activateMenuFocus('settings');
    backdrop.querySelector<HTMLButtonElement>('[data-display-yes]')?.focus({ preventScroll: true });
  }

  private networkPreferencesClose?: () => void;
  private openNetworkPreferences(onClose: () => void): void {
    this.networkPreferencesClose=onClose;
    const backdrop=document.createElement('div');backdrop.className='profile-choice-backdrop';
    const panel=document.createElement('section');panel.className='release-panel pause-panel pause-settings-panel';panel.dataset.networkPreferences='';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');backdrop.append(panel);this.root.append(backdrop);
    const restoreDialogs = suspendOtherDialogs(this.root, panel);
    this.networkPreferencesClose=()=>{backdrop.remove();restoreDialogs();onClose();};
    this.renderPausePreferences(panel,this.networkPreferencesClose);
  }

  private refreshPreferenceScreen(): void {
    const panel=this.root.querySelector<HTMLElement>('[data-network-preferences]');
    if(panel) this.renderPausePreferences(panel,()=>{panel.parentElement?.remove();this.networkPreferencesClose?.();});
    else if(this.game) this.renderPausePreferences(); else this.renderSettings();
  }

  private renderPausePreferences(panel = this.root.querySelector<HTMLElement>('#pause-settings-panel'), onBack = () => this.navigateBack()): void {
    if (!panel) return;
    panel.classList.add('pause-preferences-grid');
    panel.setAttribute('aria-labelledby', 'pause-settings-title');
    if (!panel.hasAttribute('data-network-preferences')) this.root.querySelector('#pause-overlay')?.setAttribute('aria-labelledby', 'pause-settings-title');
    panel.innerHTML = `<h2 id="pause-settings-title">${tr('settings')}</h2><div class="pause-preferences-scroll"><div class="pause-preferences-columns"><div class="pause-preferences-column">${languageSettingsMarkup()}<section class="release-panel pause-preferences-card pause-audio-card"><h3>${tr('soundTitle')}</h3>${this.setupAudioMarkup()}</section></div><div class="pause-preferences-column"><section class="release-panel pause-preferences-card pause-display-card"><h3>${tr('display')}</h3>
      ${desktop ? `<label class="settings-action"><span>${tr('resolution')}</span><select data-pause-resolution><option value="auto" ${this.desktopDisplay.auto ? 'selected' : ''}>${tr('resolutionAuto')}</option>${(this.desktopDisplay.resolutions ?? [[1280,720]]).map(([w,h]) => `<option value="${w}x${h}" ${!this.desktopDisplay.auto && w === this.desktopDisplay.width && h === this.desktopDisplay.height ? 'selected' : ''}>${w} × ${h}</option>`).join('')}</select></label><label class="settings-action"><span>${tr('windowMode')}</span><select data-pause-window><option value="windowed" ${!this.desktopDisplay.fullscreen ? 'selected' : ''}>${tr('windowed')}</option><option value="fullscreen" ${this.desktopDisplay.fullscreen ? 'selected' : ''}>${tr('fullscreen')}</option></select></label>` : `<button type="button" data-pause-fullscreen>${tr('fullscreen')}</button>`}
      <label class="settings-action"><span>${tr('calm')}</span><input data-pause-calm type="checkbox" ${this.releaseSettings.calmEffects ? 'checked' : ''} /></label>${this.displayPreferencesMarkup()}</section>${this.stickPreferencesMarkup()}</div></div></div><div class="pause-preferences-actions"><button id="pause-settings-back" ${panel.hasAttribute('data-network-preferences') ? 'data-network-prefs-back' : ''} type="button">← ${tr('backPause')}</button>${footerResetButtonMarkup()}</div><footer class="preferences-guidance-footer"><div class="release-footer-actions">${gamepadFooterAction('select', 'confirm')}${gamepadFooterAction('back', 'back')}</div><output data-preferences-status role="status"></output></footer>`;
    panel.querySelector('#pause-settings-back')?.addEventListener('click', onBack);
    panel.querySelector('[data-pause-calm]')?.addEventListener('change', event => { this.releaseSettings.calmEffects = (event.target as HTMLInputElement).checked; document.body.classList.toggle('calm-effects', this.releaseSettings.calmEffects); this.persistPreferences(); });
    panel.querySelector('[data-pause-fullscreen]')?.addEventListener('click', () => { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => { const status = panel.querySelector('[data-preferences-status]'); if (status) status.textContent = localeText('displayFailed'); }); });
    const change = () => { const resolution = panel.querySelector<HTMLSelectElement>('[data-pause-resolution]')?.value ?? 'auto'; const [width = 1280,height = 720] = resolution.split('x').map(Number); void this.previewDisplay({ width,height, auto: resolution === 'auto', fullscreen: panel.querySelector<HTMLSelectElement>('[data-pause-window]')?.value === 'fullscreen' }); };
    panel.querySelector('[data-pause-resolution]')?.addEventListener('change', change); panel.querySelector('[data-pause-window]')?.addEventListener('change', change);
    this.bindVolumeControl(); this.bindPreferenceExtras(); this.bindLanguageSelector(); enhanceMenuSelects(panel); if (!panel.hasAttribute('data-network-preferences')) this.activateMenuFocus('settings'); else panel.querySelectorAll<HTMLElement>('button,input,select').forEach(el=>{if(!el.hidden)el.dataset.uiFocus='';});
  }

  private bindLanguageSelector(): void {
    this.root.querySelectorAll<HTMLSelectElement>('[data-language]').forEach(select => select.addEventListener('change', () => {
      if (!LOCALES.includes(select.value as Locale)) return;
      if (!this.game && !this.root.querySelector('[data-network-preferences]')) {
        const trigger = this.root.querySelector<HTMLElement>('.settings-language-section [data-menu-select-trigger]');
        const items = Array.from(this.root.querySelectorAll<HTMLElement>('[data-ui-focus]:not([disabled])')).filter(item => item.getClientRects().length > 0 && !item.hidden && !item.closest('[hidden]') && item.getAttribute('aria-hidden') !== 'true');
        this.router.rememberSelection('settings', Math.max(0, items.indexOf(trigger!)));
      }
      const saved = setLocale(select.value as Locale);
      this.refreshPreferenceScreen();
      if (this.game) {
        const labels = { 'continue-match': 'journeyContinue', 'restart-match': 'journeyRestart', 'pause-settings': 'settings', 'return-to-menu': 'menu', 'viewport-warning': 'viewportWarning' } as const;
        for (const [id, key] of Object.entries(labels)) { const element = this.root.querySelector(`#${id}`); if (element) element.textContent = localeText(key); }
        this.root.querySelector('#countdown')?.setAttribute('aria-label', localeText('countdownAria'));
        this.root.querySelector('[data-mobile-touch-zones]')?.setAttribute('aria-label', localeText('mobileTouchAria'));
      }
      const status = this.root.querySelector<HTMLOutputElement>('[data-language-status]');
      if (status) status.textContent = saved ? '' : localeText('saveFailed');
      this.root.querySelector<HTMLElement>('.settings-language-section [data-menu-select-trigger]')?.focus({ preventScroll: true });
    }));
  }

  private persistPreferences(): boolean {
    const saved = saveReleaseSettings(this.releaseSettings);
    const status = this.root.querySelector<HTMLOutputElement>('[data-preferences-status]');
    if (status) status.textContent = saved ? '' : localeText('saveFailed');
    return saved;
  }

  private displayPreferencesMarkup(): string {
    return `<label class="settings-action"><span><strong>${tr('aa')}</strong><small>${tr('nextMatch')}</small></span><input data-preference-aa type="checkbox" ${this.releaseSettings.antialias ? 'checked' : ''} /></label><label class="settings-action settings-fps"><span><strong>${tr('fps')}</strong><small>${tr('fpsHint')}</small></span><select data-preference-fps>${[0,30,60,120].map(value => `<option value="${value}" ${this.releaseSettings.fpsLimit === value ? 'selected' : ''}>${value ? tr('fpsValue', { value }) : tr('unlimited')}</option>`).join('')}</select></label>`;
  }

  private stickPreferencesMarkup(showHelp = false): string {
    return `<section class="release-panel settings-section settings-stick-section preference-inputs"><header><span class="settings-icon settings-icon-gamepad" aria-hidden="true">${showHelp ? menuGlyph('gamepad') : '🎮'}</span><div><p class="eyebrow">${tr('controls')}</p><h2>${tr('stick')}</h2></div></header><p class="settings-section-note">${tr('dpadHint')}</p>
      <label class="volume-control"><span>${tr('sensitivity')}</span><input data-stick="stickSensitivity" type="range" min="50" max="200" step="5" value="${Math.round(this.releaseSettings.stickSensitivity * 100)}" /><output>${Math.round(this.releaseSettings.stickSensitivity * 100)}%</output></label>
      <label class="volume-control"><span>${tr('deadzone')}</span><input data-stick="stickDeadzone" type="range" min="0" max="50" step="1" value="${Math.round(this.releaseSettings.stickDeadzone * 100)}" /><output>${Math.round(this.releaseSettings.stickDeadzone * 100)}%</output></label>${showHelp ? `<button id="open-controls" class="settings-controls-help" type="button">${settingsActionIcon('controls')}<span>${tr('controlsHelp')}</span><b aria-hidden="true">›</b></button>` : ''}</section>`;
  }

  private bindPreferenceExtras(): void {
    this.root.querySelector<HTMLInputElement>('[data-preference-aa]')?.addEventListener('change',event=>{this.releaseSettings.antialias=(event.target as HTMLInputElement).checked;this.persistPreferences();});
    this.root.querySelector<HTMLSelectElement>('[data-preference-fps]')?.addEventListener('change',event=>{this.releaseSettings.fpsLimit=Number((event.target as HTMLSelectElement).value);this.persistPreferences();});
    this.root.querySelectorAll<HTMLInputElement>('[data-stick]').forEach(input => input.addEventListener('input', () => {
      const key = input.dataset.stick as 'stickSensitivity' | 'stickDeadzone';
      this.releaseSettings[key] = Number(input.value) / 100;
      const output = input.parentElement?.querySelector('output'); if (output) output.textContent = `${input.value}%`;
      this.persistPreferences();
    }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-reset-preferences]').forEach(button => button.addEventListener('click', () => {
      for (const key of ['master', 'music', 'effects'] as const) this.releaseSettings[key] = DEFAULT_RELEASE_SETTINGS[key];
      this.releaseSettings.musicDirection = DEFAULT_RELEASE_SETTINGS.musicDirection;
      this.releaseSettings.sfxDirection = DEFAULT_RELEASE_SETTINGS.sfxDirection;
      this.audio.setDirections(this.releaseSettings.musicDirection, this.releaseSettings.sfxDirection);
      this.audio.setMasterVolume(this.releaseSettings.master);
      this.audio.setMusicVolume(this.releaseSettings.music);
      this.audio.setEffectsVolume(this.releaseSettings.effects);
      this.releaseSettings.stickSensitivity = 1;
      this.releaseSettings.stickDeadzone = 0;
      this.releaseSettings.antialias = true;
      this.releaseSettings.fpsLimit = 0;
      this.releaseSettings.calmEffects = false;
      document.body.classList.remove('calm-effects');
      if (desktop) void this.previewDisplay({ width: 1280, height: 720, fullscreen: false, auto: true });
      this.refreshPreferenceScreen();
      this.persistPreferences();
    }));
  }

  private setupAudioMarkup(): string {
    const master = Math.round(this.audio.getMasterVolume() * 100);
    const music = Math.round(this.audio.getMusicVolume() * 100);
    const effects = Math.round(this.audio.getEffectsVolume() * 100);
    return `
      <div class="setup-audio-controls">
        <label class="volume-control" for="master-volume"><span>${tr('master')}</span><input id="master-volume" type="range" min="0" max="100" step="1" value="${master}" aria-label="${tr('masterAria')}" /><output id="master-volume-value">${master}%</output></label>
        <label class="volume-control" for="music-volume">
          <span>${tr('music')}</span>
          <input id="music-volume" type="range" min="0" max="100" step="1" value="${music}" aria-label="${tr('musicAria')}" />
          <output id="music-volume-value" for="music-volume">${music}%</output>
        </label>
        <label class="volume-control" for="effects-volume">
          <span>${tr('effects')}</span>
          <input id="effects-volume" type="range" min="0" max="100" step="1" value="${effects}" aria-label="${tr('effectsAria')}" />
          <output id="effects-volume-value" for="effects-volume">${effects}%</output>
        </label>
      </div>
    `;
  }

  private audioPrototypeGalleryMarkup(): string {
    const batch = (category: AudioPreviewCategory, title: string, directions: readonly { id: string; label: string }[]) => `<section class="release-panel audio-prototype-gallery"><header><p class="eyebrow">${tr('prototypeEyebrow')}</p><h2>${escapeHtml(title)}</h2></header><div class="audio-prototype-buttons">${directions.map((direction) => `<button type="button" data-audio-preview="${category}" data-audio-direction="${direction.id}"><strong>${escapeHtml(direction.label)}</strong><small>▶ ${tr('prototypeListen')}</small></button>`).join('')}</div></section>`;
    const sfx = SFX_PACK_OPTIONS.filter(pack => pack.id === 'soft-toy');
    return `<section class="audio-prototype-wrap" aria-label="${tr('prototypeAria')}">
      ${batch('gameplay-music', localeText('prototypeGameplay'), MUSIC_DIRECTIONS)}
      ${batch('menu-music', localeText('prototypeMenu'), MUSIC_DIRECTIONS.map((direction) => ({ id: direction.id, label: localeText(({ 'neon-workshop':'menuMusicNeon','toybox-tactics':'menuMusicToybox','arcade-skyline':'menuMusicArcade','glass-gravity':'menuMusicGlass','brickbeat':'menuMusicBrickbeat' } as const)[direction.id]) })))}
      ${batch('tactile', localeText('prototypeTactile'), sfx)}
      ${batch('rewards', localeText('prototypeRewards'), sfx)}
      ${batch('threats', localeText('prototypeThreats'), sfx)}
      ${batch('defenses', localeText('prototypeDefenses'), sfx)}
    </section>`;
  }

  private bindAudioPrototypeGallery(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-audio-preview]').forEach((button) => {
      button.addEventListener('click', async () => {
        const category = button.dataset.audioPreview as AudioPreviewCategory;
        const direction = button.dataset.audioDirection ?? '';
        this.audio.unlock();
        if (category === 'gameplay-music' || category === 'menu-music') {
          this.releaseSettings.musicDirection = direction as MusicDirectionId;
        } else if (isSfxPresetId(direction)) {
          const active = await this.audio.setSfxPreset(direction);
          this.releaseSettings.sfxPreset = active;
          const select = this.root.querySelector<HTMLSelectElement>('#sfx-preset');
          if (select && select.value !== active) {
            select.value = active;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        this.audio.setDirections(this.releaseSettings.musicDirection, this.releaseSettings.sfxDirection);
        this.audio.playPrototype(category, category === 'gameplay-music' || category === 'menu-music' ? direction as MusicDirectionId : undefined);
        this.persistPreferences();
      });
    });
  }

  private bindMenuAudioUnlock(): void {
    const unlock = (): void => {
      this.root.removeEventListener('pointerdown', unlock);
      this.root.removeEventListener('keydown', unlock);
      this.audio.unlock();
      this.audio.enterMenu();
      this.refreshAudioButtons();
    };
    this.root.addEventListener('pointerdown', unlock);
    this.root.addEventListener('keydown', unlock);
  }

  private bindAudioToggle(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.audio-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        if (this.startupMuted) {
          this.refreshAudioButtons();
          return;
        }
        this.audio.unlock();
        this.audio.toggleMuted();
        this.releaseSettings.muted = this.audio.isMuted();
        this.persistPreferences();
        this.refreshAudioButtons();
      });
    });
  }

  private bindVolumeControl(): void {
    const bind = (kind: 'master' | 'music' | 'effects'): void => {
      const slider = this.root.querySelector<HTMLInputElement>(`#${kind}-volume`);
      const output = this.root.querySelector<HTMLOutputElement>(`#${kind}-volume-value`);
      if (!slider || !output) return;
      slider.addEventListener('input', () => {
        this.audio.unlock();
        const value = Number(slider.value) / 100;
        const normalized = kind === 'master' ? this.audio.setMasterVolume(value) : kind === 'music' ? this.audio.setMusicVolume(value) : this.audio.setEffectsVolume(value);
        const percentage = Math.round(normalized * 100);
        this.releaseSettings[kind] = normalized;
        this.persistPreferences();
        slider.value = String(percentage);
        output.value = `${percentage}%`;
        output.textContent = `${percentage}%`;
      });
    };
    bind('master');
    bind('music');
    bind('effects');
  }

  private refreshAudioButtons(): void {
    const enabled = !this.audio.isMuted();
    this.root.querySelectorAll<HTMLButtonElement>('.audio-toggle').forEach((button) => {
      button.textContent = `♪ ${localeText('sound')} ${enabled ? localeText('on') : localeText('off')}`;
      button.setAttribute('aria-label', enabled ? localeText('mute') : localeText('unmute'));
      button.setAttribute('aria-pressed', String(enabled));
    });
  }

  private aiRoleLabel(config: ParticipantConfig): string {
    return localeText(({ easy: 'aiEasy', medium: 'aiMedium', hard: 'aiHard', expert: 'aiExpert' } as const)[config.difficulty ?? 'medium']);
  }

  private participantDisplayName(config: ParticipantConfig): string {
    return config.controller === 'ai' && config.label === 'ИИ' ? localeText('aiLabel') : config.label;
  }

  private controllerLabel(config: ParticipantConfig): string {
    if (config.controller === 'human-1') return localeText('keyboardWasd');
    if (config.controller === 'human-2') return localeText('keyboardArrows');
    if (isGamepadController(config.controller)) return localizedGamepadName(Number(config.controller.slice('gamepad-'.length)));
    if (config.controller === 'mobile-touch') return localeText('touchController');
    const labels: Record<AiDifficulty, string> = {
      easy: localeText('aiEasy'),
      medium: localeText('aiMedium'),
      hard: localeText('aiHard'),
      expert: localeText('aiExpert'),
    };
    return `${localeText('aiLabel')} · ${labels[config.difficulty ?? 'medium']}`;
  }

  private createSeed(): number {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] ?? 1;
  }

  private destroyGame(): void {
    this.matchLoading?.cancel();
    this.matchLoading = null;
    if (this.router.current() === 'results') this.menuFocus.suspend();
    this.mobileInputCleanup?.(); this.mobileInputCleanup = null;
    this.game?.destroy(true);
    this.game = null;
    this.resumePausedMatch = null;
    this.lastHudKey = '';
    this.lastActiveYKey = '';
    this.lastChromeKey = '';
  }

  private showPauseSettings(open: boolean): void {
    const menu = this.root.querySelector<HTMLElement>('#pause-menu-panel');
    const settings = this.root.querySelector<HTMLElement>('#pause-settings-panel');
    if (!menu || !settings) return;
    this.root.querySelector('#pause-overlay')?.setAttribute('aria-labelledby', open ? 'pause-settings-title' : 'pause-title');
    menu.hidden = open;
    settings.hidden = !open;
    if (open) { this.router.open('settings', 'pause'); this.renderPausePreferences(); }
    else this.router.open('pause', 'arena');
    this.activateMenuFocus(open ? 'settings' : 'pause');
  }
}
