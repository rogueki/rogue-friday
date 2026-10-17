import type { OrbAudioFrame, OrbAudioFrameSource } from "../controller/types";
import { clamp01 } from "./frame";

export interface AudioAnalyzerOptions {
  kind: "input" | "output";
  /** Attack time constant in ms (order: 50-90, default 70). */
  attackMs?: number;
  /** Release time constant in ms (order: 150-260, default 200). */
  releaseMs?: number;
  fftSize?: number; // default 1024
  /** Calibration window at start in ms (default 600). The noise floor is the median RMS inside it. */
  calibrationMs?: number;
  /** Manual noise floor in dBFS; skips the automatic calibration (default for `output`: -60). */
  noiseFloorDb?: number;
  /** Gate opens at floor + openDb, closes at floor + closeDb (defaults 9 / 5). */
  gateOpenDb?: number;
  gateCloseDb?: number;
  /** Gate hold in ms (default 80). */
  holdMs?: number;
}

export interface AudioAnalyzer extends OrbAudioFrameSource {
  readonly node: AnalyserNode;
  readonly kind: "input" | "output";
  /** Discards the calibration and measures the noise floor again (for example after switching the microphone). */
  recalibrate(): void;
  /** Current noise floor estimate in dBFS (NaN while calibrating). */
  readonly noiseFloorDb: number;
  readonly calibrating: boolean;
}

/** The slice of the Web Audio API the analyser needs (a real `BaseAudioContext` satisfies it; tests inject a fake). */
export interface AnalyserContextLike {
  readonly sampleRate: number;
  createAnalyser(): AnalyserNode;
}
export interface AnalyserSourceLike {
  connect(destination: AudioNode): unknown;
  disconnect(destination?: AudioNode): void;
}

const SILENCE_DB = -120;
const CAL_SAMPLES = 48;
const FLOOR_RISE_DB_PER_S = 0.5;
const CEIL_START_DB = -12;
const CEIL_DECAY_DB_PER_S = 3;
const LOW_BAND: readonly [number, number] = [60, 250];
const MID_BAND: readonly [number, number] = [250, 2000];
const HIGH_BAND: readonly [number, number] = [2000, 6000];

const toDb = (linear: number): number => (linear > 1e-6 ? 20 * Math.log10(linear) : SILENCE_DB);

/**
 * Web Audio analysis tap (MediaStream/TTS bus -> AnalyserNode). The analyser is a side branch: it has no output
 * connection, so it cannot block or colour playback or capture. `sample` is pulled once per rendered frame:
 * RMS and peak from the time domain, low/mid/high from the spectrum, normalised in dB between an adaptive noise floor
 * and a slowly decaying peak tracker, gated with a calibrated hysteresis gate and smoothed with attack/release.
 * All buffers are allocated once.
 */
