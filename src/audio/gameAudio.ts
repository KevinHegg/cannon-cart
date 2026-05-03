import { GameEvent, GameEventKind } from "../game/events";

export interface AudioVisualState {
  muted: boolean;
  unlocked: boolean;
  supported: boolean;
}

type AudioContextConstructor = new () => AudioContext;
type OscillatorKind = OscillatorType;

const STORAGE_KEY = "cannon-cart-muted";
const MASTER_VOLUME = 0.24;

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = loadMutedPreference();
  private unlocked = false;
  private supported = typeof window !== "undefined" && Boolean(getAudioContextConstructor());
  private steerCooldownUntil = 0;
  private noiseSeed = 1234567;

  getState(): AudioVisualState {
    return {
      muted: this.muted,
      unlocked: this.unlocked,
      supported: this.supported
    };
  }

  noteUserGesture(): boolean {
    if (this.muted || this.unlocked || !this.supported) {
      return false;
    }

    try {
      this.ensureContext();
      void this.context?.resume();
      this.unlocked = true;
      return true;
    } catch {
      this.supported = false;
      return false;
    }
  }

  toggleMuted(): AudioVisualState {
    this.muted = !this.muted;
    saveMutedPreference(this.muted);

    if (this.master) {
      this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    }

    if (!this.muted) {
      this.noteUserGesture();
      this.play("uiTap");
    }

    return this.getState();
  }

  playEvents(events: GameEvent[]): void {
    for (const event of events) {
      this.play(mapEventToSound(event.kind));
    }
  }

  playSteerTick(frame: number, steering: number): void {
    if (steering === 0 || frame < this.steerCooldownUntil) {
      return;
    }

    this.steerCooldownUntil = frame + 22;
    this.play("steerTick");
  }

  play(kind: SoundKind): void {
    if (this.muted || !this.unlocked || !this.supported) {
      return;
    }

    try {
      this.ensureContext();
      const context = this.context;
      if (!context) {
        return;
      }

      const now = context.currentTime;

      if (kind === "uiTap") {
        this.tap(now);
      } else if (kind === "runStart") {
        this.runStart(now);
      } else if (kind === "steerTick") {
        this.steer(now);
      } else if (kind === "fire") {
        this.fire(now);
      } else if (kind === "cannonReady") {
        this.ready(now);
      } else if (kind === "pickupBoost") {
        this.pickupBoost(now);
      } else if (kind === "pickupShield") {
        this.pickupShield(now);
      } else if (kind === "useBoost") {
        this.boost(now);
      } else if (kind === "shieldBlocked") {
        this.shield(now);
      } else if (kind === "obstacleHit") {
        this.bonk(now);
      } else if (kind === "obstacleCleared") {
        this.pop(now);
      } else if (kind === "rivalTagged") {
        this.zap(now);
      } else if (kind === "win") {
        this.win(now);
      } else if (kind === "loss") {
        this.loss(now);
      } else if (kind === "restart") {
        this.restart(now);
      }
    } catch {
      this.supported = false;
    }
  }

  private ensureContext(): void {
    if (this.context && this.master) {
      return;
    }

    const AudioCtor = getAudioContextConstructor();
    if (!AudioCtor) {
      this.supported = false;
      return;
    }

    this.context = new AudioCtor();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.master.connect(this.context.destination);
  }

  private tone(
    start: number,
    frequency: number,
    duration: number,
    type: OscillatorKind,
    volume: number,
    endFrequency = frequency
  ): void {
    if (!this.context || !this.master) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + duration * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(start: number, duration: number, volume: number, filterFrequency = 900): void {
    if (!this.context || !this.master) {
      return;
    }

    const length = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let index = 0; index < length; index += 1) {
      this.noiseSeed = (this.noiseSeed * 1664525 + 1013904223) >>> 0;
      data[index] = (this.noiseSeed / 0xffffffff) * 2 - 1;
    }

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterFrequency;
    filter.Q.value = 1.8;
    source.buffer = buffer;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private tap(now: number): void {
    this.tone(now, 420, 0.035, "triangle", 0.07, 620);
    this.noise(now, 0.025, 0.014, 1200);
  }

  private runStart(now: number): void {
    this.tone(now, 330, 0.06, "triangle", 0.07, 440);
    this.tone(now + 0.075, 440, 0.06, "triangle", 0.07, 590);
    this.tone(now + 0.15, 660, 0.09, "square", 0.065, 880);
  }

  private steer(now: number): void {
    this.tone(now, 170, 0.045, "sawtooth", 0.022, 135);
    this.noise(now, 0.035, 0.016, 1800);
  }

  private fire(now: number): void {
    this.tone(now, 120, 0.1, "sine", 0.09, 70);
    this.tone(now + 0.015, 330, 0.055, "square", 0.065, 180);
    this.noise(now, 0.065, 0.042, 640);
    this.tone(now + 0.052, 760, 0.07, "triangle", 0.045, 1280);
  }

  private ready(now: number): void {
    this.tone(now, 740, 0.06, "sine", 0.045, 1180);
    this.tone(now + 0.055, 990, 0.055, "triangle", 0.036, 1320);
  }

  private pickupBoost(now: number): void {
    this.noise(now, 0.07, 0.02, 2400);
    this.tone(now, 540, 0.06, "triangle", 0.045, 810);
    this.tone(now + 0.065, 900, 0.075, "sine", 0.042, 1360);
  }

  private pickupShield(now: number): void {
    this.tone(now, 390, 0.09, "sine", 0.038, 620);
    this.tone(now + 0.048, 760, 0.12, "triangle", 0.034, 1120);
    this.tone(now + 0.1, 1320, 0.05, "sine", 0.025, 1560);
  }

  private boost(now: number): void {
    this.noise(now, 0.18, 0.045, 1600);
    this.tone(now, 180, 0.18, "sawtooth", 0.045, 620);
    this.tone(now + 0.08, 820, 0.1, "triangle", 0.035, 1260);
  }

  private shield(now: number): void {
    this.tone(now, 230, 0.12, "sine", 0.075, 480);
    this.tone(now + 0.035, 760, 0.11, "triangle", 0.05, 1450);
    this.noise(now + 0.02, 0.09, 0.025, 2500);
  }

  private bonk(now: number): void {
    this.tone(now, 150, 0.11, "triangle", 0.075, 78);
    this.noise(now, 0.085, 0.035, 360);
    this.tone(now + 0.045, 260, 0.07, "sine", 0.035, 190);
  }

  private pop(now: number): void {
    this.tone(now, 280, 0.05, "square", 0.055, 620);
    this.noise(now, 0.07, 0.034, 1200);
    this.tone(now + 0.045, 820, 0.055, "triangle", 0.036, 1260);
  }

  private zap(now: number): void {
    this.tone(now, 1180, 0.08, "sawtooth", 0.055, 420);
    this.tone(now + 0.03, 620, 0.11, "square", 0.045, 970);
  }

  private win(now: number): void {
    this.tone(now, 392, 0.08, "triangle", 0.052, 523.25);
    this.tone(now + 0.08, 523.25, 0.08, "triangle", 0.052, 659.25);
    this.tone(now + 0.16, 783.99, 0.14, "sine", 0.06, 1046.5);
  }

  private loss(now: number): void {
    this.tone(now, 440, 0.13, "triangle", 0.06, 330);
    this.tone(now + 0.11, 300, 0.18, "sine", 0.06, 160);
    this.noise(now + 0.18, 0.08, 0.025, 360);
  }

  private restart(now: number): void {
    this.tone(now, 280, 0.045, "triangle", 0.06, 720);
    this.tone(now + 0.045, 720, 0.055, "square", 0.04, 1080);
  }
}

