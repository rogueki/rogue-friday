import type { VoiceMetrics, VoiceStatus } from "@friday/sdk";
import { AdapterError, defineMapper, type MapContext } from "@friday/adapter-core";
import {
  RAW_LATENCY_KEYS,
  RAW_VOICE_PHASES,
  RAW_VOICE_STATES,
  type RawAudioLevels,
  type RawLatency,
  type RawLatencyStat,
  type RawOutputVoice,
  type RawSpeakerProfile,
  type RawVoicePhase,
  type RawVoiceState,
  type RawVoiceStatus,
  type RawWakeCalibration,
} from "./provider-types";

/** Operator-visible settings that the status server does not deliver (see README, "Annahme (unbelegt)"). */
export interface VoiceSettings {
  cloudMode: boolean;
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

const BAND_KEYS = ["peak", "low", "mid", "high"] as const;

/**
 * Additive diagnostics are tolerated, never fatal: an object that is not `{ level: number, ... }` is dropped, optional
 * members that are not finite numbers are dropped, valid ones are clamped to 0..1.
 */
function parseAudioLevels(value: unknown): RawAudioLevels | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.level !== "number" || !Number.isFinite(record.level)) return undefined;
  const result: RawAudioLevels = { level: clampLevel(record.level) };
  for (const key of BAND_KEYS) {
    const member = record[key];
    if (typeof member === "number" && Number.isFinite(member)) result[key] = clampLevel(member);
  }
  return result;
}

const isIsoTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isFraction = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

function isSpeakerProfile(value: unknown): value is RawSpeakerProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return isIsoTime(item.updated_at) && isFraction(item.threshold) &&
    (item.sample_count === null || (Number.isInteger(item.sample_count) && (item.sample_count as number) >= 0)) &&
    (item.quality === null || isFraction(item.quality)) && (item.calibrated_at === null || isIsoTime(item.calibrated_at));
}

function isWakeCalibration(value: unknown): value is RawWakeCalibration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (item.engine === "openwakeword" || item.engine === "personal") &&
    (item.threshold === null || (typeof item.threshold === "number" && Number.isFinite(item.threshold) && item.threshold >= 0)) &&
    (item.quality === null || item.quality === "good" || item.quality === "medium" || item.quality === "weak") &&
    (item.hit_rate === null || isFraction(item.hit_rate)) && (item.own_clips === null || isCount(item.own_clips)) &&
    (item.calibrated_at === null || isIsoTime(item.calibrated_at)) &&
    (item.format === undefined || item.format === null || (isCount(item.format) && item.format >= 1));
}

function isOutputVoice(value: unknown): value is RawOutputVoice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (item.choice === null || typeof item.choice === "string") &&
    (item.kind === "clone" || item.kind === "preset" || item.kind === "cloud") &&
    Array.isArray(item.available) && item.available.length <= 8 && item.available.every((entry) => typeof entry === "string") &&
    (item.reference_updated_at === null || isIsoTime(item.reference_updated_at)) &&
    (item.needs_voice_update === undefined || typeof item.needs_voice_update === "boolean");
}

const CONVERSATION_ERRORS = ["auth", "quota", "rate", "idle", "model", "network", "protocol"];
function isConversation(value: unknown): value is NonNullable<RawVoiceStatus["conversation"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (item.backend === "local" || item.backend === "qwen") && typeof item.key_configured === "boolean" &&
    typeof item.consent === "boolean" &&
    (item.last_error === null || CONVERSATION_ERRORS.includes(String(item.last_error)));
}

const isMillis = (value: unknown): value is number | null => value === null || isCount(value);

function isLatencyStat(value: unknown): value is RawLatencyStat {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return isMillis(item.current_ms) && isMillis(item.avg_ms) && isMillis(item.p95_ms) && isCount(item.count);
}

function isLatency(value: unknown): value is RawLatency {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return RAW_LATENCY_KEYS.every((key) => item[key] === undefined || isLatencyStat(item[key]));
}

