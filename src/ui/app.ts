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
import controlsGamepadPanelUrl from '../assets/controls-gamepad-panel.webp';
import { GameAudio } from '../audio/GameAudio';
import { MUSIC_DIRECTIONS, type AudioPreviewCategory, type MusicDirectionId } from '../audio/audioDirections';
import { isSfxPresetId, SFX_PACK_OPTIONS, type SfxPresetId } from '../audio/sfxPresets';
import { AiController } from '../controllers/ai';
import { HumanInputRouter } from '../controllers/input';
import { connectedGamepads, type ConnectedGamepad, type GamepadControls } from '../controllers/gamepads';
import { mobileTouchActionAt, type MobileTouchAction } from '../controllers/mobileTouchZones';
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
import { DEFAULT_TILE_STYLE_SELECTION, TILE_STYLES } from '../domain/tileStyles';
import { PlayScene } from '../rendering/PlayScene';
import type { ArenaLayout } from '../rendering/arenaLayout';
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
import { hudIdentityForParticipant, playerAccentForSlot } from './hudIdentity';
import {
  loadPlayerNames,
  normalizePlayerName,
  savePlayerNames,
} from './playerNamePersistence';
import { startsMutedForPlaytest } from './playtestParams';
import { GamepadProfiles, gamepadDescription } from './gamepadProfiles';
import { gamepadDestination, moveGamepad } from './gamepadRoster';
import { loadSlotSelections, saveSlotSelections, type SlotSelection } from './slotPersistence';
import { loadMatchOptionSelections } from './matchOptionsPersistence';
import { loadBattleSetup, loadSetupTileStyles, saveMatchSetup } from './matchSetupPersistence';
import { formatBuildInfo } from './buildInfo';
import { loadGameTuning, resetGameTuning, saveGameTuning } from './gameTuningPersistence';
import { PlayerEventRegionLatch } from './playerEventPlacement';
import { participantLevelUpNoticeKey } from './hudInvalidation';
import { loadSoloRecords, saveSurvivalRecords } from './soloRecords';
import { MenuFocusController } from './menuNavigation';
import { enhanceMenuSelects } from './menuSelect';
import { ScreenRouter, type AppScreen } from './screenRouter';
import { loadReleaseSettings, saveReleaseSettings } from './releaseSettings';
import { isMobilePlayViewport, loadMobileSettings, saveMobileSettings, type MobileSettings } from './mobileSettings';
import { clientUpdate } from '../pwa/clientUpdate';
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

const SLOT_OPTIONS: Array<{ value: SlotValue; label: string }> = [
  { value: 'off', label: 'Отключён' },
  { value: 'human-1', label: 'WASD' },
  { value: 'human-2', label: 'Стрелки' },
  { value: 'ai-easy', label: 'ИИ · лёгкий' },
  { value: 'ai-medium', label: 'ИИ · средний' },
  { value: 'ai-hard', label: 'ИИ · сложный' },
  { value: 'ai-expert', label: 'ИИ · эксперт' },
];

const BATTLE_DIFFICULTY_COPY: Record<BattleDifficulty, { label: string; hint: string }> = {
  family: { label: 'Семейный', hint: 'Спокойный старт и плавный рост темпа. Аномалии появляются реже.' },
  normal: { label: 'Обычный', hint: 'Стандартный темп битвы. Аномалии появляются с привычной частотой.' },
  sport: { label: 'Спортивный', hint: 'Быстрый старт и резкий рост темпа. Аномалии появляются чаще.' },
};

