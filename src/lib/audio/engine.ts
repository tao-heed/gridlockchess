// lib/audio/engine.ts — Sample-based Web Audio engine for Gridlock Chess.
//
// Design philosophy (see GridlockChess.md):
//   Sound encodes *game state*, not piece *identity*. Each game event maps to a recorded
//   sample chosen for a gritty, real-world / mechanical character (see src/assets/audio).
//
// Every event is a decoded MP3 played through a single master-gain bus. Samples are
// fetched + decoded once on unlock (first user gesture); until a buffer is ready, that
// event is simply silent (non-fatal). One AudioContext is shared app-wide via a singleton.
// See src/assets/audio/CREDITS.md for sample attribution.
import moveSampleUrl from '@/assets/audio/move.mp3';
import captureSampleUrl from '@/assets/audio/capture.mp3';
import steamSampleUrl from '@/assets/audio/vector-exhausted.mp3';
import gridlockSampleUrl from '@/assets/audio/gridlock.mp3';
import overrideSampleUrl from '@/assets/audio/override.mp3';
import gameEndSampleUrl from '@/assets/audio/game-end.mp3';
import checkSampleUrl from '@/assets/audio/check.mp3';
import modeBalancedSampleUrl from '@/assets/audio/mode-balanced.mp3';
import promotionSampleUrl from '@/assets/audio/promotion.mp3';

export type SoundEvent =
  | 'move'              // King / pawn — mundane, free
  | 'anomalyMove'       // Anomaly move — base thud
  | 'override'          // King boarding an Anomaly — mech lock-in power-up
  | 'vectorExhausted'   // a single vector pool hit 0 — dry "click-off"
  | 'gridlock'          // all vectors hit 0 — low powerdown
  | 'capture'           // impact transient
  | 'check'             // alert stinger
  | 'gameEnd'           // checkmate / terminal
  | 'modeBalanced'      // UI: new game dealt — clean harmonic confirmation
  | 'promotion';        // Pawn → Omni/Terminator synthesis — metallic clang

/** Master gain ceiling — keeps the whole mix tasteful and non-fatiguing. */
const MASTER_GAIN = 0.5;

/**
 * Layered-cue micro-stagger offsets, in **seconds**, scheduled on the AudioContext clock
 * (sample-accurate — no `setTimeout` jitter). Single source of truth shared by the live game
 * and the Rules-page demos so they can never drift. Each layered cue gets its own moment so
 * transients don't mask each other, while staying well under the ~80ms threshold where the
 * ear starts hearing cues as *sequential* rather than *simultaneous feedback*.
 */
