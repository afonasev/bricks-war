import type { MatchState } from '../domain/types';
import { AudioEventTracker, gameTempo, type GameAudioEvent } from './audioEvents';
import {
  AUDIO_EVENT_PRIORITY,
  CRITICAL_MUSIC_DUCK_GAIN,
  CRITICAL_MUSIC_DUCK_SECONDS,
  type AudioPreviewCategory,
  type MusicDirectionId,
  type SfxDirectionId,
  musicDirection,
  sfxDirection,
  variationIndex,
} from './audioDirections';
import { createFoleyLibrary, type FoleyKind } from './foley';
import { audioBufferFromSamples, fireSamples, impactGainForLines, impactSamples } from './clearSounds';
import {
  createSoftToySfxLibrary,
  createQuietMechanismSfxLibrary,
  QUIET_MECHANISM_ASSET_IDS,
  SOFT_TOY_ASSET_IDS,
  SFX_PACKS,
  validateSfxPack,
  type NeonVariant,
  type SfxPackEventId,
  type SfxPresetId,
  type SoftToyAssetId,
  type RecordedAssetId,
} from './sfxPresets';

type AudioContextConstructor = new () => AudioContext;
type MusicMode = 'menu' | 'countdown' | 'game' | 'paused' | 'results';

const MENU_BPM = 78;
export const DEFAULT_MASTER_VOLUME = 0.85;
export const MASTER_GAIN_MULTIPLIER = 2;
export const MUSIC_LOOKAHEAD_SECONDS = 0.32;
export const MUSIC_SCHEDULER_MS = 50;
const MUSIC_LATE_RESET_SECONDS = 0.5;
const CLEAR_EFFECT_GAIN_SCALE = 0.49;

function midiFrequency(note: number): number {
  return 440 * (2 ** ((note - 69) / 12));
}

export function masterGainForVolume(volume: number, muted = false): number {
  if (muted) return 0;
  return Math.max(0, Math.min(1, volume)) * MASTER_GAIN_MULTIPLIER;
}

export interface ConflictSoundProfile {
  tier: 1 | 3 | 4;
  gain: number;
  root: number;
  duration: number;
}

export function conflictSoundProfile(rows: number): ConflictSoundProfile {
  if (rows >= 4) return { tier: 4, gain: 0.13, root: 146.83, duration: 0.62 };
  if (rows >= 3) return { tier: 3, gain: 0.105, root: 174.61, duration: 0.46 };
  return { tier: 1, gain: 0.075, root: 220, duration: 0.3 };
}

