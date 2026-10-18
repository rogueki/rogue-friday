import { describe, expect, it, vi } from "vitest";
import { createAudioAnalyzer } from "./analyzer";
import { createAudioFrame } from "./frame";
import { createFakeAudio, dbToAmp, sine, sum, whiteNoise } from "./fakeAudio";

// The fake analyser computes a DFT per frame; give slow CI machines room.
vi.setConfig({ testTimeout: 30_000 });

/** Runs `ms` of audio at 10 ms steps and returns the last frame. */
function run(analyzer: ReturnType<typeof createAudioAnalyzer>, clock: { t: number }, ms: number, onFrame?: (f: ReturnType<typeof createAudioFrame>) => void) {
  const frame = createAudioFrame();
  for (let i = 0; i < ms / 10; i++) {
    clock.t += 10;
    analyzer.sample(clock.t, frame);
    onFrame?.(frame);
  }
  return frame;
}

const NOISE_DB = -60;

function calibrated(kind: "input" | "output" = "input") {
  const audio = createFakeAudio();
  const analyzer = createAudioAnalyzer(audio.context, audio.source, { kind });
  const clock = { t: 0 };
  audio.analyser.signal = whiteNoise(dbToAmp(NOISE_DB) * Math.sqrt(3)); // uniform noise: rms = amp / sqrt(3)
  run(analyzer, clock, 800);
  return { audio, analyzer, clock };
}