export const STAGGER = {
  /** Steam hiss when a single vector empties — reads as a consequence of the move. */
  vectorExhausted: 0.03,
  /** Danger alert — lands last so it's never smeared into the move/steam transients. */
  check: 0.06,
  /** Heavy lock-in when the last charge drains (full Gridlock). */
  gridlock: 0.2,
  /** Falling death scream on a Gridlock Death — 160ms after the lock-in. */
  gameEnd: 0.36,
} as const;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private muted = false;
  private moveBuffer: AudioBuffer | null = null;
  private captureBuffer: AudioBuffer | null = null;
  private steamBuffer: AudioBuffer | null = null;
  private gridlockBuffer: AudioBuffer | null = null;
  private overrideBuffer: AudioBuffer | null = null;
  private gameEndBuffer: AudioBuffer | null = null;
  private checkBuffer: AudioBuffer | null = null;
  private modeBalancedBuffer: AudioBuffer | null = null;
  private promotionBuffer: AudioBuffer | null = null;

  /** Lazily create / resume the AudioContext. Must be called from a user gesture. */
  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return; // Web Audio unsupported — silently no-op.
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_GAIN;
      // Brick-wall limiter on the output bus — transparently catches any peak when cues
      // stack (e.g. move + vector-exhausted + check), so the mix can never clip.
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.05;
      this.master.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
      void this.loadMoveSample(this.ctx);
      void this.loadCaptureSample(this.ctx);
      void this.loadSteamSample(this.ctx);
      void this.loadGridlockSample(this.ctx);
      void this.loadOverrideSample(this.ctx);
      void this.loadGameEndSample(this.ctx);
      void this.loadCheckSample(this.ctx);
      void this.loadModeBalancedSample(this.ctx);
      void this.loadPromotionSample(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Fetch + decode the recorded move sample once. Failures are non-fatal (synth fallback). */
  private async loadMoveSample(ctx: AudioContext): Promise<void> {
    if (this.moveBuffer) return;
    try {
      const res = await fetch(moveSampleUrl);
      const data = await res.arrayBuffer();
      this.moveBuffer = await ctx.decodeAudioData(data);
    } catch {
      this.moveBuffer = null;
    }
  }

  /** Fetch + decode the capture sample (swing whoosh) once. Used for piece captures. */
  private async loadCaptureSample(ctx: AudioContext): Promise<void> {
    if (this.captureBuffer) return;
    try {
      const res = await fetch(captureSampleUrl);
      const data = await res.arrayBuffer();
      this.captureBuffer = await ctx.decodeAudioData(data);
    } catch {
      this.captureBuffer = null;
    }
  }

  /** Fetch + decode the steam hiss sample once. Used for vectorExhausted cue. */
  private async loadSteamSample(ctx: AudioContext): Promise<void> {
    if (this.steamBuffer) return;
    try {
      const res = await fetch(steamSampleUrl);
      const data = await res.arrayBuffer();
      this.steamBuffer = await ctx.decodeAudioData(data);
    } catch {
      this.steamBuffer = null;
    }
  }

  /** Fetch + decode the gridlock sample once. Used for gridlock (all vectors exhausted). */
  private async loadGridlockSample(ctx: AudioContext): Promise<void> {
    if (this.gridlockBuffer) return;
    try {
      const res = await fetch(gridlockSampleUrl);
      const data = await res.arrayBuffer();
      this.gridlockBuffer = await ctx.decodeAudioData(data);
    } catch {
      this.gridlockBuffer = null;
    }
  }

  /** Fetch + decode the override sample once. Used for King boarding an Anomaly. */
  private async loadOverrideSample(ctx: AudioContext): Promise<void> {
    if (this.overrideBuffer) return;
    try {
      const res = await fetch(overrideSampleUrl);
      const data = await res.arrayBuffer();
      this.overrideBuffer = await ctx.decodeAudioData(data);
    } catch {
      this.overrideBuffer = null;
    }
  }

  /** Fetch + decode the gameEnd sample once. Used for checkmate/terminal. */
  private async loadGameEndSample(ctx: AudioContext): Promise<void> {
    if (this.gameEndBuffer) return;
    try {
      const res = await fetch(gameEndSampleUrl);
      const data = await res.arrayBuffer();
      this.gameEndBuffer = await ctx.decodeAudioData(data);
    } catch {
      this.gameEndBuffer = null;
    }
  }

  /** Fetch + decode the check sample once. Used for check alert. */
  private async loadCheckSample(ctx: AudioContext): Promise<void> {
    if (this.checkBuffer) return;
    try {
      const res = await fetch(checkSampleUrl);
      const data = await res.arrayBuffer();
      this.checkBuffer = await ctx.decodeAudioData(data);
    } catch {
      this.checkBuffer = null;
    }
  }

  /** Fetch + decode the modeBalanced sample once. Used for the New Game cue. */
  private async loadModeBalancedSample(ctx: AudioContext): Promise<void> {
    if (this.modeBalancedBuffer) return;
    try {
      const res = await fetch(modeBalancedSampleUrl);
      const data = await res.arrayBuffer();
      this.modeBalancedBuffer = await ctx.decodeAudioData(data);
    } catch {
      this.modeBalancedBuffer = null;
    }
  }

  /** Fetch + decode the promotion sample once. Used for pawn → Omni synthesis. */
  private async loadPromotionSample(ctx: AudioContext): Promise<void> {
    if (this.promotionBuffer) return;
    try {
      const res = await fetch(promotionSampleUrl);
      const data = await res.arrayBuffer();
      this.promotionBuffer = await ctx.decodeAudioData(data);
    } catch {
      this.promotionBuffer = null;
    }
  }

  /** Mute-state subscribers (React consumers via useSyncExternalStore). */
  private muteListeners = new Set<() => void>();

  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    for (const listener of this.muteListeners) listener();
  }

  isMuted = (): boolean => this.muted;

  /** Subscribe to mute-state changes. Returns an unsubscribe fn (useSyncExternalStore shape). */
  subscribeMuted = (listener: () => void): (() => void) => {
    this.muteListeners.add(listener);
    return () => {
      this.muteListeners.delete(listener);
    };
  };

  play(event: SoundEvent, delay = 0): void {
    if (this.muted || !this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const t = this.ctx.currentTime + Math.max(0, delay);

    switch (event) {
      case 'move':
        // Recorded piece-drop sample (Move.mp3) — natural, real-world piece sound.
        if (this.moveBuffer) this.sample(t, this.moveBuffer, { gain: 0.9 });
        break;

      case 'anomalyMove': {
        // Recorded piece-drop sample (Move.mp3) — natural, real-world piece sound.
        if (this.moveBuffer) this.sample(t, this.moveBuffer, { gain: 0.9 });
        break;
      }

      case 'vectorExhausted':
        // Steam hiss — immediate, visceral cue that a vector just ran dry.
        if (this.steamBuffer) this.sample(t, this.steamBuffer, { gain: 0.85 });
        break;

      case 'gridlock':
        // Heavy impact — the Anomaly locks up completely.
        if (this.gridlockBuffer) this.sample(t, this.gridlockBuffer, { gain: 0.85 });
        break;

      case 'override':
        // King boarding an Anomaly — heavy windy thud impact.
        if (this.overrideBuffer) this.sample(t, this.overrideBuffer, { gain: 0.85 });
        break;

      case 'capture':
        // Quick swing whoosh — satisfying impact transient for piece captures.
        if (this.captureBuffer) this.sample(t, this.captureBuffer, { gain: 0.85 });
        break;

      case 'check':
        // Shotgun rack — menacing alert that you're in danger.
        if (this.checkBuffer) this.sample(t, this.checkBuffer, { gain: 0.85 });
        break;

      case 'gameEnd':
        // Checkmate / terminal — dramatic falling scream.
        if (this.gameEndBuffer) this.sample(t, this.gameEndBuffer, { gain: 0.85 });
        break;

      case 'modeBalanced':
        // Racecar rushing by — swift, dynamic New Game cue.
        if (this.modeBalancedBuffer) this.sample(t, this.modeBalancedBuffer, { gain: 0.85 });
        break;

      case 'promotion':
        // Pawn → Omni/Terminator synthesis — heavy metallic clang.
        if (this.promotionBuffer) this.sample(t, this.promotionBuffer, { gain: 0.9 });
        break;
    }
  }

  /** Play a decoded audio sample (recorded SFX) through the master bus. */
  private sample(t: number, buffer: AudioBuffer, { gain = 1 }: { gain?: number } = {}): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master!);
    src.start(t);
  }
}

/** Process-wide singleton — one AudioContext for the whole app. */
let singleton: SoundEngine | null = null;
export function getSoundEngine(): SoundEngine {
  if (!singleton) singleton = new SoundEngine();
  return singleton;
}