function isSpeakerDecision(value: unknown): value is { decision: "verified" | "rejected"; score: number; at: string } {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (item.decision === "verified" || item.decision === "rejected") && typeof item.score === "number" &&
    Number.isFinite(item.score) && typeof item.at === "string" && !Number.isNaN(Date.parse(item.at));
}

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
  const input = parseAudioLevels(raw.input_audio);
  const output = parseAudioLevels(raw.output_audio);
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
    // Unknown phase names (newer services) are ignored: the phase is then derived from `state`.
    ...(typeof raw.phase === "string" && (RAW_VOICE_PHASES as readonly string[]).includes(raw.phase)
      ? { phase: raw.phase as RawVoicePhase }
      : {}),
    ...(typeof raw.tts_active === "boolean" ? { tts_active: raw.tts_active } : {}),
    ...(input ? { input_audio: input } : {}),
    ...(output ? { output_audio: output } : {}),
    ...(raw.audio_transport === "device" || raw.audio_transport === "browser" ? { audio_transport: raw.audio_transport } : {}),
    ...(raw.host_platform === "windows" || raw.host_platform === "linux" ? { host_platform: raw.host_platform } : {}),
    ...(typeof raw.trusted_remaining_s === "number" && Number.isFinite(raw.trusted_remaining_s) && raw.trusted_remaining_s >= 0
      ? { trusted_remaining_s: raw.trusted_remaining_s } : {}),
    ...(isSpeakerDecision(raw.speaker_decision) ? { speaker_decision: raw.speaker_decision } : {}),
    ...(raw.speaker_profile === null || isSpeakerProfile(raw.speaker_profile) ? { speaker_profile: raw.speaker_profile } : {}),
    ...(raw.wake_calibration === null || isWakeCalibration(raw.wake_calibration) ? { wake_calibration: raw.wake_calibration } : {}),
    ...(isOutputVoice(raw.output_voice) ? { output_voice: raw.output_voice } : {}),
    ...(isConversation(raw.conversation) ? { conversation: raw.conversation } : {}),
    ...(isLatency(raw.latency) ? { latency: raw.latency } : {}),
    ...(typeof raw.service_started_at === "string" ? { service_started_at: raw.service_started_at } : {}),
    ...(typeof raw.service_version === "string" ? { service_version: raw.service_version } : {}),
    ...(typeof raw.tts_voice_choice === "string" || raw.tts_voice_choice === null ? { tts_voice_choice: raw.tts_voice_choice } : {}),
    ...(typeof raw.input_device_id === "string" || raw.input_device_id === null ? { input_device_id: raw.input_device_id } : {}),
    ...(typeof raw.output_device_id === "string" || raw.output_device_id === null ? { output_device_id: raw.output_device_id } : {}),
    ...(typeof raw.ptt_active === "boolean" ? { ptt_active: raw.ptt_active } : {}),
    ...(typeof raw.native_ptt_available === "boolean" ? { native_ptt_available: raw.native_ptt_available } : {}),
    ...(typeof raw.runtime_settings === "object" && raw.runtime_settings !== null && !Array.isArray(raw.runtime_settings) &&
      typeof (raw.runtime_settings as Record<string, unknown>).wakeWordEnabled === "boolean" &&
      typeof (raw.runtime_settings as Record<string, unknown>).speakerVerificationRequired === "boolean" &&
      typeof (raw.runtime_settings as Record<string, unknown>).storeRawRecordings === "boolean" &&
      typeof (raw.runtime_settings as Record<string, unknown>).voiceHistoryEnabled === "boolean" &&
      ["de", "en"].includes(String((raw.runtime_settings as Record<string, unknown>).sttLanguage)) &&
      ((raw.runtime_settings as Record<string, unknown>).sttModel === null ||
        (typeof (raw.runtime_settings as Record<string, unknown>).sttModel === "string" &&
          /^[a-z0-9][a-z0-9.-]{0,63}$/.test((raw.runtime_settings as Record<string, string>).sttModel ?? ""))) &&
      ["local", "qwen"].includes(String((raw.runtime_settings as Record<string, unknown>).conversationBackend)) &&
      typeof (raw.runtime_settings as Record<string, unknown>).conversationConsent === "boolean" &&
      typeof (raw.runtime_settings as Record<string, unknown>).wakeWord === "string" &&
      typeof (raw.runtime_settings as Record<string, unknown>).pushToTalkKey === "string" &&
      typeof (raw.runtime_settings as Record<string, unknown>).ttsRate === "number"
      ? { runtime_settings: raw.runtime_settings as RawVoiceStatus["runtime_settings"] } : {}),
  };
}