const ARRIVAL_FIRE = Symbol('shared-arrival-fire');

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicUserGain: GainNode | null = null;
  private effectsUserGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private clearImpactBuffer: AudioBuffer | null = null;
  private clearFireBuffer: AudioBuffer | null = null;
  private readonly activeFires = new Map<string | symbol, { serial: number; source: AudioBufferSourceNode; gain: GainNode }>();
  private foley: Readonly<Record<FoleyKind, readonly AudioBuffer[]>> | null = null;
  private softToyBuffers: Readonly<Record<SoftToyAssetId, AudioBuffer>> | null = null;
  private softToyLoad: Promise<boolean> | null = null;
  private quietMechanismBuffers: Readonly<Record<RecordedAssetId, AudioBuffer>> | null = null;
  private quietMechanismLoad: Promise<boolean> | null = null;
  private available = true;
  private muted: boolean;
  private musicVolume = DEFAULT_MASTER_VOLUME;
  private effectsVolume = DEFAULT_MASTER_VOLUME;
  private sfxPreset: SfxPresetId = 'original';
  private requestedSfxPreset: SfxPresetId = 'soft-toy';
  private mode: MusicMode = 'menu';
  private gravityIntervalMs = 800;
  private startingGravityMs = 800;
  private finalPush = false;
  private musicStep = 0;
  private gameIntroStep = -1;
  private nextMusicStepAt = 0;
  private musicDirectionId: MusicDirectionId = 'neon-workshop';
  private sfxDirectionId: SfxDirectionId = 'soft-toy';
  private readonly variationCounts = new Map<string, number>();
  private previewing = false;
  private readonly previewSources: AudioScheduledSourceNode[] = [];
  private readonly tracker = new AudioEventTracker();
  private readonly networkAnomalyTracker = new AudioEventTracker();

  constructor(initialMuted = false, levels: { music?: number; effects?: number; sfxPreset?: SfxPresetId } = {}) {
    this.muted = initialMuted;
    this.musicVolume = this.clampVolume(levels.music ?? DEFAULT_MASTER_VOLUME);
    this.effectsVolume = this.clampVolume(levels.effects ?? DEFAULT_MASTER_VOLUME);
    this.requestedSfxPreset = levels.sfxPreset ?? 'soft-toy';
    if (SFX_PACKS[this.requestedSfxPreset].kind !== 'buffered') this.sfxPreset = this.requestedSfxPreset;
  }

  unlock(): void {
    if (!this.available) return;
    if (this.context) {
      void this.context.resume().catch(() => undefined);
      return;
    }
    try {
      if (typeof window === 'undefined') return;
      const Context = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
      if (!Context) {
        this.available = false;
        return;
      }
      const context = new Context();
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;
      const master = context.createGain();
      const musicBus = context.createGain();
      const sfxBus = context.createGain();
      const musicUserGain = context.createGain();
      const effectsUserGain = context.createGain();
      master.gain.value = masterGainForVolume(1, this.muted);
      musicBus.gain.value = 0.22;
      sfxBus.gain.value = 0.72;
      musicUserGain.gain.value = this.musicVolume;
      effectsUserGain.gain.value = this.effectsVolume;
      musicBus.connect(musicUserGain);
      sfxBus.connect(effectsUserGain);
      musicUserGain.connect(master);
      effectsUserGain.connect(master);
      master.connect(compressor);
      compressor.connect(context.destination);
      this.context = context;
      this.master = master;
      this.musicBus = musicBus;
      this.sfxBus = sfxBus;
      this.musicUserGain = musicUserGain;
      this.effectsUserGain = effectsUserGain;
      this.noiseBuffer = this.createNoiseBuffer(context);
      this.clearImpactBuffer = audioBufferFromSamples(context, impactSamples(context.sampleRate));
      this.clearFireBuffer = audioBufferFromSamples(context, fireSamples(context.sampleRate));
      this.foley = createFoleyLibrary(context);
      void this.setSfxPreset(this.requestedSfxPreset);
      this.restartMusicClock();
      window.setInterval(() => this.scheduleMusic(), MUSIC_SCHEDULER_MS);
      void context.resume().catch(() => undefined);
    } catch {
      this.available = false;
      this.context = null;
    }
  }

  enterMenu(): void {
    this.stopAllClearFires();
    const alreadyInMenu = this.mode === 'menu';
    this.mode = 'menu';
    this.gameIntroStep = -1;
    this.tracker.reset();
    if (alreadyInMenu) return;
    this.restartMusicClock();
    this.fadeMusic(0.22);
  }

  startGame(): void {
    this.stopAllClearFires();
    this.mode = 'countdown';
    this.gameIntroStep = -1;
    this.tracker.reset();
    this.restartMusicClock();
    this.fadeMusic(0.13);
  }

  setDirections(music: MusicDirectionId, effects: SfxDirectionId): void {
    const musicChanged = this.musicDirectionId !== music;
    this.musicDirectionId = music;
    this.sfxDirectionId = effects;
    this.variationCounts.clear();
    if (musicChanged) this.restartMusicClock();
  }

  getDirections(): { music: MusicDirectionId; effects: SfxDirectionId } {
    return { music: this.musicDirectionId, effects: this.sfxDirectionId };
  }

  playPrototype(category: AudioPreviewCategory, direction?: MusicDirectionId | SfxDirectionId): void {
    this.unlock();
    const start = (this.context?.currentTime ?? 0) + 0.02;
    if (!this.context) return;
    this.stopPrototypePreviews();
    this.previewing = true;
    if (category === 'gameplay-music' || category === 'menu-music') {
      const selected = musicDirection((direction as MusicDirectionId | undefined) ?? this.musicDirectionId);
      const melody = category === 'menu-music' ? selected.menuMelody : [...selected.matchIntro, ...selected.melody];
      melody.slice(0, category === 'menu-music' ? 6 : 10).forEach((note, index) => this.tone(midiFrequency(note), start + index * 0.16, 0.22, 0.055, selected.lead, 0, 2200, this.musicBus));
      this.previewing = false;
      return;
    }
    if (direction) this.sfxDirectionId = direction as SfxDirectionId;
    if (category === 'tactile') {
      this.playPackPreview('ui-select', start); this.playPackPreview('ui-confirm', start + 0.16);
      this.playPackPreview('ui-back', start + 0.32); this.playPackPreview('ui-error', start + 0.48);
      this.playRotate(start + 0.72, 0); this.playLock(start + 0.96, 0); this.playClearImpact(start + 1.24, 2, 0);
    }
    if (category === 'rewards') {
      this.playClearImpact(start, 4, 0); this.playLevelUp(start + 0.42, 3, 0);
      this.playPackPreview('results-win', start + 0.88); this.playPackPreview('results-lose', start + 1.36);
    }
    if (category === 'threats') {
      this.playConflictLaunch(start, 4, 0); this.playConflictImpact(start + 0.4, 4, 0);
      this.playPressure(start + 0.82); this.playCountdown(start + 1.18, 3, true);
      this.playFinalPush(start + 1.48); this.playEliminated(start + 2.06, 0);
    }
    if (category === 'defenses') {
      this.playShieldHalfCharge(start, 0); this.playShieldFullCharge(start + 0.3, 0);
      this.playShieldBlock(start + 0.7, 0); this.playDefense(start + 1.06, 0);
      this.playCleanup(start + 1.42, 3, 0, true); this.playAnomaly(start + 1.82, 0);
      this.playCountdown(start + 2.26, 3, false); this.playRoundStart(start + 2.56);
    }
    this.previewing = false;
  }

  /** Network arena uses full authoritative state; reconnect establishes a silent baseline. */
  syncNetworkAnomalies(state: MatchState, baseline = false): void {
    if (baseline) {
      this.networkAnomalyTracker.reset();
      this.stopClearFire(ARRIVAL_FIRE);
    }
    this.syncArrivalFire(state);
    const events = this.networkAnomalyTracker.sync(state);
    if (!baseline) for (const event of events) if (event.type === 'anomaly-spawn') this.playEvent(event);
  }

  sync(state: MatchState): void {
    this.gravityIntervalMs = state.gravityIntervalMs;
    this.startingGravityMs = state.options.startingGravityMs;
    this.finalPush = state.finalPushActive;
    const events = this.tracker.sync(state);
    this.syncClearFires(state);
    this.syncArrivalFire(state);
    if (state.phase === 'paused') {
      if (this.mode !== 'paused') {
        this.mode = 'paused';
        this.fadeMusic(0.055);
      }
    } else if (state.phase !== 'results' && this.mode === 'paused') {
      this.mode = 'game';
      this.restartMusicClock();
      this.fadeMusic(0.25);
    }
    for (const event of events) this.playEvent(event);
  }

  playUiSelect(): void {
    const start = this.context?.currentTime;
    if (start === undefined) return;
    if (this.playPackEvent('ui-select', start, 0)) return;
    this.tone(587.33, start, 0.07, 0.038, 'sine', 0, 1800);
    this.tone(880, start + 0.045, 0.09, 0.026, 'triangle', 0, 2200);
  }

  playUiFeedback(kind: 'confirm' | 'back' | 'error'): void {
    const start = this.context?.currentTime;
    if (start === undefined) return;
    if (this.playPackEvent(`ui-${kind}`, start, 0)) return;
    if (kind === 'confirm') this.tone(659.25, start, 0.12, 0.052, 'triangle', 0, 2100);
    if (kind === 'back') this.tone(523.25, start, 0.12, 0.046, 'triangle', 0, 1800, undefined, 0.006, 392);
    if (kind === 'error') this.tone(196, start, 0.2, 0.07, 'sawtooth', 0, 1200, undefined, 0.006, 147);
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    this.applyMasterGain();
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(value: number): number {
    const volume = this.clampVolume(value);
    this.musicVolume = volume;
    this.effectsVolume = volume;
    this.applyUserGains();
    return volume;
  }

  getVolume(): number {
    return this.musicVolume;
  }

  setMusicVolume(value: number): number {
    this.musicVolume = this.clampVolume(value);
    this.applyUserGains();
    return this.musicVolume;
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  setEffectsVolume(value: number): number {
    this.effectsVolume = this.clampVolume(value);
    this.applyUserGains();
    return this.effectsVolume;
  }

  getEffectsVolume(): number {
    return this.effectsVolume;
  }

  async setSfxPreset(preset: SfxPresetId): Promise<SfxPresetId> {
    this.requestedSfxPreset = preset;
    const context = this.context;
    const ready = preset === 'soft-toy'
      ? context !== null && await this.prepareSoftToy(context)
      : preset === 'quiet-mechanism'
        ? context !== null && await this.prepareQuietMechanism(context)
      : validateSfxPack(SFX_PACKS[preset]);
    if (!ready || this.requestedSfxPreset !== preset) return this.sfxPreset;
    this.stopPrototypePreviews();
    this.sfxPreset = preset;
    this.variationCounts.clear();
    return this.sfxPreset;
  }

  getSfxPreset(): SfxPresetId {
    return this.sfxPreset;
  }

  private playEvent(event: GameAudioEvent): void {
    if (event.type === 'round-start') {
      this.mode = 'game';
      this.gameIntroStep = 0;
      this.restartMusicClock();
      this.fadeMusic(0.25);
    }
    const context = this.context;
    if (!context) return;
    const now = context.currentTime + 0.008;
    if (AUDIO_EVENT_PRIORITY[event.type] === 'critical') this.duckMusic(now);
    if (event.type === 'countdown') this.playCountdown(now, event.second, false);
    if (event.type === 'round-start') this.playRoundStart(now);
    if (event.type === 'rotate') this.playRotate(now, event.pan);
    if (event.type === 'lock') this.playLock(now, event.pan);
    if (event.type === 'line-clear') this.playLineClear(now, event.lines, event.pan);
    if (event.type === 'clear-impact') this.playClearImpact(now, event.lines, event.pan);
    if (event.type === 'level-up') this.playLevelUp(now, event.level, event.pan);
    if (event.type === 'anomaly-spawn') this.playAnomaly(now, event.pan);
    if (event.type === 'final-tick') this.playCountdown(now, event.second, true);
    if (event.type === 'pressure') this.playPressure(now);
    if (event.type === 'conflict-launch') this.playConflictLaunch(now, event.rows, event.pan);
    if (event.type === 'conflict-impact') this.playConflictImpact(now, event.rows, event.pan);
    if (event.type === 'cleanup') this.playCleanup(now, event.rows, event.pan, event.amplified);
    if (event.type === 'shield-half-charge') this.playShieldHalfCharge(now, event.pan);
    if (event.type === 'shield-full-charge') this.playShieldFullCharge(now, event.pan);
    if (event.type === 'shield-block') this.playShieldBlock(now, event.pan);
    if (event.type === 'active-defense') this.playDefense(now, event.pan);
    if (event.type === 'final-push') this.playFinalPush(now);
    if (event.type === 'eliminated') this.playEliminated(now, event.pan);
    if (event.type === 'results') {
      this.mode = 'results';
      this.fadeMusic(0.065);
      this.playResults(now);
    }
  }

  private scheduleMusic(): void {
    const context = this.context;
    if (!context || context.state === 'closed' || this.mode === 'paused' || this.mode === 'results') return;
    if (this.nextMusicStepAt < context.currentTime - MUSIC_LATE_RESET_SECONDS) this.restartMusicClock();
    while (this.nextMusicStepAt < context.currentTime + MUSIC_LOOKAHEAD_SECONDS) {
      const bpm = this.mode === 'menu'
        ? MENU_BPM
        : this.mode === 'countdown'
          ? 84
          : gameTempo(this.gravityIntervalMs, this.startingGravityMs, this.finalPush);
      const stepDuration = 30 / bpm;
      this.scheduleMusicStep(this.nextMusicStepAt, stepDuration);
      this.nextMusicStepAt += stepDuration;
      this.musicStep = (this.musicStep + 1) % 32;
    }
  }

  private scheduleMusicStep(start: number, stepDuration: number): void {
    const destination = this.musicBus;
    if (!destination) return;
    const step = this.musicStep;
    const direction = musicDirection(this.musicDirectionId);
    if (this.mode === 'countdown') {
      if (step % 4 === 0) {
        const root = direction.chords[Math.floor(step / 8) % direction.chords.length]?.[0] ?? 40;
        this.tone(midiFrequency(root), start, stepDuration * 3.2, 0.025, 'sine', 0, 520, destination, 0.04);
        this.percussion(start, 'kick', 0.014, destination);
      }
      return;
    }
    if (this.mode === 'game' && this.gameIntroStep >= 0) {
      const introNote = direction.matchIntro[this.gameIntroStep];
      if (introNote !== undefined) {
        this.tone(midiFrequency(introNote), start, stepDuration * 1.45, 0.052, direction.lead, this.gameIntroStep % 2 ? 0.2 : -0.2, 1800, destination, 0.012);
        this.tone(midiFrequency(introNote - 12), start, stepDuration * 1.7, 0.028, direction.accent, 0, 850, destination, 0.018);
        this.percussion(start, this.gameIntroStep % 2 === 0 ? 'kick' : 'snare', 0.025, destination);
        this.gameIntroStep += 1;
        if (this.gameIntroStep >= direction.matchIntro.length) this.gameIntroStep = -1;
        return;
      }
      this.gameIntroStep = -1;
    }
    const melody = this.mode === 'menu' ? direction.menuMelody : direction.melody;
    const note = melody[step % melody.length] ?? 69;
    const chord = direction.chords[Math.floor(step / 8) % direction.chords.length] ?? direction.chords[0]!;

    const phraseRest = step % 16 === 6 || step % 16 === 7 || step % 16 === 14 || step % 16 === 15;
    if (this.mode === 'menu') {
      if (!phraseRest && step % 2 === 0) {
        this.tone(midiFrequency(note), start, stepDuration * 1.55, 0.033, direction.lead, Math.sin(step) * 0.22, 1500, destination, 0.018);
        this.tone(midiFrequency(note + 12), start + 0.012, stepDuration * 0.8, 0.012, direction.accent, Math.sin(step) * 0.22, 2600, destination, 0.008);
      }
      if (step % 8 === 0) {
        chord.forEach((chordNote, index) => this.tone(
          midiFrequency(chordNote),
          start + index * 0.018,
          stepDuration * 7.4,
          0.014,
          direction.accent,
          0,
          900,
          destination,
          0.16,
        ));
      }
      return;
    }

    if (!phraseRest) this.tone(midiFrequency(note), start, stepDuration * 1.35, 0.038, direction.lead, step % 2 === 0 ? -0.18 : 0.18, 1300, destination, 0.018);
    if (step % 2 === 0) {
      const bass = chord[0] ?? 45;
      this.tone(midiFrequency(bass), start, stepDuration * 1.7, 0.035, 'sine', -0.08, 520, destination, 0.012);
      this.percussion(start, step % 8 === 0 ? 'kick' : 'hat', 0.028, destination);
    }
    if (step % 8 === 4) this.percussion(start, 'snare', 0.022, destination);
    if (this.finalPush && step % 4 === 2) this.percussion(start, 'hat', 0.02, destination);
    if (step % 8 === 0) {
      chord.slice(1).forEach((chordNote, index) => this.tone(
        midiFrequency(chordNote + 12),
        start + 0.01 * index,
        stepDuration * 3.6,
        0.011,
        direction.accent,
        0.12,
        1300,
        destination,
        0.08,
      ));
    }
  }

  private playCountdown(start: number, second: number, final: boolean): void {
    if (this.playPackEvent(final ? 'final-tick' : 'countdown', start, 0, second <= 3 ? 1.12 : 1)) return;
    const urgent = final && second <= 3;
    const frequency = urgent ? 1046.5 : final ? 783.99 : 523.25;
    this.tone(frequency, start, urgent ? 0.16 : 0.1, urgent ? 0.12 : 0.075, 'sine', 0, 2600);
    this.tone(frequency / 2, start, urgent ? 0.2 : 0.12, urgent ? 0.055 : 0.03, 'triangle', 0, 1200);
    if (final) this.noise(start, 0.025, urgent ? 0.04 : 0.022, 'highpass', 3400, 0);
  }

  private playRoundStart(start: number): void {
    if (this.playPackEvent('round-start', start, 0, 1.1)) return;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      this.tone(frequency, start + index * 0.065, 0.24, 0.07, 'triangle', 0, 2200);
    });
  }

  private playRotate(start: number, pan: number): void {
    const variation = this.nextVariation('rotate');
    if (this.playPackEvent('rotate', start, pan, 1, variation)) return;
    this.playFoley('plastic-click', variation, start, pan, 0.13);
  }

  private playLock(start: number, pan: number): void {
    const variation = this.nextVariation('lock');
    if (this.playPackEvent('lock', start, pan, 1, variation)) return;
    this.playFoley('wood-contact', variation, start, pan, 0.2);
  }

  private playLineClear(start: number, lines: number, pan: number): void {
    const variation = this.nextVariation('line-clear');
    for (let index = 0; index <= Math.min(4, lines); index += 1) {
      const offsetVariation = variation + index;
      if (this.playPackEvent('line-clear', start + index * 0.075, pan, 1 + lines * 0.08, offsetVariation)) continue;
      this.playFoley(index % 2 ? 'slide' : 'rubber-landing', offsetVariation, start + index * 0.075, pan, 0.13 + lines * 0.012);
    }
  }

  private playClearImpact(start: number, lines: number, pan: number): void {
    if (!this.clearImpactBuffer) return;
    this.playBufferedFoley(this.clearImpactBuffer, start, pan, impactGainForLines(lines) * CLEAR_EFFECT_GAIN_SCALE);
  }

  private stopClearFire(participantId: string | symbol): void {
    const playing = this.activeFires.get(participantId);
    if (!playing) return;
    this.activeFires.delete(participantId);
    const now = this.context?.currentTime ?? 0;
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
    playing.gain.gain.linearRampToValueAtTime(0, now + 0.04);
    try { playing.source.stop(now + 0.045); } catch { /* already finished */ }
  }

  private stopAllClearFires(): void {
    for (const participantId of this.activeFires.keys()) this.stopClearFire(participantId);
  }

  private syncClearFires(state: MatchState): void {
    const context = this.context;
    const buffer = this.clearFireBuffer;
    const destination = this.sfxBus;
    if (!context || !buffer || !destination) return;
    if (state.phase === 'paused' || state.phase === 'results' || state.pauseReasons.length > 0) {
      this.stopAllClearFires();
      return;
    }
    for (const burn of state.anomalyBurnEvents) {
      const index = state.participants.findIndex((participant) => participant.config.id === burn.participantId);
      const pan = state.participants.length <= 1 ? 0 : -0.72 + 1.44 * Math.max(0, index) / (state.participants.length - 1);
      this.startClearFire(burn.participantId, burn.serial, burn.pulseMs, pan);
    }
  }

  private syncArrivalFire(state: MatchState): void {
    const burn = state.anomalyTransition;
    if (state.phase === 'paused' || state.phase === 'results' || state.pauseReasons.length > 0
      || burn?.phase !== 'burning' || burn.targets.length === 0) {
      this.stopClearFire(ARRIVAL_FIRE);
      return;
    }
    // One shared source at row-fire gain, even when all eight boards burn together.
    this.startClearFire(ARRIVAL_FIRE, burn.serial, burn.remainingMs, 0);
  }

  private startClearFire(key: string | symbol, serial: number, remainingMs: number, pan: number): void {
    const context = this.context;
    const buffer = this.clearFireBuffer;
    const destination = this.sfxBus;
    if (!context || !buffer || !destination) return;
    const existing = this.activeFires.get(key);
    if (existing?.serial === serial) return;
    if (existing) this.stopClearFire(key);
    const source = context.createBufferSource();
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    source.buffer = buffer;
    gain.gain.value = 0.55 * CLEAR_EFFECT_GAIN_SCALE;
    panner.pan.value = pan;
    source.connect(gain); gain.connect(panner); panner.connect(destination);
    const playback = { serial, source, gain };
    this.activeFires.set(key, playback);
    source.onended = () => {
      if (this.activeFires.get(key) === playback) this.activeFires.delete(key);
    };
    source.start(context.currentTime + 0.008, Math.min(buffer.duration - 0.01, Math.max(0, (1_000 - remainingMs) / 1_000)));
  }

  private playFoley(kind: FoleyKind, variation: number, start: number, pan: number, volume: number): void {
    const buffer = this.foley?.[kind][variation % 3];
    if (!buffer) return;
    this.playBufferedFoley(buffer, start, pan, volume, 1800);
  }

  private playBufferedFoley(buffer: AudioBuffer, start: number, pan: number, volume: number, lowpass?: number, playbackRate = 1): boolean {
    const context = this.context;
    const destination = this.sfxBus;
    if (!context || !destination) return false;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    gain.gain.value = volume; panner.pan.value = Math.max(-1, Math.min(1, pan));
    if (lowpass) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = lowpass;
      source.connect(filter); filter.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(panner); panner.connect(destination);
    source.start(start); if (this.previewing) this.previewSources.push(source);
    return true;
  }

  private playLevelUp(start: number, level: number, pan: number): void {
    if (this.playPackEvent('level-up', start, pan, 1 + Math.min(level, 7) * 0.035)) return;
    const root = 69 + Math.min(7, level);
    [0, 4, 7].forEach((offset, index) => {
      this.tone(midiFrequency(root + offset), start + index * 0.072, 0.34, 0.072, 'triangle', pan, 2500);
    });
    this.noise(start, 0.3, 0.022, 'highpass', 2200, pan);
  }

  private playAnomaly(start: number, pan: number): void {
    // One common alarm motif across presets; all tones still use the Effects bus.
    for (let index = 0; index < 3; index += 1) {
      const at = start + index * 0.28;
      this.tone(620, at, 0.24, 0.085, 'triangle', pan, 2400, undefined, 0.015, 980, false);
      this.tone(310, at, 0.24, 0.032, 'sine', pan, 1400, undefined, 0.015, 490, false);
    }
  }

  private playPressure(start: number): void {
    if (this.playPackEvent('pressure', start, 0, 1.12)) return;
    this.tone(72, start, 0.55, 0.11, 'sawtooth', 0, 360, undefined, 0.012, 46);
    this.noise(start, 0.32, 0.05, 'lowpass', 520, 0);
  }

  private playConflictLaunch(start: number, rows: number, pan: number): void {
    if (this.playPackEvent('conflict-launch', start, pan, rows >= 4 ? 1.35 : rows >= 3 ? 1.18 : 1)) return;
    const profile = conflictSoundProfile(rows);
    const notes = profile.tier === 4 ? [0, 4, 7, 12, 16, 19, 24, 28, 31] : profile.tier === 3 ? [0, 7, 12] : [0, 7];
    notes.forEach((offset, index) => this.tone(
      profile.root * (2 ** (offset / 12)),
      start + index * (profile.tier === 4 ? 0.045 : 0.06),
      profile.duration - index * 0.035,
      profile.gain * (1 - index * 0.1),
      profile.tier === 4 && index === 0 ? 'sawtooth' : 'triangle',
      pan,
      profile.tier === 4 ? 3300 : 2400,
      undefined,
      0.008,
    ));
    this.noise(start, profile.duration * 0.55, profile.gain * 0.22, 'bandpass', profile.tier === 4 ? 2100 : 2800, pan);
    if (profile.tier === 4) {
      [1760, 2093, 2349, 2637].forEach((frequency, index) => this.tone(frequency, start + 0.008 + index * 0.018, 0.28, 0.028, 'sine', pan, 3800));
    }
  }

  private playConflictImpact(start: number, rows: number, pan: number): void {
    if (this.playPackEvent('conflict-impact', start, pan, rows >= 4 ? 1.35 : rows >= 3 ? 1.18 : 1)) return;
    const profile = conflictSoundProfile(rows);
    this.tone(profile.tier === 4 ? 82.41 : profile.tier === 3 ? 98 : 123.47, start, profile.duration, profile.gain, 'sine', pan, 520, undefined, 0.002, 42);
    this.noise(start, profile.duration * 0.58, profile.gain * 0.58, 'lowpass', profile.tier === 4 ? 760 : 980, pan);
    if (profile.tier === 4) {
      [293.66, 440, 587.33].forEach((frequency, index) => this.tone(
        frequency,
        start + 0.075 + index * 0.052,
        0.5,
        0.055,
        'triangle',
        pan,
        2400,
        undefined,
        0.012,
      ));
    }
  }

  private playCleanup(start: number, rows: number, pan: number, amplified = false): void {
    if (this.playPackEvent('cleanup', start, pan, amplified ? 1.3 : 1 + Math.min(rows, 4) * 0.04)) return;
    const count = Math.max(1, Math.min(4, rows));
    for (let index = 0; index <= count; index += 1) {
      this.tone(
        midiFrequency((amplified ? 74 : 67) + index * 3),
        start + index * 0.055,
        0.34,
        amplified ? 0.075 : 0.052,
        'sine',
        pan,
        3000,
        undefined,
        0.018,
      );
    }
    this.noise(start, 0.28, 0.018, 'highpass', 3600, pan);
  }

  private playShieldHalfCharge(start: number, pan: number): void {
    if (this.playPackEvent('shield-half-charge', start, pan)) return;
    this.tone(270, start, 0.48, 0.042, 'triangle', pan, 2500, undefined, 0.012, 820);
    this.tone(540, start + 0.025, 0.36, 0.019, 'sine', pan, 3300, undefined, 0.012, 1140);
  }

  private playShieldFullCharge(start: number, pan: number): void {
    if (this.playPackEvent('shield-full-charge', start, pan, 1.18)) return;
    this.tone(250, start, 0.74, 0.052, 'triangle', pan, 2600, undefined, 0.012, 920);
    this.tone(500, start + 0.035, 0.64, 0.028, 'sine', pan, 3400, undefined, 0.012, 1320);
    this.tone(1000, start + 0.09, 0.48, 0.018, 'sine', pan, 3800, undefined, 0.014, 1880);
  }

  private playShieldBlock(start: number, pan: number): void {
    if (this.playPackEvent('shield-block', start, pan, 1.2)) return;
    this.tone(210, start, 0.52, 0.07, 'triangle', pan, 1700, undefined, 0.012, 115);
    this.tone(420, start + 0.025, 0.36, 0.027, 'sine', pan, 2500, undefined, 0.012, 260);
  }

  private playDefense(start: number, pan: number): void {
    if (this.playPackEvent('active-defense', start, pan, 1.15)) return;
    this.tone(480, start, 0.4, 0.05, 'triangle', pan, 3000, undefined, 0.012, 1000);
    this.tone(960, start + 0.03, 0.3, 0.026, 'sine', pan, 3600, undefined, 0.012, 1480);
  }
  private playFinalPush(start: number): void {
    if (this.playPackEvent('final-push', start, 0, 1.25)) return;
    [196, 246.94, 293.66].forEach((frequency, index) => this.tone(frequency, start + index * 0.06, 0.5, 0.075, 'sawtooth', 0, 2400));
  }

  private playEliminated(start: number, pan: number): void {
    if (this.playPackEvent('eliminated', start, pan)) return;
    [392, 329.63, 246.94].forEach((frequency, index) => {
      this.tone(frequency, start + index * 0.09, 0.22, 0.06, 'triangle', pan, 1500);
    });
  }

  private playResults(start: number): void {
    if (this.playPackEvent('results-win', start, 0, 1.15)) return;
    [60, 64, 67, 72].forEach((note, index) => {
      this.tone(midiFrequency(note), start + index * 0.11, 0.6, 0.075, 'triangle', 0, 2100, undefined, 0.012);
    });
    this.tone(midiFrequency(48), start + 0.3, 1.2, 0.06, 'sine', 0, 700, undefined, 0.08);
  }

  private playPackEvent(event: SfxPackEventId, start: number, pan: number, intensity = 1, variation?: number): boolean {
    const pack = SFX_PACKS[this.sfxPreset];
    if (pack.kind === 'original') return false;
    if (pack.kind === 'buffered') {
      const variants = pack.events[event];
      const selected = variants[(variation ?? this.nextVariation(`${pack.id}:${event}`)) % variants.length];
      if (!selected) return true;
      const buffer = pack.id === 'quiet-mechanism'
        ? this.quietMechanismBuffers?.[selected.asset]
        : this.softToyBuffers?.[selected.asset as SoftToyAssetId];
      if (!buffer) return true;
      this.playBufferedFoley(buffer, start, pan, selected.gain * intensity, selected.lowpass, selected.playbackRate);
      return true;
    }
    const variants = pack.events[event];
    const selected = variants[(variation ?? this.nextVariation(`${pack.id}:${event}`)) % variants.length];
    if (!selected) return true;
    this.playNeonVariant(selected, start, pan, intensity);
    return true;
  }

  private playPackPreview(event: 'ui-select' | 'ui-confirm' | 'ui-back' | 'ui-error' | 'results-win' | 'results-lose', start: number): void {
    if (this.playPackEvent(event, start, 0)) return;
    if (event === 'ui-select') {
      this.tone(587.33, start, 0.07, 0.038, 'sine', 0, 1800);
      this.tone(880, start + 0.045, 0.09, 0.026, 'triangle', 0, 2200);
    }
    if (event === 'ui-confirm') this.tone(659.25, start, 0.12, 0.052, 'triangle', 0, 2100);
    if (event === 'ui-back') this.tone(523.25, start, 0.12, 0.046, 'triangle', 0, 1800, undefined, 0.006, 392);
    if (event === 'ui-error') this.tone(196, start, 0.2, 0.07, 'sawtooth', 0, 1200, undefined, 0.006, 147);
    if (event === 'results-win') this.playResults(start);
    if (event === 'results-lose') this.playEliminated(start, 0);
  }

  private playNeonVariant(variant: NeonVariant, start: number, pan: number, intensity: number): void {
    this.tone(
      variant.frequency,
      start,
      variant.duration,
      variant.gain * intensity,
      variant.waveform,
      pan,
      variant.lowpass,
      undefined,
      0.008,
      variant.endFrequency,
      false,
    );
    if (variant.noise) this.noise(start, Math.min(variant.duration, 0.24), variant.noise * intensity, 'lowpass', Math.min(1600, variant.lowpass), pan);
  }

  private tone(
    frequency: number,
    start: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    pan: number,
    filterFrequency: number,
    destination: AudioNode | null = this.sfxBus,
    attack = 0.006,
    endFrequency?: number,
    styled = true,
  ): void {
    const context = this.context;
    if (!context || !destination) return;
    const effectsStyle = styled && destination === this.sfxBus ? sfxDirection(this.sfxDirectionId) : null;
    const pitchMultiplier = effectsStyle ? 2 ** (effectsStyle.pitchOffset / 12) : 1;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    oscillator.type = effectsStyle && type !== 'sawtooth' ? (type === 'sine' ? effectsStyle.lead : effectsStyle.accent) : type;
    oscillator.frequency.setValueAtTime(frequency * pitchMultiplier, start);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency * pitchMultiplier, start + duration);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrequency * (effectsStyle?.brightness ?? 1), start);
    filter.Q.value = 0.7;
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
    if (this.previewing) this.previewSources.push(oscillator);
  }

  private noise(
    start: number,
    duration: number,
    volume: number,
    filterType: BiquadFilterType,
    filterFrequency: number,
    pan: number,
    destination: AudioNode | null = this.sfxBus,
  ): void {
    const context = this.context;
    if (!context || !destination || !this.noiseBuffer) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    source.buffer = this.noiseBuffer;
    filter.type = filterType;
    filter.frequency.value = filterFrequency;
    filter.Q.value = filterType === 'bandpass' ? 2.4 : 0.8;
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.gain.setValueAtTime(Math.max(0.0002, volume), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(destination);
    source.start(start);
    source.stop(start + duration);
    if (this.previewing) this.previewSources.push(source);
  }

  private percussion(start: number, kind: 'hat' | 'kick' | 'snare', volume: number, destination: AudioNode): void {
    if (kind === 'kick') {
      this.tone(118, start, 0.11, volume * 1.7, 'sine', 0, 600, destination, 0.002, 54);
      return;
    }
    this.noise(start, kind === 'hat' ? 0.035 : 0.085, volume, kind === 'hat' ? 'highpass' : 'bandpass', kind === 'hat' ? 5200 : 1600, 0, destination);
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.6), context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = (Math.random() * 2 - 1) * (1 - index / channel.length);
    }
    return buffer;
  }

  private prepareSoftToy(context: AudioContext): Promise<boolean> {
    if (this.softToyBuffers) return Promise.resolve(true);
    if (this.softToyLoad) return this.softToyLoad;
    this.softToyLoad = createSoftToySfxLibrary(context)
      .then((library) => {
        const complete = SOFT_TOY_ASSET_IDS.every((id) => Boolean(library[id])) && validateSfxPack(SFX_PACKS['soft-toy']);
        if (complete) this.softToyBuffers = library;
        return complete;
      })
      .catch(() => false)
      .finally(() => { this.softToyLoad = null; });
    return this.softToyLoad;
  }

  private prepareQuietMechanism(context: AudioContext): Promise<boolean> {
    if (this.quietMechanismBuffers) return Promise.resolve(true);
    if (this.quietMechanismLoad) return this.quietMechanismLoad;
    this.quietMechanismLoad = Promise.all([this.prepareSoftToy(context), createQuietMechanismSfxLibrary(context)])
      .then(([baseReady, library]) => {
        const complete = baseReady && this.softToyBuffers !== null
          && QUIET_MECHANISM_ASSET_IDS.every((id) => Boolean(library[id]))
          && validateSfxPack(SFX_PACKS['quiet-mechanism']);
        if (complete && this.softToyBuffers) this.quietMechanismBuffers = { ...this.softToyBuffers, ...library };
        return complete;
      })
      .catch(() => false)
      .finally(() => { this.quietMechanismLoad = null; });
    return this.quietMechanismLoad;
  }

  private restartMusicClock(): void {
    if (!this.context) return;
    this.musicStep = 0;
    this.nextMusicStepAt = this.context.currentTime + 0.045;
  }

  private stopPrototypePreviews(): void {
    const now = this.context?.currentTime;
    if (now === undefined) return;
    for (const source of this.previewSources.splice(0)) {
      try { source.stop(now); } catch { /* source has already stopped */ }
    }
  }

  private nextVariation(event: string): number {
    const occurrence = this.variationCounts.get(event) ?? 0;
    this.variationCounts.set(event, occurrence + 1);
    return variationIndex(event, 3, occurrence);
  }

  private duckMusic(now: number): void {
    const bus = this.musicBus;
    if (!bus) return;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
    bus.gain.linearRampToValueAtTime(CRITICAL_MUSIC_DUCK_GAIN, now + 0.025);
    bus.gain.exponentialRampToValueAtTime(this.mode === 'paused' || this.mode === 'results' ? 0.055 : 0.25, now + CRITICAL_MUSIC_DUCK_SECONDS);
  }

  private applyMasterGain(): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(masterGainForVolume(1, this.muted), now + 0.08);
  }

  private applyUserGains(): void {
    const now = this.context?.currentTime;
    if (now === undefined) return;
    for (const [gain, value] of [[this.musicUserGain, this.musicVolume], [this.effectsUserGain, this.effectsVolume]] as const) {
      if (!gain) continue;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(value, now + 0.08);
    }
  }

  private clampVolume(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_MASTER_VOLUME;
  }

  private fadeMusic(value: number): void {
    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus) return;
    bus.gain.cancelScheduledValues(context.currentTime);
    bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), context.currentTime);
    bus.gain.exponentialRampToValueAtTime(Math.max(0.0001, value), context.currentTime + 0.18);
  }
}
