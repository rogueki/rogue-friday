import type { OrbAudioFrame, OrbAudioFrameSource, OrbAudioLevels } from "../controller/types";
import { clamp01, noise1, normaliseLevels, type NormalisedLevels } from "./frame";

export interface ServiceLevelOptions {
  attackMs?: number; // default 70
  releaseMs?: number; // default 200
  /** Levels older than this decay to silence (default 900 ms; the service pushes at ~4 Hz). */
  staleMs?: number;
  /** Gate hysteresis on the smoothed rms. */
  gateOpen?: number;
  gateClose?: number;
}

export interface ServiceLevelSource extends OrbAudioFrameSource {
  /** Feeds a service level (scalar or banded). `nowMs` defaults to the monotonic clock. */
  push(level: number | OrbAudioLevels, nowMs?: number): void;
  /** Time of the last push (monotonic ms) or -Infinity. */
  readonly lastPushAt: number;
}

const monotonicNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Smooths the ~4 Hz service level (`friday.voice.audio_level`) into a per-frame signal: time-based attack/release towards
 * the latest value, decay to silence when pushes stop. Services without bands get low/mid/high estimated from the scalar
 * (spectral tilt of speech plus slow independent wobble) and the frame is flagged `bandsDerived`.
 */
export function createServiceLevelSource(options: ServiceLevelOptions = {}): ServiceLevelSource {
  const attack = Math.max(1, options.attackMs ?? 70) / 1000;
  const release = Math.max(1, options.releaseMs ?? 200) / 1000;
  const staleMs = options.staleMs ?? 900;
  const gateOpenAt = options.gateOpen ?? 0.06;
  const gateCloseAt = options.gateClose ?? 0.03;
  const target: NormalisedLevels = { rms: 0, peak: 0, low: 0, mid: 0, high: 0, derived: true };
  const scratch: NormalisedLevels = { rms: 0, peak: 0, low: 0, mid: 0, high: 0, derived: true };
  let rms = 0;
  let peak = 0;
  let low = 0;
  let mid = 0;
  let high = 0;
  let gate = false;
  let lastSample = Number.NaN;
  let lastPush = -Infinity;
  let disposed = false;

  const approach = (cur: number, to: number, dt: number, up: number, down: number): number =>
    cur + (to - cur) * (1 - Math.exp(-dt / (to > cur ? up : down)));

  return {
    get lastPushAt() {
      return lastPush;
    },
    push(level, nowMs = monotonicNow()) {
      if (disposed) return;
      const n = normaliseLevels(level, scratch);
      target.rms = n.rms;
      target.peak = n.peak;
      target.low = n.low;
      target.mid = n.mid;
      target.high = n.high;
      target.derived = n.derived;
      lastPush = nowMs;
    },
    sample(nowMs, out: OrbAudioFrame) {
      const dt = Number.isFinite(lastSample) ? Math.min(0.25, Math.max(0, (nowMs - lastSample) / 1000)) : 0;
      lastSample = nowMs;
      const fresh = nowMs - lastPush <= staleMs;
      const t = nowMs / 1000;
      let tr = fresh ? target.rms : 0;
      let tp = fresh ? target.peak : 0;
      let tl = fresh ? target.low : 0;
      let tm = fresh ? target.mid : 0;
      let th = fresh ? target.high : 0;
      if (fresh && target.derived) {
        // Spectral tilt of speech with independent slow wobble, so the bands do not move in lockstep.
        tl = tr * (0.88 + 0.12 * noise1(t * 3.1, 1));
        tm = tr * (0.72 + 0.28 * noise1(t * 4.3, 2));
        th = tr * (0.38 + 0.34 * noise1(t * 5.7, 3));
        tp = Math.max(tp, tr * (1 + 0.15 * noise1(t * 6.1, 4)));
      }
      rms = approach(rms, clamp01(tr), dt, attack, release);
      peak = approach(peak, clamp01(tp), dt, attack, release * 0.6);
      low = approach(low, clamp01(tl), dt, attack, release);
      mid = approach(mid, clamp01(tm), dt, attack, release);
      high = approach(high, clamp01(th), dt, attack, release);
      gate = gate ? rms > gateCloseAt : rms > gateOpenAt;
      out.rms = rms;
      out.peak = peak;
      out.low = low;
      out.mid = mid;
      out.high = high;
      out.gateOpen = gate;
      out.source = "service-level";
      out.bandsDerived = target.derived;
    },
    dispose() {
      disposed = true;
    },
  };
}