export interface VoiceStatusInput {
  raw: RawVoiceStatus;
  settings: VoiceSettings;
  localModel: LocalModelProbe;
}

/** A speaker decision is shown as the present state only this long after the service made it. */
const SPEAKER_DECISION_TTL_MS = 60_000;

const IN_COMMAND: ReadonlySet<RawVoiceState> = new Set(["command", "followup"]);

/**
 * Orb-relevant pipeline phase (docs/MAPPING/voice.md §2). Newer services report `phase` (listening, transcribing,
 * thinking, speaking, idle); `state == command` alone also covers speaker check, STT, routing and the wait for Hermes
 * (JV:409-459), which is why older services can only ever yield listening/speaking/idle. TTS playback always wins.
 */
export function toVoicePhase(raw: RawVoiceStatus): RawVoicePhase {
  if (raw.speaking || raw.tts_active === true || raw.state === "speaking") return "speaking";
  if (raw.phase !== undefined) return raw.phase;
  return IN_COMMAND.has(raw.state) ? "listening" : "idle";
}

export function toVoiceMode(raw: RawVoiceStatus): VoiceStatus["mode"] {
  return toVoicePhase(raw);
}

export const voiceStatusMapper = defineMapper<VoiceStatusInput, VoiceStatus>({
  name: "Friday Voice status -> VoiceStatus",
  schema: "VoiceStatus",
  toCanonical({ raw, settings, localModel }, context: MapContext) {
    const starting = raw.state === "starting";
    const paused = raw.state === "paused";
    const inCommand = IN_COMMAND.has(raw.state);
    const phase = toVoicePhase(raw);
    const waiting = raw.state === "waiting_audio";
    const focusMode = typeof raw.game_mode === "string" && raw.game_mode.length > 0;
    const verificationEnabled = raw.runtime_settings?.speakerVerificationRequired ?? true;
    const nowMs = Date.parse(context.syncedAt);
    // A decision is current only for a short while; an old rejection must not be shown as the present state.
    const decision = raw.speaker_decision && nowMs - Date.parse(raw.speaker_decision.at) <= SPEAKER_DECISION_TTL_MS
      ? raw.speaker_decision : null;
    const speakerState = !verificationEnabled ? "disabled" : raw.trusted ? "verified" : decision?.decision === "rejected" ? "rejected" : "idle";
    return {
      updatedAt: context.syncedAt,
      source: context.source(),
      mode: toVoiceMode(raw),
      // The input stream runs in every state except `starting` (JV:468-472); barge-in keeps it open while speaking.
      microphone: {
        // The mic stays open while the command is processed (barge-in), but the user is no longer being recorded.
        state:
          starting || waiting
            ? "off"
            : paused
              ? "muted"
              : phase === "listening" || (inCommand && phase === "speaking")
                ? "listening"
                : "idle",
        active: !starting && !waiting && !paused,
        deviceId: null,
        // Smoothed RMS of the last input blocks (`input_level`). Services without the meter report nothing: 0 = no data.
        inputLevel: raw.input_level ?? 0,
      },
      wakeWord: {
        enabled: !starting && !waiting && !paused && (raw.runtime_settings?.wakeWordEnabled ?? true),
        state: starting || waiting || paused ? "disabled" : inCommand ? "triggered" : "armed",
        // The service reports the phrase chosen at install time; older services fall back to the configured value.
        phrase: raw.runtime_settings?.wakeWord ?? raw.wake_phrase ?? settings.wakePhrase,
      },
      // The service compares against the single enrolled owner profile, so a verified speaker is that profile's owner;
      // any other state names nobody.
      speakerVerification: {
        enabled: verificationEnabled,
        state: speakerState,
        recognizedSpeaker: speakerState === "verified" ? "Owner" : null,
        confidence: (speakerState === "verified" || speakerState === "rejected") && decision
          ? Math.min(1, Math.max(0, decision.score)) : null,
      },
      trustedSession: {
        active: raw.trusted,
        expiresAt: raw.trusted && typeof raw.trusted_remaining_s === "number"
          ? new Date(nowMs + raw.trusted_remaining_s * 1000).toISOString() : null,
      },
      // Models load before the server opens its port (JV:285-297): reachable means loaded.
      stt: { engine: settings.sttEngine, state: phase === "transcribing" ? "busy" : "ready", latencyMs: null },
      // During the gaming mode the service switches to Piper (JV:565).
      tts: {
        engine: focusMode && !settings.cloudMode ? "piper" : settings.ttsEngine,
        state: phase === "speaking" ? "busy" : "ready",
        latencyMs: null,
      },
      localModel: { name: settings.localModelName, state: localModel.state, latencyMs: null },
      audioInputDeviceId: raw.input_device_id ?? null,
      audioOutputDeviceId: raw.output_device_id ?? null,
      serviceStartedAt: raw.service_started_at ?? null,
      audioDeviceWaiting: waiting,
      ttsVoiceChoice: raw.tts_voice_choice ?? null,
      ...(raw.wake_calibration !== undefined
        ? { wakeCalibration: raw.wake_calibration === null ? null : {
            engine: raw.wake_calibration.engine,
            threshold: raw.wake_calibration.threshold,
            quality: raw.wake_calibration.quality,
            hitRate: raw.wake_calibration.hit_rate,
            ownClips: raw.wake_calibration.own_clips,
            calibratedAt: raw.wake_calibration.calibrated_at,
            formatVersion: raw.wake_calibration.format ?? null,
          } }
        : {}),
      ...(raw.output_voice
        ? { outputVoice: {
            choice: raw.output_voice.choice,
            kind: raw.output_voice.kind,
            available: [...raw.output_voice.available],
            referenceUpdatedAt: raw.output_voice.reference_updated_at,
            needsVoiceUpdate: raw.output_voice.needs_voice_update ?? false,
          } }
        : {}),
      ...(raw.audio_transport === "device" || raw.audio_transport === "browser"
        ? { audioPath: { transport: raw.audio_transport,
            host: raw.host_platform === "windows" || raw.host_platform === "linux" ? raw.host_platform : null } }
        : {}),
      pushToTalk: { enabled: (raw.audio_transport === "browser" || raw.native_ptt_available === true) && raw.runtime_settings !== undefined,
        active: raw.ptt_active === true },
      focusMode,
      // The service only stores command audio when the owner has enabled recording.
      rawRecordingEnabled: raw.runtime_settings?.storeRawRecordings ?? false,
      voiceHistoryEnabled: raw.runtime_settings?.voiceHistoryEnabled ?? true,
      ...(raw.conversation
        ? { conversation: { backend: raw.conversation.backend, keyConfigured: raw.conversation.key_configured,
            consent: raw.conversation.consent, lastError: raw.conversation.last_error } }
        : {}),
    };
  },
});

