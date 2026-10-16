import { describe, expect, it } from "vitest";
import { AdapterError, createMapContext, findForbiddenKeys, systemClock } from "@friday/adapter-core";
import {
  PROVIDER_SYSTEM,
  RAW_VOICE_STATES,
  emptyVoiceMetricsMapper,
  manifest,
  parseRawVoiceStatus,
  toVoiceMode,
  voiceStatusMapper,
  type RawVoiceStatus,
  type VoiceSettings,
} from "../src";
import { makeVoiceStatus } from "./fake/voice-status-server";

const settings: VoiceSettings = {
  cloudMode: false,
  wakePhrase: "Hey Jarvis",
  sttEngine: "faster-whisper",
  ttsEngine: "piper",
  localModelName: "qwen3-router",
};
const context = () =>
  createMapContext({ adapterId: manifest.id, system: PROVIDER_SYSTEM, clock: systemClock });
const map = (raw: RawVoiceStatus, localState: "ready" | "busy" | "error" | "offline" = "ready") =>
  voiceStatusMapper.map({ raw, settings, localModel: { state: localState } }, context());

describe("input_level / output_level", () => {
  const base = makeVoiceStatus();
  it("are optional and numbers only", () => {
    expect(parseRawVoiceStatus({ ...base })).not.toHaveProperty("input_level");
    expect(parseRawVoiceStatus({ ...base, input_level: 0.25, output_level: 0 })).toMatchObject({
      input_level: 0.25,
      output_level: 0,
    });
    expect(() => parseRawVoiceStatus({ ...base, input_level: "loud" })).toThrow();
    expect(() => parseRawVoiceStatus({ ...base, output_level: null })).toThrow();
    expect(() => parseRawVoiceStatus({ ...base, input_level: Number.NaN })).toThrow();
  });
  it("clamps to 0..1 and maps input_level to microphone.inputLevel (0 = no data when absent)", () => {
    expect(parseRawVoiceStatus({ ...base, input_level: 3 }).input_level).toBe(1);
    expect(parseRawVoiceStatus({ ...base, input_level: -1 }).input_level).toBe(0);
    expect(map({ ...base, input_level: 0.6 }).microphone.inputLevel).toBe(0.6);
    expect(map(base).microphone.inputLevel).toBe(0);
  });
});

it("reports a paused voice service as muted with wake-word disabled", () => {
  const raw = parseRawVoiceStatus(makeVoiceStatus({ state: "paused" }));
  const status = map(raw);
  expect(status.microphone).toMatchObject({ state: "muted", active: false });
  expect(status.wakeWord).toMatchObject({ state: "disabled", enabled: false });
});

describe("parseRawVoiceStatus", () => {
  it("accepts the exact example of docs/MAPPING/voice.md §0.1", () => {
    const body = {
      state: "listening",
      started: "2026-10-14T09:12:03",
      last_event: null,
      wake_count: 0,
      rejected_speaker: 0,
      commands: 0,
      speaking: false,
      trusted: false,
    };
    expect(parseRawVoiceStatus(body)).toEqual(body);
  });

  it("keeps game_mode only when the service sent it", () => {
    expect(parseRawVoiceStatus(makeVoiceStatus({ game_mode: "game.exe" })).game_mode).toBe("game.exe");
    expect(parseRawVoiceStatus(makeVoiceStatus({ game_mode: null })).game_mode).toBeNull();
    expect("game_mode" in parseRawVoiceStatus(makeVoiceStatus())).toBe(false);
  });

  it("ignores unknown keys instead of forwarding them", () => {
    const parsed = parseRawVoiceStatus({ ...makeVoiceStatus(), secret_debug: "x" });
    expect("secret_debug" in parsed).toBe(false);
  });

  it.each([
    ["not an object", "listening"],
    ["array", []],
    ["null", null],
    ["unknown state", { ...makeVoiceStatus(), state: "booting" }],
    ["missing state", { ...makeVoiceStatus(), state: undefined }],
    ["started not a string", { ...makeVoiceStatus(), started: 5 }],
    ["last_event wrong type", { ...makeVoiceStatus(), last_event: 7 }],
    ["negative counter", { ...makeVoiceStatus(), wake_count: -1 }],
    ["fractional counter", { ...makeVoiceStatus(), commands: 1.5 }],
    ["speaking as string", { ...makeVoiceStatus(), speaking: "false" }],
    ["trusted missing", { ...makeVoiceStatus(), trusted: undefined }],
    ["game_mode number", { ...makeVoiceStatus(), game_mode: 3 }],
  ])("rejects %s with VALIDATION_FAILED", (_label, body) => {
    expect(() => parseRawVoiceStatus(body)).toThrowError(AdapterError);
    try {
      parseRawVoiceStatus(body);
    } catch (error) {
      expect((error as AdapterError).code).toBe("VALIDATION_FAILED");
      expect((error as AdapterError).retryable).toBe(false);
    }
  });
});

