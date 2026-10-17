import { describe, expect, it } from "vitest";
import { analyzePcm16, LevelSmoother } from "../src/realtime/audio-analysis";
import { BrowserVoiceTelemetry, LEVEL_INTERVAL_MS, TTS_IDLE_END_MS, type TelemetryEvent } from "../src/realtime/browser-voice-telemetry";

const RATE = 16_000;
function tone(frequency: number, amplitude = 0.3, samples = 1_280): Uint8Array {
  const buffer = new ArrayBuffer(samples * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples; i += 1) view.setInt16(i * 2, Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * frequency * i) / RATE)), true);
  return new Uint8Array(buffer);
}
const silence = (): Uint8Array => new Uint8Array(2_560);

describe("analyzePcm16", () => {
  it("separates low, mid and high bands and keeps everything in 0..1", () => {
    const low = analyzePcm16(tone(120));
    const mid = analyzePcm16(tone(800));
    const high = analyzePcm16(tone(4_000));
    expect(low.low).toBeGreaterThan(Math.max(low.mid, low.high));
    expect(mid.mid).toBeGreaterThan(Math.max(mid.low, mid.high));
    expect(high.high).toBeGreaterThan(Math.max(high.low, high.mid));
    for (const levels of [low, mid, high]) for (const value of Object.values(levels)) expect(value >= 0 && value <= 1).toBe(true);
  });

  it("scales like the Python meter (-60..-6 dBFS) and is monotonic", () => {
    const values = [0.001, 0.01, 0.05, 0.2, 0.8].map((a) => analyzePcm16(tone(440, a)).level);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    const speech = analyzePcm16(tone(440, 0.1)).level; // 0.1 amplitude sine = -23 dBFS RMS -> ~0.69
    expect(speech).toBeGreaterThan(0.5);
    expect(speech).toBeLessThan(0.8);
  });

  it("silence, empty and short frames are zero; peak is at least the level", () => {
    expect(analyzePcm16(silence())).toEqual({ level: 0, peak: 0, low: 0, mid: 0, high: 0 });
    expect(analyzePcm16(new Uint8Array(0)).level).toBe(0);
    expect(analyzePcm16(new Uint8Array(10)).level).toBe(0);
    const loud = analyzePcm16(tone(440, 0.4));
    expect(loud.peak).toBeGreaterThanOrEqual(loud.level);
  });

  it("smooths: fast attack, slow release", () => {
    const smoother = new LevelSmoother();
    const target = analyzePcm16(tone(440, 0.5));
    const first = smoother.push(target).level;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(target.level);
    const decayed = smoother.push({ level: 0, peak: 0, low: 0, mid: 0, high: 0 });
    expect(decayed.level).toBeLessThan(first);
    expect(decayed.level).toBeGreaterThan(first * 0.5);
  });
});

function rig() {
  const clock = { now: 1_000_000 };
  const events: TelemetryEvent[] = [];
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const telemetry = new BrowserVoiceTelemetry({
    now: () => clock.now,
    ttsEngine: "ElevenLabs",
    publish: (event) => events.push(event),
    setTimer: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: clock.now + ms, run });
      return id;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
  });
  const advance = (ms: number): void => {
    clock.now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= clock.now) {
      timers.delete(id);
      timer.run();
    }
  };
  const types = () => events.map((event) => event.type);
  return { telemetry, events, advance, types, clock };
}