export type SoundKind =
  | "uiTap"
  | "runStart"
  | "steerTick"
  | "fire"
  | "cannonReady"
  | "pickupBoost"
  | "pickupShield"
  | "useBoost"
  | "shieldBlocked"
  | "obstacleHit"
  | "obstacleCleared"
  | "rivalTagged"
  | "win"
  | "loss"
  | "restart";

export function createGameAudio(): GameAudio {
  return new GameAudio();
}

function mapEventToSound(kind: GameEventKind): SoundKind {
  if (kind === "pickupBoost") {
    return "pickupBoost";
  }

  if (kind === "pickupShield") {
    return "pickupShield";
  }

  if (kind === "useBoost") {
    return "useBoost";
  }

  if (kind === "shieldBlocked") {
    return "shieldBlocked";
  }

  if (kind === "obstacleHit") {
    return "obstacleHit";
  }

  if (kind === "obstacleCleared") {
    return "obstacleCleared";
  }

  if (kind === "rivalTagged") {
    return "rivalTagged";
  }

  if (kind === "win" || kind === "loss" || kind === "restart" || kind === "fire" || kind === "cannonReady") {
    return kind;
  }

  return "uiTap";
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
}

function loadMutedPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveMutedPreference(muted: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // Storage may be unavailable in private or embedded browsing contexts.
  }
}