describe("createAudioAnalyzer", () => {
  it("is a side branch: connects the analyser to the source only and disconnects it on dispose", () => {
    const audio = createFakeAudio();
    const analyzer = createAudioAnalyzer(audio.context, audio.source, { kind: "input" });
    expect(audio.connected).toEqual([audio.analyser]);
    analyzer.dispose();
    expect(audio.disconnected).toEqual([audio.analyser]);
    const out = createAudioFrame();
    analyzer.sample(10, out);
    expect(out.rms).toBe(0);
    expect(out.source).toBe("none");
  });

  it("calibrates the noise floor from the first 600 ms (median RMS) and stays silent on noise afterwards", () => {
    const { analyzer, clock, audio } = calibrated();
    expect(analyzer.calibrating).toBe(false);
    expect(analyzer.noiseFloorDb).toBeGreaterThan(NOISE_DB - 4);
    expect(analyzer.noiseFloorDb).toBeLessThan(NOISE_DB + 4);
    const f = run(analyzer, clock, 1000);
    audio.analyser.signal = whiteNoise(dbToAmp(NOISE_DB + 3) * Math.sqrt(3), 5); // +3 dB jitter stays below the gate
    const quiet = run(analyzer, clock, 500);
    expect(f.gateOpen).toBe(false);
    expect(quiet.rms).toBe(0);
    expect(quiet.peak).toBe(0);
    expect(quiet.low + quiet.mid + quiet.high).toBe(0);
  });

  it("quiet speech is smaller than loud speech, both normalised to 0..1, silence is exactly 0", () => {
    const { audio, analyzer, clock } = calibrated();
    audio.analyser.signal = sum(sine(1000, dbToAmp(-38)), whiteNoise(dbToAmp(NOISE_DB) * Math.sqrt(3), 2));
    const quiet = run(analyzer, clock, 600);
    audio.analyser.signal = sum(sine(1000, dbToAmp(-12)), whiteNoise(dbToAmp(NOISE_DB) * Math.sqrt(3), 3));
    const loud = run(analyzer, clock, 600);
    expect(quiet.gateOpen).toBe(true);
    expect(quiet.rms).toBeGreaterThan(0.05);
    expect(quiet.rms).toBeLessThanOrEqual(0.5);
    expect(loud.rms).toBeGreaterThanOrEqual(0.75);
    expect(loud.rms).toBeGreaterThan(quiet.rms * 1.5);
    expect(loud.rms).toBeLessThanOrEqual(1);
    expect(loud.peak).toBeLessThanOrEqual(1);
    audio.analyser.signal = whiteNoise(dbToAmp(NOISE_DB) * Math.sqrt(3), 4);
    const silent = run(analyzer, clock, 1200);
    expect(silent.rms).toBeLessThan(0.01);
    expect(silent.gateOpen).toBe(false);
  });

  it("attack follows ~70 ms and release ~200 ms (+-10 %) between two levels above the gate", () => {
    /** Fresh calibrated analyser, settled at `from`, then `to` for `ms`; returns rms right after. */
    const step = (from: number, to: number, ms: number) => {
      const p = calibrated();
      p.audio.analyser.signal = sine(1000, dbToAmp(from));
      run(p.analyzer, p.clock, 1500);
      p.audio.analyser.signal = sine(1000, dbToAmp(to));
      return run(p.analyzer, p.clock, ms).rms;
    };
    const settledLow = step(-30, -30, 10);
    const settledHigh = step(-12, -12, 10);
    expect(settledHigh).toBeGreaterThan(settledLow);
    const attack = step(-30, -12, 70);
    const expectedAttack = settledLow + (settledHigh - settledLow) * (1 - Math.exp(-1));
    expect(attack).toBeGreaterThan(expectedAttack * 0.9);
    expect(attack).toBeLessThan(expectedAttack * 1.1);
    const release = step(-12, -30, 200);
    const expectedRelease = settledHigh + (settledLow - settledHigh) * (1 - Math.exp(-1));
    expect(release).toBeGreaterThan(expectedRelease * 0.9);
    expect(release).toBeLessThan(expectedRelease * 1.1);
  });

  it("the gate has hysteresis and a hold: a level between the thresholds neither opens nor closes it", () => {
    const { audio, analyzer, clock } = calibrated();
    const floor = analyzer.noiseFloorDb;
    // rms of a sine = amp / sqrt(2): put the rms 7 dB over the floor (between +5 close and +9 open)
    const between = dbToAmp(floor + 7) * Math.SQRT2;
    audio.analyser.signal = sine(1000, between);
    expect(run(analyzer, clock, 400).gateOpen).toBe(false);
    audio.analyser.signal = sine(1000, dbToAmp(floor + 20) * Math.SQRT2);
    expect(run(analyzer, clock, 200).gateOpen).toBe(true);
    audio.analyser.signal = sine(1000, between);
    expect(run(analyzer, clock, 40).gateOpen).toBe(true); // hold
    expect(run(analyzer, clock, 600).gateOpen).toBe(true); // still above the close threshold
    audio.analyser.signal = sine(1000, dbToAmp(floor + 2) * Math.SQRT2);
    expect(run(analyzer, clock, 400).gateOpen).toBe(false);
  });

  it("splits the spectrum: low (60-250 Hz), mid (250-2000 Hz), high (2-6 kHz)", () => {
    const { audio, analyzer, clock } = calibrated();
    const at = (freq: number) => {
      audio.analyser.signal = sine(freq, dbToAmp(-14));
      return run(analyzer, clock, 800);
    };
    const low = at(125);
    expect(low.low).toBeGreaterThan(low.mid);
    expect(low.low).toBeGreaterThan(low.high);
    const mid = at(1000);
    expect(mid.mid).toBeGreaterThan(mid.low);
    expect(mid.mid).toBeGreaterThan(mid.high);
    const high = at(3000);
    expect(high.high).toBeGreaterThan(high.low);
    expect(high.high).toBeGreaterThan(high.mid);
  });

  it("recalibrate() restarts the measurement; a manual noise floor skips it", () => {
    const { analyzer } = calibrated();
    analyzer.recalibrate();
    expect(analyzer.calibrating).toBe(true);
    const audio = createFakeAudio();
    const manual = createAudioAnalyzer(audio.context, audio.source, { kind: "input", noiseFloorDb: -50 });
    expect(manual.calibrating).toBe(false);
    expect(manual.noiseFloorDb).toBe(-50);
  });

  it("the output (TTS bus) analyser uses a fixed floor instead of calibrating on the speech", () => {
    const audio = createFakeAudio();
    const analyzer = createAudioAnalyzer(audio.context, audio.source, { kind: "output" });
    const clock = { t: 0 };
    audio.analyser.signal = sine(500, dbToAmp(-20)); // speech is already playing during the first 600 ms
    const f = run(analyzer, clock, 800);
    expect(analyzer.noiseFloorDb).toBe(-60);
    expect(f.gateOpen).toBe(true);
    expect(f.rms).toBeGreaterThan(0.3);
  });

  it("reports silence instead of throwing when the context is closed", () => {
    const audio = createFakeAudio();
    const analyzer = createAudioAnalyzer(audio.context, audio.source, { kind: "input" });
    audio.analyser.getFloatTimeDomainData = () => {
      throw new Error("closed");
    };
    const out = createAudioFrame();
    expect(() => analyzer.sample(10, out)).not.toThrow();
    expect(out.rms).toBe(0);
  });
});
