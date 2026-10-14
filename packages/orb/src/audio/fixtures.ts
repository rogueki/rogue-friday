import type { AudioFixtureName } from "../settings";

export type { AudioFixtureName };

/** Cheap deterministic hash noise in 0..1 (no Math.random: fixtures must be reproducible). */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothNoise(t: number, rate: number): number {
  const x = t * rate;
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Syllable-like envelope: bursts of ~0.18 s separated by short pauses, with word gaps. */
function speechEnvelope(t: number, peak: number, floor: number): number {
  const syllable = Math.pow(Math.abs(Math.sin(t * Math.PI * 2.7 + smoothNoise(t, 1.3) * 3)), 1.6);
  const word = smoothNoise(t, 0.9) > 0.28 ? 1 : 0.12;
  const jitter = 0.75 + 0.25 * smoothNoise(t, 14);
  return clamp01(floor + (peak - floor) * syllable * word * jitter);
}

/** Normalised audio level 0..1 at time `t` (seconds) for a named fixture (PLAN §52.3). */
export function audioFixtureLevel(name: AudioFixtureName, t: number): number {
  switch (name) {
    case "silence":
      return 0.012 * smoothNoise(t, 3);
    case "normal":
      return speechEnvelope(t, 0.5, 0.04);
    case "loud":
      return speechEnvelope(t, 0.95, 0.18);
    case "tts": {
      // TTS is evenly paced with a regular syllable rhythm and little dynamic range.
      const syllable = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 3.1);
      const phrase = smoothNoise(t, 0.35) > 0.12 ? 1 : 0.2;
      return clamp01((0.22 + 0.4 * syllable * (0.8 + 0.2 * smoothNoise(t, 5))) * phrase);
    }
    case "spike": {
      // Quiet background with a sharp transient every 2.5 s that decays in ~0.3 s.
      const phase = t % 2.5;
      const spike = phase < 0.04 ? phase / 0.04 : Math.exp(-(phase - 0.04) * 9);
      return clamp01(0.05 + 0.95 * spike * (phase < 1.2 ? 1 : 0));
    }
  }
}

export const AUDIO_FIXTURE_NAMES: readonly AudioFixtureName[] = ["silence", "normal", "loud", "tts", "spike"];

/** Fills `out` (length = n) with the fixture sampled over [t - dt*n, t]; used for waveform visualisations. */
export function sampleAudioFixture(name: AudioFixtureName, t: number, n: number, dt = 0.02): number[] {
  return Array.from({ length: n }, (_, i) => audioFixtureLevel(name, t - (n - 1 - i) * dt));
}

export interface AudioSmootherOptions {
  /** Seconds to rise ~63 % towards a higher level. */
  attack: number;
  /** Seconds to fall ~63 % towards a lower level. */
  release: number;
}

export const HALO_SMOOTHING: AudioSmootherOptions = { attack: 0.06, release: 0.25 };

/** One attack/release smoothing step (time-based, frame-rate independent). */
export function smoothAudioLevel(current: number, target: number, dt: number, opts: AudioSmootherOptions = HALO_SMOOTHING): number {
  const tau = target > current ? opts.attack : opts.release;
  const k = 1 - Math.exp(-dt / Math.max(tau, 1e-4));
  return current + (target - current) * k;
}

export class AudioSmoother {
  private value = 0;
  constructor(private readonly opts: AudioSmootherOptions = HALO_SMOOTHING) {}
  step(target: number, dt: number): number {
    this.value = smoothAudioLevel(this.value, clamp01(target), dt, this.opts);
    return this.value;
  }
  get level(): number {
    return this.value;
  }
  reset(value = 0): void {
    this.value = value;
  }
}
