import {drawBoardEventEffects} from './boardEventEffects';
import { shieldPresentationForParticipant } from './shieldPresentation';
import { airborneBurnCells } from './airborneBurn';
import * as Phaser from 'phaser/dist/phaser.esm.js';
import { HumanInputRouter, isCapturedGameKey, isManualPauseKey } from '../controllers/input';
import { connectedGamepads, gamepadControls } from '../controllers/gamepads';
import { MOBILE_TOUCH_BUTTON_ZONE_FRACTION } from '../controllers/mobileTouchZones';
import { AiController } from '../controllers/ai';
import { isGamepadController } from '../domain/types';
import type { MatchSession } from '../sessions/matchSession';
import { applyDocumentVisibility } from '../controllers/visibility';
import {
  BOARD_WIDTH,
  HIDDEN_ROWS,
  VISIBLE_HEIGHT,
  type ActionsByParticipant,
  type GameAction,
  type MatchState,
  type ParticipantState,
} from '../domain/types';
import { FIXED_STEP_MS } from '../simulation/match';
import { landingPiece } from '../simulation/board';
import { ANOMALY_COLOR, pieceCells, pieceColor, TETROMINO_COLORS } from '../simulation/tetrominoes';
import {
  ARENA_CARD_GAP,
  ARENA_CARD_HEADER_HEIGHT,
  ARENA_EDGE_PADDING,
  chooseArenaLayout,
  chooseNetworkLayout,
  chooseMobileSoloLayout,
  type ArenaLayout,
} from './arenaLayout';
import { anomalyGlowStyle, anomalyOutlineSegments } from './anomalyGlow';
import { arenaCardColorForParticipant } from './arenaCardPalette';
import { conflictPresentationForParticipant } from './conflictPresentation';
import { ActivePieceInterpolation } from './activePieceInterpolation';
import { fixedStepCatchUp, MAX_FIXED_STEPS_PER_RENDER } from './fixedStepCatchUp';
import { playfieldRenderKey, staticPlayfieldRenderKey } from './renderInvalidation';
import { drawStyledTile } from './tileRenderer';
import { easeInFall } from '../simulation/clearPresentation';
import { FIRE_REFERENCE_CELL_SIZE, FIRE_REFERENCE_HEIGHT, FIRE_REFERENCE_WIDTH, writeFireHeatPixels } from './fireHeat';

const FIRE_GLOW_PADDING = 12;
let nextFireBandId = 0;