export function createAudioAnalyzer(context: AnalyserContextLike, source: AnalyserSourceLike, options: AudioAnalyzerOptions): AudioAnalyzer {
  const node = context.createAnalyser();
  node.fftSize = options.fftSize ?? 1024;
  node.smoothingTimeConstant = 0; // smoothing happens in our own attack/release stage
  node.minDecibels = -110;
  node.maxDecibels = 0;
  source.connect(node);

  const attack = Math.max(1, options.attackMs ?? 70) / 1000;
  const release = Math.max(1, options.releaseMs ?? 200) / 1000;
  const peakRelease = release * 0.6;
  const calibrationMs = options.calibrationMs ?? 600;
  const gateOpenDb = options.gateOpenDb ?? 9;
  const gateCloseDb = options.gateCloseDb ?? 5;
  const holdMs = options.holdMs ?? 80;
  // The TTS bus is digital silence between utterances: a fixed floor avoids calibrating on the speech itself.
  const manualFloor = options.noiseFloorDb ?? (options.kind === "output" ? -60 : undefined);

  const time = new Float32Array(node.fftSize);
  const freq = new Float32Array(node.frequencyBinCount);
  const calSamples = new Float32Array(CAL_SAMPLES);
  const binHz = context.sampleRate / node.fftSize;
  const band = (b: readonly [number, number]): [number, number] => {
    const lo = Math.max(1, Math.floor(b[0] / binHz));
    const hi = Math.max(lo + 1, Math.min(freq.length, Math.ceil(b[1] / binHz)));
    return [lo, hi];
  };
  const [lowLo, lowHi] = band(LOW_BAND);
  const [midLo, midHi] = band(MID_BAND);
  const [highLo, highHi] = band(HIGH_BAND);

  let floorDb = manualFloor ?? Number.NaN;
  let calStart = Number.NaN;
  let calCount = 0;
  let ceilDb = CEIL_START_DB;
  let lastSample = Number.NaN;
  let gate = false;
  let belowSince = Number.NaN;
  let rms = 0;
  let peak = 0;
  let low = 0;
  let mid = 0;
  let high = 0;
  let disposed = false;

  const bandDb = (lo: number, hi: number): number => {
    let power = 0;
    for (let i = lo; i < hi; i++) {
      const db = freq[i] as number;
      power += db > -200 ? Math.pow(10, db / 10) : 0; // -Infinity / NaN (silent bins) contribute nothing
    }
    return power > 1e-12 ? 10 * Math.log10(power) : SILENCE_DB;
  };

  const approach = (cur: number, to: number, dt: number, up: number, down: number): number =>
    cur + (to - cur) * (1 - Math.exp(-dt / (to > cur ? up : down)));

  function finishCalibration(): void {
    const n = calCount;
    const view = calSamples.subarray(0, n);
    view.sort();
    floorDb = n > 0 ? (view[Math.floor(n / 2)] as number) : SILENCE_DB;
  }

  const analyzer: AudioAnalyzer = {
    node,
    kind: options.kind,
    get noiseFloorDb() {
      return floorDb;
    },
    get calibrating() {
      return Number.isNaN(floorDb);
    },
    recalibrate() {
      floorDb = manualFloor ?? Number.NaN;
      calStart = Number.NaN;
      calCount = 0;
      gate = false;
    },
    sample(nowMs, out: OrbAudioFrame) {
      if (disposed) {
        out.rms = out.peak = out.low = out.mid = out.high = 0;
        out.gateOpen = false;
        out.source = "none";
        return;
      }
      const dt = Number.isFinite(lastSample) ? Math.min(0.25, Math.max(0, (nowMs - lastSample) / 1000)) : 0;
      lastSample = nowMs;
      try {
        node.getFloatTimeDomainData(time);
        node.getFloatFrequencyData(freq);
      } catch {
        // a closed context must not kill the render loop: report silence
        out.rms = out.peak = out.low = out.mid = out.high = 0;
        out.gateOpen = false;
        out.source = "analyser";
        return;
      }
      let sum = 0;
      let pk = 0;
      for (let i = 0; i < time.length; i++) {
        const v = time[i] as number;
        sum += v * v;
        const a = v < 0 ? -v : v;
        if (a > pk) pk = a;
      }
      const rmsDb = toDb(Math.sqrt(sum / time.length));
      const peakDb = toDb(pk);

      // Calibration: median RMS over the first window = noise floor. After it the floor follows the quietest level.
      if (Number.isNaN(floorDb)) {
        if (Number.isNaN(calStart)) calStart = nowMs;
        if (calCount < CAL_SAMPLES) calSamples[calCount++] = rmsDb;
        if (nowMs - calStart >= calibrationMs && calCount >= 3) finishCalibration();
      } else if (manualFloor !== undefined) {
        floorDb = manualFloor;
      } else if (rmsDb < floorDb) {
        floorDb = rmsDb;
      } else {
        floorDb += FLOOR_RISE_DB_PER_S * dt;
        if (floorDb > rmsDb) floorDb = rmsDb;
      }
      const calibrating = Number.isNaN(floorDb);
      const floor = calibrating ? SILENCE_DB : floorDb;

      // Peak tracker: jumps up with loud input, decays slowly (does not follow below floor + 24 dB).
      ceilDb = Math.max(rmsDb, ceilDb - CEIL_DECAY_DB_PER_S * dt, floor + 24);
      if (ceilDb > 0) ceilDb = 0;

      // Hysteresis gate with hold.
      if (!calibrating) {
        if (gate) {
          if (rmsDb < floor + gateCloseDb) {
            if (Number.isNaN(belowSince)) belowSince = nowMs;
            if (nowMs - belowSince >= holdMs) {
              gate = false;
              belowSince = Number.NaN;
            }
          } else {
            belowSince = Number.NaN;
          }
        } else if (rmsDb > floor + gateOpenDb) {
          gate = true;
          belowSince = Number.NaN;
        }
      } else {
        gate = false;
      }

      const lo = floor + gateCloseDb; // just under the open threshold: speech starts above 0
      const hi = Math.max(ceilDb, lo + 24);
      const norm = (db: number): number => (gate ? clamp01((db - lo) / (hi - lo)) : 0);
      const tRms = norm(rmsDb);
      const tPeak = norm(peakDb);
      // Band levels are normalised with the same window shifted by the band's share of the spectrum power (-10 dB per band).
      const tLow = norm(bandDb(lowLo, lowHi) + 10);
      const tMid = norm(bandDb(midLo, midHi) + 10);
      const tHigh = norm(bandDb(highLo, highHi) + 10);

      rms = approach(rms, tRms, dt, attack, release);
      peak = approach(peak, Math.max(tPeak, tRms), dt, attack, peakRelease);
      low = approach(low, tLow, dt, attack, release);
      mid = approach(mid, tMid, dt, attack, release);
      high = approach(high, tHigh, dt, attack, release);

      out.rms = rms;
      out.peak = peak;
      out.low = low;
      out.mid = mid;
      out.high = high;
      out.gateOpen = gate;
      out.source = "analyser";
      out.bandsDerived = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        source.disconnect(node);
      } catch {
        // already disconnected / context closed
      }
    },
  };
  return analyzer;
}