describe("BrowserVoiceTelemetry (Linux browser audio proxy)", () => {
  it("armed but idle microphone publishes nothing; input levels flow only while the service is listening", () => {
    const { telemetry, events, advance } = rig();
    telemetry.onInputFrame(tone(300));
    expect(events).toEqual([]);
    telemetry.setVoiceMode("listening");
    for (let i = 0; i < 6; i += 1) {
      telemetry.onInputFrame(tone(300, 0.3));
      advance(80);
    }
    const levels = events.filter((event) => event.type === "friday.voice.audio_level");
    expect(levels.length).toBeGreaterThanOrEqual(2);
    expect(levels.length).toBeLessThanOrEqual(Math.ceil((6 * 80) / LEVEL_INTERVAL_MS) + 1); // throttled
    expect(levels[0]?.data).toMatchObject({ direction: "input" });
    expect((levels[0]?.data as { level: number }).level).toBeGreaterThan(0);
    expect(Object.keys(levels[0]?.data ?? {}).sort()).toEqual(["at", "direction", "high", "level", "low", "mid", "peak"]);
    telemetry.setVoiceMode("transcribing"); // mic no longer used: one final 0, then nothing
    expect(events.at(-1)?.data).toMatchObject({ direction: "input", level: 0 });
    const count = events.length;
    telemetry.onInputFrame(tone(300));
    expect(events).toHaveLength(count);
  });

  it("TTS boundaries come from audio_start/audio_end and carry real output levels with bands", () => {
    const { telemetry, events, advance, types } = rig();
    telemetry.onVoiceControl('{"type":"audio_start"}');
    expect(types()).toEqual(["friday.voice.tts_started"]);
    expect(events[0]?.data).toMatchObject({ engine: "ElevenLabs" });
    for (let i = 0; i < 5; i += 1) {
      telemetry.onOutputFrame(tone(150, 0.4));
      advance(80);
    }
    const output = events.filter((event) => event.type === "friday.voice.audio_level");
    expect(output.length).toBeGreaterThanOrEqual(2);
    expect(output[1]?.data).toMatchObject({ direction: "output" });
    const sample = output[1]?.data as { low: number; high: number; level: number };
    expect(sample.level).toBeGreaterThan(0);
    expect(sample.low).toBeGreaterThan(sample.high);
    telemetry.onVoiceControl('{"type":"audio_end"}');
    const ended = events.filter((event) => event.type === "friday.voice.tts_ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]?.data).toMatchObject({ interrupted: false });
    expect((ended[0]?.data as { utteranceId: string }).utteranceId).toBe((events[0]?.data as { utteranceId: string }).utteranceId);
    expect(events.at(-2)?.data).toMatchObject({ direction: "output", level: 0 }); // level returns to 0 before tts_ended
  });

  it("clear means interrupted; a repeated audio_end is ignored; the next utterance gets a new id", () => {
    const { telemetry, events, types } = rig();
    telemetry.onVoiceControl('{"type":"audio_start"}');
    telemetry.onVoiceControl('{"type":"clear"}');
    telemetry.onVoiceControl('{"type":"audio_end"}');
    expect(types().filter((type) => type === "friday.voice.tts_ended")).toHaveLength(1);
    expect(events.find((event) => event.type === "friday.voice.tts_ended")?.data).toMatchObject({ interrupted: true });
    telemetry.onOutputFrame(tone(300));
    const ids = events.filter((event) => event.type === "friday.voice.tts_started").map((event) => (event.data as { utteranceId: string }).utteranceId);
    expect(new Set(ids).size).toBe(2);
  });

  it("frames without markers still start an utterance and end it after silence", () => {
    const { telemetry, advance, types } = rig();
    telemetry.onOutputFrame(tone(300));
    expect(types()[0]).toBe("friday.voice.tts_started");
    advance(TTS_IDLE_END_MS - 10);
    expect(types()).not.toContain("friday.voice.tts_ended");
    advance(20);
    expect(types().at(-1)).toBe("friday.voice.tts_ended");
  });

  it("close() ends what is open (interrupted) and ignores malformed control text", () => {
    const { telemetry, types } = rig();
    telemetry.onVoiceControl("not json");
    telemetry.onVoiceControl('{"type":"status","state":"listening"}');
    expect(types()).toEqual([]);
    telemetry.onOutputFrame(tone(300));
    telemetry.close();
    expect(types().at(-1)).toBe("friday.voice.tts_ended");
  });

  it("publishes numbers only", () => {
    const { telemetry, events } = rig();
    telemetry.setVoiceMode("listening");
    telemetry.onInputFrame(tone(300));
    telemetry.onOutputFrame(tone(300));
    for (const event of events) expect(JSON.stringify(event.data)).not.toMatch(/pcm|base64|samples|text/i);
  });
});