function traceFireBand(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

interface FireBandLayer {
  key: string;
  texture: Phaser.Textures.CanvasTexture;
  image: Phaser.GameObjects.Image;
  scratch: HTMLCanvasElement;
  scratchContext: CanvasRenderingContext2D;
  pixels: ImageData;
  lastFrame: number;
  lastRows: number;
  lastCalm: boolean;
}

export interface PlayRuntime {
  engine: MatchSession;
  input: HumanInputRouter;
  aiControllers: ReadonlyMap<string, AiController>;
  onReady: () => void;
  onState: (state: MatchState) => void;
  onLayout: (layout: ArenaLayout) => void;
  onFinished: (state: MatchState) => void;
  mobileSolo?: boolean;
  mobileTiltControls?: boolean;
  /** Local visual QA stops after reaching this real burn progress; no pause overlay. */
  captureAnomalyBurnAtMs?: number;
  /** Local-only real simulation shield sequence capture, measured from its first frame. */
  captureShieldAtMs?: number;
}

function playtestSimulationScale(): number {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('playtest-fast')) return 1;
  if (window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost') return 1;
  const requested = Number(params.get('playtest-fast'));
  return Number.isFinite(requested) && requested > 1 ? Math.min(20, requested) : 20;
}

export class PlayScene extends Phaser.Scene {
  private staticGraphics!: Phaser.GameObjects.Graphics;
  private graphics!: Phaser.GameObjects.Graphics;
  private readonly shieldLayers = new Map<string, { graphics: Phaser.GameObjects.Graphics; effect: Phaser.GameObjects.Graphics; maskGraphics: Phaser.GameObjects.Graphics; mask: Phaser.Display.Masks.GeometryMask }>();
  private shieldCaptureStartedAt: number | null = null;
  private accumulator = 0;
  private lastWallClockMs = Date.now();
  private resultReported = false;
  private lastLayoutKey = '';
  private lastStaticRenderKey = '';
  private lastRenderKey = '';
  private readonly activePieceInterpolation = new ActivePieceInterpolation();
  private readonly heldPauseButtons = new Map<number, boolean>();
  private readonly fireBands = new Map<string, FireBandLayer>();
  private runtime: PlayRuntime;
  private readonly simulationScale = playtestSimulationScale();
  private readonly reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  private get calmEffects(): boolean {
    return this.reducedMotion || document.body.classList.contains('calm-effects');
  }

  constructor(runtime: PlayRuntime) {
    super('play');
    this.runtime = runtime;
  }

  create(): void {
    this.staticGraphics = this.add.graphics();
    this.graphics = this.add.graphics();
    const keyboard = this.input.keyboard;
    keyboard?.on('keydown', this.handleKeyDown, this);
    keyboard?.on('keyup', this.handleKeyUp, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard?.off('keydown', this.handleKeyDown, this);
      keyboard?.off('keyup', this.handleKeyUp, this);
      document.removeEventListener('visibilitychange', this.handleVisibility);
      for (const layer of this.shieldLayers.values()) {
        layer.graphics.destroy(); layer.effect.destroy(); layer.mask.destroy(); layer.maskGraphics.destroy();
      }
      this.shieldLayers.clear();
      for (const band of this.fireBands.values()) {
        band.image.destroy();
        this.textures.remove(band.key);
      }
      this.fireBands.clear();
    });
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.activePieceInterpolation.reset(this.runtime.engine.state.participants);
      this.renderState();
    });
    this.runtime.onReady();
    this.lastWallClockMs = Date.now();
    this.activePieceInterpolation.reset(this.runtime.engine.state.participants);
    this.renderState();
  }

  update(_time: number, delta: number): void {
    if (this.runtime.engine.kind === 'network') {
      this.runtime.engine.step(delta);
      this.activePieceInterpolation.reset(this.runtime.engine.state.participants);
      this.runtime.onState(this.runtime.engine.state);
      this.renderState();
      return;
    }
    const state = this.runtime.engine.state;
    if (this.runtime.captureAnomalyBurnAtMs !== undefined && state.anomalyTransition?.phase === 'burning'
      && state.anomalyTransition.remainingMs <= this.runtime.captureAnomalyBurnAtMs) {
      this.runtime.onState(state);this.renderState();return;
    }
    if (this.shieldCaptureReady()) { this.runtime.onState(state); this.renderState(); return; }
    this.runtime.input.setEnabled(this.runtime.engine.acceptsGameplayInput(), state.globalEventHold !== null || state.anomalyTransition !== null);
    this.pollGamepads();
    const wallClockMs = Date.now();
    const wallDeltaMs = Math.max(0, Math.min(1_000, wallClockMs - this.lastWallClockMs));
    this.lastWallClockMs = wallClockMs;

    if (state.phase === 'countdown') {
      this.runtime.engine.step(wallDeltaMs * this.simulationScale);
      this.runtime.onState(state);
      this.renderState();
      return;
    }

    const simulationDeltaMs = this.simulationScale > 1 ? Math.min(wallDeltaMs, 250) : Math.min(delta, 250);
    this.accumulator += simulationDeltaMs * this.simulationScale;

    // Four steps cap synchronous simulation and AI work after a delayed frame.
    // Any valid remainder is retained for later browser frames.
    // The localhost-only accelerated fixture must execute the same scaled number of
    // fixed simulation steps; production retains its four-step frame budget.
    const catchUp = fixedStepCatchUp(this.accumulator, FIXED_STEP_MS, MAX_FIXED_STEPS_PER_RENDER * this.simulationScale);
    for (let step = 0; step < catchUp.steps; step += 1) {
      if (this.shieldCaptureReady()) break;
      const before = this.activePieceInterpolation.snapshot(state.participants);
      this.runtime.input.setEnabled(this.runtime.engine.acceptsGameplayInput(), !!state.globalEventHold || !!state.anomalyTransition);
      this.runtime.input.step(FIXED_STEP_MS);
      const actions = this.collectActions();
      this.runtime.engine.step(FIXED_STEP_MS, actions);
      this.activePieceInterpolation.commit(before, state.participants);
    }
    this.accumulator = catchUp.remainingAccumulatorMs;

    this.runtime.onState(state);
    this.renderState();
    if (state.phase === 'results' && !this.resultReported) {
      this.resultReported = true;
      this.runtime.onFinished(state);
    }
  }

  private shieldCaptureReady(): boolean {
    const target = this.runtime.captureShieldAtMs;
    const state = this.runtime.engine.state;
    if (target === undefined || state.shieldPresentationSerial === 0) return false;
    if (this.shieldCaptureStartedAt === null) this.shieldCaptureStartedAt = state.elapsedMs;
    return state.elapsedMs - this.shieldCaptureStartedAt >= target;
  }

  private collectActions(): ActionsByParticipant {
    if (!this.runtime.engine.acceptsGameplayInput()) {
      this.runtime.input.drain();
      return new Map();
    }
    const merged = new Map<string, GameAction[]>();
    for (const [participantId, actions] of this.runtime.input.drain()) {
      merged.set(participantId, [...actions]);
    }
    for (const participant of this.runtime.engine.state.participants) {
      const controller = this.runtime.aiControllers.get(participant.config.id);
      if (!controller) continue;
      const defenseRequired = (this.runtime.engine.state.pendingConflict?.incomingRows[participant.config.id] ?? 0) > 0;
      const actions = controller.actions(participant.board, this.runtime.engine.state.elapsedMs, defenseRequired);
      if (actions.length > 0) merged.set(participant.config.id, [...(merged.get(participant.config.id) ?? []), ...actions]);
    }
    return merged;
  }

  private pollGamepads(): void {
    const connected = new Map(connectedGamepads().map((descriptor) => [descriptor.controller, descriptor]));
    const snapshots = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const gamepad of snapshots) {
      if (!gamepad?.connected) continue;
      const pressed = gamepad.buttons[9]?.pressed ?? false;
      const wasPressed = this.heldPauseButtons.get(gamepad.index) ?? false;
      this.heldPauseButtons.set(gamepad.index, pressed);
      if (pressed && !wasPressed && this.runtime.engine.toggleManualPause()) {
        this.runtime.input.setEnabled(this.runtime.engine.acceptsGameplayInput());
        this.runtime.onState(this.runtime.engine.state);
      }
    }
    for (const participant of this.runtime.engine.state.participants) {
      const controller = participant.config.controller;
      if (!isGamepadController(controller)) continue;
      const descriptor = connected.get(controller);
      const gamepad = descriptor ? snapshots[descriptor.index] : null;
      this.runtime.input.updateGamepad(controller, gamepad?.connected ? gamepadControls(gamepad) : null);
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.runtime.engine.kind === 'network') return;
    if (isManualPauseKey(event)) {
      if (this.runtime.engine.toggleManualPause()) {
        this.runtime.input.setEnabled(this.runtime.engine.acceptsGameplayInput());
        this.runtime.onState(this.runtime.engine.state);
        event.preventDefault();
      }
      return;
    }
    const captured = this.runtime.input.handleKeyDown(event.code, event.repeat);
    if (captured && isCapturedGameKey(event.code)) event.preventDefault();
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (this.runtime.engine.kind === 'network') return;
    const captured = this.runtime.input.handleKeyUp(event.code);
    if (captured && isCapturedGameKey(event.code)) event.preventDefault();
  }

  private readonly handleVisibility = (): void => {
    if (this.runtime.engine.kind === 'network') return;
    applyDocumentVisibility(document.hidden, this.runtime.engine, this.runtime.input);
    if (!document.hidden) {
      this.accumulator = 0;
      this.lastWallClockMs = Date.now();
    }
    this.activePieceInterpolation.reset(this.runtime.engine.state.participants);
    this.runtime.onState(this.runtime.engine.state);
  };

  private renderState(): void {
    if (!this.graphics || !this.staticGraphics) return;
    const state = this.runtime.engine.state;
    const width = this.scale.width;
    const height = this.scale.height;
    const count = state.participants.length;
    const controlsReservedHeight = width > height ? 28 : 42;
    const layout = this.runtime.engine.kind === 'network' ? chooseNetworkLayout(width,height,count,this.runtime.mobileSolo) : this.runtime.mobileSolo
      ? chooseMobileSoloLayout(width, height, count, controlsReservedHeight)
      : chooseArenaLayout(width, height, count);
    const layoutKey = `${layout.mode}:${layout.columns}:${layout.rows}:${layout.cellSize}:${layout.participantCards?.map((card) => `${card.x}:${card.y}:${card.cellSize}:${card.headerHeight ?? ARENA_CARD_HEADER_HEIGHT}`).join('|') ?? ''}`;
    if (layoutKey !== this.lastLayoutKey) {
      this.lastLayoutKey = layoutKey;
      this.runtime.onLayout(layout);
    }

    const staticKey = staticPlayfieldRenderKey(state, layoutKey, width, height);
    if (staticKey !== this.lastStaticRenderKey) {
      this.lastStaticRenderKey = staticKey;
      this.staticGraphics.clear();
      this.staticGraphics.fillStyle(this.runtime.mobileSolo ? 0xffe6bf : 0xfff8e9, 1);
      this.staticGraphics.fillRect(0, 0, width, height);
      if (this.runtime.mobileSolo) {
        const zoneTop = Math.floor(height * (1 - MOBILE_TOUCH_BUTTON_ZONE_FRACTION));
        const third = width / 3;
        this.staticGraphics.fillStyle(0xc7ebfa, 1);
        this.staticGraphics.fillRect(0, zoneTop, third, height - zoneTop);
        this.staticGraphics.fillStyle(0xdff4b2, 1);
        this.staticGraphics.fillRect(third, zoneTop, third, height - zoneTop);
        this.staticGraphics.fillStyle(0xe3cdf7, 1);
        this.staticGraphics.fillRect(third * 2, zoneTop, third, height - zoneTop);
        this.staticGraphics.fillStyle(0xd3efcd, 1);
        this.staticGraphics.fillRect(third - 12, zoneTop, 24, height - zoneTop);
        this.staticGraphics.fillRect((third * 2) - 12, zoneTop, 24, height - zoneTop);
      }
      state.participants.forEach((participant, index) => {
        const card = layout.participantCards?.[index];
        const column = index % layout.columns;
        const row = Math.floor(index / layout.columns);
        const x = ARENA_EDGE_PADDING + column * (layout.slotWidth + ARENA_CARD_GAP) + ((layout.slotWidth - layout.cardWidth) / 2);
        const y = ARENA_EDGE_PADDING + row * (layout.slotHeight + ARENA_CARD_GAP) + ((layout.slotHeight - layout.cardHeight) / 2);
        this.drawStaticBoardCard(participant, this.runtime.engine.kind === 'network' ? Number(participant.config.controllerLabel ?? index) : index, state.options.matchVariant, card?.x ?? x, card?.y ?? y, card?.cardWidth ?? layout.cardWidth, card?.cardHeight ?? layout.cardHeight, card?.cellSize ?? layout.cellSize, card?.headerHeight ?? ARENA_CARD_HEADER_HEIGHT);
      });
    }

    const renderKey = playfieldRenderKey(state, layoutKey, width, height, this.time.now, this.calmEffects);
    if (renderKey === this.lastRenderKey && this.calmEffects) return;
    this.lastRenderKey = renderKey;
    this.graphics.clear();
    for (const layer of this.shieldLayers.values()) { layer.graphics.clear(); layer.graphics.setVisible(false); layer.effect.clear(); layer.effect.setVisible(false); }
      state.participants.forEach((participant, index) => {
        const card = layout.participantCards?.[index];
      const column = index % layout.columns;
      const row = Math.floor(index / layout.columns);
      const x = ARENA_EDGE_PADDING + column * (layout.slotWidth + ARENA_CARD_GAP) + ((layout.slotWidth - layout.cardWidth) / 2);
      const y = ARENA_EDGE_PADDING + row * (layout.slotHeight + ARENA_CARD_GAP) + ((layout.slotHeight - layout.cardHeight) / 2);
        this.drawBoardCard(participant, card?.x ?? x, card?.y ?? y, card?.cardWidth ?? layout.cardWidth, card?.cardHeight ?? layout.cardHeight, card?.cellSize ?? layout.cellSize, card?.headerHeight ?? ARENA_CARD_HEADER_HEIGHT);
    });
  }

  private drawStaticBoardCard(
    participant: ParticipantState,
    participantIndex: number,
    matchVariant: MatchState['options']['matchVariant'],
    cardX: number,
    cardY: number,
    cardWidth: number,
    cardHeight: number,
    measuredCellSize: number,
    headerHeight = ARENA_CARD_HEADER_HEIGHT,
  ): void {
    const cellSize = Math.max((this.runtime.mobileSolo || this.runtime.engine.kind === 'network') ? 2 : 8, measuredCellSize);
    const boardWidth = cellSize * BOARD_WIDTH;
    const boardHeight = cellSize * VISIBLE_HEIGHT;
    const boardX = cardX + (cardWidth - boardWidth) / 2;
    const boardY = cardY + headerHeight + Math.max(0, (cardHeight - headerHeight - boardHeight) / 2);

    this.staticGraphics.fillStyle(0xb9a987, 0.18);
    this.staticGraphics.fillRoundedRect(cardX - 2, cardY + 2, cardWidth + 4, cardHeight + 4, 12);
    this.staticGraphics.fillStyle(0xfffbf2, 1);
    this.staticGraphics.fillRoundedRect(cardX - 2, cardY - 2, cardWidth + 4, cardHeight + 4, 12);
    this.staticGraphics.fillStyle(arenaCardColorForParticipant(participantIndex, matchVariant, participant.board.alive, participant.config.teamId), 0.98);
    this.staticGraphics.fillRoundedRect(cardX, cardY, cardWidth, cardHeight, 10);
    const danger = participant.board.alive && participant.board.grid
      .slice(HIDDEN_ROWS, HIDDEN_ROWS + 5)
      .some((row) => row.some((cell) => cell !== null));
    const borderColor = danger ? 0xff3042 : participant.board.alive ? 0x80b8ff : 0x52658c;
    this.staticGraphics.lineStyle(danger ? 3 : 2, borderColor, 1);
    this.staticGraphics.strokeRoundedRect(cardX, cardY, cardWidth, cardHeight, 10);

    this.staticGraphics.fillStyle(0xf5fbff, 1);
    this.staticGraphics.fillRect(boardX, boardY, boardWidth, boardHeight);
    this.staticGraphics.lineStyle(1, 0xc9dfee, 0.9);
    for (let x = 0; x <= BOARD_WIDTH; x += 1) {
      this.staticGraphics.lineBetween(boardX + x * cellSize, boardY, boardX + x * cellSize, boardY + boardHeight);
    }
    for (let y = 0; y <= VISIBLE_HEIGHT; y += 1) {
      this.staticGraphics.lineBetween(boardX, boardY + y * cellSize, boardX + boardWidth, boardY + y * cellSize);
    }

    const settling = this.runtime.engine.state.clearPresentations.some((event) => (
      event.participantId === participant.config.id
    ));
    const reflecting = shieldPresentationForParticipant(this.runtime.engine.state, participant.config.id) || (this.runtime.engine.state.attackQueues[participant.config.id]?.[0]?.phase === 'rise' && (this.runtime.engine.state.attackQueues[participant.config.id]?.[0]?.riseRows ?? 0) > 0);
    for (let y = 0; y < VISIBLE_HEIGHT && !settling && !reflecting; y += 1) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        const kind = participant.board.grid[y + HIDDEN_ROWS]?.[x];
        if (kind) drawStyledTile(this.staticGraphics, {
          style: participant.resolvedTileStyle,
          kind,
          x: boardX + x * cellSize,
          y: boardY + y * cellSize,
          size: cellSize,
          color: kind === 'anomaly' ? ANOMALY_COLOR : kind === 'garbage' ? 0x9aa2b7 : TETROMINO_COLORS[kind],
          alpha: 1,
          state: 'settled',
        });
      }
    }

    if (!participant.board.alive) {
      this.staticGraphics.fillStyle(0xdfeaf2, 0.72);
      this.staticGraphics.fillRect(boardX, boardY, boardWidth, boardHeight);
    }
  }

  private drawBoardCard(
    participant: ParticipantState,
    cardX: number,
    cardY: number,
    cardWidth: number,
    cardHeight: number,
    measuredCellSize: number,
    headerHeight = ARENA_CARD_HEADER_HEIGHT,
  ): void {
    const cellSize = Math.max((this.runtime.mobileSolo || this.runtime.engine.kind === 'network') ? 2 : 8, measuredCellSize);
    const boardWidth = cellSize * BOARD_WIDTH;
    const boardHeight = cellSize * VISIBLE_HEIGHT;
    const boardX = cardX + (cardWidth - boardWidth) / 2;
    const boardY = cardY + headerHeight + Math.max(0, (cardHeight - headerHeight - boardHeight) / 2);
    const conflict = conflictPresentationForParticipant(this.runtime.engine.state, participant.config.id);
    const shield = shieldPresentationForParticipant(this.runtime.engine.state, participant.config.id);
    if (participant.board.clearFlashMs > 0 && participant.board.alive) {
      this.graphics.lineStyle(3, 0x15c8ff, 1);
      this.graphics.strokeRoundedRect(cardX,cardY,cardWidth,cardHeight,8);
    }
    const originalGraphics = this.graphics;
    const lift = 0;
    const rise = this.runtime.engine.state.attackQueues[participant.config.id]?.[0];
    const riseOffset = rise?.phase === 'rise' && rise.riseRows > 0 ? rise.riseRows * cellSize * Math.min(1,rise.remainingMs/600) : 0;
    const figureY = boardY - lift + riseOffset;
    if (shield || riseOffset > 0) {
      let layer = this.shieldLayers.get(participant.config.id);
      if (!layer) {
        const maskGraphics = this.add.graphics().setVisible(false);
        const graphics = this.add.graphics().setDepth(1);
        const effect = this.add.graphics().setDepth(3);
        const mask = maskGraphics.createGeometryMask();
        graphics.setMask(mask); effect.setMask(mask);
        layer = { graphics, effect, maskGraphics, mask };
        this.shieldLayers.set(participant.config.id, layer);
      }
      layer.maskGraphics.clear().fillStyle(0xffffff).fillRect(boardX, boardY, boardWidth, boardHeight);
      layer.graphics.setVisible(true);
      this.graphics = layer.graphics;
      const clearing = this.runtime.engine.state.clearPresentations.some((e) => e.participantId === participant.config.id);
      if (!clearing) for (let y = 0; y < VISIBLE_HEIGHT; y++) for (let x = 0; x < BOARD_WIDTH; x++) {
        const kind = participant.board.grid[y + HIDDEN_ROWS]?.[x];
        if (kind) drawStyledTile(this.graphics, { style: participant.resolvedTileStyle, kind,
          x: boardX + x * cellSize, y: figureY + y * cellSize, size: cellSize,
          color: kind === 'anomaly' ? ANOMALY_COLOR : kind === 'garbage' ? 0x9aa2b7 : TETROMINO_COLORS[kind], alpha: 1, state: 'settled' });
      }
    }
    this.drawClearPresentation(participant, boardX, figureY, cellSize);

    const arrival = this.runtime.engine.state.anomalyTransition;
    const burnTarget = arrival?.phase === 'burning'
      ? arrival.targets.find((target) => target.participantId === participant.config.id)?.piece
      : null;
    if (burnTarget && participant.board.alive) {
      this.drawAirborneBurn(burnTarget, participant, boardX, figureY, cellSize, 1 - arrival!.remainingMs / arrival!.durationMs);
    }
    if (participant.board.active && !burnTarget) {
      const ghost = landingPiece(participant.board.grid, participant.board.active);
      if (!arrival && ghost && ghost.y !== participant.board.active.y) {
        for (const cell of pieceCells(ghost)) {
          const visibleY = cell.y - HIDDEN_ROWS;
          if (visibleY >= 0 && visibleY < VISIBLE_HEIGHT) {
            drawStyledTile(this.graphics, {
              style: participant.resolvedTileStyle,
              kind: ghost.definition.settledKind,
              x: boardX + cell.x * cellSize,
              y: figureY + visibleY * cellSize,
              size: cellSize,
              color: pieceColor(ghost.definition),
              alpha: 0.28,
              state: 'ghost',
            });
          }
        }
      }
      const renderedActive = arrival ? participant.board.active : this.activePieceInterpolation.renderPiece(
        participant,
        this.accumulator / FIXED_STEP_MS,
        this.calmEffects,
      ) ?? participant.board.active;
      const activeCells = pieceCells(renderedActive);
      for (const cell of activeCells) {
        const visibleY = cell.y - HIDDEN_ROWS;
        if (visibleY >= 0 && visibleY < VISIBLE_HEIGHT) {
          drawStyledTile(this.graphics, {
            style: participant.resolvedTileStyle,
            kind: renderedActive.definition.settledKind,
            x: boardX + cell.x * cellSize,
            y: figureY + visibleY * cellSize,
            size: cellSize,
            color: pieceColor(renderedActive.definition),
            alpha: 1,
            state: 'active',
          });
        }
      }
      if (renderedActive.definition.source === 'anomaly') {
        this.drawActiveAnomalyGlow(activeCells, boardX, figureY, cellSize);
      }
    }

    this.graphics = originalGraphics;
    if (participant.board.alive) drawBoardEventEffects(this.graphics, this.runtime.engine.state,
      participant.config.id, boardX,boardY,boardWidth,boardHeight,this.calmEffects);
    if (conflict.impactRows > 0 && conflict.impactProgress > 0 && participant.board.alive) {
      const impactProgress = Math.max(0, Math.min(1, conflict.impactProgress));
      const impactAlpha = this.calmEffects ? 0.82 : Math.max(0.2, impactProgress);
      this.graphics.fillStyle(0xc94761, impactAlpha * 0.18);
      this.graphics.fillRect(boardX, boardY + boardHeight - cellSize * Math.min(4, conflict.impactRows), boardWidth, cellSize * Math.min(4, conflict.impactRows));
    }
    if (conflict.cleanupRows > 0 && conflict.cleanupProgress > 0 && participant.board.alive && !this.runtime.engine.state.cleanupEvents.some(e => e.participantId === participant.config.id && e.amplified)) {
      const progress = Math.max(0, Math.min(1, conflict.cleanupProgress));
      const alpha = this.calmEffects ? 0.8 : Math.max(0.15, progress * 0.72);
      const cleanedHeight = Math.min(boardHeight, Math.max(cellSize, conflict.cleanupRows * cellSize));
      const sweepY = boardY + boardHeight - cleanedHeight * (this.calmEffects ? 1 : Math.max(0.2, 1 - progress));
      this.graphics.fillStyle(0x55c978, alpha * 0.18);
      this.graphics.fillRect(boardX, boardY + boardHeight - cleanedHeight, boardWidth, cleanedHeight);
      this.graphics.lineStyle(3, 0x4fbf70, alpha);
      this.graphics.lineBetween(boardX, sweepY, boardX + boardWidth, sweepY);
      this.graphics.lineStyle(5, 0x3a965b, alpha);
      this.graphics.strokeRoundedRect(cardX + 4, cardY + 4, cardWidth - 8, cardHeight - 8, 7);
    }
    const burn = this.runtime.engine.state.anomalyBurnEvents.find((event) => event.participantId === participant.config.id);
    if (burn && participant.board.alive) {
      const bandY = figureY + boardHeight - burn.rows.length * cellSize;
      const progress = Math.max(0, Math.min(1, 1 - burn.pulseMs / 1_000));
      this.drawFireBand(participant.config.id, boardX, bandY, cellSize, burn.rows.length, progress);
      const image = this.fireBands.get(participant.config.id)?.image;
      const layer = this.shieldLayers.get(participant.config.id);
      if (shield && layer) image?.setMask(layer.mask).setDepth(2);
      else image?.clearMask(false).setDepth(0);
    } else {
      this.fireBands.get(participant.config.id)?.image.setVisible(false);
    }
    this.graphics = originalGraphics;
  }

  private drawAirborneBurn(piece: NonNullable<ParticipantState['board']['active']>, participant: ParticipantState,
    boardX: number, boardY: number, size: number, progress: number): void {
    for (const cell of airborneBurnCells(piece, progress, this.calmEffects)) {
      const y = cell.y - HIDDEN_ROWS;
      if (y < 0 || y >= VISIBLE_HEIGHT) continue;
      const x = boardX + cell.x * size;
      const py = boardY + y * size;
      if (cell.remaining > 0) drawStyledTile(this.graphics, {
        style: participant.resolvedTileStyle, kind: piece.definition.settledKind,
        x, y: py, size, color: pieceColor(piece.definition), alpha: cell.remaining, state: 'active',
      });
      if (cell.heat <= 0 || (this.calmEffects && cell.remaining === 0)) continue;
      const heat = cell.heat;
      const frontY = py + size * cell.remaining;
      this.graphics.fillStyle(0xff6b16, heat * 0.32);
      this.graphics.fillRoundedRect(x - size * 0.08, py - size * 0.06, size * 1.16, size * 1.12, size * 0.22);
      this.graphics.fillStyle(0xffa325, heat * 0.95);
      this.graphics.fillRoundedRect(x + size * 0.08, Math.min(py + size * 0.7, frontY - size * 0.2), size * 0.84, size * 0.3, size * 0.12);
      this.graphics.fillStyle(0xfff0a4, heat);
      this.graphics.fillRect(x + size * 0.15, Math.min(py + size * 0.88, frontY - size * 0.08), size * 0.7, size * 0.09);
      if (!this.calmEffects) for (let ember = 0; ember < 3; ember += 1) {
        const rise = (progress * 3 + ember * 0.31 + cell.x * 0.13) % 1;
        this.graphics.fillStyle(ember === 0 ? 0xffef9c : 0xff8730, heat * (1 - rise));
        this.graphics.fillCircle(x + size * (0.2 + ember * 0.29), Math.max(boardY, py - rise * size * 0.6), size * 0.035);
      }
    }
  }

  private drawFireBand(participantId: string, boardX: number, bandY: number, cellSize: number, rows: number, progress: number): void {
    let band = this.fireBands.get(participantId);
    if (!band) {
      const key = `fire-band-${nextFireBandId++}`;
      const texture = this.textures.createCanvas(
        key,
        FIRE_REFERENCE_WIDTH + FIRE_GLOW_PADDING * 2,
        FIRE_REFERENCE_HEIGHT + FIRE_GLOW_PADDING * 2,
      );
      const scratch = document.createElement('canvas');
      scratch.width = FIRE_REFERENCE_WIDTH;
      scratch.height = FIRE_REFERENCE_HEIGHT;
      const scratchContext = scratch.getContext('2d', { willReadFrequently: true });
      if (!texture || !scratchContext) {
        if (texture) this.textures.remove(key);
        return;
      }
      band = {
        key,
        texture,
        image: this.add.image(0, 0, key).setOrigin(0, 0).setDepth(1),
        scratch,
        scratchContext,
        pixels: scratchContext.createImageData(FIRE_REFERENCE_WIDTH, FIRE_REFERENCE_HEIGHT),
        lastFrame: -1,
        lastRows: 0,
        lastCalm: false,
      };
      this.fireBands.set(participantId, band);
    }
    const scale = cellSize / FIRE_REFERENCE_CELL_SIZE;
    band.image.setPosition(boardX - FIRE_GLOW_PADDING * scale, bandY - FIRE_GLOW_PADDING * scale);
    band.image.setScale(scale).setVisible(true);
    const calm = this.calmEffects;
    const frame = calm ? 24 : Math.min(24, Math.round(progress * 24));
    if (frame === band.lastFrame && rows === band.lastRows && calm === band.lastCalm) return;
    band.lastFrame = frame;
    band.lastRows = rows;
    band.lastCalm = calm;
    writeFireHeatPixels(band.pixels.data, rows, calm ? 1 : frame / 24, calm ? 0.5 : frame / 24);
    band.scratchContext.putImageData(band.pixels, 0, 0);
    const context = band.texture.context;
    context.clearRect(0, 0, band.texture.width, band.texture.height);
    context.save();
    context.globalAlpha = 0.3;
    context.filter = 'blur(6px)';
    if (context.filter !== 'blur(6px)') {
      context.shadowColor = 'rgba(255, 141, 33, 0.6)';
      context.shadowBlur = 6;
    }
    context.drawImage(band.scratch, FIRE_GLOW_PADDING, FIRE_GLOW_PADDING);
    context.restore();
    // The approved mockup burns over opaque square bricks. Mask the live tile
    // skin here so round or shiny player skins do not show through the flame.
    const frontWidth = Math.max(1, Math.round((calm ? 1 : frame / 24) * FIRE_REFERENCE_WIDTH));
    const bandHeight = rows * FIRE_REFERENCE_CELL_SIZE;
    const radius = Math.min(8, bandHeight / 4, frontWidth / 2);
    context.fillStyle = 'rgba(101, 43, 24, 0.82)';
    traceFireBand(context, FIRE_GLOW_PADDING, FIRE_GLOW_PADDING, frontWidth, bandHeight, radius);
    context.fill();
    context.drawImage(band.scratch, FIRE_GLOW_PADDING, FIRE_GLOW_PADDING);
    context.save();
    traceFireBand(context, FIRE_GLOW_PADDING, FIRE_GLOW_PADDING, frontWidth, bandHeight, radius);
    context.clip();
    context.strokeStyle = 'rgba(112, 52, 26, 0.15)';
    context.lineWidth = 1;
    for (let x = FIRE_REFERENCE_CELL_SIZE; x < frontWidth; x += FIRE_REFERENCE_CELL_SIZE) {
      const lineX = FIRE_GLOW_PADDING + x + 0.5;
      context.beginPath();
      context.moveTo(lineX, FIRE_GLOW_PADDING);
      context.lineTo(lineX, FIRE_GLOW_PADDING + bandHeight);
      context.stroke();
    }
    for (let y = FIRE_REFERENCE_CELL_SIZE; y < bandHeight; y += FIRE_REFERENCE_CELL_SIZE) {
      const lineY = FIRE_GLOW_PADDING + y + 0.5;
      context.beginPath();
      context.moveTo(FIRE_GLOW_PADDING, lineY);
      context.lineTo(FIRE_GLOW_PADDING + frontWidth, lineY);
      context.stroke();
    }
    context.restore();
    band.texture.refresh();
  }

  private drawClearPresentation(participant: ParticipantState, boardX: number, boardY: number, cellSize: number): void {
    const event = this.runtime.engine.state.clearPresentations.find((candidate) => (
      candidate.participantId === participant.config.id
    ));
    if (!event || !participant.board.alive) return;
    const drawRow = (cells: typeof event.rows[number]['cells'], y: number, cleared = false): void => {
      if (y < -1 || y >= VISIBLE_HEIGHT) return;
      cells.forEach((kind, x) => {
        if (!kind) return;
        drawStyledTile(this.graphics, {
          style: participant.resolvedTileStyle,
          kind,
          x: boardX + x * cellSize,
          y: boardY + y * cellSize,
          size: cellSize,
          color: cleared ? 0xaedcff : kind === 'anomaly' ? ANOMALY_COLOR : kind === 'garbage' ? 0x9aa2b7 : TETROMINO_COLORS[kind],
          alpha: 1,
          state: 'settled',
        });
      });
    };
    if (event.phase === 'highlight') {
      event.sourceGrid.forEach((row, y) => drawRow(row, y - HIDDEN_ROWS, event.removedRows.includes(y)));
      const visibleRemoved = event.removedRows.filter((y) => y >= HIDDEN_ROWS);
      for (const y of visibleRemoved) {
        this.graphics.fillStyle(0xb1daff, 0.25);
        this.graphics.fillRect(boardX, boardY + (y - HIDDEN_ROWS) * cellSize, BOARD_WIDTH * cellSize, cellSize);
      }
      return;
    }
    const progress = this.calmEffects ? 1 : easeInFall(1 - event.remainingMs / event.durationMs);
    for (const row of event.rows) {
      const y = row.fromY + (row.toY - row.fromY) * progress - HIDDEN_ROWS;
      drawRow(row.cells, y);
    }
    if (event.remainingMs < 70) {
      this.graphics.fillStyle(0xe5c794, 0.25 * (1 - event.remainingMs / 70));
      this.graphics.fillRect(boardX, boardY + VISIBLE_HEIGHT * cellSize - 3, BOARD_WIDTH * cellSize, 3);
    }
  }

  private drawActiveAnomalyGlow(cells: ReturnType<typeof pieceCells>, boardX: number, boardY: number, cellSize: number): void {
    const visibleCells = cells.filter((cell) => {
      const visibleY = cell.y - HIDDEN_ROWS;
      return visibleY >= 0 && visibleY < VISIBLE_HEIGHT;
    });
    if (visibleCells.length === 0) return;

    const style = anomalyGlowStyle(Math.floor(this.time.now / 50) * 50, cellSize);
    const segments = anomalyOutlineSegments(cells).filter((segment) => (
      segment.y1 - HIDDEN_ROWS >= 0
      && segment.y1 - HIDDEN_ROWS <= VISIBLE_HEIGHT
      && segment.y2 - HIDDEN_ROWS >= 0
      && segment.y2 - HIDDEN_ROWS <= VISIBLE_HEIGHT
    ));
    const drawSegments = (): void => {
      for (const segment of segments) {
        this.graphics.lineBetween(
          boardX + segment.x1 * cellSize,
          boardY + (segment.y1 - HIDDEN_ROWS) * cellSize,
          boardX + segment.x2 * cellSize,
          boardY + (segment.y2 - HIDDEN_ROWS) * cellSize,
        );
      }
    };

    this.graphics.lineStyle(style.outerWidth, ANOMALY_COLOR, style.outerAlpha);
    drawSegments();
    this.graphics.lineStyle(style.innerWidth, 0xffffff, style.innerAlpha);
    drawSegments();
  }

}