const NO_DATA = { currentMs: null, avgMs: null, p95Ms: null, sampleCount: 0 } as const;

const toLatencyStat = (stat: RawLatencyStat | undefined) =>
  stat === undefined ? { ...NO_DATA } : { currentMs: stat.current_ms, avgMs: stat.avg_ms, p95Ms: stat.p95_ms, sampleCount: stat.count };

/**
 * Measured windows of the voice service. `firstToken` is the complete Hermes reply (no streaming, external model
 * latency); `ttsFirstAudio` is the answer start from the end of the recording to the first played audio.
 */
export const voiceMetricsMapper = defineMapper<RawLatency, VoiceMetrics>({
  name: "Friday Voice latency -> VoiceMetrics",
  schema: "VoiceMetrics",
  toCanonical: (raw, context) => ({
    sampledAt: context.syncedAt,
    source: context.source(),
    wakeWordLatency: { ...NO_DATA },
    speakerVerificationLatency: toLatencyStat(raw.speaker),
    sttLatency: toLatencyStat(raw.stt),
    routerLatency: toLatencyStat(raw.router),
    firstToken: toLatencyStat(raw.model),
    ttsFirstAudio: toLatencyStat(raw.answer_start),
  }),
});

/** Older status servers deliver no latencies; `sampleCount: 0` marks "keine Datenquelle". */
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