describe("toVoiceMode (docs/MAPPING/voice.md §2)", () => {
  const table: Array<[Partial<RawVoiceStatus>, string]> = [
    [{ state: "starting" }, "idle"],
    [{ state: "listening" }, "idle"],
    [{ state: "command" }, "listening"],
    [{ state: "followup" }, "listening"],
    [{ state: "speaking" }, "speaking"],
    [{ state: "listening", speaking: true }, "speaking"],
    [{ state: "command", speaking: true }, "speaking"],
  ];
  it.each(table)("%j -> %s", (patch, mode) => {
    expect(toVoiceMode(makeVoiceStatus(patch))).toBe(mode);
  });

  it("never derives transcribing/thinking/error from the status server", () => {
    for (const state of RAW_VOICE_STATES)
      for (const speaking of [false, true])
        expect(["idle", "listening", "speaking"]).toContain(
          toVoiceMode(makeVoiceStatus({ state, speaking })),
        );
  });
});

describe("voiceStatusMapper", () => {
  it("maps every service state to a contract-valid VoiceStatus", () => {
    for (const state of RAW_VOICE_STATES)
      for (const speaking of [false, true])
        for (const trusted of [false, true])
          expect(() => map(makeVoiceStatus({ state, speaking, trusted }))).not.toThrow();
  });

  it("listening: microphone idle but active, wake word armed", () => {
    const status = map(makeVoiceStatus({ state: "listening" }));
    expect(status.microphone).toEqual({ state: "idle", active: true, deviceId: null, inputLevel: 0 });
    expect(status.wakeWord).toEqual({ enabled: true, state: "armed", phrase: "Hey Jarvis" });
    expect(status.mode).toBe("idle");
  });

  it("prefers the wake phrase reported by a personalized service over the configured fallback", () => {
    const raw = {
      ...makeVoiceStatus({ state: "listening" }),
      assistant_name: "Friday",
      wake_phrase: "Hey Friday",
    };
    expect(map(parseRawVoiceStatus(raw)).wakeWord.phrase).toBe("Hey Friday");
    expect(() => parseRawVoiceStatus({ ...raw, wake_phrase: "" })).toThrow();
  });

  it("command: microphone listening, wake word triggered", () => {
    const status = map(makeVoiceStatus({ state: "command" }));
    expect(status.microphone.state).toBe("listening");
    expect(status.wakeWord.state).toBe("triggered");
    expect(status.mode).toBe("listening");
  });

  it("starting: microphone off and wake word disabled", () => {
    const status = map(makeVoiceStatus({ state: "starting" }));
    expect(status.microphone).toMatchObject({ state: "off", active: false });
    expect(status.wakeWord).toMatchObject({ enabled: false, state: "disabled" });
  });

  it("trusted maps to verified speaker and active trusted session without an invented expiry", () => {
    const status = map(makeVoiceStatus({ trusted: true }));
    expect(status.speakerVerification).toEqual({
      enabled: true,
      state: "verified",
      recognizedSpeaker: null,
      confidence: null,
    });
    expect(status.trustedSession).toEqual({ active: true, expiresAt: null });
    expect(map(makeVoiceStatus({ trusted: false })).speakerVerification.state).toBe("idle");
  });

  it("speaking flag drives tts busy; stt is ready; latencies stay null", () => {
    const status = map(makeVoiceStatus({ speaking: true }));
    expect(status.tts).toEqual({ engine: "piper", state: "busy", latencyMs: null });
    expect(status.stt).toEqual({ engine: "faster-whisper", state: "ready", latencyMs: null });
    expect(map(makeVoiceStatus()).tts.state).toBe("ready");
  });

  it("game_mode switches the focus mode on and forces Piper", () => {
    const status = map(makeVoiceStatus({ game_mode: "game.exe" }));
    expect(status.focusMode).toBe(true);
    expect(status.tts.engine).toBe("piper");
    expect(map(makeVoiceStatus({ game_mode: null })).focusMode).toBe(false);
    expect(map(makeVoiceStatus()).focusMode).toBe(false);
  });

  it("reports the router model state as probed", () => {
    for (const state of ["ready", "busy", "error", "offline"] as const)
      expect(map(makeVoiceStatus(), state).localModel).toEqual({
        name: "qwen3-router",
        state,
        latencyMs: null,
      });
  });

  it("states what the service does not do: no push-to-talk, no raw recordings, devices unknown", () => {
    const status = map(makeVoiceStatus());
    expect(status.pushToTalk).toEqual({ enabled: false, active: false });
    expect(status.rawRecordingEnabled).toBe(false);
    expect(status.audioInputDeviceId).toBeNull();
    expect(status.audioOutputDeviceId).toBeNull();
  });

  it("leaks no provider keys", () => {
    const status = map(makeVoiceStatus({ game_mode: "x", last_event: "2026-10-14T09:13:00" }));
    expect(
      findForbiddenKeys(status, [
        "wake_count",
        "rejected_speaker",
        "last_event",
        "game_mode",
        "commands",
        "started",
      ]),
    ).toEqual([]);
  });
});

describe("emptyVoiceMetricsMapper", () => {
  it("returns empty statistics for every latency (keine Datenquelle)", () => {
    const metrics = emptyVoiceMetricsMapper.map(null, context());
    for (const key of [
      "wakeWordLatency",
      "speakerVerificationLatency",
      "sttLatency",
      "routerLatency",
      "firstToken",
      "ttsFirstAudio",
    ] as const)
      expect(metrics[key]).toEqual({ currentMs: null, avgMs: null, p95Ms: null, sampleCount: 0 });
  });
});
