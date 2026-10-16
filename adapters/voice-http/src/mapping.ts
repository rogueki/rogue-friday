import type { VoiceMetrics, VoiceStatus } from "@friday/sdk";
import { AdapterError, defineMapper, type MapContext } from "@friday/adapter-core";
import { RAW_VOICE_STATES, type RawVoiceState, type RawVoiceStatus } from "./provider-types";

/** Operator-visible settings that the status server does not deliver (see README, "Annahme (unbelegt)"). */
export interface VoiceSettings {
  wakePhrase: string;
  sttEngine: string;
  ttsEngine: string;
  localModelName: string;
}

export interface LocalModelProbe {
  state: "ready" | "busy" | "error" | "offline";
}

const invalid = (reason: string): AdapterError =>
  new AdapterError({
    code: "VALIDATION_FAILED",
    message: `Voice-Status: unerwartete Antwortstruktur (${reason}).`,
    retryable: false,
  });

/** Levels are normalized by the service; anything outside 0..1 is clamped, not rejected (a level is only a hint). */
export const clampLevel = (value: number): number => Math.min(1, Math.max(0, value));

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * Validates the body of the status server. Unknown keys are ignored (never forwarded); a missing or mistyped
 * known key rejects the whole answer, so nothing half-valid reaches the canonical model.
 */
export function parseRawVoiceStatus(body: unknown): RawVoiceStatus {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalid("kein Objekt");
  const raw = body as Record<string, unknown>;
  const state = raw.state;
  if (typeof state !== "string" || !(RAW_VOICE_STATES as readonly string[]).includes(state))
    throw invalid("state");
  if (typeof raw.started !== "string" || raw.started.length === 0) throw invalid("started");
  if (raw.last_event !== null && typeof raw.last_event !== "string") throw invalid("last_event");
  for (const key of ["wake_count", "rejected_speaker", "commands"] as const)
    if (!isCount(raw[key])) throw invalid(key);
  if (typeof raw.speaking !== "boolean") throw invalid("speaking");
  if (typeof raw.trusted !== "boolean") throw invalid("trusted");
  if (raw.game_mode !== undefined && raw.game_mode !== null && typeof raw.game_mode !== "string")
    throw invalid("game_mode");
  for (const key of ["input_level", "output_level"] as const)
    if (raw[key] !== undefined && (typeof raw[key] !== "number" || !Number.isFinite(raw[key])))
      throw invalid(key);
  for (const key of ["assistant_name", "wake_phrase"] as const)
    if (raw[key] !== undefined && (typeof raw[key] !== "string" || raw[key] === "")) throw invalid(key);
  return {
    state: state as RawVoiceState,
    started: raw.started,
    last_event: raw.last_event,
    wake_count: raw.wake_count as number,
    rejected_speaker: raw.rejected_speaker as number,
    commands: raw.commands as number,
    speaking: raw.speaking,
    trusted: raw.trusted,
    ...(raw.game_mode !== undefined ? { game_mode: raw.game_mode } : {}),
    ...(typeof raw.assistant_name === "string" ? { assistant_name: raw.assistant_name } : {}),
    ...(typeof raw.wake_phrase === "string" ? { wake_phrase: raw.wake_phrase } : {}),
    ...(typeof raw.input_level === "number" ? { input_level: clampLevel(raw.input_level) } : {}),
    ...(typeof raw.output_level === "number" ? { output_level: clampLevel(raw.output_level) } : {}),
  };
}

export interface VoiceStatusInput {
  raw: RawVoiceStatus;
  settings: VoiceSettings;
  localModel: LocalModelProbe;
}

const IN_COMMAND: ReadonlySet<RawVoiceState> = new Set(["command", "followup"]);

/**
 * Orb-relevant semantic mode (docs/MAPPING/voice.md §2). `state == command` also covers speaker check, STT, routing
 * and the wait for Hermes (JV:409-459), so the finer modes `transcribing`/`thinking` are not derivable from the
 * status server and are never reported.
 */
export function toVoiceMode(raw: RawVoiceStatus): VoiceStatus["mode"] {
  if (raw.speaking || raw.state === "speaking") return "speaking";
  return IN_COMMAND.has(raw.state) ? "listening" : "idle";
}

export const voiceStatusMapper = defineMapper<VoiceStatusInput, VoiceStatus>({
  name: "Friday Voice status -> VoiceStatus",
  schema: "VoiceStatus",
  toCanonical({ raw, settings, localModel }, context: MapContext) {
    const starting = raw.state === "starting";
    const paused = raw.state === "paused";
    const inCommand = IN_COMMAND.has(raw.state);
    const focusMode = typeof raw.game_mode === "string" && raw.game_mode.length > 0;
    return {
      updatedAt: context.syncedAt,
      source: context.source(),
      mode: toVoiceMode(raw),
      // The input stream runs in every state except `starting` (JV:468-472); barge-in keeps it open while speaking.
      microphone: {
        state: starting ? "off" : paused ? "muted" : inCommand ? "listening" : "idle",
        active: !starting && !paused,
        deviceId: null,
        // Smoothed RMS of the last input blocks (`input_level`). Services without the meter report nothing: 0 = no data.
        inputLevel: raw.input_level ?? 0,
      },
      wakeWord: {
        enabled: !starting && !paused,
        state: starting || paused ? "disabled" : inCommand ? "triggered" : "armed",
        // The service reports the phrase chosen at install time; older services fall back to the configured value.
        phrase: raw.wake_phrase ?? settings.wakePhrase,
      },
      // The service only starts with a speaker profile (fail closed, JV:254-255). `trusted` is set only after a
      // successful verification (JV:422); who spoke and with which score is not exposed.
      speakerVerification: {
        enabled: true,
        state: raw.trusted ? "verified" : "idle",
        recognizedSpeaker: null,
        confidence: null,
      },
      // Remaining time is not exposed (window `trusted_session_s`, VS:98), so no expiry is invented.
      trustedSession: { active: raw.trusted, expiresAt: null },
      // Models load before the server opens its port (JV:285-297): reachable means loaded.
      stt: { engine: settings.sttEngine, state: "ready", latencyMs: null },
      // During the gaming mode the service switches to Piper (JV:565).
      tts: {
        engine: focusMode ? "piper" : settings.ttsEngine,
        state: raw.speaking ? "busy" : "ready",
        latencyMs: null,
      },
      localModel: { name: settings.localModelName, state: localModel.state, latencyMs: null },
      audioInputDeviceId: null,
      audioOutputDeviceId: null,
      pushToTalk: { enabled: false, active: false },
      focusMode,
      // The service never stores raw audio (module docstring); metadata goes to logs/voice.jsonl (JV:88-91).
      rawRecordingEnabled: false,
      voiceHistoryEnabled: true,
    };
  },
});

const NO_DATA = { currentMs: null, avgMs: null, p95Ms: null, sampleCount: 0 } as const;

/** The status server delivers no latencies; `sampleCount: 0` marks "keine Datenquelle". */
export const emptyVoiceMetricsMapper = defineMapper<null, VoiceMetrics>({
  name: "Friday Voice -> VoiceMetrics (keine Datenquelle)",
  schema: "VoiceMetrics",
  toCanonical: (_none, context) => ({
    sampledAt: context.syncedAt,
    source: context.source(),
    wakeWordLatency: { ...NO_DATA },
    speakerVerificationLatency: { ...NO_DATA },
    sttLatency: { ...NO_DATA },
    routerLatency: { ...NO_DATA },
    firstToken: { ...NO_DATA },
    ttsFirstAudio: { ...NO_DATA },
  }),
});
