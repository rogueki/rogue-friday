import { describe, expect, it } from "vitest";
import { AdapterError, createMapContext, findForbiddenKeys, systemClock } from "@friday/adapter-core";
import {
  PROVIDER_SYSTEM,
  RAW_VOICE_STATES,
  emptyVoiceMetricsMapper,
  manifest,
  parseRawVoiceStatus,
  toVoiceMode,
  voiceMetricsMapper,
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

  it("never derives transcribing/thinking/error from a service without the phase key", () => {
    for (const state of RAW_VOICE_STATES)
      for (const speaking of [false, true])
        expect(["idle", "listening", "speaking"]).toContain(
          toVoiceMode(makeVoiceStatus({ state, speaking })),
        );
  });

  const phaseTable: Array<[Partial<RawVoiceStatus>, string]> = [
    [{ state: "command", phase: "listening" }, "listening"],
    [{ state: "command", phase: "transcribing" }, "transcribing"],
    [{ state: "command", phase: "thinking" }, "thinking"],
    [{ state: "followup", phase: "thinking" }, "thinking"],
    [{ state: "command", phase: "thinking", speaking: true }, "speaking"], // acknowledgement while waiting for Hermes
    [{ state: "command", phase: "thinking", tts_active: true }, "speaking"],
    [{ state: "followup", phase: "listening" }, "listening"],
    [{ state: "speaking", phase: "speaking" }, "speaking"],
    [{ state: "listening", phase: "idle" }, "idle"],
    [{ state: "waiting_audio", phase: "idle" }, "idle"],
    [{ state: "paused", phase: "idle" }, "idle"],
  ];
  it.each(phaseTable)("phase %j -> %s", (patch, mode) => {
    expect(toVoiceMode(makeVoiceStatus(patch))).toBe(mode);
  });

  it("transcribing: STT busy, microphone no longer recording; thinking keeps the stream open but idle", () => {
    const transcribing = map(makeVoiceStatus({ state: "command", phase: "transcribing" }));
    expect(transcribing.mode).toBe("transcribing");
    expect(transcribing.stt.state).toBe("busy");
    expect(transcribing.microphone).toMatchObject({ state: "idle", active: true });
    const thinking = map(makeVoiceStatus({ state: "command", phase: "thinking" }));
    expect(thinking.mode).toBe("thinking");
    expect(thinking.stt.state).toBe("ready");
    const speaking = map(makeVoiceStatus({ state: "speaking", speaking: true, phase: "speaking" }));
    expect(speaking.tts.state).toBe("busy");
  });

  it("waiting_audio (Linux browser transport): microphone off, wake word disabled", () => {
    const status = map(makeVoiceStatus({ state: "waiting_audio", phase: "idle" }));
    expect(status.microphone).toMatchObject({ state: "off", active: false });
    expect(status.wakeWord).toMatchObject({ enabled: false, state: "disabled" });
    expect(status.mode).toBe("idle");
    expect(status.audioDeviceWaiting).toBe(true);
    expect(map(makeVoiceStatus({ state: "listening" })).audioDeviceWaiting).toBe(false);
  });

  it("parses the additive phase / band keys leniently and clamps them", () => {
    const base = makeVoiceStatus();
    const parsed = parseRawVoiceStatus({
      ...base,
      phase: "thinking",
      tts_active: false,
      audio_transport: "browser",
      input_audio: { level: 0.4, peak: 2, low: 0.3, mid: 0.2, high: "x" },
      output_audio: { level: 0.1 },
    });
    expect(parsed).toMatchObject({
      phase: "thinking",
      tts_active: false,
      audio_transport: "browser",
      input_audio: { level: 0.4, peak: 1, low: 0.3, mid: 0.2 },
      output_audio: { level: 0.1 },
    });
    expect(parsed.input_audio).not.toHaveProperty("high");
    const junk = parseRawVoiceStatus({ ...base, phase: "dreaming", tts_active: "yes", input_audio: "loud", output_audio: { peak: 1 }, audio_transport: "usb" });
    expect(junk).not.toHaveProperty("phase");
    expect(junk).not.toHaveProperty("tts_active");
    expect(junk).not.toHaveProperty("input_audio");
    expect(junk).not.toHaveProperty("output_audio");
    expect(junk).not.toHaveProperty("audio_transport");
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
      recognizedSpeaker: "Owner",
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

  it("reports the audio path and the host that owns it", () => {
    expect(
      map(parseRawVoiceStatus(makeVoiceStatus({ audio_transport: "device", host_platform: "linux" }))).audioPath,
    ).toEqual({
      transport: "device",
      host: "linux",
    });
    expect(map(makeVoiceStatus({ audio_transport: "browser" })).audioPath).toEqual({
      transport: "browser",
      host: null,
    });
    expect(
      map(parseRawVoiceStatus({ ...makeVoiceStatus({ audio_transport: "device" }), host_platform: "macos" })).audioPath,
    ).toEqual({
      transport: "device",
      host: null,
    });
    expect(map(makeVoiceStatus()).audioPath).toBeUndefined();
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

describe("speaker verification from the service (DASH-11.03)", () => {
  const T = context().syncedAt;
  const at = (offsetSeconds: number) => new Date(Date.parse(T) + offsetSeconds * 1000).toISOString();
  const raw = (patch: Record<string, unknown>): RawVoiceStatus =>
    parseRawVoiceStatus({ ...makeVoiceStatus(), ...patch });
  const runtimeSettings = (speakerVerificationRequired: boolean) => ({
    wakeWordEnabled: true,
    wakeWord: "Hey Jarvis",
    pushToTalkKey: "Ctrl+Space",
    speakerVerificationRequired,
    storeRawRecordings: false,
    voiceHistoryEnabled: true,
    sttLanguage: "de",
    sttModel: null,
    conversationBackend: "local",
    conversationConsent: false,
    conversationSilenceSeconds: 20,
    proactiveAnnouncements: true, conversationRegion: "ap-southeast-1",
    ttsRate: 1,
  });

  it("verified session reports the score and an expiry derived from the remaining time", () => {
    const status = map(raw({
      trusted: true,
      trusted_remaining_s: 90,
      speaker_decision: { decision: "verified", score: 0.82, at: at(0) },
    }));
    expect(status.speakerVerification).toMatchObject({ state: "verified", confidence: 0.82, recognizedSpeaker: "Owner" });
    expect(status.trustedSession.active).toBe(true);
    expect(status.trustedSession.expiresAt).toBe(new Date(Date.parse(status.updatedAt) + 90_000).toISOString());
  });

  it("current rejection: state rejected with its confidence", () => {
    const status = map(raw({ speaker_decision: { decision: "rejected", score: 0.31, at: at(-10) } }));
    expect(status.speakerVerification).toMatchObject({ state: "rejected", confidence: 0.31, recognizedSpeaker: null });
    expect(status.trustedSession).toEqual({ active: false, expiresAt: null });
  });

  it("an old rejection is not shown as the present state", () => {
    const status = map(raw({ speaker_decision: { decision: "rejected", score: 0.31, at: at(-120) } }));
    expect(status.speakerVerification).toMatchObject({ state: "idle", confidence: null });
  });

  it("disabled verification wins over a verified service flag", () => {
    const status = map(raw({
      trusted: true,
      runtime_settings: runtimeSettings(false),
      speaker_decision: { decision: "verified", score: 0.82, at: at(0) },
    }));
    expect(status.speakerVerification).toMatchObject({ enabled: false, state: "disabled", recognizedSpeaker: null });
  });

  it("clamps a negative score to zero", () => {
    const status = map(raw({ speaker_decision: { decision: "rejected", score: -0.2, at: at(0) } }));
    expect(status.speakerVerification).toMatchObject({ state: "rejected", confidence: 0 });
  });

  it("drops a malformed decision", () => {
    const status = map(raw({ speaker_decision: { decision: "maybe" } }));
    expect(status.speakerVerification).toMatchObject({ state: "idle", confidence: null });
  });
});

describe("voice latency windows", () => {
  const stat = { current_ms: 900, avg_ms: 1100, p95_ms: 1800, count: 40 };
  it("keeps valid windows and maps them; missing keys stay empty", () => {
    const raw = parseRawVoiceStatus({ ...makeVoiceStatus(), latency: { stt: stat, answer_start: stat } });
    expect(raw.latency).toEqual({ stt: stat, answer_start: stat });
    const metrics = voiceMetricsMapper.map(raw.latency!, context());
    expect(metrics.ttsFirstAudio).toEqual({ currentMs: 900, avgMs: 1100, p95Ms: 1800, sampleCount: 40 });
    expect(metrics.routerLatency).toEqual({ currentMs: null, avgMs: null, p95Ms: null, sampleCount: 0 });
  });
  it("drops a malformed window instead of forwarding it", () => {
    for (const latency of [{ stt: { ...stat, p95_ms: -1 } }, { stt: { ...stat, count: 1.5 } }, { model: "slow" }, [stat]]) {
      expect(parseRawVoiceStatus({ ...makeVoiceStatus(), latency }).latency).toBeUndefined();
    }
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

describe("voice artifacts (DASH-12.02)", () => {
  const wake = { engine: "personal", threshold: 2.4, quality: "good", hit_rate: 0.95, own_clips: 20, calibrated_at: "2026-10-30T09:00:00Z" };
  const voice = { choice: "custom", kind: "clone", available: ["friday-female", "custom"], reference_updated_at: "2026-10-30T09:05:00Z" };

  it("maps the wake calibration and the output voice as separate artifacts", () => {
    const status = map(parseRawVoiceStatus({ ...makeVoiceStatus(), wake_calibration: wake, output_voice: voice }));
    expect(status.wakeCalibration).toEqual({ engine: "personal", threshold: 2.4, quality: "good", hitRate: 0.95, ownClips: 20, calibratedAt: "2026-10-30T09:00:00Z", formatVersion: null });
    expect(status.outputVoice).toEqual({ choice: "custom", kind: "clone", available: ["friday-female", "custom"], referenceUpdatedAt: "2026-10-30T09:05:00Z", needsVoiceUpdate: false });
  });

  it("reports the wake model format and a pending voice update when the service sends them", () => {
    const status = map(parseRawVoiceStatus({
      ...makeVoiceStatus(),
      wake_calibration: { ...wake, format: 1 },
      output_voice: { ...voice, needs_voice_update: true },
    }));
    expect(status.wakeCalibration?.formatVersion).toBe(1);
    expect(status.outputVoice?.needsVoiceUpdate).toBe(true);
    const broken = map(parseRawVoiceStatus({ ...makeVoiceStatus(), wake_calibration: { ...wake, format: 0 }, output_voice: { ...voice, needs_voice_update: "yes" } }));
    expect(broken.wakeCalibration).toBeUndefined();
    expect(broken.outputVoice).toBeUndefined();
  });

  it("keeps an explicit null calibration and omits fields an older service does not send", () => {
    expect(map(parseRawVoiceStatus({ ...makeVoiceStatus(), wake_calibration: null })).wakeCalibration).toBeNull();
    const older = map(parseRawVoiceStatus(makeVoiceStatus()));
    expect(older.wakeCalibration).toBeUndefined();
    expect(older.outputVoice).toBeUndefined();
  });

  it("drops malformed artifacts instead of failing the status", () => {
    const status = map(parseRawVoiceStatus({
      ...makeVoiceStatus(),
      wake_calibration: { ...wake, quality: "excellent" },
      output_voice: { ...voice, available: "custom", path: "/home/owner/voice.wav" },
    }));
    expect(status.wakeCalibration).toBeUndefined();
    expect(status.outputVoice).toBeUndefined();
  });
});

describe("conversation", () => {
  const raw = (patch: Record<string, unknown>): RawVoiceStatus =>
    parseRawVoiceStatus({ ...makeVoiceStatus(), ...patch });

  it("maps the conversation backend, consent, key state and last error", () => {
    const status = map(raw({ conversation: { backend: "qwen", key_configured: true, consent: true, last_error: "quota" } }));
    expect(status.conversation).toEqual({ backend: "qwen", keyConfigured: true, consent: true, lastError: "quota" });
  });

  it("maps the installer voice mode and ignores unknown values", () => {
    expect(map(raw({ voice_mode: "elevenlabs" })).voiceMode).toBe("elevenlabs");
    expect(map(raw({ voice_mode: "local" })).voiceMode).toBe("local");
    expect(map(raw({ voice_mode: "cloud" })).voiceMode).toBeUndefined();
  });

  it("drops an invalid conversation block", () => {
    expect(map(raw({ conversation: { backend: "cloud", key_configured: true, consent: false, last_error: null } })).conversation)
      .toBeUndefined();
    expect(map(raw({ conversation: { backend: "qwen", key_configured: true, consent: false, last_error: "boom" } })).conversation)
      .toBeUndefined();
  });

  it("drops a conversation block without consent", () => {
    expect(map(raw({ conversation: { backend: "qwen", key_configured: true, last_error: null } })).conversation)
      .toBeUndefined();
  });
});