function battleDifficultyOptionsMarkup(selected: BattleDifficulty): string {
  return (['family', 'normal', 'sport'] as const).map((value) => {
    const copy = BATTLE_DIFFICULTY_COPY[value];
    return `<option value="${value}" data-menu-select-description="${escapeHtml(copy.hint)}" ${selected === value ? 'selected' : ''}>${copy.label}</option>`;
  }).join('');
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

type MainMenuDestination = 'survival' | 'battle' | 'team-battle' | 'settings';

const MAIN_MENU_PREVIEWS: Record<MainMenuDestination, {
  label: string;
  callouts: ReadonlyArray<{ icon: string; tone: string; text: string }>;
}> = {
  survival: {
    label: 'Пример режима «Выживание»',
    callouts: [
      { icon: '◇', tone: 'blue', text: 'Каждый играет независимо · щиты копятся сериями линий' },
      { icon: '✦', tone: 'lime', text: 'Аномалии очищают нижние ряды' },
      { icon: '◷', tone: 'violet', text: 'Выживите и наберите как можно больше очков' },
    ],
  },
  battle: {
    label: 'Пример режима «Битва» для четырёх игроков',
    callouts: [
      { icon: '◉', tone: 'blue', text: 'Каждый сам за себя · щиты копятся сериями линий' },
      { icon: '⇄', tone: 'coral', text: 'Атакуйте соперников · аномалии очищают нижние ряды' },
      { icon: '♛', tone: 'violet', text: 'Выживите и наберите как можно больше очков' },
    ],
  },
  'team-battle': {
    label: 'Пример командного боя: две команды по два игрока',
    callouts: [
      { icon: '2×2', tone: 'lime', text: 'Две команды по два игрока · щиты копятся сериями линий' },
      { icon: '⇄', tone: 'blue', text: 'Атакуйте команду соперников · аномалии очищают нижние ряды' },
      { icon: '♛', tone: 'violet', text: 'Выживите и наберите как можно больше очков' },
    ],
  },
  settings: {
    label: 'Пример настроек звука, экрана, эффектов и управления',
    callouts: [
      { icon: '●', tone: 'coral', text: 'Автор Афонасьев Евгений' },
      { icon: '✦', tone: 'blue', text: 'при поддержке Codex' },
      { icon: '◷', tone: 'violet', text: '2026 год' },
    ],
  },
};

function showcaseMiniBoardMarkup(color: 'blue' | 'coral' | 'lime' | 'violet', board: number, crowned = false): string {
  const blocks = [
    [1, 11], [2, 11], [3, 11], [4, 11], [6, 11], [1, 10], [3, 10], [4, 10], [6, 10], [2, 9], [3, 9], [6, 9],
    [board % 2 ? 5 : 3, 8], [board % 2 ? 5 : 4, 7], [board % 2 ? 4 : 5, 8], [board % 2 ? 6 : 5, 9],
  ];
  return `<div class="mini-board mini-board-${color}"><div class="mini-player">${crowned ? '<b aria-label="Победитель">♛</b>' : '<b aria-hidden="true">◆</b>'}<span>●●●●</span></div><div class="mini-grid">${blocks.map(([x, y], index) => `<i style="--x:${x};--y:${y};--tone:${index % 4}"></i>`).join('')}</div></div>`;
}

function mainMenuPreviewMarkup(destination: MainMenuDestination): string {
  const visual = destination === 'survival'
    ? `<div class="showcase-visual survival-showcase"><div class="survival-preview-board">${showcaseMiniBoardMarkup('blue', 0)}</div><div class="survival-record"><small>ЛУЧШИЙ РЕЗУЛЬТАТ</small><strong>04:28</strong><span>ТОП-10</span></div></div>`
    : destination === 'battle'
      ? `<div class="showcase-visual mini-boards">${(['blue', 'coral', 'lime', 'violet'] as const).map((color, board) => showcaseMiniBoardMarkup(color, board, board === 0)).join('')}</div>`
      : destination === 'team-battle'
        ? `<div class="showcase-visual team-showcase"><div class="team-preview team-preview-sun"><div>${showcaseMiniBoardMarkup('coral', 1)}${showcaseMiniBoardMarkup('lime', 2)}</div></div><div class="team-versus">VS</div><div class="team-preview team-preview-sky"><b class="team-preview-crown" aria-label="Победившая команда">♛</b><div>${showcaseMiniBoardMarkup('blue', 0)}${showcaseMiniBoardMarkup('violet', 3)}</div></div></div>`
        : `<div class="showcase-visual settings-showcase"><div class="settings-preview-card"><header><span>⚙</span><strong>НАСТРОЙКИ</strong></header><div class="preview-setting"><b>♪</b><span>Музыка</span><i><em style="width:72%"></em></i></div><div class="preview-setting"><b>✦</b><span>Эффекты</span><i><em style="width:88%"></em></i></div><div class="preview-toggles"><span><b>▣</b> Полный экран <i>ВКЛ</i></span><span><b>◌</b> Спокойные эффекты <i>ВЫКЛ</i></span></div><div class="preview-controls preview-navigation"><b>🎮</b><span>Управление</span><strong>›</strong></div></div></div>`;
  const callouts = MAIN_MENU_PREVIEWS[destination].callouts.map((callout) => `<div><b class="callout-${callout.tone}" aria-hidden="true">${callout.icon}</b><span>${callout.text}</span></div>`).join('');
  return `${visual}<div class="showcase-callouts">${callouts}</div>`;
}

interface ReleaseFooterOptions {
  confirm?: string;
  back?: string;
  start?: string;
  roster?: string;
  keyboard: string;
  buildInfo?: boolean;
}

function releaseFooterMarkup({ confirm, back, start, roster, keyboard, buildInfo = false }: ReleaseFooterOptions): string {
  const showGamepadActions = !isMobilePlayViewport();
  const mobileCredits = buildInfo && !showGamepadActions
    ? '<span class="release-footer-credits">Автор Афонасьев Евгений · при поддержке Codex · 2026</span>'
    : '';
  const confirmHint = confirm && showGamepadActions ? `<span class="release-footer-action"><b class="input-badge input-confirm">A</b>${confirm}</span>` : '';
  const backHint = back && showGamepadActions ? `<span class="release-footer-action"><b class="input-badge input-back">B</b>${back}</span>` : '';
  const rosterHint = roster && showGamepadActions ? `<span class="release-footer-action"><b class="input-badge input-roster">Y</b>${roster}</span>` : '';
  return `<footer class="release-footer main-menu-footer release-guidance-footer">
    <div class="release-footer-inner${start ? ' release-footer-start-layout' : ''}">
      ${start ? `${showGamepadActions ? `<div class="release-footer-side release-footer-before-start">${confirmHint}${backHint}</div>` : ''}<button class="primary-button footer-start" id="start-match" type="button">${showGamepadActions ? '<kbd aria-hidden="true">X</kbd>' : ''}<span>${start}</span></button>${showGamepadActions ? `<div class="release-footer-side release-footer-after-start">${rosterHint}</div>` : ''}` : `${showGamepadActions ? `<div class="release-footer-actions">${confirmHint}${backHint}${rosterHint}</div>` : ''}`}
      <small>${keyboard}</small>
      ${buildInfo ? `<span class="release-build-info">${formatBuildInfo()}</span>` : ''}
      ${mobileCredits}
    </div>
  </footer>`;
}

export class BricksWarApp {
  private game: Phaser.Game | null = null;
  private network: NetworkApp | null = null;
  private readonly slots: SlotValue[] = loadSlotSelections();
  private readonly playerNames = loadPlayerNames();
  private readonly slotTileStyles: TileStyleSelection[] = loadSetupTileStyles();
  private readonly battleSetups = { battle: loadBattleSetup('battle'), 'team-battle': loadBattleSetup('team-battle') };
  private readonly survivalOptions: MatchOptionSelections = { ...loadMatchOptionSelections(), conflictEnabled: false, matchVariant: 'free-for-all' };
  private get durationMinutes(): number { return this.selectedMode === 'survival' ? DEFAULT_DURATION_MINUTES : this.battleSetups[this.selectedMode].durationMinutes; }
  private set durationMinutes(minutes: number) { if (this.selectedMode !== 'survival') this.battleSetups[this.selectedMode].durationMinutes = minutes; }
  private selectedMode: 'survival' | 'battle' | 'team-battle' = 'battle';
  private get pacing(): MatchOptionSelections { return this.selectedMode === 'survival' ? this.survivalOptions : this.battleSetups[this.selectedMode].options; }
  private persistMatchSetup(): void { saveMatchSetup(this.selectedMode, { options: this.pacing, durationMinutes: this.durationMinutes }, this.slotTileStyles); }
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
  private playerNameObservedWidths = new WeakMap<HTMLInputElement | HTMLTextAreaElement, number>();
  private readonly releaseSettings = loadReleaseSettings();
  private sfxPreferenceRevision = 0;
  private readonly mobileSettings: MobileSettings = loadMobileSettings();
  private readonly audio = new GameAudio(startsMutedForPlaytest() || this.releaseSettings.muted, {
    music: this.releaseSettings.music,
    effects: this.releaseSettings.effects,
    sfxPreset: this.releaseSettings.sfxPreset,
  });
  private readonly router = new ScreenRouter();
  private readonly menuFocus: MenuFocusController;
  private readonly gamepadProfiles = new GamepadProfiles();
  private readonly slotProfiles: Array<string | null> = [null, null, null, null];
  private readonly liveGamepads = new Map<number, { device: string; token: number; profile: string | null }>();
  private connectionToken = 0;
  private readonly profileChoices: Array<{ index: number; token: number; slot?: number; controller?: SlotValue; page?: number; draft?: string }> = [];
  private setupNavigationGamepadIndex: number | null = null;
  private readonly onGamepadConnectionChange = (event: GamepadEvent): void => {
    if (event.type === 'gamepaddisconnected') {
      this.forgetLiveGamepad(event.gamepad.index);
      this.menuFocus.disconnectGamepad(event.gamepad.index);
    }
    this.syncLiveGamepads(Array.from(navigator.getGamepads?.() ?? []));
    if (!this.game) this.renderCurrentScreen();
  };
  private readonly onFullscreenChange = (): void => {
    const label = document.fullscreenElement ? 'Вкл' : 'Выкл';
    const settingsState = this.root.querySelector<HTMLElement>('#toggle-fullscreen b');
    const pauseState = this.root.querySelector<HTMLElement>('#pause-toggle-fullscreen b');
    if (settingsState) settingsState.textContent = label;
    if (pauseState) pauseState.textContent = label;
  };

  constructor(private readonly root: HTMLElement) {
    this.gamepadProfiles.importSlotNames(this.playerNames);
    this.audio.setDirections(this.releaseSettings.musicDirection, this.releaseSettings.sfxDirection);
    this.menuFocus = new MenuFocusController(root, {
      onBack: () => this.navigateBack(),
      onInputMode: (mode) => { this.root.dataset.inputMode = mode; },
      onSelectionChange: (selected) => this.updateMainMenuShowcase(selected),
      onGamepadSelection: (gamepadIndex, selected) => this.openPlayerNameChoice(gamepadIndex, selected),
      onGamepadConfirm: (gamepadIndex, selected) => this.handleGamepadConfirm(gamepadIndex, selected),
      onGamepadRoster: (index) => this.placeGamepadWithY(index),
      onGamepadsSnapshot: (pads) => this.syncLiveGamepads(pads),
      onGamepadStart: () => this.startSetupFromGamepad(),
      acceptsGamepad: (gamepadIndex) => this.profileChoices[0] ? (this.profileChoices[0].index < 0 || gamepadIndex === this.profileChoices[0].index) : this.setupNavigationGamepadIndex === null || gamepadIndex === this.setupNavigationGamepadIndex,
    });
  }

  private readonly updateDesktopLayout = (): void => {
    this.root.dataset.layout = isMobilePlayViewport() ? 'mobile' : 'desktop';
    configureDesktopStage(this.root);
    configureDesktopLabPages(this.root, () => this.menuFocus.activate(this.router.current()));
  };

  start(): void {
    // Navigation may abort an audio load; its old completion must not roll back saved preferences.
    window.addEventListener('pagehide', () => { this.sfxPreferenceRevision += 1; });
    this.updateDesktopLayout();
    window.addEventListener('resize', () => {
      this.updateDesktopLayout();
      this.updateClientUpdateButton();
      if (this.profileChoices.length) { this.renderProfileChoice(); this.menuFocus.activate(this.router.current()); }
    });
    this.tuning = loadGameTuning() ?? cloneGameTuning(DEFAULT_GAME_TUNING);
    window.addEventListener('gamepadconnected', this.onGamepadConnectionChange);
    window.addEventListener('gamepaddisconnected', this.onGamepadConnectionChange);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.body.classList.toggle('calm-effects', this.releaseSettings.calmEffects);
    clientUpdate.setMenuGuard(() => this.router.current() === 'main-menu' && !this.game && !this.network && this.profileChoices.length === 0);
    clientUpdate.subscribe(() => this.updateClientUpdateButton());
    this.renderMainMenu();
  }

  private desktopDisplay: DisplayPreferences = { width: 1280, height: 720, fullscreen: false };
  private downloadUrl = '';

  private updateClientUpdateButton(): void {
    const button = this.root.querySelector<HTMLButtonElement>('.client-update-button');
    const status = this.root.querySelector<HTMLElement>('.client-update-status');
    const announcement = this.root.querySelector<HTMLElement>('.client-update-announcement');
    if (!button || !status) return;
    const state = clientUpdate.snapshot();
    button.hidden = !state.available;
    const download = this.root.querySelector<HTMLButtonElement>('.desktop-download');
    if (download) { download.hidden = state.available || !this.downloadUrl || isMobilePlayViewport(); }
    if (announcement) announcement.hidden = !state.available;
    button.disabled = state.applying || state.blocked;
    button.textContent = state.applying ? 'Обновление…' : 'Обновить';
    status.textContent = state.blocked ? 'Сначала завершите сетевую игру' : state.error ? 'Не удалось обновить. Попробуйте ещё раз.' : '';
    status.hidden = !state.available || !status.textContent;
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

  private rememberFocus(): void {
    this.router.rememberSelection(this.router.current(), this.menuFocus.selectedIndex());
  }

  private activateMenuFocus(screen: AppScreen): void {
    this.updateDesktopLayout();
    enhanceMenuSelects(this.root);
    this.root.querySelectorAll<HTMLElement>('button:not(.menu-select-option), input, textarea, select:not([hidden])').forEach((element) => {
      if (!element.closest('.menu-select-pages') && !element.hasAttribute('data-ui-focus')) element.setAttribute('data-ui-focus', '');
    });
    this.menuFocus.activate(screen, this.profileChoices.length ? 0 : this.router.selectionFor(screen, this.root.querySelectorAll('[data-ui-focus]:not([disabled])').length));
  }

  private navigate(screen: AppScreen, parent?: AppScreen): void {
    this.rememberFocus();
    this.profileChoices.length = 0;
    if (screen === 'survival' || screen === 'battle' || screen === 'team-battle') {
      this.setupNavigationGamepadIndex = null;
      // AI entries are inactive in Survival; its visible empty cards must also be empty Y destinations.
      if (screen === 'survival') this.slots.forEach((slot, index) => { if (slot.startsWith('ai-')) this.slots[index] = 'off'; });
    } else {
      this.setupNavigationGamepadIndex = null;
    }
    if (screen === 'survival' || screen === 'battle' || screen === 'team-battle') this.selectedMode = screen;
    this.router.open(screen, parent);
    clientUpdate.refresh();
    this.renderCurrentScreen();
  }

  private navigateBack(): void {
    if (this.profileChoices.length) { this.profileChoices.shift(); this.renderSetup(); return; }
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
    this.disconnectPlayerNameResizeObserver();
    this.destroyGame();
    this.countdownReady = false;
    this.audio.enterMenu();
    const mobile = isMobilePlayViewport();
    this.root.innerHTML = `
      <main class="release-screen premium-surface main-menu-screen" data-screen="main-menu">
        <div class="menu-block menu-block-one" aria-hidden="true"></div>
        <div class="menu-block menu-block-two" aria-hidden="true"></div>
        <div class="menu-block menu-block-three" aria-hidden="true"></div>
        <section class="main-menu-layout">
          <div class="main-menu-primary">
            <header class="release-brand main-menu-brand">
              <p class="menu-kicker">${mobile ? 'СОЛО-ИГРА НА ТЕЛЕФОНЕ' : 'ЛОКАЛЬНАЯ ИГРА · ДО 4 ИГРОКОВ'}</p>
              <div class="main-menu-brand-row"><h1><span>BRICKS</span><span>WAR</span></h1><div class="client-update-slot"><p class="client-update-announcement" hidden><strong>Вышла новая версия игры,</strong> готовы обновиться?</p><button class="client-update-button" type="button" hidden>Обновить</button><p class="client-update-status" role="status" hidden></p><button type="button" class="desktop-download" data-ui-focus hidden aria-label="Скачать игру для установки" title="Скачать игру"><span aria-hidden="true">⇩</span><span>Скачать игру</span></button></div></div>
            </header>
            ${shouldShowIosInstallHint() || isLocalPlaytestFlag('pwa-install-hint') ? '<aside class="pwa-install-hint" role="status"><span aria-hidden="true">⇧</span><p>Хотите играть как в приложении? Нажмите <b>Поделиться</b> в Safari, затем <b>На экран «Домой»</b>.</p><button type="button" data-dismiss-pwa-hint aria-label="Закрыть подсказку установки">×</button></aside>' : ''}
            <nav class="mode-menu" aria-label="Главное меню">
              <button class="mode-choice mode-survival" type="button" data-destination="survival">
                <span class="mode-icon" aria-hidden="true">♢</span>
                <span class="mode-copy"><strong>Выживание</strong><small>Продержитесь дольше и побейте рекорд</small></span>
                <span class="mode-forward" aria-hidden="true">›</span>
              </button>
              <button class="mode-choice mode-battle" type="button" data-destination="battle">
                <span class="mode-icon" aria-hidden="true">⚔</span>
                <span class="mode-copy"><strong>Битва</strong><small>${mobile ? 'Сразитесь с одним или двумя ИИ' : '2–4 игрока. Каждый сражается за себя'}</small></span>
                <span class="mode-forward" aria-hidden="true">›</span>
              </button>
              <button class="mode-choice mode-team desktop-only" type="button" data-destination="team-battle">
                <span class="mode-icon mode-icon-team" aria-hidden="true"><i></i><i></i><i></i></span>
                <span class="mode-copy"><strong>Командный бой</strong><small>Две команды по два игрока</small></span>
                <span class="mode-forward" aria-hidden="true">›</span>
              </button>
<button class="mode-choice mode-network" type="button" data-network-entry><span class="mode-icon" aria-hidden="true">◎</span><span class="mode-copy"><strong>Сетевая игра</strong><small>Выживание, Битва и Командный бой</small></span><span class="mode-forward" aria-hidden="true">›</span></button>
              <button class="mode-choice mode-settings" type="button" data-destination="settings">
                <span class="mode-icon" aria-hidden="true">⚙</span>
                <span class="mode-copy"><strong>Настройки</strong><small>Звук, экран, эффекты и управление</small></span>
                <span class="mode-forward" aria-hidden="true">›</span>
              </button>
              ${desktop ? '<button class="mode-choice mode-exit" id="desktop-exit" type="button"><span class="mode-icon" aria-hidden="true">⏻</span><span class="mode-copy"><strong>Выход из игры</strong><small>Закрыть приложение</small></span><span class="mode-forward" aria-hidden="true">›</span></button>' : ''}
            </nav>
          </div>
          <aside id="menu-showcase" class="menu-showcase showcase-survival" data-preview="survival" aria-label="${MAIN_MENU_PREVIEWS.survival.label}">
            <div class="showcase-sky" aria-hidden="true"><i></i><i></i><i></i></div>
            <div id="showcase-content" class="showcase-content" aria-hidden="true">${mainMenuPreviewMarkup('survival')}</div>
          </aside>
        </section>
        ${releaseFooterMarkup({ confirm: mobile ? 'Открыть' : 'Выбрать', back: 'Назад', keyboard: mobile ? 'Коснитесь карточки, чтобы открыть режим' : '↑↓ / WASD · выбор &nbsp;·&nbsp; Enter · открыть', buildInfo: true })}
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
      this.network = new NetworkApp(this.root, () => {this.router.open('main-menu'); this.renderMainMenu();}, this.audio);
    });
    this.root.querySelector('.client-update-button')?.addEventListener('click', () => { clientUpdate.apply(); });
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
    const destination = selected?.dataset.destination as MainMenuDestination | undefined;
    if (!destination || !(destination in MAIN_MENU_PREVIEWS)) return;
    const showcase = this.root.querySelector<HTMLElement>('#menu-showcase');
    const content = this.root.querySelector<HTMLElement>('#showcase-content');
    if (!showcase || !content || showcase.dataset.preview === destination) return;
    showcase.dataset.preview = destination;
    showcase.classList.remove('showcase-survival', 'showcase-battle', 'showcase-team-battle', 'showcase-settings');
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
      <main class="release-screen premium-surface settings-screen" data-screen="settings">
        <header class="release-heading"><button class="screen-back" id="settings-back" type="button">← Назад</button><div><p class="eyebrow">BRICKS WAR</p><h1>Настройки</h1></div></header>
        <section class="settings-list" aria-label="Настройки игры">
          <section class="release-panel settings-section settings-audio-section"><header><span class="settings-icon" aria-hidden="true">♪</span><div><p class="eyebrow">ЗВУК</p><h2>Музыка и эффекты</h2></div></header>${this.setupAudioMarkup()}</section>
          ${isLocalPlaytestFlag('audio-prototypes') ? this.audioPrototypeGalleryMarkup() : ''}
          <section class="release-panel settings-section settings-display-section"><header><span class="settings-icon settings-icon-screen" aria-hidden="true">▣</span><div><p class="eyebrow">ЭКРАН</p><h2>Изображение</h2></div></header>
            ${desktop ? `<label class="settings-action"><span><strong>Разрешение окна</strong><small>Размер игрового окна; полный экран использует весь монитор</small></span><select id="desktop-resolution">${(this.desktopDisplay.resolutions ?? [[960,540],[1280,720],[1440,900],[1600,900],[1920,1080]]).map(([w,h]) => `<option value="${w}x${h}" ${w === this.desktopDisplay.width && h === this.desktopDisplay.height ? 'selected' : ''}>${w} × ${h}</option>`).join('')}</select></label><label class="settings-action"><span><strong>Режим экрана</strong><small>Полный экран или отдельное окно</small></span><select id="desktop-window-mode"><option value="windowed" ${!this.desktopDisplay.fullscreen ? 'selected' : ''}>Оконный</option><option value="fullscreen" ${this.desktopDisplay.fullscreen ? 'selected' : ''}>Полный экран</option></select></label><output id="desktop-display-status" class="settings-status" role="status"></output>` : ''}
            ${mobile || desktop ? '' : `<button class="settings-action" id="toggle-fullscreen" type="button"><span><strong>Полноэкранный режим</strong><small>Использовать весь экран для игровых полей</small></span><b>${document.fullscreenElement ? 'Вкл' : 'Выкл'}</b></button><output id="fullscreen-status" class="settings-status" role="status"></output>`}
            <label class="settings-action"><span><strong>Спокойные эффекты</strong><small>Меньше движения, частиц и ярких вспышек</small></span><input id="calm-effects" type="checkbox" ${this.releaseSettings.calmEffects ? 'checked' : ''} /></label>
          </section>
          <button class="release-panel settings-action settings-navigation" id="open-rules" type="button"><span class="settings-icon" aria-hidden="true">✦</span><span><strong>Правила</strong><small>Фигуры, атаки и защита — на примерах</small></span><b>›</b></button>
          ${mobile ? '' : `<button class="release-panel settings-action settings-navigation" id="open-controls" type="button"><span class="settings-icon" aria-hidden="true">🎮</span><span><strong>Управление</strong><small>Клавиатура и геймпад</small></span><b>›</b></button>`}
          <button class="release-panel settings-action settings-navigation" id="open-settings-lab" type="button"><span class="settings-icon settings-icon-lab" aria-hidden="true">⌁</span><span><strong>Лаборатория дизайна</strong><small>Тонкая настройка игрового баланса</small></span><b>›</b></button>
        </section>
        ${releaseFooterMarkup({ confirm: mobile ? undefined : 'Выбрать', back: 'Назад', keyboard: mobile ? 'Все настройки меняются касанием' : '↑↓ / WASD · выбор &nbsp;·&nbsp; Enter / A · открыть &nbsp;·&nbsp; Esc / B · назад' })}
      </main>
    `;
    this.root.querySelector('#settings-back')?.addEventListener('click', () => this.navigateBack());
    this.root.querySelector('#open-rules')?.addEventListener('click', () => this.navigate('rules'));
    this.root.querySelector('#open-controls')?.addEventListener('click', () => this.navigate('controls'));
    this.root.querySelector('#open-settings-lab')?.addEventListener('click', () => this.navigate('laboratory'));
    this.bindAudioPrototypeGallery();
    const applyDesktopDisplay = () => {
      if (!desktop) return;
      const resolution = this.root.querySelector<HTMLSelectElement>('#desktop-resolution')?.value ?? '1280x720';
      const [width = 1280, height = 720] = resolution.split('x').map(Number);
      const fullscreen = this.root.querySelector<HTMLSelectElement>('#desktop-window-mode')?.value === 'fullscreen';
      void desktop.setDisplay({ width, height, fullscreen }).then(value => { this.desktopDisplay = value; })
        .catch(() => { const status = this.root.querySelector('#desktop-display-status'); if (status) status.textContent = 'Не удалось изменить параметры экрана'; });
    };
    this.root.querySelector('#desktop-resolution')?.addEventListener('change', applyDesktopDisplay);
    this.root.querySelector('#desktop-window-mode')?.addEventListener('change', applyDesktopDisplay);
    this.root.querySelector('#toggle-fullscreen')?.addEventListener('click', () => {
      const operation = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      void operation.then(() => this.renderSettings()).catch(() => {
        const status = this.root.querySelector<HTMLOutputElement>('#fullscreen-status');
        if (status) status.textContent = 'Браузер не разрешил изменить полноэкранный режим';
      });
    });
    this.root.querySelector<HTMLInputElement>('#calm-effects')?.addEventListener('change', (event) => {
      this.releaseSettings.calmEffects = (event.currentTarget as HTMLInputElement).checked;
      document.body.classList.toggle('calm-effects', this.releaseSettings.calmEffects);
      saveReleaseSettings(this.releaseSettings);
    });
    this.bindMenuAudioUnlock();
    this.bindAudioToggle();
    this.bindVolumeControl();
    this.bindSfxPresetControl();
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
      this.router.open('settings');
      this.renderSettings();
      return;
    }
    this.root.innerHTML = `
      <main class="release-screen premium-surface controls-screen" data-screen="controls">
        <header class="release-heading"><button class="screen-back" id="controls-back" type="button">← Настройки</button><div><p class="eyebrow">ФИКСИРОВАННАЯ СХЕМА</p><h1>Управление</h1></div></header>
        <div class="controls-reference">
          <section class="gamepad-reference" aria-label="Схема геймпада">
            <img class="approved-gamepad-artwork" src="${controlsGamepadPanelUrl}" width="1000" height="720" alt="Геймпад: левый стик или D-pad — движение; вниз — ускорить падение; A — повернуть; B — назад в меню; Menu — пауза. В меню D-pad или стик выбирает пункт, основная кнопка открывает, правая кнопка возвращает назад." />
          </section>
          <section class="keyboard-reference">
            <article class="release-panel"><h2>Клавиатура 1</h2><div class="keyboard-cluster wasd"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div><ul class="key-actions"><li class="action-rotate">W повернуть</li><li class="action-move">A D двигать</li><li class="action-drop">S ускорить</li></ul></article>
            <article class="release-panel"><h2>Клавиатура 2</h2><div class="keyboard-cluster arrows"><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></div><ul class="key-actions"><li class="action-rotate">↑ повернуть</li><li class="action-move">← → двигать</li><li class="action-drop">↓ ускорить</li></ul></article>
          </section>
        </div>
        ${releaseFooterMarkup({ back: 'Назад', keyboard: 'Esc / B · назад' })}
      </main>
    `;
    this.root.querySelector('#controls-back')?.addEventListener('click', () => this.navigateBack());
    this.activateMenuFocus('controls');
  }

  private renderSetup(): void {
    if (!this.root.querySelector('[data-profile-choice]') && this.root.querySelector(`[data-screen="${this.selectedMode}"]`)) this.rememberFocus();
    this.disconnectPlayerNameResizeObserver();
    this.destroyGame();
    this.countdownReady = false;
    this.audio.enterMenu();
    const mode = this.selectedMode;
    window.scrollTo({ top: 0 });
    const mobile = isMobilePlayViewport();
    const title = mode === 'survival' ? 'Выживание' : mode === 'team-battle' ? 'Командный бой' : 'Битва';
    const subtitle = mobile ? (mode === 'survival' ? 'Играйте в одиночку и побейте рекорд' : 'Вы против одного или двух ИИ') : mode === 'survival'
      ? 'Продержитесь как можно дольше и попадите в локальный топ-10'
      : mode === 'team-battle' ? 'Две команды по два игрока' : 'От двух до четырёх игроков — каждый за себя';
    const records = mode === 'survival' ? loadSoloRecords() : [];
    const lobby = mobile
      ? this.mobileSetupMarkup(mode, records)
      : mode === 'survival'
      ? `<div class="survival-setup-grid">
          <section class="release-panel survival-rules"><p class="eyebrow">КАК ИГРАТЬ</p><h2>Правила режима</h2><ul><li><b>◷</b><span>Атак нет. Рекорд — по очкам</span></li><li><b>!</b><span>С 3:00 серые ряды учащаются: пауза от 15 до 5 секунд</span></li><li><b>✦</b><span>Закрытие линий аномалиями очищает нижние ряды</span></li><li><b>⬡</b><span>Серии очищенных линий заряжают щиты</span></li><li><b>◇</b><span>Каждый играет независимо, фигуры идут в одном порядке</span></li></ul></section>
          <section class="release-panel survival-player"><p class="eyebrow">ИГРОКИ</p><h2>От 1 до 4 игроков</h2><div class="battle-lobby survival-lobby">${this.slots.map((value, index) => this.slotMarkup(index, isManualSlot(value) ? value : 'off', true)).join('')}</div></section>
          <section class="release-panel survival-records"><h2>Лучшие результаты</h2>${records.length ? `<ol>${records.map((record, index) => `<li><b>${index + 1}</b><span><strong>${escapeHtml(record.name)}</strong></span><span class="record-metrics"><time>${record.lineScore.toLocaleString('ru-RU')}</time><small class="record-duration" aria-label="Время выживания ${formatDuration(record.elapsedMs).slice(0, -2)}">◷ ${formatDuration(record.elapsedMs).slice(0, -2)}</small></span></li>`).join('')}</ol>` : '<p>Здесь появятся первые рекорды</p>'}</section>
        </div>`
      : `<div class="battle-setup-layout">${this.modeRulesMarkup(mode)}<section class="release-panel battle-setup-roster battle-player">${mode === 'team-battle'
        ? `<div class="team-lobby"><section class="team-group team-one">${[0, 1].map((index) => this.slotMarkup(index, this.slots[index] ?? 'off')).join('')}</section><span class="versus">VS</span><section class="team-group team-two">${[2, 3].map((index) => this.slotMarkup(index, this.slots[index] ?? 'off')).join('')}</section></div>`
        : `<p class="eyebrow">ИГРОКИ</p><h2>От 2 до 4 игроков</h2><div class="battle-lobby survival-lobby">${this.slots.map((value, index) => this.slotMarkup(index, value)).join('')}</div>`}</section></div>`;
    this.root.innerHTML = `
      <main class="release-screen premium-surface mode-setup-screen" data-screen="${mode}">
        <div class="setup-scroll">
        <header class="release-heading"><button class="screen-back" id="mode-back" type="button">← Главное меню</button><div><p class="eyebrow">BRICKS WAR · ${mobile ? 'СОЛО' : mode === 'survival' ? '1–4 ИГРОКА' : mode === 'team-battle' ? '2 × 2' : 'АРЕНА'}</p><h1>${title}</h1><p>${subtitle}</p></div></header>
        <section class="mode-setup-content">${lobby}</section>
        ${mode === 'survival' || mobile ? '' : this.modeSettingsMarkup()}
        <p class="setup-error" id="setup-error" role="alert" aria-live="polite"></p>
        </div>
        ${releaseFooterMarkup({ roster: mobile ? undefined : 'Войти', confirm: mobile ? undefined : 'Подтвердить', back: 'Назад', start: 'Начать', keyboard: mobile ? 'Настройте матч и нажмите «Начать»' : '↑↓ / WASD · выбор &nbsp;·&nbsp; Enter / A · подтвердить &nbsp;·&nbsp; X · начать &nbsp;·&nbsp; Esc / B · назад' })}
      </main>
    `;

    this.root.querySelectorAll<HTMLSelectElement>('[data-slot]').forEach((select) => {
      select.addEventListener('change', () => {
        this.audio.playUiSelect();
        const index = Number(select.dataset.slot);
        this.setSlot(index, select.value as SlotValue);
      });
    });
    this.root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-player-name]').forEach((input) => {
      input.addEventListener('click', () => this.openPlayerNameChoice(-1, input));
      input.addEventListener('input', () => {
        const index = Number(input.dataset.playerName);
        this.playerNames[index] = normalizePlayerName(input.value, index);
        savePlayerNames(this.playerNames);
        const profile = this.slotProfiles[index];
        if (profile && isGamepadSlot(this.slots[index]!)) this.gamepadProfiles.rename(profile, this.playerNames[index]!);
        this.fitPlayerNameInput(input);
      });
      input.addEventListener('change', () => {
        const index = Number(input.dataset.playerName);
        input.value = this.playerNameForSlot(index);
        this.gamepadProfiles.rememberName(input.value);
        this.fitPlayerNameInput(input);
      });
    });
    this.root.querySelectorAll<HTMLSelectElement>('[data-tile-style]').forEach((select) => {
      select.addEventListener('change', () => {
        this.audio.playUiSelect();
        const index = Number(select.dataset.tileStyle);
        const selection = select.value as TileStyleSelection;
        this.slotTileStyles[index] = selection;
        this.persistMatchSetup();
        const preview = this.root.querySelector<HTMLElement>(`[data-style-preview="${index}"]`);
        if (preview) preview.dataset.style = selection;
      });
    });
    this.root.querySelector('#start-match')?.addEventListener('click', () => this.startMatch());
    this.root.querySelectorAll<HTMLSelectElement>('[data-mobile-setting]').forEach((select) => select.addEventListener('change', () => {
      const key = select.dataset.mobileSetting as keyof MobileSettings;
      if (key === 'aiCount') this.mobileSettings.aiCount = Number(select.value) === 3 ? 3 : Number(select.value) === 2 ? 2 : 1;
      else if (key === 'aiDifficulty') this.mobileSettings.aiDifficulty = select.value as AiDifficulty;
      saveMobileSettings(this.mobileSettings); this.renderSetup();
    }));
    this.root.querySelector('#mode-back')?.addEventListener('click', () => this.navigateBack());
    this.root.querySelectorAll<HTMLButtonElement>('[data-add-human]').forEach((button) => button.addEventListener('click', () => this.addHumanToSlot(Number(button.dataset.addHuman))));
    this.root.querySelectorAll<HTMLButtonElement>('[data-add-ai]').forEach((button) => button.addEventListener('click', () => this.setSlot(Number(button.dataset.addAi), 'ai-medium')));
    this.root.querySelectorAll<HTMLButtonElement>('[data-remove-slot]').forEach((button) => button.addEventListener('click', () => this.setSlot(Number(button.dataset.removeSlot), 'off')));
    this.root.querySelector<HTMLSelectElement>('#match-duration')?.addEventListener('change', (event) => {
      this.audio.playUiSelect();
      const value = (event.currentTarget as HTMLSelectElement).value;
      this.pacing.battleTimeMode = value === 'until-victory' ? 'until-victory' : 'timed';
      if (value !== 'until-victory') this.durationMinutes = Number(value);
      this.persistMatchSetup();
      this.renderSetup();
    });
    this.bindModeSettings();
    this.bindMenuAudioUnlock();
    this.showValidation();
    this.renderProfileChoice();
    this.activateMenuFocus(this.router.current());
    this.setupPlayerNameFitting();
  }

  private disconnectPlayerNameResizeObserver(): void {
    this.playerNameResizeObserver?.disconnect();
    this.playerNameResizeObserver = null;
    if (this.playerNameFitFrame !== null) cancelAnimationFrame(this.playerNameFitFrame);
    this.playerNameFitFrame = null;
    this.pendingPlayerNameFits.clear();
  }

  private setupPlayerNameFitting(): void {
    const inputs = this.root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-player-name]');
    if (!inputs.length) return;
    inputs.forEach((input) => this.fitPlayerNameInput(input));
    this.playerNameResizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const input = entry.target as HTMLInputElement | HTMLTextAreaElement;
        const width = entry.contentRect.width;
        if (this.playerNameObservedWidths.get(input) === width) return;
        this.playerNameObservedWidths.set(input, width);
        this.pendingPlayerNameFits.add(input);
      });
      if (!this.pendingPlayerNameFits.size || this.playerNameFitFrame !== null) return;
      // Fit after ResizeObserver delivery; changing textarea size inside it can loop.
      this.playerNameFitFrame = requestAnimationFrame(() => {
        this.playerNameFitFrame = null;
        const pending = [...this.pendingPlayerNameFits];
        this.pendingPlayerNameFits.clear();
        pending.forEach((input) => {
          if (input.isConnected && this.root.contains(input)) this.fitPlayerNameInput(input);
        });
      });
    });
    this.playerNameObservedWidths = new WeakMap();
    inputs.forEach((input) => this.playerNameResizeObserver?.observe(input));
  }

  private fitPlayerNameInput(input: HTMLInputElement | HTMLTextAreaElement): void {
    input.style.removeProperty('font-size');
    if (input instanceof HTMLTextAreaElement) { input.rows = 1; input.style.removeProperty('height'); }
    const style = window.getComputedStyle(input);
    const minimumSize = 12;
    const naturalSize = Number.parseFloat(style.fontSize);
    if (!Number.isFinite(naturalSize) || naturalSize < minimumSize) return;
    const pencilReserve = input.classList.contains('editable-player-name') ? 24 : 0;
    const availableWidth = input.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) - pencilReserve;
    if (availableWidth <= 0) return;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    const spacing = style.letterSpacing === 'normal' ? 0 : Number.parseFloat(style.letterSpacing) || 0;
    const widthAt = (size: number): number => {
      context.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
      return context.measureText(input.value).width + Math.max(0, input.value.length - 1) * spacing;
    };
    if (widthAt(naturalSize) <= availableWidth) return;
    if (widthAt(minimumSize) > availableWidth) {
      if (input instanceof HTMLTextAreaElement) {
        input.rows = 2;
        input.style.fontSize = `${minimumSize}px`;
        input.style.height = `${Math.ceil(minimumSize * 2 * 1.1 + Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom) + 6)}px`;
      }
      return;
    }
    let low = minimumSize;
    let high = naturalSize;
    for (let step = 0; step < 12; step += 1) {
      const middle = (low + high) / 2;
      if (widthAt(middle) <= availableWidth) low = middle;
      else high = middle;
    }
    input.style.fontSize = `${low}px`;
  }

  private mobileSetupMarkup(mode: 'survival' | 'battle' | 'team-battle', records: ReturnType<typeof loadSoloRecords>): string {
    if (mode === 'team-battle') return this.mobileSetupMarkup('battle', records);
    const player = `<label><small>Имя игрока</small><input data-player-name="0" aria-label="Имя игрока 1" value="${escapeHtml(this.playerNameForSlot(0))}" maxlength="20" /></label>`;
    const recordsMarkup = records.length ? `<ol>${records.map((record, index) => `<li><b>${index + 1}</b><span><strong>${escapeHtml(record.name)}</strong></span><span class="record-metrics"><time>${record.lineScore.toLocaleString('ru-RU')}</time><small class="record-duration" aria-label="Время выживания ${formatDuration(record.elapsedMs).slice(0, -2)}">◷ ${formatDuration(record.elapsedMs).slice(0, -2)}</small></span></li>`).join('')}</ol>` : '<p>Сыграйте первую партию — рекорд появится здесь.</p>';
    if (mode === 'survival') return `<div class="mobile-solo-setup"><section class="release-panel mobile-setup-card"><p class="eyebrow">СОЛО</p><h2>Выживание</h2><p>Атак нет. Рекорд — по очкам. С 3:00 серые ряды учащаются: пауза от 15 до 5 секунд.</p>${player}<div class="mobile-control-hint">Сверху — поворот. Снизу: ← → сдвиг, ↓ ускорение.</div></section><section class="release-panel survival-records mobile-survival-records"><header><div><p class="eyebrow">ЛОКАЛЬНЫЙ ТОП-10</p><h2>Лучшие результаты</h2></div><span aria-hidden="true">♛</span></header>${recordsMarkup}</section></div>`;
    const difficulty = this.pacing.battleDifficulty;
    const attackMode = this.pacing.conflictEnabled ? this.pacing.conflictTargeting : 'off';
    return `<section class="release-panel mobile-solo-setup mobile-setup-card"><p class="eyebrow">СОЛО</p><h2>Битва с ИИ</h2><p class="mobile-mode-rule">${this.pacing.battleTimeMode === 'until-victory' ? 'До последнего выжившего; одновременно — по очкам. С 3:00 серые ряды учащаются.' : 'Последний выживший побеждает. По таймеру — очки; в финале растут серые ряды.'}</p>${player}<label><small>Соперники</small><select data-mobile-setting="aiCount"><option value="1" ${this.mobileSettings.aiCount === 1 ? 'selected' : ''}>1 ИИ</option><option value="2" ${this.mobileSettings.aiCount === 2 ? 'selected' : ''}>2 ИИ</option><option value="3" ${this.mobileSettings.aiCount === 3 ? 'selected' : ''}>3 ИИ</option></select></label><label><small>Сложность ИИ</small><select data-mobile-setting="aiDifficulty">${(['easy','medium','hard','expert'] as const).map((value) => `<option value="${value}" ${this.mobileSettings.aiDifficulty === value ? 'selected' : ''}>${({ easy: 'Лёгкая', medium: 'Средняя', hard: 'Сложная', expert: 'Эксперт' })[value]}</option>`).join('')}</select></label><label><small>Темп битвы</small><select id="battle-difficulty" aria-label="Темп битвы">${battleDifficultyOptionsMarkup(difficulty)}</select></label><label><small>Режим атаки</small><select id="attack-mode" aria-label="Режим атаки"><option value="off" ${attackMode === 'off' ? 'selected' : ''}>Выключены</option><option value="hunt-leader" ${attackMode === 'hunt-leader' ? 'selected' : ''}>Только лидеру</option><option value="all-opponents" ${attackMode === 'all-opponents' ? 'selected' : ''}>Всем соперникам</option></select></label><label><small>Длительность</small><select id="match-duration" aria-label="Длительность матча">${this.durationOptionsMarkup()}</select></label><div class="mobile-control-hint">Коснитесь верхней части экрана для поворота. Внизу: ← → сдвиг, ↓ ускорение.</div></section>`;
  }

  private startSetupFromGamepad(): void {
    if (this.profileChoices.length) return;
    const screen = this.router.current();
    if (screen !== 'survival' && screen !== 'battle' && screen !== 'team-battle') return;
    const button = this.root.querySelector<HTMLButtonElement>('#start-match');
    if (!button || button.disabled) return;
    button.click();
  }

  private durationOptionsMarkup(): string {
    const untilVictory = this.pacing.battleTimeMode === 'until-victory';
    return `<option value="until-victory" ${untilVictory ? 'selected' : ''}>До победы</option>${Array.from({ length: 9 }, (_, index) => index + 2).map((minutes) => `<option value="${minutes}" ${!untilVictory && minutes === this.durationMinutes ? 'selected' : ''}>${minutes} мин</option>`).join('')}`;
  }

  private modeSettingsMarkup(): string {
    const teams = this.selectedMode === 'team-battle';
    const attackMode = this.pacing.conflictEnabled ? this.pacing.conflictTargeting : 'off';
    const difficulty = this.pacing.battleDifficulty;
    const mobile = isMobilePlayViewport();
    return `<section class="mode-settings" aria-label="Настройки режима">
      <label><small>Длительность</small><select id="match-duration" aria-label="Длительность матча">${this.durationOptionsMarkup()}</select></label>
      <label><small>Атаки</small><select id="attack-mode" aria-label="Режим атаки"><option value="off" ${attackMode === 'off' ? 'selected' : ''}>Выключены</option>${teams ? '' : `<option value="hunt-leader" ${attackMode === 'hunt-leader' ? 'selected' : ''}>Только лидеру</option>`}<option value="all-opponents" ${attackMode === 'all-opponents' ? 'selected' : ''}>${teams ? 'Другой команде' : 'Всем соперникам'}</option></select></label>
      ${mobile ? '' : `<label><small>Сложность</small><select id="battle-difficulty" aria-label="Сложность битвы">${battleDifficultyOptionsMarkup(difficulty)}</select></label>`}
    </section>`;
  }

  private modeRulesMarkup(mode: 'battle' | 'team-battle'): string {
    const victoryRule = this.pacing.battleTimeMode === 'until-victory'
      ? (mode === 'team-battle' ? 'До последней команды; одновременно — по очкам' : 'До последнего выжившего; одновременно — по очкам')
      : (mode === 'team-battle' ? 'Выживите командой и наберите больше очков' : 'Последний выживший побеждает; по таймеру — очки');
    const rules = mode === 'team-battle'
      ? [{ icon: '2×2', text: 'Две команды по два игрока' }, { icon: '⇄', text: 'Атакуйте команду соперников' }, { icon: '⬡', text: 'Серии очищенных линий заряжают щиты' }, { icon: '✦', text: 'Закрытие линий аномалиями очищает нижние ряды' }, { icon: '♛', text: victoryRule }]
      : [{ icon: '◉', text: 'Каждый сам за себя' }, { icon: '⇄', text: 'Атакуйте соперников' }, { icon: '⬡', text: 'Серии очищенных линий заряжают щиты' }, { icon: '✦', text: 'Закрытие линий аномалиями очищает нижние ряды' }, { icon: '♛', text: victoryRule }];
    return `<section class="release-panel mode-rules mode-rules-${mode}"><p class="eyebrow">КАК ИГРАТЬ</p><h2>Правила режима</h2><ul>${rules.map(({ icon, text }) => `<li><b>${icon}</b><span>${text}</span></li>`).join('')}</ul><div class="mode-rules-board" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div></section>`;
  }

  private bindModeSettings(): void {
    this.root.querySelector<HTMLSelectElement>('#attack-mode')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      this.pacing.conflictEnabled = value !== 'off';
      this.pacing.conflictTargeting = value === 'hunt-leader' ? 'hunt-leader' : 'all-opponents';
      this.persistMatchSetup();
      this.renderSetup();
    });
    this.root.querySelector<HTMLSelectElement>('#battle-difficulty')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      this.pacing.battleDifficulty = value === 'family' || value === 'sport' ? value : 'normal';
      this.persistMatchSetup();
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
    saveSlotSelections(this.slots.map((slot) => isGamepadSlot(slot) ? 'off' : slot));
    this.audio.playUiSelect();
    this.renderSetup();
  }

  private addHumanToSlot(index: number): void {
    const assigned = new Set(this.slots.filter((slot, slotIndex) => slotIndex !== index && isManualSlot(slot)));
    const available: SlotValue[] = ['human-1', 'human-2', ...connectedGamepads().map((gamepad) => gamepad.controller)];
    const controller = available.find((value) => !assigned.has(value));
    if (controller) this.setSlot(index, controller);
  }

  private handleGamepadConfirm(gamepadIndex: number, selected: HTMLElement | null): boolean {
    if (this.router.current() === 'main-menu' && selected?.matches('[data-destination="survival"], [data-destination="battle"], [data-destination="team-battle"]')) {
      selected.click();
      this.setupNavigationGamepadIndex = gamepadIndex;
      return true;
    }
    return false;
  }

  private forgetLiveGamepad(index: number): boolean {
    const removed = this.liveGamepads.delete(index);
    const controller = `gamepad-${index}`;
    this.slots.forEach((slot, position) => {
      if (slot === controller) { this.slots[position] = 'off'; this.slotProfiles[position] = null; }
    });
    for (let position = this.profileChoices.length - 1; position >= 0; position--) {
      if (this.profileChoices[position]!.index === index || this.profileChoices[position]!.controller === controller) this.profileChoices.splice(position, 1);
    }
    if (this.setupNavigationGamepadIndex === index) this.setupNavigationGamepadIndex = null;
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

  private placeGamepadWithY(index: number): void {
    if (isMobilePlayViewport() || !['survival', 'battle', 'team-battle'].includes(this.router.current())) return;
    const live = this.liveGamepads.get(index);
    if (!live || this.profileChoices.some((choice) => choice.index === index)) return;
    const controller = `gamepad-${index}` as GamepadController;
    const moved = moveGamepad(this.slots.map((slot, position) => ({ controller: slot, name: this.playerNameForSlot(position), style: this.slotTileStyles[position]!, profile: this.slotProfiles[position]! })), controller);
    if (moved) {
      moved.forEach((slot, position) => {
        this.slots[position] = slot.controller;
        this.playerNames[position] = slot.name;
        this.slotTileStyles[position] = slot.style;
        this.slotProfiles[position] = slot.profile;
      });
      this.persistRoster();
      this.renderSetup();
      return;
    }
    if (this.slots.includes(controller) || gamepadDestination(this.slots, controller) < 0) return;
    const assigned = new Set(this.slotProfiles.filter((id): id is string => id !== null));
    const candidates = this.gamepadProfiles.candidates(live.device, assigned);
    const identical = [...this.liveGamepads.values()].filter((item) => item.device === live.device).length > 1;
    if (candidates.length > 1 || (identical && candidates.length > 0)) {
      this.profileChoices.push({ index, token: live.token });
      this.renderSetup();
    } else this.completeGamepadJoin(index, live.token, candidates[0]?.id ?? null);
  }

  private completeGamepadJoin(index: number, token: number, profileId: string | null, newName?: string): void {
    const live = this.liveGamepads.get(index);
    const pad = Array.from(navigator.getGamepads?.() ?? []).find((item) => item?.connected && item.index === index);
    const controller = `gamepad-${index}` as GamepadController;
    if (!live || live.token !== token || !pad || gamepadDescription(pad) !== live.device || isMobilePlayViewport() || this.slots.includes(controller)) return;
    const position = gamepadDestination(this.slots, controller);
    if (position < 0) return;
    const profile = profileId ? this.gamepadProfiles.candidates(live.device, new Set(this.slotProfiles.filter((id): id is string => id !== null))).find((item) => item.id === profileId) : this.gamepadProfiles.create(live.device, newName ?? `Игрок ${position + 1}`);
    if (!profile) return;
    this.slots[position] = controller;
    this.playerNames[position] = profile.name;
    this.slotProfiles[position] = profile.id;
    live.profile = profile.id;
    this.persistRoster();
    this.renderSetup();
  }

  private persistRoster(): void {
    saveSlotSelections(this.slots.map((slot) => isGamepadSlot(slot) ? 'off' : slot));
    savePlayerNames(this.playerNames);
    this.persistMatchSetup();
  }

  private openPlayerNameChoice(index: number, selected: HTMLElement | null): void {
    if (isMobilePlayViewport() || this.profileChoices.length || !selected?.matches('[data-player-name]')) return;
    const slot = Number(selected.dataset.playerName);
    const live = this.liveGamepads.get(index);
    const controller = this.slots[slot];
    if ((index >= 0 && !live) || !controller || !isManualSlot(controller)) return;
    // -1 denotes pointer entry, independent of any live gamepad.
    this.profileChoices.push({ index, token: live?.token ?? 0, slot, controller });
    this.renderSetup();
  }

  private renderProfileChoice(): void {
    const choice = this.profileChoices[0];
    const live = choice && this.liveGamepads.get(choice.index);
    if (!choice || (choice.index >= 0 && !live) || isMobilePlayViewport()) return;
    const editing = choice.slot !== undefined;
    const targetController = editing ? this.slots[choice.slot!] : null;
    const targetDevice = targetController && isGamepadSlot(targetController)
      ? this.liveGamepads.get(Number(targetController.slice(8)))?.device : null;
    const assigned = new Set(this.slotProfiles.filter((id, slot): id is string => id !== null && slot !== choice.slot));
    const candidates = editing
      ? this.gamepadProfiles.profiles.filter((profile, index, profiles) => profiles.findIndex((item) => item.name === profile.name) === index)
      : this.gamepadProfiles.candidates(targetDevice ?? live!.device, assigned);
    const pageSize = isMobilePlayViewport() ? Math.max(1, Math.min(6, Math.floor((innerHeight - 290) / 52))) : 4;
    const pageCount = Math.max(1, Math.ceil(candidates.length / pageSize));
    choice.page = Math.max(0, Math.min(choice.page ?? 0, pageCount - 1));
    const visibleCandidates = candidates.slice(choice.page * pageSize, (choice.page + 1) * pageSize);
    const name = choice.draft ?? (editing ? this.playerNameForSlot(choice.slot!) : `Игрок ${gamepadDestination(this.slots, `gamepad-${choice.index}` as GamepadController) + 1}`);
    this.root.querySelector('main')?.setAttribute('inert', '');
    this.root.querySelector('.profile-choice-backdrop')?.remove();
    this.root.insertAdjacentHTML('beforeend', `<div class="profile-choice-backdrop"><section class="release-panel profile-choice" data-profile-choice role="dialog" aria-modal="true" aria-labelledby="profile-choice-title"><h2 id="profile-choice-title">Выберите имя</h2><p>${choice.index >= 0 ? `Геймпад ${choice.index + 1}. ` : ''}${editing ? 'Выберите сохранённое имя или введите новое для этого игрока.' : 'Выберите своё сохранённое имя или создайте новое.'}</p><div class="profile-choice-actions">${visibleCandidates.map((profile) => `<div class="profile-choice-row"><button type="button" data-profile-id="${escapeHtml(profile.id)}" data-ui-focus>${escapeHtml(profile.name)}</button><button type="button" data-profile-delete="${escapeHtml(profile.id)}" aria-label="Удалить сохранённое имя ${escapeHtml(profile.name)}" data-ui-focus>Удалить</button></div>`).join('')}${pageCount > 1 ? `<nav class="profile-pages" aria-label="Страницы сохранённых имён"><button type="button" data-profile-previous data-ui-focus ${choice.page === 0 ? 'disabled' : ''}>← Предыдущие имена</button><output>${choice.page + 1} / ${pageCount}</output><button type="button" data-profile-next data-ui-focus ${choice.page === pageCount - 1 ? 'disabled' : ''}>Следующие имена →</button></nav>` : ''}<label class="profile-new-name">Новое имя<input data-profile-name data-ui-focus aria-label="Новое имя" maxlength="18" value="${escapeHtml(name)}"></label><button type="button" data-profile-new data-ui-focus>Сохранить</button><button type="button" data-profile-cancel data-ui-focus>Отмена</button></div></section></div>`);
    this.root.querySelector<HTMLInputElement>('[data-profile-name]')?.addEventListener('input', event => { choice.draft = (event.target as HTMLInputElement).value; });
    for (const [selector, direction] of [['[data-profile-previous]', -1], ['[data-profile-next]', 1]] as const) this.root.querySelector(selector)?.addEventListener('click', () => { choice.page = (choice.page ?? 0) + direction; this.renderSetup(); });
    this.root.querySelectorAll<HTMLElement>('[data-profile-id], [data-profile-new]').forEach((button) => button.addEventListener('click', () => {
      const profileId = button.dataset.profileId ?? null;
      const enteredName = this.root.querySelector<HTMLInputElement>('[data-profile-name]')!.value;
      this.profileChoices.shift();
      if (!editing) this.completeGamepadJoin(choice.index, choice.token, profileId, enteredName);
      else {
        const current = this.liveGamepads.get(choice.index);
        const pad = Array.from(navigator.getGamepads?.() ?? []).find((item) => item?.connected && item.index === choice.index);
        const selectedProfile = profileId ? candidates.find((profile) => profile.id === profileId) : null;
        if ((choice.index < 0 || (current?.token === choice.token && pad && gamepadDescription(pad) === current.device)) && this.slots[choice.slot!] === choice.controller && (!profileId || (selectedProfile && this.gamepadProfiles.profiles.includes(selectedProfile)))) {
          this.playerNames[choice.slot!] = selectedProfile?.name ?? normalizePlayerName(enteredName, choice.slot!);
          // Copy the name into an independent profile when it belongs to another player/device.
          const reusable = selectedProfile && (!targetDevice || (selectedProfile.device === targetDevice && !assigned.has(selectedProfile.id)));
          const profile = reusable ? selectedProfile : this.gamepadProfiles.create(targetDevice ?? 'keyboard', this.playerNames[choice.slot!]!);
          if (targetDevice) {
            this.slotProfiles[choice.slot!] = profile.id;
            const target = this.liveGamepads.get(Number(choice.controller!.slice(8)));
            if (target) target.profile = profile.id;
          }
          this.persistRoster();
        }
      }
      this.renderSetup();
    }));
    this.root.querySelectorAll<HTMLElement>('[data-profile-delete]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.profileDelete!;
      const name = this.gamepadProfiles.profiles.find((profile) => profile.id === id)?.name;
      const deleted = new Set(editing ? this.gamepadProfiles.profiles.filter((profile) => profile.name === name).map((profile) => profile.id) : [id]);
      deleted.forEach((profile) => this.gamepadProfiles.remove(profile));
      this.slotProfiles.forEach((profile, slot) => { if (profile && deleted.has(profile)) this.slotProfiles[slot] = null; });
      this.liveGamepads.forEach((pad) => { if (pad.profile && deleted.has(pad.profile)) pad.profile = null; });
      this.renderSetup();
    }));
    this.root.querySelector('[data-profile-cancel]')?.addEventListener('click', () => { this.profileChoices.shift(); this.renderSetup(); });
  }

  private renderDebugTuning(): void {
    this.destroyGame();
    window.scrollTo({ top: 0 });
    if (!releaseTuningSaveEnabled()) {
      this.root.innerHTML = `
        <main class="release-screen premium-surface settings-screen" data-screen="laboratory">
          <header class="release-heading"><button class="screen-back" id="close-debug-lab" type="button">← Настройки</button><div><p class="eyebrow">ЛАБОРАТОРИЯ ДИЗАЙНА</p><h1>Только для локальной сборки</h1></div></header>
          <section class="release-panel laboratory-unavailable"><h2>Настройки релизного баланса защищены</h2><p>В публичной версии лаборатория показывает только это пояснение. Запустите проект на localhost, чтобы менять параметры следующего матча и сохранять их на этом устройстве.</p></section>
        </main>`;
      this.root.querySelector('#close-debug-lab')?.addEventListener('click', () => this.navigateBack());
      this.activateMenuFocus('laboratory');
      return;
    }
    this.root.innerHTML = `
      <main class="release-screen premium-surface debug-lab-screen" data-screen="laboratory">
        <header class="debug-lab-header release-heading">
          <button id="close-debug-lab" class="screen-back" type="button">← Настройки</button>
          <div><p class="eyebrow">GAME DESIGN / THIS DEVICE</p><h1>Лаборатория баланса</h1></div>
          <p>Изменения применятся к следующему матчу и сохраняются только в этом браузере. Сброс вернёт баланс текущей релизной сборки.</p>
          <div class="debug-lab-actions">
            <button id="reset-debug-tuning" type="button">Сбросить значения</button>
            <button id="save-debug-tuning" class="debug-save-button" type="button">Сохранить</button>
            ${releaseTuningSaveEnabled() ? '<button id="save-release-tuning" class="debug-release-save-button" type="button">Сохранить релизную версию</button>' : ''}
            <output id="debug-save-status" role="status">Настройки не передаются на другие устройства</output>
          </div>
        </header>
        <div class="debug-lab-content">
          ${TUNING_GROUPS.map((group) => `
            <section class="debug-group">
              <div class="debug-group-heading"><h2>${group.title}</h2><p>${group.description}</p></div>
              <div class="debug-fields">${group.fields.map((field) => this.debugScalarFieldMarkup(field)).join('')}</div>
            </section>
          `).join('')}
          <section class="debug-group">
            <div class="debug-group-heading"><h2>Сложность битвы</h2><p>Три готовых темпа. Эти значения определяют старт, рост скорости и частоту аномалий.</p></div>
            <div class="debug-ai-grid">${(['family', 'normal', 'sport'] as const).map((difficulty) => this.debugBattleDifficultyCardMarkup(difficulty)).join('')}</div>
          </section>
          <section class="debug-group">
            <div class="debug-group-heading"><h2>Компьютерные игроки</h2><p>Реакция, ускоренное опускание, ошибки и желание атаковать. Шансы задаются в процентах и остаются seed-воспроизводимыми.</p></div>
            <div class="debug-ai-grid">
              ${(['easy', 'medium', 'hard', 'expert'] as const).map((difficulty) => this.debugAiCardMarkup(difficulty)).join('')}
            </div>
          </section>
          <section class="debug-group"><div class="debug-group-heading"><h2>Наклоны телефона</h2><p>Пороги, сглаживание и повторный поворот для мобильного управления.</p></div><div class="debug-fields">${this.mobileTiltFieldsMarkup()}</div></section>
          <section class="debug-group">
            <div class="debug-group-heading"><h2>Сообщения матча</h2><p>Редактируйте короткие игровые надписи. Подстановки: <code>{level}</code>, <code>{senders}</code>, <code>{rows}</code>.</p></div>
            <div class="debug-fields debug-message-fields">${MESSAGE_TEMPLATE_KEYS.map((key) => this.debugMessageFieldMarkup(key)).join('')}</div>
          </section>
        </div>
      </main>
    `;
    this.bindDebugTuning();
  }

  private debugScalarFieldMarkup(field: TuningField): string {
    const value = this.tuning[field.key];
    return `
      <label class="debug-field">
        <span><b>${field.label}</b><small>${field.hint}</small></span>
        <span class="debug-number"><input type="number" value="${value}" min="${field.min}" max="${field.max}" step="${field.step}" data-tuning-key="${field.key}" aria-label="${field.label}" /><i>${field.unit}</i></span>
      </label>
    `;
  }

  private debugBattleDifficultyCardMarkup(difficulty: BattleDifficulty): string {
    const profile = this.tuning.battleDifficulties[difficulty];
    const field = (key: keyof typeof profile, label: string, hint: string, value: number, unit: string, min: number, max: number, step: number): string => `<label class="debug-field is-compact"><span><b>${label}</b><small>${hint}</small></span><span class="debug-number"><input type="number" value="${value}" min="${min}" max="${max}" step="${step}" data-battle-difficulty="${difficulty}" data-battle-key="${key}" aria-label="${BATTLE_DIFFICULTY_COPY[difficulty].label}: ${label}" /><i>${unit}</i></span></label>`;
    return `<article class="debug-ai-card"><h3>${BATTLE_DIFFICULTY_COPY[difficulty].label}</h3>${field('startingGravityMs', 'Начальное падение', 'Пауза между автоматическими шагами в начале матча.', profile.startingGravityMs, 'мс', 100, 2000, 10)}${field('accelerationPercent', 'Ускорение уровня', 'Насколько быстрее становится падение после уровня.', profile.accelerationPercent, '%', 0, 30, .25)}${field('piecesPerLevel', 'Фигур до аномалии', 'Сколько поставленных фигур нужно до следующего уровня и аномалии.', profile.piecesPerLevel, 'шт', 1, 50, 1)}</article>`;
  }

  private debugAiCardMarkup(difficulty: AiDifficulty): string {
    const labels: Record<AiDifficulty, string> = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный', expert: 'Эксперт' };
    const profile = this.tuning.ai[difficulty];
    const field = (key: keyof typeof profile, label: string, hint: string, value: number, unit: string, min: number, max: number, step: number): string => `
      <label class="debug-field is-compact">
        <span><b>${label}</b><small>${hint}</small></span>
        <span class="debug-number"><input type="number" value="${value}" min="${min}" max="${max}" step="${step}" data-ai-difficulty="${difficulty}" data-ai-key="${key}" aria-label="${labels[difficulty]}: ${label}" /><i>${unit}</i></span>
      </label>`;
    return `
      <article class="debug-ai-card">
        <h3>${labels[difficulty]}</h3>
        ${field('reactionMs', 'Реакция', 'Пауза между решениями ИИ.', profile.reactionMs, 'мс', 20, 1000, 5)}
        ${field('dropTapIntervalMs', 'Опускание', 'Интервал шагов вниз; 0 полностью выключает ускорение.', profile.dropTapIntervalMs ?? 0, 'мс', 0, 1500, 5)}
        ${field('errorChance', 'Ошибка', 'Шанс выбрать не лучший, но легальный вариант.', profile.errorChance * 100, '%', 0, 100, 1)}
        ${field('conflictIntentChance', 'Атака', 'Шанс приоритета двух и более линий в конфликтном режиме.', profile.conflictIntentChance * 100, '%', 0, 100, 1)}
      </article>
    `;
  }

  private debugMessageFieldMarkup(key: keyof GameTuning['messages']): string {
    const labels: Record<keyof GameTuning['messages'], [string, string]> = {
      roundStart: ['Старт раунда', 'Общее сообщение после отсчёта.'],
      levelUp: ['Новый уровень', 'Общее сообщение; использует {level}.'],
      finalPushTitle: ['Финальный рывок', 'Главная строка общего финального сообщения.'],
      finalPushHint: ['Подсказка финала', 'Вторая строка общего финального сообщения.'],
      incomingAttack: ['Входящая атака', 'В центре поля получателя; использует {senders} и {rows}; имя выделено цветом.'],
      attackImpact: ['Серые ряды получены', 'Больше не выводится: новые ряды видны на поле.'],
      activeDefense: ['Активная защита', 'В центре поля защищённого игрока.'],
      shieldBlock: ['Щит', 'В центре поля игрока, чей щит поглотил атаку.'],
    };
    const [label, hint] = labels[key];
    return `<label class="debug-field is-compact"><span><b>${label}</b><small>${hint}</small></span><textarea data-message-key="${key}" aria-label="${label}" rows="2">${escapeHtml(this.tuning.messages[key])}</textarea></label>`;
  }

  private mobileTiltFieldsMarkup(): string {
    const fields: Array<[keyof GameTuning['mobileTilt'], string, string, number, number, number]> = [
      ['horizontalThreshold', 'Чувствительность вбок', 'Наклон для сдвига влево и вправо.', 5, 45, 1], ['rotateThreshold', 'Поворот от себя', 'Наклон для одного поворота.', 5, 45, 1], ['dropThreshold', 'Ускорение к себе', 'Наклон для удерживаемого ускорения.', 5, 45, 1], ['deadZone', 'Мёртвая зона', 'Наклоны в этой зоне не учитываются.', 0, 20, 1], ['smoothing', 'Сглаживание', 'Доля нового показания датчика.', 0.05, 1, 0.05], ['rotateRearmMs', 'Повторный поворот', 'Пауза до следующего поворота после возврата в нейтраль.', 0, 1000, 10],
    ];
    return fields.map(([key, label, hint, min, max, step]) => `<label class="debug-field"><span><b>${label}</b><small>${hint}</small></span><span class="debug-number"><input type="number" data-mobile-tilt="${key}" value="${this.tuning.mobileTilt[key]}" min="${min}" max="${max}" step="${step}" aria-label="${label}" /><i>${key === 'smoothing' ? '' : key === 'rotateRearmMs' ? 'мс' : '°'}</i></span></label>`).join('');
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
        if (status) status.textContent = status.value = 'Ошибка: браузер не дал сбросить локальные настройки';
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
    status.value = saved ? 'Сохранено только в этом браузере' : 'Ошибка: браузер не дал сохранить локальные настройки';
    status.textContent = status.value;
    button.disabled = false;
  }

  private async saveReleaseTuning(): Promise<void> {
    const button = this.root.querySelector<HTMLButtonElement>('#save-release-tuning');
    const status = this.root.querySelector<HTMLOutputElement>('#debug-save-status');
    if (!button || !status || !releaseTuningSaveEnabled()) return;
    button.disabled = true;
    status.value = 'Сохраняю релизную версию…';
    status.textContent = status.value;
    try {
      const response = await fetch('/__debug/game-tuning', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.tuning),
      });
      const result = await response.json() as { ok?: boolean; file?: string; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? 'Не удалось сохранить релизную версию');
      status.value = `Релизная версия сохранена: ${result.file ?? 'config/game-tuning.json'}`;
      status.textContent = status.value;
    } catch (error) {
      status.value = error instanceof Error ? `Ошибка: ${error.message}` : 'Ошибка сохранения';
      status.textContent = status.value;
    } finally {
      button.disabled = false;
    }
  }

  private slotMarkup(index: number, value: SlotValue, survival = false): string {
    const style = this.slotTileStyles[index] ?? DEFAULT_TILE_STYLE_SELECTION;
    const human = isManualSlot(value);
    const playerClass = `player-${index + 1}`;
    if (value === 'off') {
      return `<article class="participant-card empty ${playerClass}" data-slot-card="${index}"><div><strong>Свободное место</strong><small>Нажмите Y на свободном геймпаде</small></div><span class="join-actions"><button type="button" data-add-human="${index}">Добавить игрока</button>${survival ? '' : `<button type="button" data-add-ai="${index}">Добавить ИИ</button>`}</span></article>`;
    }
    return `
      <article class="participant-card occupied ${playerClass}" data-slot-card="${index}">
        <header>${human ? `<span class="editable-name-field"><textarea class="player-name editable-player-name" data-player-name="${index}" aria-label="Имя игрока ${index + 1}" rows="1" maxlength="18">${escapeHtml(this.playerNameForSlot(index))}</textarea></span>` : '<strong class="player-name">ИИ</strong>'}<button class="remove-participant" type="button" data-remove-slot="${index}" aria-label="Удалить ${human ? escapeHtml(this.playerNameForSlot(index)) : 'ИИ'}" title="Удалить"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg></button></header>
        <label><span>${human ? 'Управление' : 'Сложность'}</span><select data-slot="${index}" aria-label="Участник ${index + 1}">${this.slotOptions(index, value, survival).filter((option) => option.value !== 'off').map((option) => `<option value="${option.value}" ${option.value === value ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>
        <label><span>Стиль фигур</span><span class="tile-style-control">${this.tileStylePreviewMarkup(index, style)}<select data-tile-style="${index}" aria-label="Стиль участника ${index + 1}"><option value="random" ${style === 'random' ? 'selected' : ''}>Случайный</option>${TILE_STYLES.map((option) => `<option value="${option.id}" ${option.id === style ? 'selected' : ''}>${option.label}</option>`).join('')}</select></span></label>
      </article>
    `;
  }

  private slotOptions(slotIndex: number, selected: SlotValue, survival = false): Array<{ value: SlotValue; label: string; disabled?: boolean }> {
    const assigned = new Set(this.slots.filter((value, index) => index !== slotIndex && isManualSlot(value)));
    const options = SLOT_OPTIONS.filter((option) => !survival || isManualSlot(option.value)).map((option) => ({ ...option, disabled: assigned.has(option.value) }));
    const connected = connectedGamepads();
    const gamepadOptions = connected.map((gamepad) => ({
      value: gamepad.controller,
      label: `Геймпад ${gamepad.index + 1}`,
      disabled: assigned.has(gamepad.controller),
    }));
    if (isGamepadSlot(selected) && !connected.some((gamepad) => gamepad.controller === selected)) {
      gamepadOptions.push({ value: selected, label: `Геймпад ${Number(selected.slice(8)) + 1} · отключён`, disabled: false });
    }
    return [...options, ...gamepadOptions];
  }

  private gamepadFor(controller: GamepadController): ConnectedGamepad | null {
    return connectedGamepads().find((gamepad) => gamepad.controller === controller) ?? null;
  }

  private gamepadAvailabilityErrors(configs: readonly ParticipantConfig[] = this.configs()): Array<{ message: string }> {
    return configs.some((config) => isGamepadController(config.controller) && !this.gamepadFor(config.controller))
      ? [{ message: 'Подключите или выберите доступный геймпад.' }]
      : [];
  }

  private tileStylePreviewMarkup(index: number, style: TileStyleSelection): string {
    return `<span class="tile-style-preview" data-style-preview="${index}" data-style="${style}" aria-hidden="true"><i></i><i></i><i></i></span>`;
  }

  private configs(): ParticipantConfig[] {
    if (isMobilePlayViewport()) {
      const player: ParticipantConfig = { id: 'player-1', label: this.playerNameForSlot(0), controller: 'mobile-touch', tileStyle: this.slotTileStyles[0] ?? DEFAULT_TILE_STYLE_SELECTION };
      if (this.selectedMode === 'survival') return [player];
      return [player, ...Array.from({ length: this.mobileSettings.aiCount }, (_, index): ParticipantConfig => ({ id: `ai-${index + 1}`, label: 'ИИ', controller: 'ai', difficulty: this.mobileSettings.aiDifficulty, tileStyle: this.slotTileStyles[index + 1] ?? DEFAULT_TILE_STYLE_SELECTION }))];
    }
    if (this.selectedMode === 'survival') {
      return this.slots.flatMap((value, index): ParticipantConfig[] => {
        if (!isManualSlot(value)) return [];
        const gamepad = isGamepadSlot(value) ? this.gamepadFor(value) : null;
        return [{ id: `player-${index + 1}`, label: this.playerNameForSlot(index), controller: value, controllerLabel: gamepad?.label, tileStyle: this.slotTileStyles[index] ?? DEFAULT_TILE_STYLE_SELECTION }];
      });
    }
    return this.slots.flatMap((value, index): ParticipantConfig[] => {
      if (value === 'off') return [];
      if (isManualSlot(value)) {
        const gamepad = isGamepadSlot(value) ? this.gamepadFor(value) : null;
        return [{ id: `player-${index + 1}`, label: this.playerNameForSlot(index), controller: value, controllerLabel: gamepad?.label, tileStyle: this.slotTileStyles[index] ?? DEFAULT_TILE_STYLE_SELECTION }];
      }
      return [{
        id: `player-${index + 1}`,
        label: 'ИИ',
        controller: 'ai',
        difficulty: value.slice(3) as AiDifficulty,
        tileStyle: this.slotTileStyles[index] ?? DEFAULT_TILE_STYLE_SELECTION,
      }];
    });
  }

  private playerNameForSlot(index: number): string {
    return this.playerNames[index] ?? `Игрок ${index + 1}`;
  }

  private showValidation(): boolean {
    const configs = this.configs();
    const errors = [
      ...(this.selectedMode === 'survival' ? validateSurvivalParticipants(configs) : validateParticipants(configs)),
      ...this.gamepadAvailabilityErrors(configs),
      ...validateDurationMinutes(this.durationMinutes),
      ...validateMatchOptions(configs, this.pacing),
    ];
    const output = this.root.querySelector<HTMLElement>('#setup-error');
    const button = this.root.querySelector<HTMLButtonElement>('#start-match');
    if (output) output.textContent = errors[0]?.message ?? '';
    if (button) button.disabled = errors.length > 0;
    return errors.length === 0;
  }

  private startMatch(): void {
    if (!this.showValidation()) return;
    this.disconnectPlayerNameResizeObserver();
    this.countdownReady = false;
    this.playerEventRegions.clear();
    this.audio.unlock();
    this.audio.startGame();
    this.router.open('arena', this.router.current());
    desktop?.setSafeMenu(false);
    this.menuFocus.suspend();
    const configs = this.configs();
    const mobileMatch = configs[0]?.controller === 'mobile-touch';
    const seed = isLocalPlaytestFlag('playtest-anomaly-arrival') ? 4217
      : isLocalPlaytestFlag('playtest-shield-impact') ? 173 : this.createSeed();
    const activeTuning = this.tuning;
    const engine = new MatchEngine(configs, seed, this.durationMinutes, this.pacing, activeTuning, this.selectedMode === 'survival');
    if (isLocalPlaytestFlag('playtest-anomaly-arrival')) prepareAnomalyArrivalPlaytest(engine);
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
        ${mobileMatch ? '' : `<div class="arena-topline">
          <div class="arena-brand"><strong>BRICKS WAR</strong><span id="match-status" class="match-status">ПОДГОТОВКА</span></div>
          <div id="round-timer" class="round-timer" aria-label="${initialClock.ariaLabel}">
            <span id="match-clock" class="round-timer-value">${formatClock(initialClock.milliseconds)}</span>
            <small>${initialClock.label}</small>
          </div>
          <div class="arena-utilities"><em id="pressure-status">АВТОПАУЗА ВКЛАДКИ</em><button id="manual-pause" class="pause-control" type="button" aria-label="Поставить матч на паузу" aria-pressed="false"><span aria-hidden="true">Ⅱ</span><b>ПАУЗА</b></button>${this.audioButtonMarkup()}</div>
        </div>`}
        <div class="game-stage" id="game-stage">
          <div id="game-canvas" class="game-canvas"></div>
          <div id="hud-grid" class="hud-grid" aria-live="polite"></div>
          <div id="arena-event-layer" class="arena-event-layer" aria-live="assertive"><div id="arena-event-notice" class="match-event-plaque arena-event-notice" hidden></div></div>
          <div id="countdown" class="countdown" aria-label="Обратный отсчёт" hidden>3</div>
          <div id="pause-overlay" class="pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title" hidden>
            <section id="pause-menu-panel" class="pause-panel">
              <span id="pause-title">Матч на паузе</span>
              <small id="pause-copy">${mobileMatch ? 'Коснитесь кнопки ниже, чтобы продолжить' : 'Нажмите Escape или кнопку ниже, чтобы продолжить'}</small>
              <button id="continue-match" class="pause-continue" type="button">Продолжить ${mobileMatch ? '' : '<kbd>Esc</kbd>'}</button>
              <div id="manual-pause-actions" class="pause-actions" hidden><button id="restart-match" type="button">Заново</button><button id="pause-settings" type="button">Настройки</button><button id="return-to-menu" type="button">Главное меню</button></div>
            </section>
            <section id="pause-settings-panel" class="pause-panel pause-settings-panel" hidden>
              <span>Настройки</span>
              ${this.setupAudioMarkup()}
              ${mobileMatch ? '' : `<button class="settings-action" id="pause-toggle-fullscreen" type="button"><span><strong>Полноэкранный режим</strong></span><b>${document.fullscreenElement ? 'Вкл' : 'Выкл'}</b></button>`}
              <label class="settings-action"><span><strong>Спокойные эффекты</strong><small>Меньше движения и вспышек</small></span><input id="pause-calm-effects" type="checkbox" ${this.releaseSettings.calmEffects ? 'checked' : ''} /></label>
              <output id="pause-settings-status" class="settings-status" role="status"></output>
              <button id="pause-settings-back" type="button">← Назад к паузе</button>
            </section>
          </div>
          <div id="viewport-warning" class="viewport-warning">Увеличьте окно для читаемого поля</div>
          ${mobileMatch ? `<div class="mobile-match-actions"><button id="manual-pause" class="mobile-match-action" type="button" aria-label="Поставить матч на паузу" aria-pressed="false"><span aria-hidden="true">Ⅱ</span></button><output id="mobile-match-timer" class="mobile-match-timer" aria-label="${initialClock.ariaLabel}">${formatClock(initialClock.milliseconds)}</output></div>` : ''}
          ${mobileMatch ? this.mobileGameControlsMarkup() : ''}
        </div>
        <div id="results-layer"></div>
      </main>
    `;

    const scene = new PlayScene({
      engine: new LocalMatchSession(engine),
      input,
      aiControllers,
      onReady: () => {
        this.countdownReady = true;
        this.lastHudKey = '';
        this.updateHud(engine.state);
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
      transparent: false,
      antialias: true,
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
        if (state) state.textContent = document.fullscreenElement ? 'Вкл' : 'Выкл';
      }).catch(() => {
        const status = this.root.querySelector<HTMLOutputElement>('#pause-settings-status');
        if (status) status.textContent = 'Браузер не разрешил изменить полноэкранный режим';
      });
    });
    this.root.querySelector<HTMLInputElement>('#pause-calm-effects')?.addEventListener('change', (event) => {
      this.releaseSettings.calmEffects = (event.currentTarget as HTMLInputElement).checked;
      document.body.classList.toggle('calm-effects', this.releaseSettings.calmEffects);
      saveReleaseSettings(this.releaseSettings);
    });
    const returnToMenu = (): void => { this.destroyGame(); this.router.open('main-menu'); this.renderMainMenu(); };
    this.root.querySelector('#return-to-menu')?.addEventListener('click', returnToMenu);
    this.bindAudioToggle();
    this.bindVolumeControl();
    this.bindSfxPresetControl();
    if (mobileMatch) this.bindMobileMatchInput(input);
    if (isLocalPlaytestFlag('playtest-board-events')) {
      Object.assign(window, {__boardEffectsQA: {engine, prepareClearPlaytest, audio: this.audio}});
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
    return `<div class="mobile-touch-zones" data-mobile-touch-zones aria-label="Касания: внизу влево, ускорение и вправо; выше — поворот"><span class="mobile-touch-zone mobile-touch-zone-left" aria-hidden="true">←</span><span class="mobile-touch-zone mobile-touch-zone-down" aria-hidden="true">↓</span><span class="mobile-touch-zone mobile-touch-zone-right" aria-hidden="true">→</span></div>`;
  }

  private updateArenaLayout(layout: ArenaLayout): void {
    this.latestArenaLayout = layout;
    const hud = this.root.querySelector<HTMLElement>('#hud-grid');
    if (!hud) return;
    hud.dataset.layout = layout.mode;
    hud.dataset.cellSize = String(layout.cellSize);
    hud.style.setProperty('--arena-columns', String(layout.columns));
    hud.style.setProperty('--arena-rows', String(layout.rows));
    hud.style.setProperty('--arena-card-width', `${layout.cardWidth}px`);
    hud.style.setProperty('--arena-card-height', `${layout.cardHeight}px`);
    if (layout.mode === 'mobile-solo' && this.latestHudState) {
      this.lastHudKey = '';
      this.updateHud(this.latestHudState);
    }
  }

  private updateHud(state: MatchState): void {
    this.latestHudState = state;
    if (this.countdownReady || state.phase !== 'countdown') this.audio.sync(state);
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
    const hudKey = `${cardConflictKey}:${transitionKey}:${state.participants.map((participant) => `${participant.board.alive}:${participant.placement}:${participant.score}:${participant.placedPieces}:${participant.shieldCount}:${participant.shieldCharge}:${participant.shieldReady}:${participant.lineClearStreak}:${participantLevelUpNoticeKey(participant.levelUpEvent)}:${participant.board.active?.definition.source ?? '-'}:${participant.board.nextPiece.id}`).join('|')}`;
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
        const senderNames = senderParticipants.map((sender) => sender.config.label);
        const senderAccent = senderParticipants.length
          ? playerAccentForSlot(state.participants.indexOf(senderParticipants[0]!))
          : playerAccentForSlot(index);
        const defended = impactActive && (state.conflictImpactEvent?.defendedRecipientIds?.includes(participant.config.id) ?? false);
        const shieldBlocked = impactActive && (state.conflictImpactEvent?.shieldedRecipientIds?.includes(participant.config.id) ?? false);
        const cleanupRows = state.cleanupEvents.find((event) => event.participantId === participant.config.id)?.rows ?? 0;
        const reflecting = state.shieldPresentations.some((event) => event.participantId === participant.config.id && event.remainingMs > 0);
        const participantEvent = reflecting ? null : participantMatchEvent(state, participant.config.id, this.tuning.messages, senderNames);
        const noticeEventKey = participantEvent
          ? `${participantEvent.kind}:${participant.levelUpEvent?.serial ?? 0}:${state.anomalyBurnSerial}:${state.shieldChargeSerial}:${state.cleanupSerial}:${state.pendingConflict?.serial ?? state.conflictImpactEvent?.serial ?? 0}:${participant.config.id}`
          : null;
        const noticeRegion = noticeEventKey
          ? this.playerEventRegions.resolve(participant.config.id, noticeEventKey, participant.board.grid, participant.board.active)
          : null;
        if (!noticeEventKey) this.playerEventRegions.release(participant.config.id);
        const identity = hudIdentityForParticipant(index, state.options.matchVariant);
        const shieldInventory = shieldInventoryMarkup(participant, state);
        const compactMobileAi = isMobilePlayViewport() && participant.config.controller === 'ai';
        const mobilePlayer = mobileSoloMatch && index === 0;
        const mobileCard = this.latestArenaLayout?.participantCards?.[index];
        const mobileStyle = mobileCard ? `--mobile-x:${mobileCard.x}px;--mobile-y:${mobileCard.y}px;--mobile-width:${mobileCard.cardWidth}px;--mobile-height:${mobileCard.cardHeight}px;` : '';
        const identityLabel = compactMobileAi ? this.controllerLabel(participant.config).replace(/^ИИ · /, '') : participant.config.label;
        const identityMarkup = `<div class="hud-identity"><strong class="${leaderIds.has(participant.config.id) ? 'is-leader' : ''}">${escapeHtml(identityLabel)}</strong>${identity.teamLabel ? `<i class="hud-team">${identity.teamLabel}</i>` : ''}</div>`;
        const statsMarkup = `<div class="hud-stats"><b>${participant.score.toLocaleString('ru-RU')} очков</b><span>${formatPieces(participant.placedPieces)}</span></div>`;
        const mobilePlayerMarkup = mobilePlayer
          ? `<div class="mobile-player-summary">${identityMarkup}${statsMarkup}</div>${shieldInventory}${nextPiecePreviewMarkup(participant.board.nextPiece)}`
          : `${identityMarkup}${statsMarkup}${shieldInventory}${compactMobileAi ? '' : nextPiecePreviewMarkup(participant.board.nextPiece)}`;
        return `
        <article class="hud-card ${mobileSoloMatch && index === 0 ? 'mobile-player-card' : ''} ${compactMobileAi ? 'mobile-ai-card' : ''} hud-palette-${identity.palette} ${participant.board.alive ? '' : 'is-out'} ${participant.board.active?.definition.source === 'anomaly' ? 'has-active-anomaly' : ''} ${senderRows ? 'is-conflict-sender' : ''} ${incomingRows ? 'is-conflict-target' : ''} ${impactRows ? 'is-conflict-impact' : ''} ${defended || shieldBlocked ? 'is-conflict-defense' : ''} ${cleanupRows ? 'is-cleaning' : ''} ${participant.shieldReady ? 'has-shield' : ''} ${participantEvent ? 'has-player-event' : ''}" style="--player-name-color:${playerAccentForSlot(index)};--sender-color:${senderAccent};${mobileStyle}" data-team="${identity.teamLabel ? identity.palette : ''}" data-tile-style="${participant.resolvedTileStyle}" data-next-piece="${participant.board.nextPiece.id}" data-active-y="${participant.board.active?.y ?? ''}" data-attack-rows="${senderRows}" data-incoming-rows="${incomingRows || impactRows}" data-event-kind="${participantEvent?.kind ?? ''}" data-shield-remaining-ms="${state.shieldPresentations.find(e => e.participantId === participant.config.id)?.remainingMs ?? 0}" data-shield-debt="${state.shieldPresentations.filter(e => e.participantId === participant.config.id).reduce((n,e) => n + e.deferredImpacts.reduce((m,i) => m + i.rows, 0), 0)}" data-gray-rows="${participant.board.grid.filter(row => row.some(cell => cell === 'garbage')).length}">
          ${mobilePlayerMarkup}

          ${participantEvent ? `<span class="player-event-symbol" data-kind="${participantEvent.kind}" data-accent="${participantEvent.accent}" style="--event-duration:${participantEvent.lifetimeMs}ms" aria-hidden="true">${matchEventIconMarkup(participantEvent.icon)}</span><div class="match-event-plaque player-event-notice is-${noticeRegion}" data-kind="${participantEvent.kind}" data-accent="${participantEvent.accent}" style="--event-duration:${participantEvent.lifetimeMs}ms" role="status" aria-label="${escapeHtml([participantEvent.title, participantEvent.detail].filter(Boolean).join('. '))}">${matchEventPlaqueMarkup(participantEvent, participantEvent.template && participantEvent.values ? formatParticipantEventMarkup(participantEvent.template, participantEvent.values) : escapeHtml(participantEvent.title))}</div>` : ''}
          ${participant.board.alive ? '' : '<b class="out-label">ВЫБЫЛ</b>'}
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
    const globalEvent = globalMatchEvent(state, this.tuning.messages);
    const chromeKey = `${state.phase}:${pauseKey}:${this.countdownReady}:${Math.ceil(state.countdownMs / 1000)}:${Math.ceil((Number.isFinite(state.durationMs) ? state.remainingMs : state.elapsedMs) / 1000)}:${state.gravityLevel}:${state.elapsedMs >= state.pressureStartMs}:${Math.ceil(Math.max(0, state.nextPressureAtMs - state.elapsedMs) / 1000)}:${globalEvent?.kind ?? ''}:${state.globalEventHold?.level ?? 0}:${pendingMax}:${impactMax}`;
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
    if (pauseTitle) pauseTitle.textContent = manuallyPaused ? 'Матч на паузе' : 'Матч приостановлен';
    const pauseCopy = this.root.querySelector<HTMLElement>('#pause-copy');
    const mobileMatch = this.root.querySelector('.mobile-solo-arena') !== null;
    this.root.querySelector<HTMLElement>('.arena-screen')?.classList.toggle('is-mobile-pause-open', mobileMatch && state.phase === 'paused');
    if (pauseCopy) {
      pauseCopy.textContent = manuallyPaused
        ? hiddenPaused ? 'Матч останется на паузе после возвращения во вкладку' : mobileMatch ? 'Коснитесь кнопки ниже, чтобы продолжить' : 'Нажмите Escape или кнопку ниже, чтобы продолжить'
        : 'Вернитесь во вкладку, чтобы продолжить';
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
      pauseButton.setAttribute('aria-label', manuallyPaused ? 'Продолжить матч' : 'Поставить матч на паузу');
      pauseButton.classList.toggle('is-paused', manuallyPaused);
      const icon = pauseButton.querySelector('span');
      const label = pauseButton.querySelector('b');
      if (pauseButton.classList.contains('mobile-match-action')) pauseButton.querySelector('span')!.textContent = manuallyPaused ? '▶' : 'Ⅱ';
      if (icon) icon.textContent = manuallyPaused ? '▶' : 'Ⅱ';
      if (label) label.textContent = manuallyPaused ? 'ПРОДОЛЖИТЬ' : 'ПАУЗА';
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
      status.textContent = state.phase === 'countdown' ? 'ПОДГОТОВКА' : state.phase === 'playing' ? `УРОВЕНЬ ${state.gravityLevel + 1}` : state.phase === 'paused' ? 'ПАУЗА' : 'ФИНИШ';
    }
    const roundTimer = this.root.querySelector<HTMLElement>('#round-timer');
    const mobileMatchTimer = this.root.querySelector<HTMLElement>('#mobile-match-timer');
    const clockPresentation = matchClockPresentation(!Number.isFinite(state.durationMs), state.elapsedMs, state.remainingMs);
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
        ? `ДАВЛЕНИЕ · СЛЕДУЮЩИЙ РЯД ${formatClock(Math.max(0, state.nextPressureAtMs - state.elapsedMs))}`
        : 'АВТОПАУЗА ВКЛАДКИ';
      pressure.classList.toggle('is-pressure', inPressure);
    }
  }

  private showResults(state: MatchState): void {
    const layer = this.root.querySelector<HTMLElement>('#results-layer');
    if (!layer) return;
    this.router.open('results', 'main-menu');
    const ordered = [...state.participants].sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99));
    const survival = state.isSurvival;
    const simultaneous = state.endReason === 'simultaneous-elimination';
    const teamBattle = state.options.matchVariant === 'teams';
    const resultTitle = simultaneous ? 'Одновременное выбывание'
      : teamBattle && state.options.battleTimeMode === 'until-victory' ? 'Последняя команда'
      : 'Последний выживший';
    const finishedAt = Date.now();
    const survivalResult = survival ? saveSurvivalRecords(state.participants.map((participant) => ({
      name: participant.config.label,
      elapsedMs: participant.survivalMs,
      lineScore: participant.score,
      finishedAt,
      placedPieces: participant.placedPieces,
    }))) : null;
    const currentRecordIds = new Set(survivalResult?.rankedIds ?? []);
    const teamSummary = state.options.matchVariant === 'teams'
      ? teamScores(state.participants.map((participant, index) => ({ id: participant.config.id, score: participant.score, alive: participant.board.alive, teamId: teamIdForSlot(index) ?? undefined })))
      : [];
    layer.innerHTML = `
      <section class="results-panel ${survival ? 'survival-results-panel' : ''}" aria-labelledby="results-title">
        <p class="eyebrow">${survival ? 'РЕЗУЛЬТАТЫ ВЫЖИВАНИЯ' : state.endReason === 'timeout' ? 'ВРЕМЯ ВЫШЛО' : resultTitle.toLocaleUpperCase('ru-RU')}</p>
        <h2 id="results-title">${survival ? 'Итоги выживания' : state.endReason === 'timeout' ? 'Время вышло' : resultTitle}</h2>
        ${simultaneous ? '<p class="survival-result-copy">Последние соперники выбыли одновременно. Победитель определён по очкам; при равных очках — ничья.</p>' : ''}
        ${survival ? `<p class="survival-result-copy">Место — по очкам за линии.</p><div class="survival-results-columns"><section class="survival-current-results" aria-labelledby="match-results-heading"><h3 id="match-results-heading">Результаты матча</h3><ol class="results-list survival-match-results">${ordered.map((participant) => `<li class="place-${participant.placement}" style="--player-name-color:${playerAccentForSlot(state.participants.indexOf(participant))}"><span class="result-place">#${participant.placement}</span><span><strong>${state.winnerIds.includes(participant.config.id) ? '♛ ' : ''}${escapeHtml(participant.config.label)}</strong><small>${this.controllerLabel(participant.config)} · ${formatDuration(participant.survivalMs)}</small></span><time>${participant.score.toLocaleString('ru-RU')}</time></li>`).join('')}</ol></section><section class="survival-local-records" aria-labelledby="local-records-heading"><h3 id="local-records-heading">Локальный топ-10</h3><ol class="results-list survival-record-list">${survivalResult?.records.map((record) => `<li class="${currentRecordIds.has(record.id) ? 'is-current-record' : ''}"><span class="result-place">#${1 + survivalResult.records.filter((other) => other.lineScore > record.lineScore).length}</span><span><strong>${escapeHtml(record.name)}</strong></span><span class="record-metrics"><time>${record.lineScore.toLocaleString('ru-RU')}</time><small class="record-duration" aria-label="Время выживания ${formatDuration(record.elapsedMs).slice(0, -2)}">◷ ${formatDuration(record.elapsedMs).slice(0, -2)}</small></span></li>`).join('')}</ol></section></div>` : ''}
        ${teamSummary.length ? `<div class="team-results">${teamSummary.map((team) => {
          const members = state.participants.filter((_participant, index) => teamIdForSlot(index) === team.teamId);
          const winner = members.some((participant) => state.winnerIds.includes(participant.config.id));
          return `<p class="${winner ? 'is-winner' : ''}">${winner ? '♛ ' : ''}${team.teamId === 'team-1' ? 'КОМАНДА СОЛНЦА' : 'КОМАНДА НЕБА'} · ${(simultaneous ? team.score * 2 : team.score).toLocaleString('ru-RU')}<small>${members.map((participant) => { const memberIndex = state.participants.indexOf(participant); return `<span style="--player-name-color:${playerAccentForSlot(memberIndex)}">${escapeHtml(participant.config.label)}</span>: ${participant.score.toLocaleString('ru-RU')}${participant.board.alive || simultaneous ? '' : ' ×½'}`; }).join(' · ')}</small></p>`;
        }).join('')}</div>` : ''}
        ${survival ? '' : `<ol class="results-list">
          ${ordered.map((participant) => `
            <li class="place-${participant.placement} ${participant.board.alive ? '' : 'is-eliminated'}" style="--player-name-color:${playerAccentForSlot(state.participants.indexOf(participant))}">
              <span class="result-place">#${participant.placement}</span>
              <span><strong>${state.winnerIds.includes(participant.config.id) ? '♛ ' : ''}${escapeHtml(participant.config.label)}${participant.board.alive ? '' : ' (ВЫБЫЛ)'}</strong><small>${this.controllerLabel(participant.config)} · ${formatPieces(participant.placedPieces)} · ${formatDuration(participant.survivalMs)}</small></span>
              <time>${participant.score.toLocaleString('ru-RU')}</time>
            </li>
          `).join('')}
        </ol>`}
        <div class="results-actions" style="visibility:hidden" aria-hidden="true"><button disabled id="play-again" class="primary-button" type="button"><span>Повторить</span><b>↻</b></button><button disabled id="results-main-menu" type="button">Главное меню</button></div>
      </section>
    `;
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

  private audioButtonMarkup(): string {
    const enabled = !this.audio.isMuted();
    return `<button class="audio-toggle" type="button" aria-label="${enabled ? 'Отключить звук' : 'Включить звук'}" aria-pressed="${enabled}">♪ ЗВУК ${enabled ? 'ВКЛ' : 'ВЫКЛ'}</button>`;
  }

  private setupAudioMarkup(): string {
    const music = Math.round(this.audio.getMusicVolume() * 100);
    const effects = Math.round(this.audio.getEffectsVolume() * 100);
    return `
      <div class="setup-audio-controls">
        ${this.audioButtonMarkup()}
        <label class="volume-control" for="music-volume">
          <span>Музыка</span>
          <input id="music-volume" type="range" min="0" max="100" step="1" value="${music}" aria-label="Громкость музыки" />
          <output id="music-volume-value" for="music-volume">${music}%</output>
        </label>
        <label class="volume-control" for="effects-volume">
          <span>Эффекты</span>
          <input id="effects-volume" type="range" min="0" max="100" step="1" value="${effects}" aria-label="Громкость эффектов" />
          <output id="effects-volume-value" for="effects-volume">${effects}%</output>
        </label>
        <label class="sfx-preset-control" for="sfx-preset">
          <span><strong>Набор эффектов</strong><small>Цельный стиль для меню и матча</small></span>
          <select id="sfx-preset" aria-label="Набор звуковых эффектов">
            ${SFX_PACK_OPTIONS.map((pack) => `<option value="${pack.id}" ${this.releaseSettings.sfxPreset === pack.id ? 'selected' : ''}>${pack.label}</option>`).join('')}
          </select>
        </label>
      </div>
    `;
  }

  private audioPrototypeGalleryMarkup(): string {
    const batch = (category: AudioPreviewCategory, title: string, directions: readonly { id: string; label: string }[]) => `<section class="release-panel audio-prototype-gallery"><header><p class="eyebrow">АУДИО-ПРОТОТИПЫ</p><h2>${title}</h2></header><div class="audio-prototype-buttons">${directions.map((direction) => `<button type="button" data-audio-preview="${category}" data-audio-direction="${direction.id}"><strong>${direction.label}</strong><small>▶ Прослушать</small></button>`).join('')}</div></section>`;
    const sfx = SFX_PACK_OPTIONS;
    return `<section class="audio-prototype-wrap" aria-label="Галерея аудиопрототипов">
      ${batch('gameplay-music', 'Темы матча · Calm / Escalation / Final Push', MUSIC_DIRECTIONS)}
      ${batch('menu-music', 'Тема меню', MUSIC_DIRECTIONS.map((direction) => ({ id: direction.id, label: direction.menuLabel })))}
      ${batch('tactile', 'Тактильные действия · rotate / lock / line clear', sfx)}
      ${batch('rewards', 'Награды · линии / уровень / результат', sfx)}
      ${batch('threats', 'Угрозы · атака / удар / Final Push', sfx)}
      ${batch('defenses', 'Защита и аномалии · щит / блок / anomaly', sfx)}
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
        saveReleaseSettings(this.releaseSettings);
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
        this.audio.unlock();
        this.audio.toggleMuted();
        this.releaseSettings.muted = this.audio.isMuted();
        saveReleaseSettings(this.releaseSettings);
        this.refreshAudioButtons();
      });
    });
  }

  private bindVolumeControl(): void {
    const bind = (kind: 'music' | 'effects'): void => {
      const slider = this.root.querySelector<HTMLInputElement>(`#${kind}-volume`);
      const output = this.root.querySelector<HTMLOutputElement>(`#${kind}-volume-value`);
      if (!slider || !output) return;
      slider.addEventListener('input', () => {
        this.audio.unlock();
        const value = Number(slider.value) / 100;
        const normalized = kind === 'music' ? this.audio.setMusicVolume(value) : this.audio.setEffectsVolume(value);
        const percentage = Math.round(normalized * 100);
        this.releaseSettings[kind] = normalized;
        saveReleaseSettings(this.releaseSettings);
        slider.value = String(percentage);
        output.value = `${percentage}%`;
        output.textContent = `${percentage}%`;
      });
    };
    bind('music');
    bind('effects');
  }

  private bindSfxPresetControl(): void {
    const select = this.root.querySelector<HTMLSelectElement>('#sfx-preset');
    if (!select) return;
    select.addEventListener('change', async () => {
      const preset = select.value as SfxPresetId;
      if (!isSfxPresetId(preset)) return;
      const revision = ++this.sfxPreferenceRevision;
      this.audio.unlock();
      this.releaseSettings.sfxPreset = preset;
      saveReleaseSettings(this.releaseSettings);
      const active = await this.audio.setSfxPreset(preset);
      if (this.sfxPreferenceRevision !== revision) return;
      this.releaseSettings.sfxPreset = active;
      select.value = active;
      saveReleaseSettings(this.releaseSettings);
    });
  }

  private refreshAudioButtons(): void {
    const enabled = !this.audio.isMuted();
    this.root.querySelectorAll<HTMLButtonElement>('.audio-toggle').forEach((button) => {
      button.textContent = `♪ ЗВУК ${enabled ? 'ВКЛ' : 'ВЫКЛ'}`;
      button.setAttribute('aria-label', enabled ? 'Отключить звук' : 'Включить звук');
      button.setAttribute('aria-pressed', String(enabled));
    });
  }

  private controllerLabel(config: ParticipantConfig): string {
    if (config.controller === 'human-1') return 'КЛАВИАТУРА 1 · WASD';
    if (config.controller === 'human-2') return 'КЛАВИАТУРА 2 · СТРЕЛКИ';
    if (isGamepadController(config.controller)) return `ГЕЙМПАД ${Number(config.controller.slice('gamepad-'.length)) + 1} · ${config.controllerLabel ?? 'НЕДОСТУПЕН'}`;
    const labels: Record<AiDifficulty, string> = {
      easy: 'ЛЁГКИЙ',
      medium: 'СРЕДНИЙ',
      hard: 'СЛОЖНЫЙ',
      expert: 'ЭКСПЕРТ',
    };
    return `ИИ · ${labels[config.difficulty ?? 'medium']}`;
  }

  private createSeed(): number {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] ?? 1;
  }

  private destroyGame(): void {
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
    menu.hidden = open;
    settings.hidden = !open;
    if (open) this.router.open('settings', 'pause');
    else this.router.open('pause', 'arena');
    this.activateMenuFocus(open ? 'settings' : 'pause');
  }
}
